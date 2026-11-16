import {
  appendHistory,
  getNoteRow,
  getSeq,
  insertNote,
  listNotesSince,
  rowToNote,
  setSeq,
  transaction,
  updateNote,
} from './db.js';
import type { Memory, Note, SyncConflict, SyncNote } from './types.js';

const MAX_NOTES_PER_PUSH = 500;
const MAX_BODY = 20_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const FALLBACK_MEMORY: Memory = {
  due: 0,
  interval: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  lastReviewedAt: null,
  lastGrade: null,
};

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

function normalizeMemory(raw: unknown, now: number): Memory {
  const source = (raw ?? {}) as Partial<Memory>;
  const grade = source.lastGrade;
  return {
    due: clamp(Number(source.due ?? now), 0, Number.MAX_SAFE_INTEGER),
    interval: clamp(Number(source.interval ?? 0), 0, 36_500),
    ease: clamp(Number(source.ease ?? 2.5), 1.3, 3.2),
    reps: clamp(Number(source.reps ?? 0), 0, 100_000),
    lapses: clamp(Number(source.lapses ?? 0), 0, 100_000),
    lastReviewedAt: source.lastReviewedAt == null ? null : Number(source.lastReviewedAt),
    lastGrade: grade === 0 || grade === 1 || grade === 2 ? grade : null,
  };
}

function normalizeNote(input: SyncNote, now: number): Note | null {
  if (!input || typeof input !== 'object') return null;
  if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id)) return null;
  const body = typeof input.body === 'string' ? input.body.slice(0, MAX_BODY) : '';
  const updatedAt = clamp(Number(input.updatedAt ?? now), 0, Number.MAX_SAFE_INTEGER);

  return {
    id: input.id,
    body,
    createdAt: clamp(Number(input.createdAt ?? now), 0, Number.MAX_SAFE_INTEGER),
    updatedAt,
    deletedAt: input.deletedAt == null ? null : clamp(Number(input.deletedAt), 0, Number.MAX_SAFE_INTEGER),
    memory: normalizeMemory(input.memory, now),
    reviewCount: clamp(Number(input.reviewCount ?? 0), 0, 1_000_000),
    // 老客户端不会推这个字段，缺了就当没归档
    archivedAt:
      input.archivedAt == null ? null : clamp(Number(input.archivedAt), 0, Number.MAX_SAFE_INTEGER),
  };
}

export interface SyncOutcome {
  since: number;
  notes: Note[];
  conflicts: SyncConflict[];
  /** 校验没过、没存下来的笔记。以前是静默丢掉，客户端以为成功了 */
  rejected: { id: string; reason: string }[];
}

/**
 * 增量同步。
 *
 * 每条笔记带一个 baseUpdatedAt —— 客户端上次同步时看到的 updatedAt。服务端据此判断
 * 「这一侧改过没有」，两侧都改过才算真冲突，而不是谁先到谁赢。
 * 落败的一方不会消失，原文进 note_history，用户在界面上能翻回去恢复。
 */
export function runSync(userId: string, since: number, incoming: SyncNote[]): SyncOutcome {
  const now = Date.now();
  const all = Array.isArray(incoming) ? incoming : [];
  const batch = all.slice(0, MAX_NOTES_PER_PUSH);
  const overflow = all.slice(MAX_NOTES_PER_PUSH);
  const conflicts: SyncConflict[] = [];
  const explicitWinners: Note[] = [];
  const rejected: { id: string; reason: string }[] = [];

  const cursor = transaction(() => {
    let seq = getSeq(userId);

    for (const raw of batch) {
      const rawId = typeof raw?.id === 'string' ? raw.id : '';
      if (!ID_PATTERN.test(rawId)) {
        rejected.push({ id: rawId.slice(0, 64) || '(空)', reason: 'id 不合法' });
        continue;
      }

      const candidate = normalizeNote(raw, now);
      if (!candidate) {
        rejected.push({ id: rawId, reason: '格式不对' });
        continue;
      }

      const existing = getNoteRow(userId, candidate.id);

      if (!existing) {
        seq += 1;
        insertNote(userId, candidate, seq);
        continue;
      }

      const base = Number(raw.baseUpdatedAt ?? 0) || 0;
      const serverChanged = existing.updated_at !== base;
      const localChanged = candidate.updatedAt !== base;

      if (serverChanged && localChanged && existing.updated_at !== candidate.updatedAt) {
        if (candidate.updatedAt > existing.updated_at) {
          appendHistory(userId, existing.id, existing.body, existing.updated_at, now);
          seq += 1;
          updateNote(userId, candidate, seq);
          conflicts.push({ id: candidate.id, winner: 'local', lostBody: existing.body });
        } else {
          appendHistory(userId, candidate.id, candidate.body, candidate.updatedAt, now);
          conflicts.push({ id: candidate.id, winner: 'remote', lostBody: candidate.body });
          explicitWinners.push(rowToNote(existing));
        }
        continue;
      }

      if (candidate.updatedAt > existing.updated_at) {
        appendHistory(userId, existing.id, existing.body, existing.updated_at, now);
        seq += 1;
        updateNote(userId, candidate, seq);
      }
    }

    setSeq(userId, seq);
    return seq;
  });

  const merged = new Map<string, Note>();
  for (const row of listNotesSince(userId, since)) {
    merged.set(row.id, rowToNote(row));
  }
  for (const note of explicitWinners) {
    merged.set(note.id, note);
  }

  /*
   * 超出的部分不静默丢掉，逐条告诉他「这批没接收」。
   * 现在的客户端会自己分批，走不到这里；这是给老版本和第三方客户端的兜底 ——
   * 悄悄截断会让它们以为同步成功了，那些笔记却永远上不来。
   */
  for (const raw of overflow) {
    const rawId = typeof raw?.id === 'string' ? raw.id : '';
    rejected.push({ id: rawId.slice(0, 64) || '(空)', reason: `一次最多 ${MAX_NOTES_PER_PUSH} 条，这条没接收` });
  }

  return { since: cursor, notes: [...merged.values()], conflicts, rejected };
}
