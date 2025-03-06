# SaveMyPlants! 🌱

A Telegram bot that sends you notifications when temperatures at your tracked locations are expected to drop below freezing (0°C), helping you protect your plants from frost damage.

## Features

- 🔔 Receive notifications about freezing temperatures:
  - Warning ~6 hours before temperatures drop below 0°C
  - Alert when temperature crosses below 0°C
  - Morning summary if freezing is expected later in the day
  - All clear notification when freezing risk passes
- 📍 Track multiple locations
- 🗺️ Geographical caching to minimize API calls
- 💾 Persistent storage with SQLite

## Prerequisites

- Node.js 14+
- pnpm
- Telegram Bot Token (from BotFather)
- OpenWeatherMap API Key (or other weather API)

## Installation

1. Clone this repository:
```bash
git clone https://github.com/TheTrueShell/SaveMyPlants.git
cd SaveMyPlants
```

2. Install dependencies:
```bash
pnpm install
```

3. Configure environment variables by copying the example and editing it:
```bash
cp .env.example .env
```

4. Edit the `.env` file with your Telegram Bot Token and OpenWeatherMap API Key.

## Usage

1. Start the bot:
```bash
pnpm start
```

2. Open Telegram and find your bot by the username you registered with BotFather

3. Send the `/start` command to begin interacting with the bot

## Available Commands

- `/start` - Start the bot and see welcome message
- `/help` - Show help message with available commands
- `/add` - Add a new location to monitor
- `/list` - List your saved locations
- `/check` - Check current weather at your locations
- `/remove` - Remove a location

## How It Works

1. Users add locations through the Telegram interface
2. The bot regularly checks the weather forecast for these locations
3. When a location is expected to experience freezing temperatures:
   - Users receive a warning about 6 hours beforehand
   - Users receive an alert when the temperature drops below 0°C
   - Users receive a morning summary of locations expected to freeze that day
   - Users receive an all-clear message when the freezing risk passes

## Geographical Caching

The bot uses a geographical caching system to minimize API calls to weather services. If multiple locations are within 10km of each other (configurable), they'll be served with a single API call.

## License

ISC

## Acknowledgements

- [Telegraf](https://github.com/telegraf/telegraf) for the Telegram Bot framework
- [OpenWeatherMap](https://openweathermap.org/) for weather data
- [better-sqlite3](https://github.com/JoshuaWise/better-sqlite3) for database operations
- [geolib](https://github.com/manuelbieh/geolib) for geographical calculations 