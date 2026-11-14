/** 服务端与客户端共享的数据形状。两边各存一份，保持同步。 */

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
  /** 归档时间。归档后不再进复习队列，但笔记本身还留着 */
  archivedAt: number | null;
}

/** 客户端推给服务端的笔记，多带一个「我上次同步时看到的 updatedAt」 */
export interface SyncNote extends Note {
  baseUpdatedAt: number;
}

export interface SyncRequest {
  /** 上次拿到的服务端游标 */
  since: number;
  notes: SyncNote[];
}

export interface SyncConflict {
  id: string;
  winner: 'local' | 'remote';
  /** 落败一方的正文，已经写进历史 */
  lostBody: string;
}

export interface SyncResponse {
  /** 服务端最新游标，下次原样带回来 */
  since: number;
  notes: Note[];
  conflicts: SyncConflict[];
}

export interface HistoryEntry {
  body: string;
  savedAt: number;
  replacedAt: number;
}
