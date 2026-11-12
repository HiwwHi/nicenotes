import type { Grade, Memory, Note } from '../types';
import { DAY, MINUTE } from './date';

/**
 * 排期算法：SM-2 的简化版，改了两处。
 *
 * 1. 「忘了」不清零历史。原版 SM-2 会从头开始，结果是一条难记的笔记永远停在第一天，
 *    永远看不到进步。这里只清空间隔、压低难度系数，让它快速回来但不归零。
 * 2. 三个按钮的间隔刻意拉开距离。如果「有点模糊」和「记得」都给明天，按钮就没有意义了。
 */

const MIN_EASE = 1.3;
const MAX_EASE = 3.2;
const MAX_INTERVAL = 365;
const RELEARN_MINUTES = 10;

export function freshMemory(now: number): Memory {
  return {
    due: now,
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    lastReviewedAt: null,
    lastGrade: null,
  };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function nextInterval(memory: Memory, grade: Grade): { interval: number; ease: number; reps: number; lapses: number } {
  const reps = memory.reps + 1;

  if (grade === 0) {
    return {
      interval: 0,
      ease: clamp(memory.ease - 0.2, MIN_EASE, MAX_EASE),
      reps: 0,
      lapses: memory.lapses + 1,
    };
  }

  if (grade === 1) {
    const raw = reps <= 1 ? 1 : reps === 2 ? 3 : Math.max(memory.interval + 1, memory.interval * 1.7);
    return {
      interval: clamp(Math.round(raw), 1, MAX_INTERVAL),
      ease: clamp(memory.ease - 0.05, MIN_EASE, MAX_EASE),
      reps,
      lapses: memory.lapses,
    };
  }

  const ease = clamp(memory.ease + 0.08, MIN_EASE, MAX_EASE);
  const raw = reps <= 1 ? 2 : reps === 2 ? 5 : Math.max(memory.interval + 2, memory.interval * ease);
  return {
    interval: clamp(Math.round(raw), 1, MAX_INTERVAL),
    ease,
    reps,
    lapses: memory.lapses,
  };
}

export function nextDue(memory: Memory, grade: Grade, now: number): number {
  const { interval } = nextInterval(memory, grade);
  return grade === 0 ? now + RELEARN_MINUTES * MINUTE : now + interval * DAY;
}

export function applyGrade(note: Note, grade: Grade, now: number): Note {
  const next = nextInterval(note.memory, grade);
  return {
    ...note,
    updatedAt: now,
    reviewCount: note.reviewCount + 1,
    memory: {
      due: grade === 0 ? now + RELEARN_MINUTES * MINUTE : now + next.interval * DAY,
      interval: next.interval,
      ease: next.ease,
      reps: next.reps,
      lapses: next.lapses,
      lastReviewedAt: now,
      lastGrade: grade,
    },
  };
}

export const GRADE_META: { grade: Grade; label: string; tone: 'bad' | 'mid' | 'good'; key: string }[] = [
  { grade: 0, label: '忘了', tone: 'bad', key: '1' },
  { grade: 1, label: '有点模糊', tone: 'mid', key: '2' },
  { grade: 2, label: '记得', tone: 'good', key: '3' },
];

export function isNew(note: Note): boolean {
  return note.reviewCount === 0;
}

export function isDue(note: Note, now: number): boolean {
  return !isNew(note) && note.memory.due <= now;
}
