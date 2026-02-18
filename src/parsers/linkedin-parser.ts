import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseParser, Job } from './base-parser';
import { LocationConfig, SiteConfig } from '../config';
import { createLogger } from '../logger';

const log = createLogger('LinkedIn');

const BASE_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const PAGE_SIZE = 25;
const DEFAULT_MAX_PAGES = 4;
const DEFAULT_DELAY_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractJobId(url: string): string {
  const withoutQuery = url.split('?')[0];
  const parts = withoutQuery.split('-');
  return parts[parts.length - 1] || url;
}

export class LinkedInParser extends BaseParser {
  readonly source = 'linkedin';

  async search(keywords: string[], location: LocationConfig, siteConfig?: SiteConfig): Promise<Job[]> {
    const maxPages = siteConfig?.maxPages ?? DEFAULT_MAX_PAGES;
    const delayMs = siteConfig?.pageDelayMs ?? DEFAULT_DELAY_MS;
    const query = keywords.join(' ');
    log.info(`Searching with keywords: ${query} (maxPages: ${maxPages}, delay: ${delayMs}ms)`);

    const allJobs: Job[] = [];

    for (let page = 0; page < maxPages; page++) {
      const start = page * PAGE_SIZE;

      const params: Record<string, string | number> = {
        keywords: query,
        start,
        f_TPR: 'r604800',
      };

      if (location.country || location.city) {
        params.location = location.city || location.country;
      }

      if (location.remote) {
        params.f_WT = 2;
      }

      try {
        log.info(`Fetching page ${page + 1}/${maxPages} (start=${start})...`);

        const { data } = await axios.get<string>(BASE_URL, {
          params,
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });

        const $ = cheerio.load(data);
        const cards = $('li > div.base-card');

        if (cards.length === 0) {
          log.info(`Page ${page + 1}: no results, stopping`);
          break;
        }

        cards.each((_, el) => {
          const card = $(el);
          const title = card.find('[class*=_title]').text().trim();
          const url = card.find('[class*=_full-link]').attr('href')?.trim() || '';
          const company = card.find('[class*=_subtitle]').text().trim();
          const jobLocation = card.find('[class*=_location]').text().trim();
          const dateText = card.find('[class*=listdate]').attr('datetime')?.trim()
            || card.find('[class*=listdate]').text().trim();

          if (!title || !url) return;

          const externalId = extractJobId(url);

          allJobs.push({
            externalId,
            source: this.source,
            title,
            company: company || 'Unknown',
            url: url.split('?')[0],
            description: '',
            location: jobLocation || '',
            tags: [],
            postedAt: dateText || null,
          });
        });

        log.info(`Page ${page + 1}: found ${cards.length} jobs (total: ${allJobs.length})`);

        if (page < maxPages - 1) {
          log.info(`Waiting ${delayMs / 1000}s before next page...`);
          await sleep(delayMs);
        }
      } catch (err) {
        log.error(`Failed to fetch page ${page + 1}`, err);
        break;
      }
    }

    log.info(`Fetched ${allJobs.length} jobs total from LinkedIn`);
    return allJobs;
  }
}
