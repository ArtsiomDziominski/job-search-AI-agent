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
  getDistinctSources,
  clearAllJobs,
  markNotified,
  JobRow,
  JobsFilter,
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
      '/jobs [site] [posted] — Browse vacancies with filters\n' +
      '/search — Run search immediately\n' +
      '/setstack <skills> — Update your skills (comma-separated)\n' +
      '/setlocation <country/city> — Set location filter\n' +
      '/clear — Delete all vacancies from database'
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
    const args = ctx.message.text.replace('/jobs', '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filter = parseJobsFilter(args);
    await sendJobsPage(ctx, 0, filter);
  });

  bot.action(/^jobs_page:(\d+)(?::(.*))?$/, async (ctx) => {
    const page = parseInt(ctx.match[1], 10);
    const filterStr = ctx.match[2] || '';
    const filter = parseJobsFilter(filterStr.split(',').filter(Boolean));
    await ctx.answerCbQuery();
    await sendJobsPage(ctx, page, filter);
  });

  bot.command('clear', async (ctx) => {
    const total = getTotalJobCount();
    if (total === 0) {
      await ctx.reply('Database is already empty.');
      return;
    }
    await ctx.reply(
      `⚠️ Are you sure you want to delete all ${total} vacancies from the database?\n\nThis action cannot be undone.`,
      Markup.inlineKeyboard([
        Markup.button.callback('✅ Yes, delete all', 'clear_confirm'),
        Markup.button.callback('❌ No, cancel', 'clear_cancel'),
      ])
    );
  });

  bot.action('clear_confirm', async (ctx) => {
    await ctx.answerCbQuery();
    const deleted = clearAllJobs();
    log.info(`User cleared database: ${deleted} jobs deleted`);
    await ctx.editMessageText(`🗑 Done. Deleted ${deleted} vacancies from the database.`);
  });

  bot.action('clear_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('Cancelled. Database was not changed.');
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

function parseJobsFilter(args: string[]): JobsFilter {
  const filter: JobsFilter = {};
  const knownSources = getDistinctSources();
  for (const arg of args) {
    if (arg === 'posted' || arg === 'new') {
      filter.sortBy = 'posted';
    } else if (knownSources.includes(arg)) {
      filter.source = arg;
    }
  }
  return filter;
}

function filterToString(filter: JobsFilter): string {
  const parts: string[] = [];
  if (filter.source) parts.push(filter.source);
  if (filter.sortBy) parts.push(filter.sortBy);
  return parts.join(',');
}

function filterLabel(filter: JobsFilter): string {
  const parts: string[] = [];
  if (filter.source) parts.push(`site: ${filter.source}`);
  if (filter.sortBy === 'posted') parts.push('sort: posted date');
  return parts.length > 0 ? parts.join(', ') : 'no filters';
}

async function sendJobsPage(ctx: { reply: Function }, page: number, filter: JobsFilter = {}): Promise<void> {
  const total = getTotalJobCount(filter);
  if (total === 0) {
    const sources = getDistinctSources();
    const hint = sources.length > 0
      ? `\n\nAvailable sites: ${sources.join(', ')}\nUsage: /jobs [site] [posted]`
      : '';
    await ctx.reply(`No jobs found with these filters (${filterLabel(filter)}).${hint}`);
    return;
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const jobs = getJobsPage(safePage, PAGE_SIZE, filter);
  const fStr = filterToString(filter);

  const headerFilter = filterLabel(filter);
  const lines: string[] = [
    `📋 *Vacancies* \\(page ${safePage + 1}/${totalPages}, total: ${total}\\)` +
    `\n🔎 ${escapeMarkdown(headerFilter)}\n`,
  ];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const num = safePage * PAGE_SIZE + i + 1;
    const scoreText = job.match_score !== null ? ` \\| ${job.match_score}%` : '';
    const safeUrl = (job.url || '#').replace(/\)/g, '%29');
    const postedAt = job.posted_at
      ? escapeMarkdown(job.posted_at.replace('T', ' ').substring(0, 10))
      : '';
    const addedAt = job.created_at
      ? escapeMarkdown(job.created_at.replace('T', ' ').substring(0, 16))
      : '';
    const postedLine = postedAt ? `   📅 Posted: ${postedAt}\n` : '';
    lines.push(
      `*${num}\\.* ${escapeMarkdown(job.title)}\n` +
      `   🏢 ${escapeMarkdown(job.company)} \\| 📍 ${escapeMarkdown(job.location || 'Remote')}${scoreText}\n` +
      `   🌐 ${escapeMarkdown(job.source)}\n` +
      postedLine +
      `   🕐 Added: ${addedAt} \\| 🔗 [Apply](${safeUrl})\n`
    );
  }

  const navButtons: ReturnType<typeof Markup.button.callback>[] = [];
  if (safePage > 0) {
    navButtons.push(Markup.button.callback(`← Page ${safePage}`, `jobs_page:${safePage - 1}:${fStr}`));
  }
  if (safePage < totalPages - 1) {
    navButtons.push(Markup.button.callback(`Page ${safePage + 2} →`, `jobs_page:${safePage + 1}:${fStr}`));
  }

  const keyboard = navButtons.length > 0 ? Markup.inlineKeyboard(navButtons) : undefined;

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
