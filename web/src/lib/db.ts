import type { StoredNote } from '../types';

/**
 * IndexedDB 的手写封装，不引第三方库。
 * 只用到两个 store：notes（笔记本体）和 meta（同步游标、设置、每日计数）。
 */

const DB_NAME = 'nicenotes';
const DB_VERSION = 1;
const NOTES = 'notes';
const META = 'meta';

let handle: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (handle) return handle;
  handle = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('这个浏览器不支持本地数据库，换 Chrome / Edge / Safari 再试'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTES)) db.createObjectStore(NOTES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本地数据库打不开'));
    request.onblocked = () => reject(new Error('本地数据库被另一个标签页占用，关掉多余的标签页再试'));
  });
  return handle;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('本地读写失败'));
  });
}

function mutate(name: string, fn: (store: IDBObjectStore) => void): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(name, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('本地写入失败'));
        tx.onabort = () => reject(tx.error ?? new Error('本地写入被中断'));
        fn(tx.objectStore(name));
      }),
  );
}

export async function readNotes(): Promise<StoredNote[]> {
  const db = await open();
  const store = db.transaction(NOTES, 'readonly').objectStore(NOTES);
  const rows = await request(store.getAll());
  return rows as StoredNote[];
}

export function putNotes(notes: StoredNote[]): Promise<void> {
  if (notes.length === 0) return Promise.resolve();
  return mutate(NOTES, (store) => {
    for (const note of notes) store.put(note);
  });
}

export function putNote(note: StoredNote): Promise<void> {
  return mutate(NOTES, (store) => {
    store.put(note);
  });
}

export function deleteNotes(ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return mutate(NOTES, (store) => {
    for (const id of ids) store.delete(id);
  });
}

export async function readMeta<T>(key: string): Promise<T | undefined> {
  const db = await open();
  const store = db.transaction(META, 'readonly').objectStore(META);
  const row = (await request(store.get(key))) as { key: string; value: T } | undefined;
  return row?.value;
}

export function writeMeta(key: string, value: unknown): Promise<void> {
  return mutate(META, (store) => {
    store.put({ key, value });
  });
}

export function clearAll(): Promise<void> {
  return open().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([NOTES, META], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('清空失败'));
        tx.objectStore(NOTES).clear();
        tx.objectStore(META).clear();
      }),
  );
}
