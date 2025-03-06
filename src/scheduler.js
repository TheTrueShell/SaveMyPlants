const schedule = require('node-schedule');
const { locationOps, notificationOps } = require('./db');
const { getForecast, analyzeForecast, findNearbyLocations, cleanupWeatherCache } = require('./weather');
require('dotenv').config();

// Get configuration from .env
const WEATHER_UPDATE_FREQUENCY = parseInt(process.env.WEATHER_UPDATE_FREQUENCY || '60'); // Default 60 minutes
const MORNING_NOTIFICATION_HOUR = parseInt(process.env.MORNING_NOTIFICATION_HOUR || '7'); // Default 7am
const WARNING_TIME = parseInt(process.env.WARNING_TIME || '6'); // Default 6 hours
const GEOCACHE_DISTANCE = parseInt(process.env.GEOCACHE_DISTANCE || '10000'); // Default 10km

// Store active schedules
const activeSchedules = new Map();

/**
 * Initialize all schedulers
 * @param {Object} bot - Telegram bot instance
 */
function initializeSchedulers(bot) {
  // Schedule regular weather checks
  scheduleWeatherChecks(bot);
  
  // Schedule morning summaries
  scheduleMorningSummaries(bot);
  
  // Schedule cache cleanup
  schedule.scheduleJob('0 */3 * * *', cleanupWeatherCache); // Every 3 hours
  
  console.log('All schedulers initialized');
}

/**
 * Schedule regular weather checks for all locations
 * @param {Object} bot - Telegram bot instance
 */
function scheduleWeatherChecks(bot) {
  // Run every WEATHER_UPDATE_FREQUENCY minutes
  const job = schedule.scheduleJob(`*/${WEATHER_UPDATE_FREQUENCY} * * * *`, async () => {
    try {
      console.log('Running scheduled weather check');
      await checkAllLocationsWeather(bot);
    } catch (error) {
      console.error('Error in scheduled weather check:', error);
    }
  });
  
  activeSchedules.set('weatherChecks', job);
  
  // Also run an initial check immediately
  checkAllLocationsWeather(bot).catch(error => {
    console.error('Error in initial weather check:', error);
  });
}

/**
 * Schedule morning summaries for all locations
 * @param {Object} bot - Telegram bot instance
 */
function scheduleMorningSummaries(bot) {
  // Run every day at the configured morning hour
  const job = schedule.scheduleJob(`0 ${MORNING_NOTIFICATION_HOUR} * * *`, async () => {
    try {
      console.log('Running morning weather summaries');
      await sendMorningSummaries(bot);
    } catch (error) {
      console.error('Error in morning summaries:', error);
    }
  });
  
  activeSchedules.set('morningSummaries', job);
}

/**
 * Check weather for all locations and schedule notifications if needed
 * @param {Object} bot - Telegram bot instance
 */
async function checkAllLocationsWeather(bot) {
  // Get all locations from the database
  const allLocations = locationOps.getAllLocations.all();
  
  if (!allLocations.length) {
    console.log('No locations to check');
    return;
  }
  
  // Group nearby locations to minimize API calls
  const checkedCoordinates = new Set();
  const locationGroups = [];
  
  for (const location of allLocations) {
    const key = `${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`;
    
    // Skip if we've already checked this approximate location
    if (checkedCoordinates.has(key)) continue;
    
    // Find nearby locations
    const nearby = findNearbyLocations(
      location.latitude,
      location.longitude,
      GEOCACHE_DISTANCE,
      allLocations
    );
    
    // Mark these coordinates as checked
    checkedCoordinates.add(key);
    
    // Add the group
    if (nearby.length > 0) {
      locationGroups.push(nearby);
    }
  }
  
  // Process each group
  for (const group of locationGroups) {
    // Use the first location as the representative for the API call
    const repLocation = group[0];
    
    try {
      // Get weather forecast for this representative location
      const forecast = await getForecast(repLocation.latitude, repLocation.longitude);
      
      // Apply forecast to all locations in the group
      for (const location of group) {
        await processLocationForecast(bot, location, forecast);
      }
    } catch (error) {
      console.error(`Error processing location group (${repLocation.name}):`, error);
    }
  }
}

/**
 * Process forecast data for a specific location
 * @param {Object} bot - Telegram bot instance
 * @param {Object} location - Location data from the database
 * @param {Object} forecastData - Weather forecast data
 */
async function processLocationForecast(bot, location, forecastData) {
  try {
    // Analyze the forecast for freezing conditions
    const analysis = analyzeForecast(forecastData);
    
    // Get latest warning for this location (to detect when to send "all clear")
    const latestWarning = notificationOps.getLatestWarningForLocation.get(location.id);
    
    // Check if we should send a warning notification
    if (analysis.willFreezeSoon && !analysis.isBelowFreezing) {
      // Schedule a warning notification for now
      const notification = {
        locationId: location.id,
        notificationType: 'warning',
        scheduledFor: new Date().toISOString(),
        temperature: analysis.freezingForecast?.main?.temp,
        forecastTime: analysis.freezingTime?.toISOString()
      };
      
      // Add to database
      const result = notificationOps.addNotification.run(notification);
      
      // Send immediately
      if (result.lastInsertRowid) {
        await sendNotification(bot, result.lastInsertRowid);
      }
    }
    
    // Check if we should send a "now freezing" notification
    if (analysis.isBelowFreezing) {
      // Schedule a "now freezing" notification for now
      const notification = {
        locationId: location.id,
        notificationType: 'now_freezing',
        scheduledFor: new Date().toISOString(),
        temperature: analysis.currentTemp,
        forecastTime: new Date().toISOString()
      };
      
      // Add to database
      const result = notificationOps.addNotification.run(notification);
      
      // Send immediately
      if (result.lastInsertRowid) {
        await sendNotification(bot, result.lastInsertRowid);
      }
    }
    
    // Check if we should send an "all clear" notification
    if (analysis.allClear && latestWarning && !latestWarning.sent) {
      // Schedule an "all clear" notification for now
      const notification = {
        locationId: location.id,
        notificationType: 'all_clear',
        scheduledFor: new Date().toISOString(),
        temperature: analysis.currentTemp,
        forecastTime: new Date().toISOString()
      };
      
      // Add to database
      const result = notificationOps.addNotification.run(notification);
      
      // Send immediately
      if (result.lastInsertRowid) {
        await sendNotification(bot, result.lastInsertRowid);
      }
    }
  } catch (error) {
    console.error(`Error processing forecast for location ${location.name}:`, error);
  }
}

/**
 * Send morning summaries for all locations
 * @param {Object} bot - Telegram bot instance
 */
async function sendMorningSummaries(bot) {
  // Get all locations from the database
  const allLocations = locationOps.getAllLocations.all();
  
  if (!allLocations.length) {
    console.log('No locations for morning summaries');
    return;
  }
  
  // Group by user_id to avoid sending too many messages to the same user
  const locationsByUser = {};
  
  for (const location of allLocations) {
    if (!locationsByUser[location.user_id]) {
      locationsByUser[location.user_id] = [];
    }
    locationsByUser[location.user_id].push(location);
  }
  
  // Process each user's locations
  for (const userId in locationsByUser) {
    const userLocations = locationsByUser[userId];
    const freezingLocations = [];
    
    // Check forecast for each location
    for (const location of userLocations) {
      try {
        const forecast = await getForecast(location.latitude, location.longitude);
        const analysis = analyzeForecast(forecast);
        
        // If it will freeze today, add to the list
        if (analysis.morningWarning) {
          freezingLocations.push({
            location,
            analysis
          });
        }
      } catch (error) {
        console.error(`Error getting forecast for location ${location.name}:`, error);
      }
    }
    
    // If any locations will freeze today, send a summary notification
    if (freezingLocations.length > 0) {
      // Add a morning summary notification to the database
      const notification = {
        locationId: freezingLocations[0].location.id, // Use the first location as reference
        notificationType: 'morning_summary',
        scheduledFor: new Date().toISOString(),
        temperature: null,
        forecastTime: null
      };
      
      // Include data for all freezing locations
      const additionalData = {
        freezingLocations: freezingLocations.map(fl => ({
          locationId: fl.location.id,
          name: fl.location.name,
          temperature: fl.analysis.freezingForecast?.main?.temp,
          forecastTime: fl.analysis.freezingTime?.toISOString()
        }))
      };
      
      // Add to database with additional data
      const result = notificationOps.addNotification.run({
        ...notification,
        additionalData: JSON.stringify(additionalData)
      });
      
      // Send immediately
      if (result.lastInsertRowid) {
        await sendNotification(bot, result.lastInsertRowid);
      }
    }
  }
}

/**
 * Send a notification to the user
 * @param {Object} bot - Telegram bot instance
 * @param {number} notificationId - ID of the notification in the database
 */
async function sendNotification(bot, notificationId) {
  try {
    // Get the notification data with joined location and user info
    const notification = notificationOps.getPendingNotificationById?.get(notificationId);
    
    if (!notification) {
      console.error(`Notification not found: ${notificationId}`);
      return;
    }
    
    // Skip if already sent
    if (notification.sent) {
      return;
    }
    
    // Get the message based on notification type
    let message = '';
    
    switch (notification.notification_type) {
      case 'warning':
        message = `⚠️ Freezing alert! ${notification.location_name} will drop below ${process.env.TEMP_THRESHOLD || 0}°C ` +
          `in approximately ${WARNING_TIME} hours.\n\n` +
          `Expected temperature: ${notification.temperature?.toFixed(1)}°C\n` +
          `Expected time: ${new Date(notification.forecast_time).toLocaleString()}`;
        break;
      
      case 'now_freezing':
        message = `❄️ It's now freezing at ${notification.location_name}!\n\n` +
          `Current temperature: ${notification.temperature?.toFixed(1)}°C\n` +
          `Protect your plants from frost damage!`;
        break;
      
      case 'all_clear':
        message = `✅ All clear for ${notification.location_name}!\n\n` +
          `Temperatures are expected to stay above ${process.env.TEMP_THRESHOLD || 0}°C for the foreseeable future.\n` +
          `Current temperature: ${notification.temperature?.toFixed(1)}°C`;
        break;
      
      case 'morning_summary':
        // Parse the additional data for multiple locations
        let additionalData = {};
        try {
          additionalData = JSON.parse(notification.additional_data || '{}');
        } catch (error) {
          console.error('Error parsing additional data:', error);
        }
        
        const { freezingLocations = [] } = additionalData;
        
        message = `🌡️ Morning Frost Alert ☕\n\n` +
          `The following locations may experience freezing temperatures today:\n\n`;
        
        for (const fl of freezingLocations) {
          message += `- ${fl.name}: ${fl.temperature?.toFixed(1)}°C at ${new Date(fl.forecastTime).toLocaleTimeString()}\n`;
        }
        
        message += `\nPlease take necessary precautions to protect your plants!`;
        break;
      
      default:
        message = `Weather alert for ${notification.location_name}`;
    }
    
    // Send the message to the user
    await bot.telegram.sendMessage(notification.telegram_id, message);
    
    // Mark as sent
    notificationOps.markNotificationAsSent.run(notificationId);
    
    console.log(`Notification sent: ${notification.notification_type} for ${notification.location_name}`);
  } catch (error) {
    console.error(`Error sending notification ${notificationId}:`, error);
  }
}

/**
 * Check for and send any pending notifications
 * @param {Object} bot - Telegram bot instance
 */
async function processAllPendingNotifications(bot) {
  try {
    // Get all pending notifications
    const pendingNotifications = notificationOps.getPendingNotifications.all();
    
    for (const notification of pendingNotifications) {
      await sendNotification(bot, notification.id);
    }
  } catch (error) {
    console.error('Error processing pending notifications:', error);
  }
}

module.exports = {
  initializeSchedulers,
  processAllPendingNotifications
}; 