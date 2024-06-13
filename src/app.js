require('dotenv').config();

// Check required environment variables
if (!process.env.SIGNER_PUBLIC_KEYS || !process.env.DISCORD_WEBHOOK_URL || !process.env.CHECK_INTERVAL || !process.env.API_URL || !process.env.REPEAT_CHECKS) {
  console.error('Missing required environment variable(s). Please check the README for instructions on how to set them.');
  process.exit(1);
}


const axios = require('axios');
const debug = require('debug')('http');
// invoke as `DEBUG=http node app.js` to see HTTP requests and responses
const BigNumber = require('bignumber.js');

const signerPublicKeys = process.env.SIGNER_PUBLIC_KEYS.split(','); // read signer public keys from environment variable
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL; // read Discord webhook URL from environment variable
const checkInterval = Number(process.env.CHECK_INTERVAL); // read check interval from environment variable
const apiUrl = process.env.API_URL; // read API URL from environment variable
const repeatChecks = process.env.REPEAT_CHECKS; // read repeat checks from environment variable

// Constants
const oneDayInMilliseconds = 24 * 60 * 60 * 1000;
const lastNotificationTimes = {}; // stores the last notification time for each validator to avoid notification fatigue

axios.interceptors.request.use(request => {
  debug('Starting Request', request)
  return request
})

axios.interceptors.response.use(response => {
  debug('Response:', response)
  return response
})

/**
 * Sends a Discord notification if 24 hours have passed since the last notification.
 * @param {string} message - The message to send.
 * @param {string} validatorId - The ID of the validator.
 */
const sendDiscordNotification = async (message, validatorId) => {
  const now = Date.now();
  const lastNotificationTime = lastNotificationTimes[validatorId];
  // log the last notification time for debugging
  // console.log(`Last notification time for validatorId ${validatorId}: ${lastNotificationTime}`)
  // only send a notification if 24 hours have passed since the last notification
  if (!lastNotificationTime || now - lastNotificationTime >= oneDayInMilliseconds) {
    console.log(`Sending Discord notification for validatorId: ${validatorId}`);
    try {
      await axios.post(discordWebhookUrl, {
        content: message
      });
      lastNotificationTimes[validatorId] = now; // update the last notification time
      console.log(`Successfully sent Discord notification for validatorId: ${validatorId}`);
    } catch (error) {
      console.error(`Failed to send Discord notification for validatorId: ${validatorId}. Error: ${error.message}`);
      console.log(error.message);
    }
  } else {
    console.log(`Suppressing Discord notification for validatorId: ${validatorId} because 24 hours have not passed since the last notification.`);
  } 
}

/**
 * Finds the current POX cycle.
 */
const getCurrentCycle = async () => {
  try {
    const response = await axios.get(`${apiUrl}/v2/pox`, {
    });

    //console.log(response.data.current_cycle);
    //const { data } = response.data;
    //console.log(data);
    //const currentCycle = response.data.current_cycle.id;
    const currentCycle = response.data.current_cycle;
    return currentCycle;
  } catch (error) {
    console.error(`Failed to fetch current cycle. Error: ${error.message}`);
    return null;
  }
}

/**
 * Check the status for a given signer public key in the current cycle
 @param {string} signerPublicKey - The public key of the signer.
 @param {int} cycleId - The ID of the cycle.
 @param {int} minThreshold - The minimum threshold an elected signer this cycle.
 */
const checkSigner = async (signerPublicKey, cycleId, currentCycleMinThreshold) => {
  try {
    //console.log(`Checking cycleId ${cycleId} for signer ${signerPublicKey}`);
    //console.log(`query: ${apiUrl}/extended/v2/pox/cycles/${cycleId}/signers/${signerPublicKey}`);
    const response = await axios.get(`${apiUrl}/extended/v2/pox/cycles/${cycleId}/signers/${signerPublicKey}`, {
    });
    const signer_stake = await checkSignerStake(signerPublicKey, response.data.stacked_amount, currentCycleMinThreshold);
  } catch (error) {
    // API should return http/400 if the signer is not found in the cycle
    if (error.response && error.response.status === 400) {
      const message=`Error: Signer ${signerPublicKey} not found in cycle ${cycleId}`;
      console.error(message);
      sendDiscordNotification(message, signerPublicKey);
    } else {
      // if the API call fails for any other reason, send a Discord notification
      const message=`Error: Failed to fetch signer for cycleId: ${cycleId}. Error: ${error.message}`;
      console.error(message);
      sendDiscordNotification(message, signerPublicKey);
  }
 }
}

/**
 * Check the total stake for a given signer and compare it to the minimum required.
 * Sends a Discord notification if the stake is below the minimum required.
 */
const checkSignerStake = (signerPublicKey, signerStake, requiredStake) => {
  const signerStakeWei = new BigNumber(signerStake);
  const requiredStakeWei = new BigNumber(requiredStake);
  const stakeDifference = signerStakeWei.minus(requiredStakeWei);
  const stakeDifferencePercentage = stakeDifference.dividedBy(requiredStakeWei).multipliedBy(100);

  console.log(`Signer ${signerPublicKey}: Current stake = ${signerStakeWei.toFixed(2)}, Minimum stake = ${requiredStakeWei.toFixed(2)}, Difference = ${stakeDifference.toFixed(2)} (${stakeDifferencePercentage.toFixed(2)}%)`);

  if (signerStakeWei.isLessThan(requiredStakeWei)) {
    const message = `Alert: The signer STX stake for signer ${signerPublicKey} is below the minimum. Current stake: ${signerStakeWei.toFixed(2)}, Minimum stake: ${requiredStakeWei.toFixed(2)}`;
    console.log(message);
    sendDiscordNotification(message, signerPublicKey);
  } else {
    console.log(`Signer ${signerPublicKey}: Stake is within acceptable range.`);
  }
}

// Export functions for testing
module.exports = {
  getCurrentCycle,
  checkSigner,
  checkSignerStake,
  sendDiscordNotification,
  lastNotificationTimes
};

async function main() {

console.log('Starting Stacks Signer Watcher');
console.log("Signer Public Keys: " + signerPublicKeys);
console.log("Using API URL: " + apiUrl);
console.log('lastNotificationTimes:', lastNotificationTimes);
console.log("Discord webhook URL: " + discordWebhookUrl);
console.log("Checking stake every " + checkInterval + " seconds");

if (repeatChecks == "true") {
  console.log("Repeat checks enabled");
  console.log("Will run checks every " + checkInterval + " seconds");
  setInterval(async () => {
    console.log('Checking current POX cycle')
    const currentCycle = await getCurrentCycle();
    const currentCycleID = currentCycle.id;
    const currentCycleMinThreshold = currentCycle.min_threshold_ustx;
    console.log('Current POX cycle ID:', currentCycleID);
    console.log('Current POX cycle minimum threshold:', currentCycleMinThreshold + "ustx");
    signerPublicKeys.forEach((signerPublicKey) => {
      checkSigner(signerPublicKey, currentCycleID, currentCycleMinThreshold);
    });
   }, checkInterval * 1000);
 } else {
   console.log("Repeat checks disabled, running once then will exit");
   console.log('Checking current POX cycle')
   const currentCycle = await getCurrentCycle();
   const currentCycleID = currentCycle.id;
   const currentCycleMinThreshold = currentCycle.min_threshold_ustx;
   console.log('Current POX cycle ID:', currentCycleID);
   console.log('Current POX cycle minimum threshold:', currentCycleMinThreshold + "ustx");
   signerPublicKeys.forEach((signerPublicKey) => {
    console.log('Checking signer:', signerPublicKey); 
    checkSigner(signerPublicKey, currentCycleID, currentCycleMinThreshold);
   });
 }

}

main().catch(console.error);

