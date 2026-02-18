import { initDatabase, closeDatabase } from './db/database';
import { createBot, startBot, setSearchCallback } from './bot/bot';
import { startScheduler, stopScheduler, runSearchCycle } from './scheduler';
import { createLogger } from './logger';

const log = createLogger('Main');

async function main(): Promise<void> {
  log.info('Job Search AI Agent starting...');

  initDatabase();

  const bot = createBot();
  setSearchCallback(runSearchCycle);

  startScheduler();

  await startBot();

  const shutdown = () => {
    log.info('Shutting down...');
    stopScheduler();
    bot.stop('shutdown');
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
