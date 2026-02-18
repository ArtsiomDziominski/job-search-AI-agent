import Database from 'better-sqlite3';
import * as path from 'path';
import { createLogger } from '../logger';

const log = createLogger('DB');

export interface JobRow {
  id?: number;
  external_id: string;
  source: string;
  title: string;
  company: string;
  url: string;
  description: string;
  location: string;
  tags: string;
  posted_at: string | null;
  match_score: number | null;
  match_reasoning: string | null;
  notified: number;
  created_at?: string;
}

let db: Database.Database;

export function initDatabase(): void {
  const dbPath = path.resolve(process.cwd(), 'jobs.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL,
      source TEXT NOT NULL,
      title TEXT,
      company TEXT,
      url TEXT,
      description TEXT,
      location TEXT,
      tags TEXT,
      posted_at TEXT,
      match_score REAL,
      match_reasoning TEXT,
      notified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source, external_id)
    );

    CREATE TABLE IF NOT EXISTS bot_chats (
      chat_id INTEGER PRIMARY KEY,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  log.info('Database initialized');
}

export function insertJob(job: Omit<JobRow, 'id' | 'created_at' | 'notified' | 'match_score' | 'match_reasoning'>): boolean {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO jobs (external_id, source, title, company, url, description, location, tags, posted_at)
    VALUES (@external_id, @source, @title, @company, @url, @description, @location, @tags, @posted_at)
  `);
  const result = stmt.run(job);
  return result.changes > 0;
}

export function getUnanalyzedJobs(): JobRow[] {
  return db.prepare('SELECT * FROM jobs WHERE match_score IS NULL').all() as JobRow[];
}

export function updateJobAnalysis(id: number, score: number, reasoning: string): void {
  db.prepare('UPDATE jobs SET match_score = ?, match_reasoning = ? WHERE id = ?').run(score, reasoning, id);
}

export function getUnnotifiedJobs(minScore: number): JobRow[] {
  return db.prepare(
    'SELECT * FROM jobs WHERE notified = 0 AND match_score IS NOT NULL AND match_score >= ? ORDER BY match_score DESC'
  ).all(minScore) as JobRow[];
}

export function markNotified(id: number): void {
  db.prepare('UPDATE jobs SET notified = 1 WHERE id = ?').run(id);
}

export function getJobStats(): { total: number; analyzed: number; notified: number } {
  const total = (db.prepare('SELECT COUNT(*) as cnt FROM jobs').get() as { cnt: number }).cnt;
  const analyzed = (db.prepare('SELECT COUNT(*) as cnt FROM jobs WHERE match_score IS NOT NULL').get() as { cnt: number }).cnt;
  const notified = (db.prepare('SELECT COUNT(*) as cnt FROM jobs WHERE notified = 1').get() as { cnt: number }).cnt;
  return { total, analyzed, notified };
}

export function registerChat(chatId: number): void {
  db.prepare('INSERT OR REPLACE INTO bot_chats (chat_id, active) VALUES (?, 1)').run(chatId);
}

export function deactivateChat(chatId: number): void {
  db.prepare('UPDATE bot_chats SET active = 0 WHERE chat_id = ?').run(chatId);
}

export function getActiveChats(): number[] {
  const rows = db.prepare('SELECT chat_id FROM bot_chats WHERE active = 1').all() as { chat_id: number }[];
  return rows.map(r => r.chat_id);
}

export function isChatActive(chatId: number): boolean {
  const row = db.prepare('SELECT active FROM bot_chats WHERE chat_id = ?').get(chatId) as { active: number } | undefined;
  return row?.active === 1;
}

export function closeDatabase(): void {
  if (db) db.close();
}
