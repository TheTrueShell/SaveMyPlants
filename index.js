const { initializeBot } = require('./src/bot');
const { initializeSchedulers, processAllPendingNotifications } = require('./src/scheduler');
const { cleanupWeatherCache } = require('./src/weather');
require('dotenv').config();

// Catch unhandled errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function main() {
  try {
    console.log('Starting SaveMyPlants! bot...');
    
    // Initialize the Telegram bot
    const bot = initializeBot();
    
    // Start the bot
    await bot.launch();
    console.log('Bot started successfully!');
    
    // Process any pending notifications
    await processAllPendingNotifications(bot);
    
    // Initialize schedulers
    initializeSchedulers(bot);
    
    // Clean up expired cache entries on startup
    cleanupWeatherCache();
    
    console.log('Bot is now running. Press Ctrl+C to stop.');
    
    // Enable graceful stop
    process.once('SIGINT', () => {
      bot.stop('SIGINT');
      console.log('Bot stopped.');
    });
    
    process.once('SIGTERM', () => {
      bot.stop('SIGTERM');
      console.log('Bot terminated.');
    });
  } catch (error) {
    console.error('Error starting the bot:', error);
    process.exit(1);
  }
}

// Start the application
main(); 