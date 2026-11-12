import type { Grade, Memory, Note } from './types';
import { DAY, humanDelta } from './util/date';

const MINUTE = 60_000;

export function newMemory(now: number): Memory {
  return { reps: 0, interval: 0, ease: 2.5, lapses: 0, due: now };
}

/** 还没被回顾过一次的笔记 */
export function isNew(note: Note): boolean {
  return note.memory.firstReview === undefined;
}

/**
 * 一次回顾之后，这条笔记的记忆状态变成什么样。
 *
 * 规则脱胎于 SM-2，但做了三处改动：
 *  1. 「忘了」不打回零，只把间隔清零并把难度系数调高——避免一条难记的笔记永远从头开始；
 *  2. 间隔增长上限由 ease 控制，简单的内容会迅速拉开到几个月；
 *  3. 「有点模糊」的增长系数固定 1.6，刻意比「记得」保守。
 */
export function schedule(prev: Memory, g: Grade, now: number): Memory {
  const m: Memory = { ...prev, lastReview: now };
  m.firstReview ??= now;
  m.reps += 1;

  if (g === 0) {
    m.lapses += 1;
    m.ease = Math.max(1.3, m.ease - 0.2);
    m.interval = 0;
    m.due = now + 10 * MINUTE;
    return m;
  }

  if (g === 1) {
    m.ease = Math.max(1.3, m.ease - 0.05);
    m.interval = m.interval < 1 ? 1 : Math.round(Math.max(m.interval * 1.6, m.interval + 1));
  } else {
    m.ease = Math.min(3.2, m.ease + 0.06);
    if (m.reps <= 1) m.interval = 3;
    else if (m.reps === 2) m.interval = 7;
    else m.interval = Math.round(Math.max(m.interval * m.ease, m.interval + 1));
  }

  m.due = now + m.interval * DAY;
  return m;
}

/** 给三个按钮下方的小字用：「10 分钟后」「明天」「7 天后」 */
export function previewDue(memory: Memory, g: Grade, now: number): string {
  return humanDelta(schedule(memory, g, now).due - now);
}

export type Stage = 'new' | 'learning' | 'familiar' | 'solid';

/** 把间隔映射成一个人能理解的状态，用于统计和列表标签 */
export function stageOf(note: Note): Stage {
  if (isNew(note)) return 'new';
  const days = note.memory.interval;
  if (days < 7) return 'learning';
  if (days < 21) return 'familiar';
  return 'solid';
}

export const STAGE_LABEL: Record<Stage, string> = {
  new: '新的',
  learning: '学习中',
  familiar: '熟悉',
  solid: '稳固',
};
