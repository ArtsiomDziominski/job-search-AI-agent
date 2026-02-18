import { BaseParser, Job } from './base-parser';
import { LocationConfig } from '../config';
import { createLogger } from '../logger';

const log = createLogger('LinkedIn');

/**
 * LinkedIn does not provide a free public job search API.
 *
 * To implement this parser, consider:
 * 1. Apify LinkedIn Job Scraper actors (paid, no cookies needed)
 * 2. Puppeteer/Playwright-based scraping (fragile, may violate ToS)
 * 3. LinkedIn Marketing/Talent API (requires partner access)
 *
 * This stub is provided so the parser registry stays consistent.
 * Set "enabled": true in config.json once you have an implementation.
 */
export class LinkedInParser extends BaseParser {
  readonly source = 'linkedin';

  async search(_keywords: string[], _location: LocationConfig): Promise<Job[]> {
    log.warn(
      'LinkedIn parser is a stub. No free public API available. ' +
      'See src/parsers/linkedin-parser.ts for implementation options.'
    );
    return [];
  }
}
