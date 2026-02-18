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
  ukraine: 5,
  kazakhstan: 40,
  minsk: 16,
  usa: 112,
  germany: 96,
};

export class HeadHunterParser extends BaseParser {
  readonly source = 'headhunter';
  private readonly API_URL = 'https://api.hh.ru/vacancies';

  async search(keywords: string[], location: LocationConfig): Promise<Job[]> {
    const query = keywords.join(' OR ');
    log.info(`Searching with query: ${query}`);

    try {
      const params: Record<string, string | number> = {
        text: query,
        per_page: 50,
        page: 0,
      };

      const areaKey = (location.city || location.country || '').toLowerCase();
      if (areaKey && AREA_CODES[areaKey]) {
        params.area = AREA_CODES[areaKey];
      }

      const { data } = await axios.get<HHResponse>(this.API_URL, {
        params,
        timeout: 15000,
        headers: { 'User-Agent': 'job-search-ai-agent/1.0' },
      });

      log.info(`Found ${data.items.length} jobs (total available: ${data.found})`);

      return data.items.map(v => ({
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
      }));
    } catch (err) {
      log.error('Failed to fetch vacancies', err);
      return [];
    }
  }
}
