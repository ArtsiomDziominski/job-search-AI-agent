import axios from 'axios';
import { BaseParser, Job } from './base-parser';
import { LocationConfig } from '../config';
import { createLogger } from '../logger';

const log = createLogger('RemoteOK');

interface RemoteOKJob {
  id: string;
  slug: string;
  company: string;
  position: string;
  description: string;
  location: string;
  tags: string[];
  url: string;
  date: string;
}

export class RemoteOKParser extends BaseParser {
  readonly source = 'remoteok';
  private readonly API_URL = 'https://remoteok.com/api';

  async search(keywords: string[], location: LocationConfig): Promise<Job[]> {
    log.info(`Searching with keywords: ${keywords.join(', ')}`);

    try {
      const { data } = await axios.get<RemoteOKJob[]>(this.API_URL, {
        headers: { 'User-Agent': 'job-search-ai-agent/1.0' },
        timeout: 15000,
      });

      // First element is metadata object, skip it
      const listings = data.slice(1);

      const filtered = listings.filter(job => {
        const searchable = [
          job.position || '',
          job.description || '',
          ...(job.tags || []),
        ].join(' ');

        if (!this.matchesKeywords(searchable, keywords)) return false;

        if (location.country || location.city) {
          const loc = (job.location || '').toLowerCase();
          if (location.country && !loc.includes(location.country.toLowerCase())) return false;
          if (location.city && !loc.includes(location.city.toLowerCase())) return false;
        }

        return true;
      });

      log.info(`Found ${filtered.length} matching jobs out of ${listings.length} total`);

      return filtered.map(job => ({
        externalId: String(job.id || job.slug),
        source: this.source,
        title: job.position || 'Untitled',
        company: job.company || 'Unknown',
        url: job.url || `https://remoteok.com/remote-jobs/${job.slug}`,
        description: (job.description || '').substring(0, 5000),
        location: job.location || 'Remote',
        tags: job.tags || [],
        postedAt: job.date || null,
      }));
    } catch (err) {
      log.error('Failed to fetch jobs', err);
      return [];
    }
  }
}
