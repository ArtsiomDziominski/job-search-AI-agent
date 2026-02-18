import cron from 'node-cron';
import { getConfig } from './config';
import { getParser } from './parsers';
import { insertJob, getUnanalyzedJobs, updateJobAnalysis, getUnnotifiedJobs } from './db/database';
import { analyzeJob, QuotaExhaustedError } from './ai/analyzer';
import { notifyJob } from './bot/bot';
import { createLogger } from './logger';

const log = createLogger('Scheduler');

let task: cron.ScheduledTask | null = null;

export interface SiteReport {
  site: string;
  fetched: number;
  newJobs: number;
  duplicates: number;
  error: string | null;
}

export interface SearchReport {
  sites: SiteReport[];
  totalFetched: number;
  totalNew: number;
  totalDuplicates: number;
  analyzed: number;
  analysisFailed: number;
  quotaExhausted: boolean;
  notified: number;
  durationMs: number;
}

export async function runSearchCycle(): Promise<SearchReport> {
  const config = getConfig();
  const startTime = Date.now();
  log.info('=== Search cycle started ===');

  const report: SearchReport = {
    sites: [],
    totalFetched: 0,
    totalNew: 0,
    totalDuplicates: 0,
    analyzed: 0,
    analysisFailed: 0,
    quotaExhausted: false,
    notified: 0,
    durationMs: 0,
  };

  // 1. Fetch jobs from all enabled sites
  const enabledSites = config.sites.filter(s => s.enabled);

  for (const site of enabledSites) {
    const siteReport: SiteReport = {
      site: site.name,
      fetched: 0,
      newJobs: 0,
      duplicates: 0,
      error: null,
    };

    const parser = getParser(site.name);
    if (!parser) {
      siteReport.error = 'No parser registered';
      log.warn(`No parser found for site: ${site.name}`);
      report.sites.push(siteReport);
      continue;
    }

    log.info(`Fetching from ${site.name}...`);
    try {
      const jobs = await parser.search(config.keywords, config.location);
      siteReport.fetched = jobs.length;

      for (const job of jobs) {
        const isNew = insertJob({
          external_id: job.externalId,
          source: job.source,
          title: job.title,
          company: job.company,
          url: job.url,
          description: job.description,
          location: job.location,
          tags: JSON.stringify(job.tags),
          posted_at: job.postedAt,
        });
        if (isNew) {
          siteReport.newJobs++;
        } else {
          siteReport.duplicates++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      siteReport.error = msg;
      log.error(`Error fetching from ${site.name}`, err);
    }

    report.sites.push(siteReport);
    report.totalFetched += siteReport.fetched;
    report.totalNew += siteReport.newJobs;
    report.totalDuplicates += siteReport.duplicates;

    log.info(`[${site.name}] fetched: ${siteReport.fetched}, new: ${siteReport.newJobs}, duplicates: ${siteReport.duplicates}`);
  }

  // 2. Analyze unscored jobs with OpenAI
  const unanalyzed = getUnanalyzedJobs();
  log.info(`Analyzing ${unanalyzed.length} jobs...`);

  for (const job of unanalyzed) {
    try {
      const result = await analyzeJob(
        job.title,
        job.description,
        job.company,
        config.keywords
      );
      updateJobAnalysis(job.id!, result.score, result.reasoning);
      report.analyzed++;
    } catch (err) {
      if (err instanceof QuotaExhaustedError) {
        report.quotaExhausted = true;
        log.error(`OpenAI quota exhausted after analyzing ${report.analyzed}/${unanalyzed.length} jobs`);
        break;
      }
      report.analysisFailed++;
      log.error(`Failed to analyze job ${job.id}`, err);
    }
  }

  // 3. Notify about high-scoring unnotified jobs
  const toNotify = getUnnotifiedJobs(config.search.minMatchScore);
  log.info(`Sending ${toNotify.length} notifications...`);

  for (const job of toNotify) {
    try {
      await notifyJob(job);
      report.notified++;
    } catch (err) {
      log.error(`Failed to notify job ${job.id}`, err);
    }
  }

  report.durationMs = Date.now() - startTime;
  log.info(`=== Search cycle complete in ${(report.durationMs / 1000).toFixed(1)}s ===`);
  return report;
}

export function formatReport(report: SearchReport): string {
  const lines: string[] = ['📋 *Search Report*\n'];

  for (const site of report.sites) {
    const status = site.error ? '❌' : '✅';
    lines.push(`${status} *${site.site}*`);
    if (site.error) {
      lines.push(`   Error: ${site.error}`);
    } else {
      lines.push(`   Fetched: ${site.fetched} | New: ${site.newJobs} | Duplicates: ${site.duplicates}`);
    }
  }

  lines.push('');
  lines.push(`📊 *Total:*`);
  lines.push(`   Fetched: ${report.totalFetched}`);
  lines.push(`   New: ${report.totalNew}`);
  lines.push(`   Duplicates: ${report.totalDuplicates}`);

  if (report.analyzed > 0 || report.analysisFailed > 0 || report.quotaExhausted) {
    lines.push('');
    lines.push(`🤖 *AI Analysis:*`);
    lines.push(`   Analyzed: ${report.analyzed}`);
    if (report.analysisFailed > 0) {
      lines.push(`   Failed: ${report.analysisFailed}`);
    }
    if (report.quotaExhausted) {
      lines.push(`   ⚠️ OpenAI quota exhausted`);
    }
  }

  if (report.notified > 0) {
    lines.push('');
    lines.push(`📬 Notifications sent: ${report.notified}`);
  }

  lines.push('');
  lines.push(`⏱ Duration: ${(report.durationMs / 1000).toFixed(1)}s`);

  return lines.join('\n');
}

export function startScheduler(): void {
  const config = getConfig();
  const expression = config.search.cronExpression;

  if (!cron.validate(expression)) {
    log.error(`Invalid cron expression: ${expression}`);
    return;
  }

  task = cron.schedule(expression, async () => {
    try {
      await runSearchCycle();
    } catch (err) {
      log.error('Search cycle failed', err);
    }
  });

  log.info(`Scheduler started with cron: ${expression}`);
}

export function stopScheduler(): void {
  if (task) {
    task.stop();
    task = null;
    log.info('Scheduler stopped');
  }
}
