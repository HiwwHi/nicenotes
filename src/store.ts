import { db } from './db';
import { isNew, newMemory, schedule } from './scheduler';
import type { Grade, Note } from './types';
import { addDays, DAY, dayKey } from './util/date';
import { uid } from './util/dom';

const NEW_PER_DAY = 3;
const MAX_DUE = 15;

type Listener = () => void;

let notes: Note[] = [];
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

export function getNotes(): Note[] {
  return notes;
}

export async function load(): Promise<void> {
  notes = await db.all();
  notes.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addNote(body: string, tags: string[]): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: uid(),
    body: body.trim(),
    tags,
    createdAt: now,
    updatedAt: now,
    memory: newMemory(now),
    history: [],
  };
  notes = [note, ...notes];
  await db.put(note);
  emit();
  return note;
}

export async function editNote(id: string, body: string, tags: string[]): Promise<void> {
  const i = notes.findIndex((n) => n.id === id);
  if (i < 0) return;
  const updated: Note = { ...notes[i]!, body: body.trim(), tags, updatedAt: Date.now() };
  notes = notes.map((n) => (n.id === id ? updated : n));
  await db.put(updated);
  emit();
}

export async function removeNote(id: string): Promise<void> {
  notes = notes.filter((n) => n.id !== id);
  await db.remove(id);
  emit();
}

/** 记一次回顾，返回更新后的笔记 */
export async function review(id: string, g: Grade): Promise<Note | null> {
  const i = notes.findIndex((n) => n.id === id);
  if (i < 0) return null;
  const now = Date.now();
  const note = notes[i]!;
  const updated: Note = {
    ...note,
    memory: schedule(note.memory, g, now),
    history: [...note.history, { at: now, g }],
  };
  notes = notes.map((n) => (n.id === id ? updated : n));
  await db.put(updated);
  emit();
  return updated;
}

export async function importNotes(incoming: Note[]): Promise<number> {
  const known = new Set(notes.map((n) => n.id));
  const fresh = incoming.filter((n) => n && n.id && !known.has(n.id));
  for (const n of fresh) await db.put(n);
  notes = [...fresh, ...notes].sort((a, b) => b.createdAt - a.createdAt);
  emit();
  return fresh.length;
}

export function exportNotes(): string {
  return JSON.stringify({ app: 'echo-notes', version: 1, exportedAt: Date.now(), notes }, null, 2);
}

export function dailyNewUsed(now: number): number {
  const key = dayKey(now);
  return notes.filter((n) => n.memory.firstReview !== undefined && dayKey(n.memory.firstReview) === key)
    .length;
}

/**
 * 今天该回顾什么：先排已到期的，再补几条新的。
 *
 * 已到期的那批用「加权随机」抽出——逾期越久权重越高，间隔越长（说明记牢了）
 * 相对越不着急。用户感觉是随机撞见，其实是算法在挑。
 * 新的每天最多 3 条，让「打开就用得完」成为常态。
 */
export function buildQueue(now: number): { queue: Note[]; remaining: number } {
  const due = notes.filter((n) => !isNew(n) && n.memory.due <= now);

  const quota = Math.max(0, NEW_PER_DAY - dailyNewUsed(now));
  const fresh = notes
    .filter(isNew)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, quota);

  const head = weightedOrder(due, now).slice(0, MAX_DUE);
  return { queue: [...head, ...fresh], remaining: Math.max(0, due.length - head.length) };
}

function weightOf(note: Note, now: number): number {
  if (isNew(note)) return 1.5;
  const overdueDays = Math.max(0, (now - note.memory.due) / DAY);
  return 1 + Math.min(overdueDays, 30) * 0.6;
}

/** 按权重不放回地抽取，得到一个近似随机的顺序 */
function weightedOrder(pool: Note[], now: number): Note[] {
  const rest = pool.slice();
  const out: Note[] = [];
  while (rest.length > 0) {
    const weights = rest.map((n) => weightOf(n, now));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let pick = rest.length - 1;
    for (let i = 0; i < rest.length; i += 1) {
      r -= weights[i]!;
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    out.push(rest.splice(pick, 1)[0]!);
  }
  return out;
}

export function nextDueAt(): number | null {
  const upcoming = notes.filter((n) => !isNew(n)).map((n) => n.memory.due);
  return upcoming.length ? Math.min(...upcoming) : null;
}

export function reviewedDayKeys(): Set<string> {
  const set = new Set<string>();
  for (const n of notes) for (const h of n.history) set.add(dayKey(h.at));
  return set;
}

/** 连续回顾天数。今天还没回顾时，从昨天往回数，不算断 */
export function streak(): number {
  const days = reviewedDayKeys();
  let cursor = Date.now();
  if (!days.has(dayKey(cursor))) cursor = addDays(cursor, -1);
  let count = 0;
  while (days.has(dayKey(cursor))) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export function totalReviews(): number {
  return notes.reduce((sum, n) => sum + n.history.length, 0);
}
