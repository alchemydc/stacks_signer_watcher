require('dotenv').config();

// Check required environment variables
if (!process.env.MONITORED_SIGNER_PUBLIC_KEYS || !process.env.DISCORD_WEBHOOK_URL || !process.env.CHECK_INTERVAL || !process.env.API_URL || !process.env.REPEAT_CHECKS || !process.env.NOTIFY_HOURS_BEFORE_PREPARE_PHASE) {
  console.error('Missing required environment variable(s). Please check the README for instructions on how to set them.');
  process.exit(1);
}


const axios = require('axios');
const debug = require('debug')('http');
// invoke as `DEBUG=http node app.js` to see HTTP requests and responses
const BigNumber = require('bignumber.js');

const monitoredSignerPublicKeys = process.env.MONITORED_SIGNER_PUBLIC_KEYS.split(','); // read signer public keys from environment variable
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL; // read Discord webhook URL from environment variable
const checkInterval = Number(process.env.CHECK_INTERVAL); // read check interval from environment variable
const apiUrl = process.env.API_URL; // read API URL from environment variable
const repeatChecks = process.env.REPEAT_CHECKS; // read repeat checks from environment variable
const notifyHoursBeforePreparePhase = Number(process.env.NOTIFY_HOURS_BEFORE_PREPARE_PHASE); // read notify hours before prepare phase from environment variable

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
 * Get relevant info from the current POX cycle as well as the next POX cycle
 * 
*/
const getCurrentAndNextCycle = async () => {
  try {
    const response = await axios.get(`${apiUrl}/v2/pox`, {
    });
    const currentCycle = response.data.current_cycle;
    const nextCycle = response.data.next_cycle;
    return { currentCycle, nextCycle };
  } catch (error) {
    console.error(`Failed to fetch POX info for current and next cycle. Error: ${error.message}`);
    return null;
  }
}

/**
 * Get the signers for a given cycle.
 */
const getSigners = async (cycleId) => {
  try {
    //console.log("Request URI: " + `${apiUrl}/signer-metrics/v1/cycles/${cycleId}/signers`);
    const response = await axios.get(`${apiUrl}/signer-metrics/v1/cycles/${cycleId}/signers`, {
    });
    //console.log(response.data);
    console.log(`${response.data.total} of ${response.data.limit} possible signers registered found for cycleId: ${cycleId}`);
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch signers for cycleId: ${cycleId}. Error: ${error.message}`);
    return null;
  }
}


/**
 * Calculate the estimated time when the prepare phase for the next cycle will start
 * based on how many burnchain blocks are left until the prepare phase starts.
 * @param {int} blocksUntilPreparePhase - The number of burnchain blocks until the prepare phase starts.
 */
function calculatePreparePhaseStartTime(blocksUntilPreparePhase) {
  
  // burn chain has a 10 minute block time
  const blockTime = 10 * 60; // 10 minutes in seconds
  // current time in seconds
  const currentTime = Math.floor(Date.now() / 1000); // convert milliseconds to seconds
  console.log(`Current time: ${new Date(currentTime * 1000)}`);
  const preparePhaseStartTime = currentTime + (blocksUntilPreparePhase * blockTime);
  console.log(`Estimated time when the prepare phase for the next cycle will start: ${new Date(preparePhaseStartTime * 1000)}`);
  // log the hours until the prepare phase starts
  const hoursUntilPreparePhase = (preparePhaseStartTime - currentTime) / 3600;
  console.log(`Estimated hours until the prepare phase starts: ${hoursUntilPreparePhase}`);
  // send an alert if the prepare phase is starting in less than 72 hours
  if (preparePhaseStartTime - currentTime < notifyHoursBeforePreparePhase * 60 * 60) {
    const message = `Alert: The prepare phase for the next cycle is starting in ${blocksUntilPreparePhase} burnchain blocks. Estimated start time: ${new Date(preparePhaseStartTime * 1000)}`;
    console.log(message);
    sendDiscordNotification(message, 'preparePhaseStartTime');
  }
  return preparePhaseStartTime; 
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

/**
 * Analyze data for the current cycle and next cycle and send alerts as necessary
 * Specifically we are looking to see if the prepare phase for the next cycle is starting soon
 * STX must be locked before the prepare phase for the next reward cycle starts
 * So if you don't lock and commit STX prior to the start of the prepare phase, you will miss out on rewards for the next cycle
 */
function analyzePOXCycles(currentCycle, nextCycle) {
  console.log('Current POX cycle:', currentCycle);
   console.log('Next POX cycle:', nextCycle);
   const currentCycleID = currentCycle.id;
   const currentCycleMinThreshold = currentCycle.min_threshold_ustx;
   console.log('Current POX cycle ID:', currentCycleID);
   console.log('Current POX cycle minimum threshold:', currentCycleMinThreshold + "ustx");
   const nextCycleID = nextCycle.id;
   console.log('Next POX cycle ID:', nextCycleID);
   console.log("next POC cycle minimum threshold:", nextCycle.min_threshold_ustx + "ustx");
   console.log("next cycle prepare phase starts in " + nextCycle.blocks_until_prepare_phase + " burnchain blocks");
   calculatePreparePhaseStartTime(nextCycle.blocks_until_prepare_phase);
}

/**
 * Check and see if the signers we are monitoring are in the active set for the current cycle
 * If they are, then we will check their stake and send a notification if it is below the minimum threshold
 * If any of our monitored signers are not in the active set, then we will send a notification
 * Takes a list of signer public keys that we are monitoring and the signers for the current cycle as params
 * @param {Array} monitoredSignerPublicKeys - The public keys of the signers we are monitoring.
 * @param {Object} cycleSigners - The signers for the current cycle.
*/
function checkSignersInActiveSet(monitoredSignerPublicKeys, cycleSigners, minimumRequiredStake) {
  // iterate over each signer and see if it is one of the ones we care about
  cycleSigners.results.forEach((signer) => {
    //console.log("Evaluating signer: " + signer.signer_key);
    if 
    (monitoredSignerPublicKeys.includes(signer.signer_key)) {
      console.log("Found our signer in active set for cycle: " + signer.signer_key);
      console.log(signer);
      console.log(`Checking stake for signer ${signer.signer_key}`);
      console.log(`Stacked amount: ${signer.stacked_amount}`);
      console.log(`Minimum threshold: ${minimumRequiredStake}`);
      checkSignerStake(signer.signer_key, signer.stacked_amount, minimumRequiredStake);
    }
  });
}

function checkMissingSigners(cycleSigners, monitoredSignerPublicKeys) {
  // Find signers that are monitored but not in cycle
  const missingFromCycle = monitoredSignerPublicKeys.filter(monitoredKey => 
      !cycleSigners.results.some(signer => signer.signer_key === monitoredKey)
  );

  // Send notifications for missing signers
  if (missingFromCycle.length > 0) {
      const message = `Alert: The following monitored signers are not in the active set for the current cycle: ${missingFromCycle.join(', ')}`;
      console.log(message);
      sendDiscordNotification(message, 'missing-signers');
  }
}


// Export functions for testing
module.exports = {
  getCurrentAndNextCycle,
  calculatePreparePhaseStartTime,
  getSigners,
  checkSignerStake,
  sendDiscordNotification,
  lastNotificationTimes,
  analyzePOXCycles,
  checkSignersInActiveSet,
  checkMissingSigners
};

async function main() {

console.log('Starting Stacks Signer Watcher');
console.log("Signer Public Keys: " + monitoredSignerPublicKeys);
console.log("Using API URL: " + apiUrl);
console.log('lastNotificationTimes:', lastNotificationTimes);
console.log("Discord webhook URL: " + discordWebhookUrl);
console.log("Checking status every " + checkInterval + " seconds");
console.log(`Notifying ~${notifyHoursBeforePreparePhase} hours before next prepare phase begins`);

if (repeatChecks == "true") {
  console.log("Repeat checks enabled");
  console.log("Will run checks every " + checkInterval + " seconds");
  setInterval(async () => {
    console.log('Getting data for current and next POX cycles')
    const { currentCycle, nextCycle } = await getCurrentAndNextCycle();
    console.log('Analyzing POX cycles');
    analyzePOXCycles(currentCycle, nextCycle);
    const cycleSigners = await getSigners(currentCycle.id);
    checkMissingSigners(cycleSigners, monitoredSignerPublicKeys);
    checkSignersInActiveSet(monitoredSignerPublicKeys, cycleSigners, currentCycle.min_threshold_ustx); 
   }, checkInterval * 1000);
 } else {
   console.log("Repeat checks disabled, running once then will exit");
   console.log('Getting data for current and next POX cycles')
   const { currentCycle, nextCycle } = await getCurrentAndNextCycle();
   console.log('Analyzing POX cycles');
   analyzePOXCycles(currentCycle, nextCycle);
   const cycleSigners = await getSigners(currentCycle.id);
   checkMissingSigners(cycleSigners, monitoredSignerPublicKeys);
   checkSignersInActiveSet(monitoredSignerPublicKeys, cycleSigners, currentCycle.min_threshold_ustx);
   
 }

}

main().catch(console.error);

