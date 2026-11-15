export type Grade = 0 | 1 | 2;

export interface Memory {
  /** 下次该复习的时间戳（ms） */
  due: number;
  /** 当前间隔（天） */
  interval: number;
  /** 难度系数，SM-2 里的 EF */
  ease: number;
  /** 连续答对次数 */
  reps: number;
  /** 忘记次数 */
  lapses: number;
  lastReviewedAt: number | null;
  lastGrade: Grade | null;
}

export interface Note {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  memory: Memory;
  reviewCount: number;
  /** 归档时间。归档后不再进复习队列，但笔记仍然留在流里 */
  archivedAt?: number | null;
}

/** 本地存储的笔记，多记一个「上次同步时看到的服务端版本」 */
export interface StoredNote extends Note {
  baseUpdatedAt: number;
  /**
   * demo 表示这是首次打开时塞进来的示例，只用来让你看见界面长什么样。
   * 它不会被推到服务器；一旦登录的账号里已经有笔记，它就被清掉。
   */
  origin?: 'demo';
}

export interface SyncPayload {
  since: number;
  notes: StoredNote[];
}

export interface SyncConflict {
  id: string;
  winner: 'local' | 'remote';
  lostBody: string;
}

export interface SyncResult {
  since: number;
  notes: Note[];
  conflicts: SyncConflict[];
  /** 服务端校验没过、没存下的笔记 */
  rejected?: { id: string; reason: string }[];
}

export interface HistoryVersion {
  body: string;
  savedAt: number;
  replacedAt: number;
}

export interface Account {
  email: string;
}
