import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

export interface SiteConfig {
  name: string;
  enabled: boolean;
  maxPages?: number;
  pageDelayMs?: number;
}

export interface LocationConfig {
  country: string;
  city: string;
  remote: boolean;
}

export interface SearchConfig {
  cronExpression: string;
  minMatchScore: number;
}

export interface AppConfig {
  sites: SiteConfig[];
  keywords: string[];
  location: LocationConfig;
  search: SearchConfig;
}

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');

function loadConfigFromDisk(): AppConfig {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as AppConfig;
}

function saveConfigToDisk(config: AppConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

let currentConfig: AppConfig = loadConfigFromDisk();

export function getConfig(): AppConfig {
  return currentConfig;
}

export function updateKeywords(keywords: string[]): void {
  currentConfig.keywords = keywords;
  saveConfigToDisk(currentConfig);
}

export function updateLocation(location: Partial<LocationConfig>): void {
  currentConfig.location = { ...currentConfig.location, ...location };
  saveConfigToDisk(currentConfig);
}

export function reloadConfig(): void {
  currentConfig = loadConfigFromDisk();
}

export function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set in .env');
  return key;
}

export function getTelegramToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set in .env');
  return token;
}
