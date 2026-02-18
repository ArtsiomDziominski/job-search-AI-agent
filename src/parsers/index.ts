import { BaseParser } from './base-parser';
import { RemoteOKParser } from './remoteok-parser';
import { HeadHunterParser } from './headhunter-parser';
import { LinkedInParser } from './linkedin-parser';

export { Job } from './base-parser';
export { BaseParser } from './base-parser';

type ParserConstructor = new () => BaseParser;

const parserRegistry: Record<string, ParserConstructor> = {
  remoteok: RemoteOKParser,
  headhunter: HeadHunterParser,
  linkedin: LinkedInParser,
};

/**
 * Register a new parser at runtime.
 * Usage: registerParser('mysite', MySiteParser);
 * Then add { "name": "mysite", "enabled": true } to config.json
 */
export function registerParser(name: string, ctor: ParserConstructor): void {
  parserRegistry[name] = ctor;
}

export function getParser(name: string): BaseParser | null {
  const Ctor = parserRegistry[name];
  if (!Ctor) return null;
  return new Ctor();
}

export function getAvailableParsers(): string[] {
  return Object.keys(parserRegistry);
}
