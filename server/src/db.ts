import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Memory, Note } from './types.js';

const DB_PATH = process.env.DB_PATH ?? resolve(import.meta.dirname, '..', 'data', 'nicenotes.sqlite');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL UNIQUE,
    pw_hash    TEXT NOT NULL,
    seq        INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id           TEXT NOT NULL,
    body         TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    memory       TEXT NOT NULL,
    review_count INTEGER NOT NULL DEFAULT 0,
    seq          INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_notes_seq ON notes(user_id, seq);

  CREATE TABLE IF NOT EXISTS note_history (
    row_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_id     TEXT NOT NULL,
    body        TEXT NOT NULL,
    saved_at    INTEGER NOT NULL,
    replaced_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_history_note ON note_history(user_id, note_id, replaced_at DESC);
`);

export interface NoteRow {
  user_id: string;
  id: string;
  body: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  memory: string;
  review_count: number;
  seq: number;
}

const DEFAULT_MEMORY: Memory = {
  due: 0,
  interval: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  lastReviewedAt: null,
  lastGrade: null,
};

export function rowToNote(row: NoteRow): Note {
  let memory: Memory;
  try {
    memory = { ...DEFAULT_MEMORY, ...(JSON.parse(row.memory) as Partial<Memory>) };
  } catch {
    memory = { ...DEFAULT_MEMORY };
  }
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    memory,
    reviewCount: row.review_count,
  };
}

export function getUserByEmail(email: string): { id: string; email: string; pw_hash: string } | undefined {
  return db.prepare('SELECT id, email, pw_hash FROM users WHERE email = ?').get(email) as
    | { id: string; email: string; pw_hash: string }
    | undefined;
}

export function insertUser(id: string, email: string, pwHash: string, now: number): void {
  db.prepare('INSERT INTO users (id, email, pw_hash, seq, created_at) VALUES (?, ?, ?, 0, ?)').run(
    id,
    email,
    pwHash,
    now,
  );
}

export function getUserById(id: string): { id: string; email: string } | undefined {
  return db.prepare('SELECT id, email FROM users WHERE id = ?').get(id) as { id: string; email: string } | undefined;
}

export function createSession(token: string, userId: string, expiresAt: number): void {
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
}

export function getSession(token: string, now: number): { user_id: string; expires_at: number } | undefined {
  return db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token) as
    | { user_id: string; expires_at: number }
    | undefined;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** 顺手清掉过期会话，避免表无限长 */
export function pruneSessions(now: number): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}

export function getSeq(userId: string): number {
  const row = db.prepare('SELECT seq FROM users WHERE id = ?').get(userId) as { seq: number } | undefined;
  return row?.seq ?? 0;
}

export function setSeq(userId: string, seq: number): void {
  db.prepare('UPDATE users SET seq = ? WHERE id = ?').run(seq, userId);
}

export function getNoteRow(userId: string, id: string): NoteRow | undefined {
  return db.prepare('SELECT * FROM notes WHERE user_id = ? AND id = ?').get(userId, id) as NoteRow | undefined;
}

export function insertNote(userId: string, note: Note, seq: number): void {
  db.prepare(
    `INSERT INTO notes (user_id, id, body, created_at, updated_at, deleted_at, memory, review_count, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    note.id,
    note.body,
    note.createdAt,
    note.updatedAt,
    note.deletedAt,
    JSON.stringify(note.memory),
    note.reviewCount,
    seq,
  );
}

export function updateNote(userId: string, note: Note, seq: number): void {
  db.prepare(
    `UPDATE notes SET body = ?, updated_at = ?, deleted_at = ?, memory = ?, review_count = ?, seq = ?
     WHERE user_id = ? AND id = ?`,
  ).run(
    note.body,
    note.updatedAt,
    note.deletedAt,
    JSON.stringify(note.memory),
    note.reviewCount,
    seq,
    userId,
    note.id,
  );
}

export function listNotesSince(userId: string, since: number): NoteRow[] {
  return db
    .prepare('SELECT * FROM notes WHERE user_id = ? AND seq > ? ORDER BY seq ASC')
    .all(userId, since) as unknown as NoteRow[];
}

export function appendHistory(userId: string, noteId: string, body: string, savedAt: number, replacedAt: number): void {
  db.prepare(
    'INSERT INTO note_history (user_id, note_id, body, saved_at, replaced_at) VALUES (?, ?, ?, ?, ?)',
  ).run(userId, noteId, body, savedAt, replacedAt);
}

export function listHistory(userId: string, noteId: string, limit = 20): { body: string; saved_at: number; replaced_at: number }[] {
  return db
    .prepare(
      'SELECT body, saved_at, replaced_at FROM note_history WHERE user_id = ? AND note_id = ? ORDER BY replaced_at DESC LIMIT ?',
    )
    .all(userId, noteId, limit) as { body: string; saved_at: number; replaced_at: number }[];
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
