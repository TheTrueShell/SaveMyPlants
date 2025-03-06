const { Telegraf, Scenes, session } = require('telegraf');
const { message } = require('telegraf/filters');
const { userOps, locationOps } = require('./db');
const { getForecast, analyzeForecast } = require('./weather');
require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;

/**
 * Initialize the Telegram bot
 * @returns {Object} - Bot instance
 */
function initializeBot() {
  if (!BOT_TOKEN) {
    throw new Error('BOT_TOKEN is not defined in .env file');
  }
  
  const bot = new Telegraf(BOT_TOKEN);
  
  // Set up middleware
  bot.use(session());
  
  // Set up scenes/wizards
  const stage = setupScenes();
  bot.use(stage.middleware());
  
  // Set up commands
  setupCommands(bot);
  
  return bot;
}

/**
 * Set up scenes for multi-step interactions
 * @returns {Scenes.Stage} - Scenes stage
 */
function setupScenes() {
  // Scene for adding a location
  const addLocationScene = new Scenes.WizardScene(
    'add_location',
    // Step 1: Ask for location name
    async (ctx) => {
      await ctx.reply('Please enter a name for this location (e.g., "Home Garden", "Cabin", etc.):');
      return ctx.wizard.next();
    },
    // Step 2: Save name and ask for location
    async (ctx) => {
      // Save the location name
      ctx.wizard.state.locationName = ctx.message.text;
      
      // Ask for the location
      await ctx.reply(
        'Please send your location by:\n' +
        '1. Tapping the paperclip/attachment icon\n' +
        '2. Selecting "Location"\n' +
        '3. Choose your location on the map\n\n' +
        'Or, you can type the coordinates manually in this format: latitude,longitude\n' +
        'Example: 51.5074,-0.1278'
      );
      return ctx.wizard.next();
    },
    // Step 3: Save the location
    async (ctx) => {
      try {
        let latitude, longitude;
        
        // Check if the message contains a location
        if (ctx.message.location) {
          // Get coords from the location object
          latitude = ctx.message.location.latitude;
          longitude = ctx.message.location.longitude;
        } else if (ctx.message.text) {
          // Try to parse coordinates from text
          const coordsMatch = ctx.message.text.match(/^(\-?\d+(\.\d+)?),\s*(\-?\d+(\.\d+)?)$/);
          if (!coordsMatch) {
            await ctx.reply('Invalid format. Please send a valid location or coordinates in the format latitude,longitude');
            return;
          }
          
          latitude = parseFloat(coordsMatch[1]);
          longitude = parseFloat(coordsMatch[3]);
          
          // Validate the coordinates
          if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            await ctx.reply('Invalid coordinates. Latitude must be between -90 and 90, and longitude between -180 and 180.');
            return;
          }
        } else {
          await ctx.reply('Please send a location or coordinates.');
          return;
        }
        
        // Get user from the database or create a new one
        const telegramId = ctx.from.id.toString();
        let user = userOps.getUserByTelegramId.get(telegramId);
        
        if (!user) {
          // Insert the user
          userOps.upsertUser.run({
            telegramId,
            username: ctx.from.username || null,
            firstName: ctx.from.first_name || null,
            lastName: ctx.from.last_name || null
          });
          
          // Get the newly inserted user
          user = userOps.getUserByTelegramId.get(telegramId);
        }
        
        // Save the location to the database
        try {
          locationOps.addLocation.run({
            userId: user.id,
            name: ctx.wizard.state.locationName,
            latitude,
            longitude
          });
          
          // Get the weather for this location to provide immediate feedback
          const forecast = await getForecast(latitude, longitude);
          const analysis = analyzeForecast(forecast);
          
          // Build the response message
          let responseMsg = `✅ Location "${ctx.wizard.state.locationName}" has been added!\n\n`;
          
          responseMsg += `📍 ${analysis.locationName}\n`;
          responseMsg += `🌡️ Current temperature: ${analysis.currentTemp?.toFixed(1)}°C\n\n`;
          
          if (analysis.isBelowFreezing) {
            responseMsg += `❄️ Warning: It's currently below freezing at this location!\n`;
          } else if (analysis.willBeBelowFreezing) {
            const freezingTime = analysis.freezingTime ? analysis.freezingTime.toLocaleString() : 'soon';
            responseMsg += `⚠️ Heads up: This location will drop below freezing on ${freezingTime}\n`;
          } else {
            responseMsg += `✅ No freezing temperatures expected in the next 5 days.\n`;
          }
          
          await ctx.reply(responseMsg);
        } catch (error) {
          console.error('Error adding location:', error);
          
          if (error.message.includes('UNIQUE constraint failed')) {
            await ctx.reply(`You already have a location named "${ctx.wizard.state.locationName}". Please use a different name.`);
            return ctx.scene.leave();
          }
          
          await ctx.reply('Error adding location. Please try again.');
        }
      } catch (error) {
        console.error('Error processing location:', error);
        await ctx.reply('An unexpected error occurred. Please try again.');
      }
      
      return ctx.scene.leave();
    }
  );

  // Create and return the stage with scenes
  const stage = new Scenes.Stage([addLocationScene]);
  return stage;
}

/**
 * Set up bot commands
 * @param {Object} bot - Telegraf bot instance
 */
function setupCommands(bot) {
  // Start command
  bot.start(async (ctx) => {
    const telegramId = ctx.from.id.toString();
    
    // Upsert the user
    userOps.upsertUser.run({
      telegramId,
      username: ctx.from.username || null,
      firstName: ctx.from.first_name || null,
      lastName: ctx.from.last_name || null
    });
    
    await ctx.reply(
      `🌱 Welcome to SaveMyPlants! 🌱\n\n` +
      `I'll notify you when temperatures at your saved locations drop below 0°C (freezing).\n\n` +
      `Commands:\n` +
      `/add - Add a new location to monitor\n` +
      `/list - List your saved locations\n` +
      `/check - Check current weather at your locations\n` +
      `/remove - Remove a location\n` +
      `/help - Show this help message`
    );
  });
  
  // Help command
  bot.help((ctx) => {
    return ctx.reply(
      `🌱 SaveMyPlants Help 🌱\n\n` +
      `Protect your plants from freezing temperatures!\n\n` +
      `Commands:\n` +
      `/add - Add a new location to monitor\n` +
      `/list - List your saved locations\n` +
      `/check - Check current weather at your locations\n` +
      `/remove - Remove a location\n` +
      `/help - Show this help message\n\n` +
      `You'll receive notifications:\n` +
      `• ~6 hours before freezing temperatures\n` +
      `• When temperature drops below freezing\n` +
      `• Morning summary if freezing expected that day\n` +
      `• All-clear when freezing risk passes`
    );
  });
  
  // Add location command
  bot.command('add', (ctx) => {
    return ctx.scene.enter('add_location');
  });
  
  // List locations command
  bot.command('list', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const user = userOps.getUserByTelegramId.get(telegramId);
    
    if (!user) {
      return ctx.reply('You need to add a location first. Use /add to get started.');
    }
    
    const locations = locationOps.getLocationsForUser.all(user.id);
    
    if (locations.length === 0) {
      return ctx.reply('You don\'t have any saved locations yet. Use /add to add a location.');
    }
    
    let message = '📍 Your saved locations:\n\n';
    
    locations.forEach((location, index) => {
      message += `${index + 1}. ${location.name} (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)})\n`;
    });
    
    message += '\nUse /check to see the current weather at these locations.';
    
    return ctx.reply(message);
  });
  
  // Check weather command
  bot.command('check', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const user = userOps.getUserByTelegramId.get(telegramId);
    
    if (!user) {
      return ctx.reply('You need to add a location first. Use /add to get started.');
    }
    
    const locations = locationOps.getLocationsForUser.all(user.id);
    
    if (locations.length === 0) {
      return ctx.reply('You don\'t have any saved locations yet. Use /add to add a location.');
    }
    
    // Show "typing..." indicator
    await ctx.replyWithChatAction('typing');
    
    let message = '🌡️ Current weather at your locations:\n\n';
    
    // Check each location
    for (const location of locations) {
      try {
        const forecast = await getForecast(location.latitude, location.longitude);
        const analysis = analyzeForecast(forecast);
        
        message += `📍 ${location.name} (${analysis.locationName})\n`;
        message += `Current temperature: ${analysis.currentTemp?.toFixed(1)}°C\n`;
        
        if (analysis.isBelowFreezing) {
          message += `❄️ Currently BELOW FREEZING! Protect your plants!\n`;
        } else if (analysis.willFreezeSoon) {
          const timeUntilFreezing = analysis.freezingTime ? 
            `in ${Math.round((analysis.freezingTime.getTime() - new Date().getTime()) / (1000 * 60 * 60))} hours` : 
            'soon';
          message += `⚠️ Will drop below freezing ${timeUntilFreezing}!\n`;
        } else if (analysis.willBeBelowFreezing) {
          const freezingTime = analysis.freezingTime ? analysis.freezingTime.toLocaleString() : 'soon';
          message += `⚠️ Will drop below freezing on ${freezingTime}\n`;
        } else {
          message += `✅ No freezing temperatures expected in the next 5 days.\n`;
        }
        
        message += `\n`;
      } catch (error) {
        console.error(`Error checking weather for location ${location.name}:`, error);
        message += `📍 ${location.name}: Error fetching weather data. Please try again later.\n\n`;
      }
    }
    
    return ctx.reply(message);
  });
  
  // Remove location command
  bot.command('remove', async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const user = userOps.getUserByTelegramId.get(telegramId);
    
    if (!user) {
      return ctx.reply('You don\'t have any locations to remove.');
    }
    
    const locations = locationOps.getLocationsForUser.all(user.id);
    
    if (locations.length === 0) {
      return ctx.reply('You don\'t have any saved locations to remove.');
    }
    
    // If the command has arguments, try to parse which location to remove
    const args = ctx.message.text.split(' ').slice(1).join(' ').trim();
    
    if (args) {
      // Try to interpret the argument as an index or a name
      const indexMatch = args.match(/^(\d+)$/);
      
      if (indexMatch) {
        // It's an index
        const index = parseInt(indexMatch[1]) - 1;
        
        if (index < 0 || index >= locations.length) {
          return ctx.reply(`Invalid location number. Please use a number between 1 and ${locations.length}.`);
        }
        
        const locationToRemove = locations[index];
        
        try {
          locationOps.deleteLocation.run(locationToRemove.id, user.id);
          return ctx.reply(`Location "${locationToRemove.name}" has been removed.`);
        } catch (error) {
          console.error('Error removing location:', error);
          return ctx.reply('Error removing location. Please try again.');
        }
      } else {
        // Try to find by name
        const location = locations.find(l => l.name.toLowerCase() === args.toLowerCase());
        
        if (!location) {
          return ctx.reply(
            `No location found with name "${args}". Here are your locations:\n\n` +
            locations.map((l, i) => `${i + 1}. ${l.name}`).join('\n') +
            '\n\nUse /remove <number> or /remove <name> to remove a location.'
          );
        }
        
        try {
          locationOps.deleteLocation.run(location.id, user.id);
          return ctx.reply(`Location "${location.name}" has been removed.`);
        } catch (error) {
          console.error('Error removing location:', error);
          return ctx.reply('Error removing location. Please try again.');
        }
      }
    }
    
    // No arguments, show the list of locations
    let message = 'Which location do you want to remove?\n\n';
    
    locations.forEach((location, index) => {
      message += `${index + 1}. ${location.name}\n`;
    });
    
    message += '\nReply with /remove <number> or /remove <name> to remove a location.';
    
    return ctx.reply(message);
  });
  
  // Handle location messages outside of the wizard
  bot.on(message('location'), async (ctx) => {
    await ctx.reply('To add this location, please use the /add command first.');
  });
  
  // Handle unknown commands
  bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) {
      await ctx.reply('Unknown command. Use /help to see available commands.');
    }
  });
}

module.exports = {
  initializeBot
}; 