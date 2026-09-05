import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const dataDirectory = process.env.DAYLIGHT_DATA_DIR ? resolve(process.env.DAYLIGHT_DATA_DIR) : join(currentDir, '../data');
mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(join(dataDirectory, 'daylight.db'));
database.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`);

export type DailyNote = { id: string; date: string; content: string; createdAt: string; updatedAt: string };

export function getNote(day: string): DailyNote | null {
  const row = database.prepare('SELECT id, day, content, created_at, updated_at FROM notes WHERE day = ?').get(day) as
    | { id: string; day: string; content: string; created_at: string; updated_at: string }
    | undefined;
  return row ? { id: row.id, date: row.day, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

export function saveNote(day: string, content: string): DailyNote {
  const existing = getNote(day);
  const now = new Date().toISOString();
  if (existing) {
    database.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE day = ?').run(content, now, day);
    return { ...existing, content, updatedAt: now };
  }
  const id = crypto.randomUUID();
  database.prepare('INSERT INTO notes (id, day, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, day, content, now, now);
  return { id, date: day, content, createdAt: now, updatedAt: now };
}

export function getSetting(key: string): string | null {
  const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  database.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value, new Date().toISOString());
}
