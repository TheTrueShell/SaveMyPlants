const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Ensure data directory exists
const dbDir = path.dirname(process.env.DB_PATH);
if (!fs.existsSync(dbDir)) {
  console.log(`Creating database directory: ${dbDir}`);
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database with verbose error handling
let db;
try {
  console.log(`Connecting to database at: ${process.env.DB_PATH}`);
  db = new Database(process.env.DB_PATH);
  
  // Enable foreign key constraints
  db.pragma('foreign_keys = ON');
  
  console.log('Database connection established successfully');
} catch (error) {
  console.error('Error initializing database:', error);
  process.exit(1); // Exit if we can't connect to the database
}

// Create tables if they don't exist
function initializeDatabase() {
  console.log(`Initializing database at ${process.env.DB_PATH}`);
  
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('Users table initialized');

  // Locations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, name)
    )
  `);
  console.log('Locations table initialized');

  // Notifications table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY,
      location_id INTEGER NOT NULL,
      notification_type TEXT NOT NULL,
      scheduled_for TIMESTAMP NOT NULL,
      temperature REAL,
      forecast_time TIMESTAMP,
      sent BOOLEAN DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    )
  `);
  console.log('Notifications table initialized');

  // Weather cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS weather_cache (
      id INTEGER PRIMARY KEY,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      data TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(latitude, longitude)
    )
  `);
  console.log('Weather cache table initialized');
}

// Initialize the database before preparing statements
initializeDatabase();

// User operations
const userOps = {
  // Add or update a user
  upsertUser: db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, last_name)
    VALUES (@telegramId, @username, @firstName, @lastName)
    ON CONFLICT(telegram_id) DO UPDATE SET
    username = excluded.username,
    first_name = excluded.first_name,
    last_name = excluded.last_name
  `),

  // Get user by Telegram ID
  getUserByTelegramId: db.prepare(`
    SELECT * FROM users WHERE telegram_id = ?
  `),

  // Get all users
  getAllUsers: db.prepare(`
    SELECT * FROM users
  `)
};

// Location operations
const locationOps = {
  // Add a location for a user
  addLocation: db.prepare(`
    INSERT INTO locations (user_id, name, latitude, longitude)
    VALUES (@userId, @name, @latitude, @longitude)
  `),

  // Delete a location
  deleteLocation: db.prepare(`
    DELETE FROM locations WHERE id = ? AND user_id = ?
  `),

  // Get locations for a user
  getLocationsForUser: db.prepare(`
    SELECT * FROM locations WHERE user_id = ?
  `),

  // Get location by ID
  getLocationById: db.prepare(`
    SELECT * FROM locations WHERE id = ?
  `),

  // Get all locations
  getAllLocations: db.prepare(`
    SELECT * FROM locations
  `)
};

// Notification operations
const notificationOps = {
  // Add a notification
  addNotification: db.prepare(`
    INSERT INTO notifications 
    (location_id, notification_type, scheduled_for, temperature, forecast_time)
    VALUES (@locationId, @notificationType, @scheduledFor, @temperature, @forecastTime)
  `),

  // Mark a notification as sent
  markNotificationAsSent: db.prepare(`
    UPDATE notifications SET sent = 1 WHERE id = ?
  `),

  // Get pending notifications
  getPendingNotifications: db.prepare(`
    SELECT n.*, l.name as location_name, l.latitude, l.longitude, u.telegram_id
    FROM notifications n
    JOIN locations l ON n.location_id = l.id
    JOIN users u ON l.user_id = u.id
    WHERE n.sent = 0 AND n.scheduled_for <= datetime('now')
  `),
  
  // Get pending notification by ID
  getPendingNotificationById: db.prepare(`
    SELECT n.*, l.name as location_name, l.latitude, l.longitude, u.telegram_id
    FROM notifications n
    JOIN locations l ON n.location_id = l.id
    JOIN users u ON l.user_id = u.id
    WHERE n.id = ?
  `),

  // Get the latest warning notification for a location
  getLatestWarningForLocation: db.prepare(`
    SELECT * FROM notifications
    WHERE location_id = ? AND notification_type = 'warning'
    ORDER BY created_at DESC LIMIT 1
  `)
};

// Weather cache operations
const weatherCacheOps = {
  // Add or update cache entry
  upsertWeatherCache: db.prepare(`
    INSERT INTO weather_cache (latitude, longitude, data, expires_at)
    VALUES (@latitude, @longitude, @data, @expiresAt)
    ON CONFLICT(latitude, longitude) DO UPDATE SET
    data = excluded.data,
    expires_at = excluded.expires_at
  `),

  // Get cache entry
  getWeatherCache: db.prepare(`
    SELECT * FROM weather_cache
    WHERE latitude = ? AND longitude = ? AND expires_at > datetime('now')
  `),

  // Get all valid cache entries
  getAllCachedLocations: db.prepare(`
    SELECT * FROM weather_cache
    WHERE expires_at > datetime('now')
  `),

  // Delete expired cache entries
  cleanupExpiredCache: db.prepare(`
    DELETE FROM weather_cache WHERE expires_at <= datetime('now')
  `)
};

module.exports = {
  db,
  userOps,
  locationOps,
  notificationOps,
  weatherCacheOps
}; 