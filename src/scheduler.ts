import cron from 'node-cron';
import { getConfig } from './config';
import { getParser } from './parsers';
import { insertJob, getUnanalyzedJobs, updateJobAnalysis, getUnnotifiedJobs } from './db/database';
import { analyzeJob } from './ai/analyzer';
import { notifyJob } from './bot/bot';
import { createLogger } from './logger';

const log = createLogger('Scheduler');

let task: cron.ScheduledTask | null = null;

export async function runSearchCycle(): Promise<void> {
  const config = getConfig();
  log.info('=== Search cycle started ===');

  // 1. Fetch jobs from all enabled sites
  const enabledSites = config.sites.filter(s => s.enabled);
  let newJobCount = 0;

  for (const site of enabledSites) {
    const parser = getParser(site.name);
    if (!parser) {
      log.warn(`No parser found for site: ${site.name}`);
      continue;
    }

    log.info(`Fetching from ${site.name}...`);
    try {
      const jobs = await parser.search(config.keywords, config.location);

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
        if (isNew) newJobCount++;
      }
    } catch (err) {
      log.error(`Error fetching from ${site.name}`, err);
    }
  }

  log.info(`Inserted ${newJobCount} new jobs`);

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
    } catch (err) {
      log.error(`Failed to analyze job ${job.id}`, err);
    }
  }

  // 3. Notify about high-scoring unnotified jobs
  const toNotify = getUnnotifiedJobs(config.search.minMatchScore);
  log.info(`Sending ${toNotify.length} notifications...`);

  for (const job of toNotify) {
    try {
      await notifyJob(job);
    } catch (err) {
      log.error(`Failed to notify job ${job.id}`, err);
    }
  }

  log.info('=== Search cycle complete ===');
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
