import { Telegraf, Markup } from 'telegraf';
import { getTelegramToken, getConfig, updateKeywords, updateLocation } from '../config';
import {
  registerChat,
  deactivateChat,
  isChatActive,
  getJobStats,
  getActiveChats,
  getJobsPage,
  getTotalJobCount,
  markNotified,
  JobRow,
} from '../db/database';
import { createLogger } from '../logger';

const log = createLogger('Bot');

import { SearchReport, formatReport } from '../scheduler';

let bot: Telegraf | null = null;
let searchCallback: (() => Promise<SearchReport>) | null = null;

export function setSearchCallback(cb: () => Promise<SearchReport>): void {
  searchCallback = cb;
}

export function createBot(): Telegraf {
  bot = new Telegraf(getTelegramToken());

  bot.command('start', async (ctx) => {
    const chatId = ctx.chat.id;
    registerChat(chatId);
    log.info(`Chat ${chatId} started`);
    await ctx.reply(
      'Welcome to Job Search AI Agent!\n\n' +
      'I will search for jobs matching your skills and notify you about the best matches.\n\n' +
      'Commands:\n' +
      '/start — Start receiving notifications\n' +
      '/stop — Stop notifications\n' +
      '/status — Show current status\n' +
      '/jobs — Show last 10 found vacancies\n' +
      '/setstack <skills> — Update your skills (comma-separated)\n' +
      '/setlocation <country/city> — Set location filter\n' +
      '/search — Run search immediately'
    );
  });

  bot.command('stop', async (ctx) => {
    const chatId = ctx.chat.id;
    deactivateChat(chatId);
    log.info(`Chat ${chatId} stopped`);
    await ctx.reply('Notifications paused. Use /start to resume.');
  });

  bot.command('status', async (ctx) => {
    const chatId = ctx.chat.id;
    const active = isChatActive(chatId);
    const config = getConfig();
    const stats = getJobStats();
    const enabledSites = config.sites.filter(s => s.enabled).map(s => s.name).join(', ');

    await ctx.reply(
      `Status: ${active ? 'Active' : 'Paused'}\n\n` +
      `Keywords: ${config.keywords.join(', ')}\n` +
      `Location: ${config.location.country || config.location.city || 'Any'} ${config.location.remote ? '(remote OK)' : ''}\n` +
      `Sites: ${enabledSites}\n` +
      `Schedule: ${config.search.cronExpression}\n` +
      `Min score: ${config.search.minMatchScore}%\n\n` +
      `Jobs found: ${stats.total}\n` +
      `Analyzed: ${stats.analyzed}\n` +
      `Notified: ${stats.notified}`
    );
  });

  bot.command('setstack', async (ctx) => {
    const text = ctx.message.text.replace('/setstack', '').trim();
    if (!text) {
      await ctx.reply('Usage: /setstack Frontend, Vue, TypeScript, Node.js');
      return;
    }
    const skills = text.split(',').map(s => s.trim()).filter(Boolean);
    updateKeywords(skills);
    log.info(`Keywords updated to: ${skills.join(', ')}`);
    await ctx.reply(`Skills updated: ${skills.join(', ')}`);
  });

  bot.command('setlocation', async (ctx) => {
    const text = ctx.message.text.replace('/setlocation', '').trim();
    if (!text) {
      await ctx.reply(
        'Usage:\n' +
        '/setlocation remote — remote jobs only\n' +
        '/setlocation Germany — filter by country\n' +
        '/setlocation Moscow — filter by city'
      );
      return;
    }

    if (text.toLowerCase() === 'remote') {
      updateLocation({ country: '', city: '', remote: true });
      await ctx.reply('Location set to: Remote only');
    } else {
      updateLocation({ country: text, city: '', remote: false });
      await ctx.reply(`Location set to: ${text}`);
    }
    log.info(`Location updated: ${text}`);
  });

  bot.command('jobs', async (ctx) => {
    await sendJobsPage(ctx, 0);
  });

  bot.action(/^jobs_page:(\d+)$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    await sendJobsPage(ctx, page);
  });

  bot.command('search', async (ctx) => {
    if (!searchCallback) {
      await ctx.reply('Search engine is not ready yet. Please wait.');
      return;
    }
    await ctx.reply('🔍 Starting search... This may take a minute.');
    try {
      const report = await searchCallback();
      await ctx.reply(formatReport(report), { parse_mode: 'Markdown' });
    } catch (err) {
      log.error('Manual search failed', err);
      await ctx.reply('Search failed. Check logs for details.');
    }
  });

  return bot;
}

const PAGE_SIZE = 10;

async function sendJobsPage(ctx: { reply: Function }, page: number): Promise<void> {
  const total = getTotalJobCount();
  if (total === 0) {
    await ctx.reply('No jobs found yet. Run /search to fetch vacancies.');
    return;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const jobs = getJobsPage(safePage, PAGE_SIZE);

  const lines: string[] = [
    `📋 *Vacancies* \\(page ${safePage + 1}/${totalPages}, total: ${total}\\)\n`,
  ];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const num = safePage * PAGE_SIZE + i + 1;
    const scoreText = job.match_score !== null ? ` \\| ${job.match_score}%` : '';
    const safeUrl = (job.url || '#').replace(/\)/g, '%29');
    lines.push(
      `*${num}\\.* ${escapeMarkdown(job.title)}\n` +
      `   🏢 ${escapeMarkdown(job.company)} \\| 📍 ${escapeMarkdown(job.location || 'Remote')}${scoreText}\n` +
      `   🔗 [Apply](${safeUrl})\n`
    );
  }

  const buttons: ReturnType<typeof Markup.button.callback>[] = [];
  if (safePage > 0) {
    buttons.push(Markup.button.callback(`← Page ${safePage}`, `jobs_page:${safePage - 1}`));
  }
  if (safePage < totalPages - 1) {
    buttons.push(Markup.button.callback(`Page ${safePage + 2} →`, `jobs_page:${safePage + 1}`));
  }

  const keyboard = buttons.length > 0 ? Markup.inlineKeyboard(buttons) : undefined;

  try {
    await ctx.reply(lines.join('\n'), {
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
      ...keyboard,
    });
  } catch (err) {
    log.error('Failed to send jobs page', err);
    await ctx.reply(`Jobs page ${safePage + 1}/${totalPages} — failed to render. Check logs.`);
  }
}

export async function startBot(): Promise<void> {
  if (!bot) throw new Error('Bot not created. Call createBot() first.');

  bot.catch((err: unknown) => {
    log.error('Bot error', err);
  });

  await bot.launch();
  log.info('Telegram bot started');

  process.once('SIGINT', () => bot?.stop('SIGINT'));
  process.once('SIGTERM', () => bot?.stop('SIGTERM'));
}

export async function notifyJob(job: JobRow): Promise<void> {
  if (!bot) return;

  const chats = getActiveChats();
  if (chats.length === 0) return;

  const scoreBar = '█'.repeat(Math.round((job.match_score || 0) / 10)) +
                   '░'.repeat(10 - Math.round((job.match_score || 0) / 10));

  const message =
    `💼 *${escapeMarkdown(job.title)}*\n` +
    `🏢 ${escapeMarkdown(job.company)}\n` +
    `📍 ${escapeMarkdown(job.location || 'Not specified')}\n` +
    `📊 Match: ${job.match_score}% ${scoreBar}\n` +
    `💡 ${escapeMarkdown(job.match_reasoning || 'No analysis')}\n` +
    `🔗 Source: ${escapeMarkdown(job.source)}`;

  const keyboard = Markup.inlineKeyboard([
    Markup.button.url('Apply →', job.url || '#'),
  ]);

  for (const chatId of chats) {
    try {
      await bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
      markNotified(job.id!);
    } catch (err) {
      log.error(`Failed to send notification to chat ${chatId}`, err);
    }
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
