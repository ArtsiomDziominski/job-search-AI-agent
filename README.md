# Job Search AI Agent

AI-powered job search agent that automatically finds relevant jobs, analyzes them with OpenAI, and sends notifications via Telegram.

## Features

- **Multi-site search**: RemoteOK, HeadHunter (hh.ru), LinkedIn (stub), easily extensible
- **AI matching**: OpenAI analyzes each job and gives a match score (0–100%) with reasoning
- **Telegram bot**: Receive notifications with match details and one-click apply buttons
- **Duplicate prevention**: SQLite database ensures you never see the same job twice
- **Scheduled search**: Runs every 30 minutes via cron (configurable)
- **Config-driven**: Change keywords, sites, and location without touching code

## Prerequisites

- Node.js 18+ ([download](https://nodejs.org/))
- A Telegram bot token (see below)
- An OpenAI API key (see below)

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```
OPENAI_API_KEY=sk-your-actual-openai-key
TELEGRAM_BOT_TOKEN=123456789:your-actual-bot-token
```

### 3. Configure job search

Edit `config.json` to set your preferences:

```json
{
  "sites": [
    { "name": "remoteok", "enabled": true },
    { "name": "headhunter", "enabled": true },
    { "name": "linkedin", "enabled": false }
  ],
  "keywords": ["Frontend", "Vue", "Nuxt", "TypeScript"],
  "location": {
    "country": "",
    "city": "",
    "remote": true
  },
  "search": {
    "cronExpression": "*/30 * * * *",
    "minMatchScore": 50
  }
}
```

### 4. Run the agent

Development mode (with hot reload):

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

### 5. Talk to your bot

Open Telegram, find your bot, and send `/start`. The bot will begin sending you job matches.

## Getting API Keys

### OpenAI API Key

1. Go to [platform.openai.com](https://platform.openai.com/)
2. Sign in or create an account
3. Navigate to API Keys in the sidebar
4. Click "Create new secret key"
5. Copy the key and paste it into your `.env` file as `OPENAI_API_KEY`

The agent uses `gpt-4o-mini` which costs roughly $0.15 per 1M input tokens — very affordable for job analysis.

### Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a display name (e.g., "Job Search Agent")
4. Choose a username (e.g., `my_job_search_bot`)
5. BotFather will give you a token like `123456789:ABCdefGhIjKlMnOpQrStUvWxYz`
6. Paste it into your `.env` file as `TELEGRAM_BOT_TOKEN`

## Telegram Bot Commands

| Command | Description |
|---|---|
| `/start` | Start receiving job notifications |
| `/stop` | Pause notifications |
| `/status` | Show current config, stats, and schedule |
| `/setstack Frontend, React, Node.js` | Update your skill keywords |
| `/setlocation Germany` | Set country/city filter |
| `/setlocation remote` | Search remote jobs only |
| `/search` | Trigger an immediate search |

## Configuration Reference

### `config.json`

| Field | Description |
|---|---|
| `sites[].name` | Parser name (must match a registered parser) |
| `sites[].enabled` | Whether to search this site |
| `keywords` | Skills/technologies to search for |
| `location.country` | Filter by country name |
| `location.city` | Filter by city name |
| `location.remote` | Include remote jobs |
| `search.cronExpression` | How often to search (cron syntax) |
| `search.minMatchScore` | Minimum AI match score to send a notification (0–100) |

### HeadHunter location codes

The HeadHunter parser maps common location names to hh.ru area codes. Currently supported: Russia, Moscow, Saint Petersburg, Ukraine, Kazakhstan, Minsk, USA, Germany. Add more in `src/parsers/headhunter-parser.ts` in the `AREA_CODES` map.

## Adding a New Job Site

1. Create `src/parsers/mysite-parser.ts`:

```typescript
import { BaseParser, Job } from './base-parser';
import { LocationConfig } from '../config';

export class MySiteParser extends BaseParser {
  readonly source = 'mysite';

  async search(keywords: string[], location: LocationConfig): Promise<Job[]> {
    // Fetch jobs from the site API or scrape HTML
    // Filter by keywords using this.matchesKeywords(text, keywords)
    // Return array of Job objects
    return [];
  }
}
```

2. Register it in `src/parsers/index.ts`:

```typescript
import { MySiteParser } from './mysite-parser';

// Add to the registry:
const parserRegistry: Record<string, ParserConstructor> = {
  // ...existing parsers...
  mysite: MySiteParser,
};
```

3. Enable it in `config.json`:

```json
{
  "sites": [
    { "name": "mysite", "enabled": true }
  ]
}
```

## Project Structure

```
src/
  parsers/
    base-parser.ts        — Abstract parser class + Job interface
    remoteok-parser.ts    — RemoteOK JSON API parser
    headhunter-parser.ts  — HeadHunter (hh.ru) API parser
    linkedin-parser.ts    — LinkedIn stub (no free API available)
    index.ts              — Parser registry and factory
  ai/
    analyzer.ts           — OpenAI job analysis + cover letter generation
  bot/
    bot.ts                — Telegram bot commands and notification sender
  db/
    database.ts           — SQLite schema and query helpers
  config.ts               — Config loader (config.json + .env)
  scheduler.ts            — Cron-based search cycle orchestrator
  logger.ts               — Timestamped console logger
  index.ts                — Main entry point
config.json               — User-editable search configuration
.env                      — API keys (not committed to git)
```

## Future Enhancements

- **Auto-apply**: Use OpenAI-generated cover letters + site APIs to apply automatically
- **LinkedIn integration**: Connect via Apify actors or a Puppeteer-based scraper
- **Web dashboard**: View job history, scores, and analytics in a browser
- **Multi-user**: Support multiple Telegram users with individual configs
- **Resume parsing**: Extract skills from uploaded resume automatically

## License

MIT
