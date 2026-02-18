import { LocationConfig } from '../config';

export interface Job {
  externalId: string;
  source: string;
  title: string;
  company: string;
  url: string;
  description: string;
  location: string;
  tags: string[];
  postedAt: string | null;
}

export abstract class BaseParser {
  abstract readonly source: string;

  abstract search(keywords: string[], location: LocationConfig): Promise<Job[]>;

  protected matchesKeywords(text: string, keywords: string[]): boolean {
    const lower = text.toLowerCase();
    return keywords.some(kw => lower.includes(kw.toLowerCase()));
  }
}
