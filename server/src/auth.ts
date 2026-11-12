import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createSession, deleteSession, getSession, insertUser, getUserByEmail, pruneSessions } from './db.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface AuthUser {
  id: string;
  email: string;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

export function registerUser(email: string, password: string): { token: string; user: AuthUser } {
  const id = randomUUID();
  insertUser(id, email, hashPassword(password), Date.now());
  return { token: issueToken(id), user: { id, email } };
}

export function loginUser(email: string, password: string): { token: string; user: AuthUser } | null {
  const row = getUserByEmail(email);
  if (!row) return null;
  if (!verifyPassword(password, row.pw_hash)) return null;
  return { token: issueToken(row.id), user: { id: row.id, email: row.email } };
}

function issueToken(userId: string): string {
  const token = randomBytes(32).toString('hex');
  createSession(token, userId, Date.now() + SESSION_TTL_MS);
  return token;
}

export function resolveToken(token: string | null): string | null {
  if (!token) return null;
  const now = Date.now();
  const row = getSession(token, now);
  if (!row) return null;
  if (row.expires_at < now) {
    deleteSession(token);
    return null;
  }
  return row.user_id;
}

export function revokeToken(token: string): void {
  deleteSession(token);
}

/** 登录接口的朴素限流：同一 IP 十分钟内最多 10 次失败尝试 */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return false;
  }
  entry.count += 1;
  if (attempts.size > 5000) attempts.clear();
  return entry.count > 10;
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}

export function tidySessions(): void {
  pruneSessions(Date.now());
}
