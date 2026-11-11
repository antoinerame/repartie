import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'repartie.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '💬',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subtopics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS arguments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subtopic_id INTEGER NOT NULL REFERENCES subtopics(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES arguments(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('moi','autre')),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'fait' CHECK (kind IN ('fait','valeur','exemple','sophisme')),
  strength INTEGER NOT NULL DEFAULT 2 CHECK (strength BETWEEN 1 AND 3),
  concede INTEGER NOT NULL DEFAULT 0,
  sources TEXT NOT NULL DEFAULT '[]',
  ref_id INTEGER REFERENCES arguments(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  box INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  reviews INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_args_sub ON arguments(subtopic_id);
CREATE INDEX IF NOT EXISTS idx_args_parent ON arguments(parent_id);
CREATE INDEX IF NOT EXISTS idx_args_ref ON arguments(ref_id);
CREATE INDEX IF NOT EXISTS idx_subs_topic ON subtopics(topic_id);
`);

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function all<T = any>(sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T = any>(sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
