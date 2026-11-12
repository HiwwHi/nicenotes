import type { Note } from './types';

const DB_NAME = 'echo-notes';
const DB_VERSION = 1;
const STORE = 'notes';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // 某些环境（无痕模式、被策略禁用）里 open 会既不成功也不失败，
    // 这里兜一个超时，至少让界面给出提示而不是一直白屏。
    const timer = setTimeout(() => reject(new Error('本地数据库打开超时')), 5000);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error('无法打开本地数据库'));
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new Error('本地数据库被其他标签页占用'));
    };
  });
  return opening;
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('本地数据库读写失败'));
  });
}

export const db = {
  all: () => run<Note[]>('readonly', (s) => s.getAll()),
  put: (note: Note) => run<IDBValidKey>('readwrite', (s) => s.put(note)),
  remove: (id: string) => run<undefined>('readwrite', (s) => s.delete(id)),
  clear: () => run<undefined>('readwrite', (s) => s.clear()),
};

/** IndexedDB 不可用时（隐私模式、老浏览器）退化成内存存储，至少不白屏 */
export function isPersistent(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}
