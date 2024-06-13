// Import the necessary modules
const axios = require('axios');
const BigNumber = require('bignumber.js');
const { getCurrentCycle } = require('../src/app.js'); 
const { sendDiscordNotification } = require('../src/app.js'); 
const { lastNotificationTimes } = require('../src/app.js'); 

console.log('lastNotificationTimes:', lastNotificationTimes);


const oneDayInMilliseconds = 24 * 60 * 60 * 1000;
const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;

// Mock the axios module
jest.mock('axios');

describe('sendDiscordNotification', () => {
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    axios.post.mockClear();
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  it('should send a Discord notification if 24 hours have passed since the last notification', async () => {
    const message = 'Test message';
    const validatorId = 'test-validator';

    // Set the last notification time to more than 24 hours ago
    lastNotificationTimes[validatorId] = Date.now() - oneDayInMilliseconds - 1;
    // originalLog('lastNotificationTimes:', lastNotificationTimes);
    // print out the value of onedayinmilliseconds
    // originalLog('oneDayInMilliseconds:', oneDayInMilliseconds);

    await sendDiscordNotification(message, validatorId);

    expect(axios.post).toHaveBeenCalledWith(discordWebhookUrl, { content: message });
    expect(console.log).toHaveBeenCalledWith(`Successfully sent Discord notification for validatorId: ${validatorId}`);
  });

  it('should not send a Discord notification if 24 hours have not passed since the last notification', async () => {
    const message = 'Test message';
    const validatorId = 'test-validator';

    // Set the last notification time to less than 24 hours ago
    lastNotificationTimes[validatorId] = Date.now() - oneDayInMilliseconds / 2;
    // originalLog('lastNotificationTimes:', lastNotificationTimes);

    await sendDiscordNotification(message, validatorId);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('should log an error if sending the Discord notification fails', async () => {
    const message = 'Test message';
    const validatorId = 'test-validator';

    // Make axios.post throw an error
    axios.post.mockRejectedValue(new Error('Test error'));

    // Set the last notification time to more than 24 hours ago so that the discord notification will attempt to be sent
    lastNotificationTimes[validatorId] = Date.now() - oneDayInMilliseconds - 1;
    
    await sendDiscordNotification(message, validatorId);
    // check to make sure the error is being thrown
    //originalLog(axios.post.mock);

    expect(console.error).toHaveBeenCalledWith(`Failed to send Discord notification for validatorId: ${validatorId}. Error: Test error`);
  });
});

describe('getCurrentCycle', () => {
  const originalLog = console.log;
  const originalError = console.error;

  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    axios.post.mockClear();
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  it('should return the current cycle from the API', async () => {
    // Mock response object
    const mockResponse = {
      data: {
        current_cycle: {
          id: 123, // Example ID, adjust based on your actual data structure
          min_threshold_ustx: 100000000000
        }
      }
    };

    // Mock axios.get to resolve with mockResponse
    axios.get.mockResolvedValue(mockResponse);

    // Call the function and assert the result
    const result = await getCurrentCycle();
    expect(result).toEqual(mockResponse.data.current_cycle);
  });

  it('should return null on error', async () => {
    // Mock axios.get to reject with an error
    axios.get.mockRejectedValue(new Error('Network error'));

    // Call the function and assert the result
    const result = await getCurrentCycle();
    expect(result).toBeNull();
  });
});


