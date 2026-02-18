import axios from 'axios';
import { BaseParser, Job } from './base-parser';
import { LocationConfig } from '../config';
import { createLogger } from '../logger';

const log = createLogger('HeadHunter');

interface HHVacancy {
  id: string;
  name: string;
  alternate_url: string;
  snippet: { requirement: string | null; responsibility: string | null };
  employer: { name: string };
  area: { name: string };
  published_at: string;
  professional_roles: { name: string }[];
}

interface HHResponse {
  items: HHVacancy[];
  found: number;
  pages: number;
  page: number;
}

const AREA_CODES: Record<string, number> = {
  russia: 113,
  moscow: 1,
  'saint petersburg': 2,
  'санкт-петербург': 2,
  'москва': 1,
  'россия': 113,
  ukraine: 5,
  kazakhstan: 40,
  minsk: 16,
  usa: 112,
  germany: 96,
  poland: 97,
  serbia: 99,
  georgia: 28,
  turkey: 103,
  cyprus: 48,
  'united kingdom': 110,
  netherlands: 89,
  portugal: 93,
};

const MAX_PAGES = 5;

export class HeadHunterParser extends BaseParser {
  readonly source = 'headhunter';
  private readonly API_URL = 'https://api.hh.ru/vacancies';

  async search(keywords: string[], location: LocationConfig): Promise<Job[]> {
    const query = keywords.join(' OR ');
    log.info(`Searching with query: ${query}`);

    const allJobs: Job[] = [];

    try {
      const baseParams: Record<string, string | number> = {
        text: query,
        per_page: 100,
        search_field: 'name',
      };

      const areaKey = (location.city || location.country || '').toLowerCase();
      if (areaKey && AREA_CODES[areaKey]) {
        baseParams.area = AREA_CODES[areaKey];
      }

      if (location.remote) {
        baseParams.schedule = 'remote';
      }

      let totalAvailable = 0;
      let totalPages = 1;

      for (let page = 0; page < Math.min(totalPages, MAX_PAGES); page++) {
        const params = { ...baseParams, page };

        const { data } = await axios.get<HHResponse>(this.API_URL, {
          params,
          timeout: 15000,
          headers: { 'User-Agent': 'job-search-ai-agent/1.0' },
        });

        if (page === 0) {
          totalAvailable = data.found;
          totalPages = data.pages;
          log.info(`Total available: ${totalAvailable}, pages: ${totalPages} (fetching up to ${MAX_PAGES})`);
        }

        for (const v of data.items) {
          allJobs.push({
            externalId: v.id,
            source: this.source,
            title: v.name,
            company: v.employer?.name || 'Unknown',
            url: v.alternate_url,
            description: [
              v.snippet?.requirement || '',
              v.snippet?.responsibility || '',
            ].join('\n').substring(0, 5000),
            location: v.area?.name || '',
            tags: v.professional_roles?.map(r => r.name) || [],
            postedAt: v.published_at || null,
          });
        }

        if (data.items.length === 0) break;
      }

      log.info(`Fetched ${allJobs.length} jobs total from ${Math.min(totalPages, MAX_PAGES)} pages`);
      return allJobs;
    } catch (err) {
      log.error('Failed to fetch vacancies', err);
      return allJobs;
    }
  }
}
