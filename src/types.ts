export type Grade = 0 | 1 | 2;

/**
 * 一条笔记的「记忆状态」。整个应用的调度都围绕它转。
 */
export interface Memory {
  /** 被回顾过的次数 */
  reps: number;
  /** 当前间隔（天）。0 表示还没进入长期记忆 */
  interval: number;
  /** 难度系数，越低说明这条越难记，间隔增长越慢 */
  ease: number;
  /** 遗忘次数 */
  lapses: number;
  /** 下次该出现的时间戳 */
  due: number;
  /** 第一次被回顾的时间。undefined 表示这是一条「新」笔记 */
  firstReview?: number;
  lastReview?: number;
}

export interface ReviewLog {
  at: number;
  g: Grade;
}

export interface Note {
  id: string;
  body: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  memory: Memory;
  history: ReviewLog[];
}

export type View = 'review' | 'all' | 'stats';
