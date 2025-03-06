const axios = require('axios');
const geolib = require('geolib');
const { weatherCacheOps } = require('./db');
require('dotenv').config();

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const TEMP_THRESHOLD = parseFloat(process.env.TEMP_THRESHOLD || '0');
const GEOCACHE_DISTANCE = parseInt(process.env.GEOCACHE_DISTANCE || '10000'); // Default 10km
const GEOCACHE_EXPIRY = parseInt(process.env.GEOCACHE_EXPIRY || '3600000'); // Default 1 hour

// OpenWeatherMap API base URL for 5-day forecast
const FORECAST_API_URL = 'https://api.openweathermap.org/data/2.5/forecast';

/**
 * Fetches the weather forecast from the API or cache
 * @param {number} latitude
 * @param {number} longitude
 * @param {boolean} forceRefresh - If true, bypass cache
 * @returns {Promise<Object>} The forecast data
 */
async function getForecast(latitude, longitude, forceRefresh = false) {
  // Check cache first (if not forcing refresh)
  if (!forceRefresh) {
    // First try exact coordinates
    let cachedData = weatherCacheOps.getWeatherCache.get(latitude, longitude);
    
    // If no exact match, try to find nearby cached locations
    if (!cachedData) {
      // Get all cached locations (we should improve this with a spatial index in production)
      const allCachedLocations = weatherCacheOps.getAllCachedLocations?.get() || [];
      
      // Find the closest cached location within the cache distance
      for (const location of allCachedLocations) {
        const distance = geolib.getDistance(
          { latitude, longitude },
          { latitude: location.latitude, longitude: location.longitude }
        );
        
        if (distance <= GEOCACHE_DISTANCE) {
          cachedData = location;
          break;
        }
      }
    }
    
    // If we found valid cached data, return it
    if (cachedData) {
      return JSON.parse(cachedData.data);
    }
  }
  
  // No valid cache, call the API
  try {
    const response = await axios.get(FORECAST_API_URL, {
      params: {
        lat: latitude,
        lon: longitude,
        appid: OPENWEATHER_API_KEY,
        units: 'metric', // Use Celsius
        cnt: 40 // Max number of timestamps (5 days with 3-hour intervals)
      }
    });
    
    // Cache the response
    const expiresAt = new Date(Date.now() + GEOCACHE_EXPIRY).toISOString();
    weatherCacheOps.upsertWeatherCache.run({
      latitude,
      longitude,
      data: JSON.stringify(response.data),
      expiresAt
    });
    
    return response.data;
  } catch (error) {
    console.error('Error fetching weather forecast:', error.message);
    throw new Error(`Failed to fetch weather forecast: ${error.message}`);
  }
}

/**
 * Analyzes forecast data to check for freezing conditions
 * @param {Object} forecastData - The data from OpenWeatherMap API
 * @returns {Object} Analysis of freezing events
 */
function analyzeForecast(forecastData) {
  const list = forecastData.list || [];
  const now = new Date();
  const warningTime = parseInt(process.env.WARNING_TIME || '6') * 60 * 60 * 1000; // Convert hours to ms
  
  // Sort forecast entries chronologically
  list.sort((a, b) => a.dt - b.dt);
  
  const result = {
    locationName: forecastData.city?.name || 'Unknown location',
    currentTemp: list[0]?.main?.temp,
    isBelowFreezing: false,
    willFreezeSoon: false,
    freezingForecast: null,
    freezingTime: null,
    morningWarning: false,
    willBeBelowFreezing: false,
    allClear: true
  };
  
  // Check current conditions
  if (result.currentTemp <= TEMP_THRESHOLD) {
    result.isBelowFreezing = true;
    result.allClear = false;
  }
  
  // Look for upcoming freezing events
  for (const item of list) {
    const forecastTime = new Date(item.dt * 1000);
    const temp = item.main.temp;
    
    // If we find a temperature below threshold
    if (temp <= TEMP_THRESHOLD) {
      result.willBeBelowFreezing = true;
      result.allClear = false;
      
      // If this is the first freezing event we've found
      if (!result.freezingForecast) {
        result.freezingForecast = item;
        result.freezingTime = forecastTime;
        
        // Check if it's within the warning period (e.g., 6 hours)
        const timeUntilFreezing = forecastTime.getTime() - now.getTime();
        if (timeUntilFreezing <= warningTime && timeUntilFreezing > 0) {
          result.willFreezeSoon = true;
        }
      }
    }
  }
  
  // Check if we need to issue a morning warning
  if (result.willBeBelowFreezing && !result.isBelowFreezing) {
    // Is there a freezing event today?
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    if (result.freezingTime && result.freezingTime < tomorrow) {
      // It will freeze sometime today
      result.morningWarning = true;
    }
  }
  
  return result;
}

/**
 * Find locations near the given coordinates
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} maxDistance - Maximum distance in meters
 * @param {Array} allLocations - Array of all locations to check
 * @returns {Array} Locations within the specified distance
 */
function findNearbyLocations(latitude, longitude, maxDistance, allLocations) {
  const nearbyLocations = [];
  
  for (const location of allLocations) {
    const distance = geolib.getDistance(
      { latitude, longitude },
      { latitude: location.latitude, longitude: location.longitude }
    );
    
    if (distance <= maxDistance) {
      nearbyLocations.push({
        ...location,
        distance
      });
    }
  }
  
  return nearbyLocations;
}

/**
 * Clears expired entries from the weather cache
 */
function cleanupWeatherCache() {
  weatherCacheOps.cleanupExpiredCache.run();
}

module.exports = {
  getForecast,
  analyzeForecast,
  findNearbyLocations,
  cleanupWeatherCache
}; 