/**
 * Database initialization script
 * Run this script to ensure the database is properly set up before starting the bot
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('Starting database initialization script...');

// Ensure data directory exists
const dbDir = path.dirname(process.env.DB_PATH);
if (!fs.existsSync(dbDir)) {
  console.log(`Creating database directory: ${dbDir}`);
  fs.mkdirSync(dbDir, { recursive: true });
}

// Delete existing database file if it exists
if (fs.existsSync(process.env.DB_PATH)) {
  console.log(`Removing existing database file: ${process.env.DB_PATH}`);
  fs.unlinkSync(process.env.DB_PATH);
}

// Initialize database
console.log(`Creating new database at: ${process.env.DB_PATH}`);
const db = new Database(process.env.DB_PATH);

// Enable foreign key constraints
db.pragma('foreign_keys = ON');

// Create tables
console.log('Creating database tables...');

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
console.log('- Users table created');

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
console.log('- Locations table created');

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
console.log('- Notifications table created');

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
console.log('- Weather cache table created');

// Close the database connection
db.close();
console.log('Database initialization completed successfully!'); 