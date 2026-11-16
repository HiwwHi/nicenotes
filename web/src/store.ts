import { useSyncExternalStore } from 'react';
import { ApiError, api, hasBackend } from './lib/api';
import { dayKey, splitBody } from './lib/date';
import { plainText, splitLinks } from './lib/rich';
import * as local from './lib/db';
import { contentHash, parseMarkdownFile, toBody } from './lib/markdown-import';
import { GRADE_META, applyGrade, freshMemory, isDue, isNew } from './lib/scheduler';
import type { Account, Grade, StoredNote } from './types';

const TOKEN_KEY = 'nicenotes.token';
const NEW_PER_DAY = 3;
const DAY = 86_400_000;

/**
 * 生成笔记 id。
 *
 * crypto.randomUUID 只在安全上下文（HTTPS 或 localhost）里有。用
 * http://192.168.x.x:8787 这种地址打开时它是 undefined，
 * 直接调用会抛 TypeError —— 表现为「一记笔记就白屏」。
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const random = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
  return `n-${Date.now().toString(36)}-${random}`;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn' | 'error';
  /** 可选的操作按钮，比如删除后的「撤销」 */
  action?: { label: string; run: () => void };
}

export interface AppState {
  ready: boolean;
  fatal: string | null;
  notes: StoredNote[];
  account: Account | null;
  syncing: boolean;
  lastSyncAt: number | null;
  syncError: string | null;
  /** 浏览器报告的网络状态。断网时要说清楚「东西还在本机」，而不是让那个小圆点自己去红 */
  online: boolean;
  /** 这台服务器开不开注册。关掉之后界面里不该出现注册入口 */
  allowRegister: boolean;
  currentId: string | null;
  revealed: boolean;
  sessionDone: string[];
  newToday: number;
  newDay: string;
  log: Record<string, number>;
  toast: Toast | null;
}

const emptyState: AppState = {
  ready: false,
  fatal: null,
  notes: [],
  account: null,
  syncing: false,
  lastSyncAt: null,
  syncError: null,
  online: true,
  allowRegister: true,
  currentId: null,
  revealed: false,
  sessionDone: [],
  newToday: 0,
  newDay: '',
  log: {},
  toast: null,
};

let state: AppState = emptyState;

/**
 * 同一个浏览器里可能同时开着好几个实例：浏览器的标签页、装成应用的独立窗口。
 * 不加这一层，A 里写的笔记 B 要刷新才看得见，甚至会各自覆盖。
 */
const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('nicenotes-tab');

let announceTimer: ReturnType<typeof setTimeout> | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function announceChange(): void {
  if (!channel) return;
  if (announceTimer) clearTimeout(announceTimer);
  // 连续写（比如批量操作）时合并成一次，别让别的标签页反复重载
  announceTimer = setTimeout(() => channel.postMessage({ type: 'changed' }), 80);
}

async function reloadFromDisk(): Promise<void> {
  if (!state.ready) return;

  const notes = await local.readNotes();
  set({ notes });

  // 正在看的那条可能被另一个标签页删了
  if (state.currentId && !notes.some((note) => note.id === state.currentId && !note.deletedAt)) {
    advance();
  }
}

if (channel) {
  channel.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
    if (event.data?.type !== 'changed') return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void reloadFromDisk(), 120);
  });
}
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApp(): AppState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => emptyState,
  );
}

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string, tone: Toast['tone'] = 'ok', action?: Toast['action']): void {
  const id = ++toastSeq;
  set({ toast: { id, text, tone, action } });
  if (toastTimer) clearTimeout(toastTimer);

  // 带操作按钮的提示要多留一会儿，否则手还没移到按钮上就没了
  const life = action ? 8000 : tone === 'error' ? 5200 : 3200;
  toastTimer = setTimeout(() => {
    if (state.toast?.id === id) set({ toast: null });
  }, life);
}

/** 手动关掉提示条，比如点了「撤销」之后 */
export function dismissToast(): void {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toast: null });
}

/* ---------------------------------------------------------------- 选题 */

interface Pick {
  note: StoredNote;
  kind: 'due' | 'new';
}

/**
 * 「随机」是加权的，不是纯随机。
 * 逾期越久权重越高，但上限定在 30 天 —— 否则一条放了半年的笔记会永远被抽中，
 * 你连续三天看到同一条会直接卸载。
 */
function weightedPick(pool: StoredNote[], now: number): StoredNote | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0] ?? null;

  const weights = pool.map((note) => 1 + Math.min(30, Math.max(0, (now - note.memory.due) / DAY)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    roll -= weights[i] ?? 0;
    if (roll <= 0) return pool[i] ?? null;
  }
  return pool[pool.length - 1] ?? null;
}

function visibleNotes(notes: StoredNote[]): StoredNote[] {
  return notes.filter((note) => !note.deletedAt);
}

/** 归档 = 不再进复习队列，但笔记本身还在流里，随时能翻到 */
function isArchived(note: StoredNote): boolean {
  return Boolean(note.archivedAt);
}

function pickNext(app: Pick['kind'] | 'any' = 'any'): Pick | null {
  const now = Date.now();
  const exclude = new Set(app === 'any' ? state.sessionDone : state.sessionDone);
  const pool = visibleNotes(state.notes).filter((note) => !exclude.has(note.id) && !isArchived(note));

  if (app !== 'new') {
    const due = pool.filter((note) => isDue(note, now));
    const picked = weightedPick(due, now);
    if (picked) return { note: picked, kind: 'due' };
  }

  if (app !== 'due' && state.newToday < NEW_PER_DAY) {
    const fresh = pool.filter(isNew).sort((a, b) => a.createdAt - b.createdAt);
    const first = fresh[0];
    if (first) return { note: first, kind: 'new' };
  }

  return null;
}

function advance(): void {
  const next = pickNext();
  set({ currentId: next?.note.id ?? null, revealed: false });
}

/* ---------------------------------------------------------------- 持久化 */

async function store(note: StoredNote): Promise<void> {
  const notes = state.notes.some((item) => item.id === note.id)
    ? state.notes.map((item) => (item.id === note.id ? note : item))
    : [...state.notes, note];
  set({ notes });
  await local.putNote(note);
  announceChange();
}

/* ---------------------------------------------------------------- 初始化 */

function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 无痕模式下写不进去，忽略 */
  }
}

export function authToken(): string | null {
  return getToken();
}

const SEED: { title: string; rest: string; daysAgo: number }[] = [
  {
    title: 'probe 慢，先怀疑 regulator 的上电时序，最后才怀疑内核。',
    rest: '顺序是：量 `regulator enable` 到输出稳定的时间 → 看 driver 的 probe 里有没有 I2C 轮询等待 → 查有没有 `-EPROBE_DEFER` 反复重试 → 才轮到调度和 CPU 频率。\n大多数「内核慢」最后都是硬件时序。',
    daysAgo: 0,
  },
  {
    title: '看到 -517 就是 EPROBE_DEFER，不是失败。',
    rest: '`-517` 的意思是「我依赖的东西还没准备好」，内核让你等一等。真正要查的是那个依赖为什么没起来 —— 常见是 `regulator`、`clk`、`gpio` 的驱动还没 probe 完。',
    daysAgo: 1,
  },
  {
    title: 'dmesg 里 Freeing unused kernel memory 是内核态和用户态的分界线。',
    rest: '它之前全是内核初始化，之后才是 init。算启动耗时必须先按这一刀切开，否则会把用户态的慢算到内核头上。',
    daysAgo: 2,
  },
  {
    title: '两份 dts 用了同一个 GPIO，编译一声不响，上板才发现。',
    rest: 'pinctrl 里 A 节点用了 `GPIO3_A2`，B 节点也用了。合并时不会报冲突，因为语法完全合法。只有运行时读 pinmux 寄存器才知道谁赢了。\n多人并行改 dts 时这是高频事故。',
    daysAgo: 3,
  },
  {
    title: 'initcall_debug 只能启动前打开，别人的 log 事后用不上。',
    rest: '所以拿到一份现成的 dmesg，只能靠时间戳差值人工找嫌疑：\n```text\n[    0.823] probe of 1c28000.i2c returned 0 after 1204 usecs\n[    1.457] probe of fe2b0000.ethernet returned -517 after 3 usecs\n```\n这两行差了 0.6 秒，真正的嫌疑是第一行 —— 它自己花了 1.2ms。',
    daysAgo: 5,
  },
  {
    title: 'I2C 通信失败，先量上拉电阻，再看时序。',
    rest: '`4.7k` 上拉在 `400k` 速率下边沿常常太慢。示波器看 SCL 上升沿，如果爬到 3.3V 用了几百纳秒，就是它。\n```bash\n# 先确认设备在不在总线上\ni2cdetect -y 1\n# 再读一遍寄存器，看有没有响应\ni2cget -y 1 0x38 0x00\n```\n曾经因为这个换过一整批板子上的电阻。',
    daysAgo: 6,
  },
  {
    title: '设备树 reg 区间重叠，编译器不报，运行时内存被踩。',
    rest: '两个节点都从 `0x10000000` 起、长度各 `0x1000` —— 完全合法。这类问题只能自己写脚本扫，靠 review 看是看不出来的。',
    daysAgo: 8,
  },
  {
    title: '间隔重复的关键不是复习，是在「快忘记」的那一刻复习。',
    rest: '太早复习是浪费，太晚复习等于重学。所以真正要算的不是「第几天复习」，是「你有多大概率还记得」。\n难度系数 `ease` 就是这个估计。',
    daysAgo: 10,
  },
  {
    title: '本地优先不是「离线能用」，是「本地数据才是唯一真相」。',
    rest: '服务器只是另一台设备。同步是两台设备交换各自知道的事实，不是把数据上传备份。\n这个区别决定了断网时你到底还能不能干活。',
    daysAgo: 12,
  },
];

async function seedIfEmpty(): Promise<void> {
  if (await local.readMeta<boolean>('seeded')) return;
  const now = Date.now();
  const notes: StoredNote[] = SEED.map((item, index) => {
    const created = now - item.daysAgo * DAY - index * 37 * 60_000;
    return {
      // 用固定 id：两个标签页同时首次打开会各 seed 一次，随机 id 会让示例翻倍
      id: `demo-seed-${String(index + 1).padStart(4, '0')}`,
      body: `${item.title}\n${item.rest}`,
      createdAt: created,
      updatedAt: created,
      deletedAt: null,
      memory: { ...freshMemory(now), due: now },
      reviewCount: 0,
      baseUpdatedAt: 0,
      origin: 'demo',
    };
  });

  state = { ...state, notes: [...state.notes, ...notes] };
  await local.putNotes(notes);
  await local.writeMeta('seeded', true);
}

let initializing = false;

/**
 * 盯住网络状态。
 *
 * navigator.onLine 只说明「有没有网卡」，连不上服务器它照样是 true —— 所以
 * 这里只管真断网。服务端挂了属于另一回事，由 syncError 那条路负责提示。
 * 恢复联网时立刻补一次同步，不用等用户再写一条笔记才想起来。
 */
let onlineBound = false;

function bindOnlineEvents(): void {
  if (onlineBound || typeof window === 'undefined') return;
  onlineBound = true;

  const sync = () => set({ online: navigator.onLine });
  sync();

  window.addEventListener('offline', sync);
  window.addEventListener('online', () => {
    sync();
    if (getToken() && hasBackend) void syncNow(true);
  });
}

export async function init(): Promise<void> {
  if (state.ready || initializing) return;
  initializing = true;
  try {
    bindOnlineEvents();
    const notes = await local.readNotes();
    const log = (await local.readMeta<Record<string, number>>('log')) ?? {};
    const today = dayKey(Date.now());
    const storedDay = (await local.readMeta<string>('newDay')) ?? '';
    const storedCount = (await local.readMeta<number>('newToday')) ?? 0;
    const lastSyncAt = (await local.readMeta<number>('lastSyncAt')) ?? null;

    state = {
      ...state,
      notes,
      log,
      newDay: storedDay === today ? today : today,
      newToday: storedDay === today ? storedCount : 0,
    };

    if (notes.length === 0) await seedIfEmpty();

    // 顺带问一句这台服务器开不开注册，界面据此决定要不要显示注册入口
    if (hasBackend) {
      void api
        .health()
        .then((result) => set({ allowRegister: result.allowRegister !== false }))
        .catch(() => undefined);
    }

    const token = getToken();
    if (token && hasBackend) {
      try {
        const me = await api.me(token);
        set({ account: { email: me.user.email } });
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setToken(null);
      }
    }

    set({ ready: true, lastSyncAt });
    advance();

    if (getToken() && hasBackend) void syncNow(true);
  } catch (error) {
    set({ ready: true, fatal: error instanceof Error ? error.message : '本地存储初始化失败' });
  }
}

/* ---------------------------------------------------------------- 写操作 */

export async function addNote(body: string): Promise<boolean> {
  const text = body.trim();
  if (!text) return false;
  const now = Date.now();
  const note: StoredNote = {
    id: newId(),
    body: text.slice(0, 20_000),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    memory: freshMemory(now),
    reviewCount: 0,
    baseUpdatedAt: 0,
  };
  await store(note);
  toast('记下了。它会在合适的时候回来找你');
  scheduleSync();
  return true;
}

export async function editNote(id: string, body: string): Promise<void> {
  const note = state.notes.find((item) => item.id === id);
  const text = body.trim();
  if (!note || !text || text === note.body) return;
  await store({ ...note, body: text.slice(0, 20_000), updatedAt: Date.now() });
  toast('改好了');
  scheduleSync();
}

export async function removeNote(id: string): Promise<void> {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return;
  const now = Date.now();
  await store({ ...note, deletedAt: now, updatedAt: now });
  if (state.currentId === id) advance();
  toast('删掉了', 'ok', { label: '撤销', run: () => void restoreNote(id) });
  scheduleSync();
}

/** 撤销删除。软删除的好处就在这里：内容一直没走，只是标了一笔 */
export async function restoreNote(id: string): Promise<void> {
  const note = state.notes.find((item) => item.id === id);
  if (!note || !note.deletedAt) return;
  await store({ ...note, deletedAt: null, updatedAt: Date.now() });
  toast('恢复了');
  scheduleSync();
}

/** 不再复习这条。笔记本身留着，想翻回来随时能找到 */
export async function archiveNote(id: string): Promise<void> {
  const note = state.notes.find((item) => item.id === id);
  if (!note || note.archivedAt) return;

  const now = Date.now();
  await store({ ...note, archivedAt: now, updatedAt: now });
  if (state.currentId === id) advance();
  toast('不再复习这条了', 'ok', { label: '恢复', run: () => void unarchiveNote(id) });
  scheduleSync();
}

export async function unarchiveNote(id: string): Promise<void> {
  const note = state.notes.find((item) => item.id === id);
  if (!note || !note.archivedAt) return;
  await store({ ...note, archivedAt: null, updatedAt: Date.now() });
  toast('恢复复习了');
  scheduleSync();
}

/** 批量改若干条笔记的共同字段 */
async function patchNotes(ids: string[], patch: Partial<StoredNote>): Promise<StoredNote[]> {
  const wanted = new Set(ids);
  const now = Date.now();
  const changed: StoredNote[] = [];

  const next = state.notes.map((note) => {
    if (!wanted.has(note.id)) return note;
    const updated = { ...note, ...patch, updatedAt: now };
    changed.push(updated);
    return updated;
  });

  if (changed.length === 0) return [];
  set({ notes: next });
  await local.putNotes(changed);
  announceChange();
  return changed;
}

export async function removeNotes(ids: string[]): Promise<number> {
  const changed = await patchNotes(ids, { deletedAt: Date.now() });
  if (changed.length === 0) return 0;

  if (state.currentId && ids.includes(state.currentId)) advance();
  toast(`删掉 ${changed.length} 条`, 'ok', {
    label: '撤销',
    run: () => void restoreNotes(changed.map((note) => note.id)),
  });
  scheduleSync();
  return changed.length;
}

export async function archiveNotes(ids: string[]): Promise<number> {
  const changed = await patchNotes(ids, { archivedAt: Date.now() });
  if (changed.length === 0) return 0;

  if (state.currentId && ids.includes(state.currentId)) advance();
  toast(`归档了 ${changed.length} 条`, 'ok', {
    label: '撤销',
    run: () => void unarchiveNotes(changed.map((note) => note.id)),
  });
  scheduleSync();
  return changed.length;
}

export async function restoreNotes(ids: string[]): Promise<void> {
  const changed = await patchNotes(ids, { deletedAt: null });
  if (changed.length === 0) return;
  toast(`恢复了 ${changed.length} 条`);
  scheduleSync();
}

export async function unarchiveNotes(ids: string[]): Promise<void> {
  const changed = await patchNotes(ids, { archivedAt: null });
  if (changed.length === 0) return;
  toast(`恢复了 ${changed.length} 条的复习`);
  scheduleSync();
}

export async function grade(id: string, value: Grade): Promise<void> {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return;

  const now = Date.now();
  const wasNew = isNew(note);
  // 手滑点到「忘记了」会把间隔直接打回原点，得留一条退路
  const before = { memory: note.memory, reviewCount: note.reviewCount };
  const graded: StoredNote = { ...applyGrade(note, value, now), baseUpdatedAt: note.baseUpdatedAt };
  await store(graded);

  const today = dayKey(now);
  const log = { ...state.log, [today]: (state.log[today] ?? 0) + 1 };
  const newToday = wasNew ? state.newToday + 1 : state.newToday;

  const sessionDone = state.sessionDone.includes(id) ? state.sessionDone : [...state.sessionDone, id];
  set({ log, newDay: today, newToday, sessionDone });
  void local.writeMeta('log', log);
  if (wasNew) {
    void local.writeMeta('newDay', today);
    void local.writeMeta('newToday', newToday);
  }

  advance();
  scheduleSync();

  toast(GRADE_META.find((item) => item.grade === value)?.label ?? '记下了', 'ok', {
    label: '撤销',
    run: () => void undoGrade(id, before.memory, before.reviewCount, log, wasNew),
  });
}

/** 把上一次评分退回去 */
async function undoGrade(
  id: string,
  memory: StoredNote['memory'],
  reviewCount: number,
  log: Record<string, number>,
  wasNew: boolean,
): Promise<void> {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return;

  await store({ ...note, memory, reviewCount, updatedAt: Date.now() });

  // 今天的计数和「本轮已看过」也一起退回去，否则撤销完却少算一次
  const today = dayKey(Date.now());
  const reverted = { ...log };
  if ((reverted[today] ?? 0) > 0) reverted[today] = (reverted[today] ?? 0) - 1;
  else delete reverted[today];

  const newToday = wasNew ? Math.max(0, state.newToday - 1) : state.newToday;
  const sessionDone = state.sessionDone.filter((item) => item !== id);

  set({ log: reverted, newToday, sessionDone });
  void local.writeMeta('log', reverted);
  void local.writeMeta('newToday', newToday);

  scheduleSync();
  toast('撤销了，下次复习时间也退回去了');
}

export function reveal(): void {
  set({ revealed: true });
}

export function skip(): void {
  if (!state.currentId) return;
  set({ sessionDone: [...state.sessionDone, state.currentId] });
  advance();
}

/** 今天没有到期的了，但用户想提前看一条 */
export function reviewEarly(): void {
  const pool = visibleNotes(state.notes).filter((note) => !isNew(note) && !isArchived(note));
  if (pool.length === 0) return;
  pool.sort((a, b) => a.memory.due - b.memory.due);
  const note = pool[0];
  if (note) set({ currentId: note.id, revealed: false });
}

export function nextSoonest(): number | null {
  const upcoming = visibleNotes(state.notes)
    .filter((note) => !isNew(note) && !isArchived(note) && note.memory.due > Date.now())
    .sort((a, b) => a.memory.due - b.memory.due);
  return upcoming[0]?.memory.due ?? null;
}

/* ---------------------------------------------------------------- 账号与同步 */

let syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSync(): void {
  if (!getToken() || !hasBackend) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void syncNow(true);
  }, 2500);
}

/**
 * 同步失败后的自动重试。
 *
 * 断网、服务端重启、地铁里进隧道，这些都会让一次同步失败。以前失败就
 * 停在那儿，除非用户又写了一条笔记，否则不会再试。
 */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 15_000;

function scheduleRetry(): void {
  if (!getToken() || !hasBackend) return;
  if (retryTimer) return;

  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, 5 * 60 * 1000);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncNow(true);
  }, delay);
}

export async function syncNow(silent = false): Promise<number | null> {
  const token = getToken();
  if (!token || !hasBackend || state.syncing) return null;

  set({ syncing: true, syncError: silent ? state.syncError : null });
  try {
    const dirty = state.notes.filter((note) => note.origin !== 'demo' && note.updatedAt !== note.baseUpdatedAt);
    const since = (await local.readMeta<number>('cursor')) ?? 0;
    const result = await api.sync(token, { since, notes: dirty });

    const byId = new Map(state.notes.map((note) => [note.id, note]));
    const touched: StoredNote[] = [];

    for (const remote of result.notes) {
      const current = byId.get(remote.id);
      if (!current || remote.updatedAt >= current.updatedAt) {
        const merged: StoredNote = { ...remote, baseUpdatedAt: remote.updatedAt };
        byId.set(remote.id, merged);
        touched.push(merged);
      }
    }

    const notes = [...byId.values()];
    state = { ...state, notes };
    await local.putNotes(touched);
    await local.writeMeta('cursor', result.since);
    await local.writeMeta('lastSyncAt', Date.now());

    const now = Date.now();
    set({ syncing: false, lastSyncAt: now, currentId: state.currentId, syncError: null });

    // 这次通了，把退避重置回起点
    retryDelay = 15_000;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    // 当前卡片可能被远端覆盖了，重算一下
    if (state.currentId && !byId.has(state.currentId)) advance();

    const lost = result.conflicts.filter((item) => item.winner === 'remote').length;
    const dropped = result.rejected?.length ?? 0;

    if (dropped > 0) {
      // 被拒的笔记留在本机，只是上不去。得说出来，不然用户以为同步好了
      toast(`${dropped} 条笔记没同步上去（服务端不认这个格式），本机数据还在`, 'warn');
    } else if (lost > 0) {
      toast(`${lost} 条笔记在另一台设备上改过，旧内容已存进历史`, 'warn');
    } else if (!silent) {
      toast(result.notes.length > 0 ? `已同步，拿回 ${result.notes.length} 条` : '已是最新');
    }
    return result.notes.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : '同步失败';
    set({ syncing: false, syncError: message });
    if (!silent) toast(message, 'error');
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      setToken(null);
      set({ account: null });
      return null;
    }

    // 网络类错误就等着再试，别让一次断网把后面的笔记都堵在本机
    scheduleRetry();
    return null;
  }
}

/** 账号里已经有笔记时，把本机的示例笔记清掉，别让它们混进真实数据 */
async function dropDemoNotes(): Promise<void> {
  const demoIds = state.notes.filter((note) => note.origin === 'demo').map((note) => note.id);
  if (demoIds.length === 0) return;
  const gone = new Set(demoIds);
  set({ notes: state.notes.filter((note) => !gone.has(note.id)) });
  await local.deleteNotes(demoIds);
  if (state.currentId && gone.has(state.currentId)) advance();
}

/** 账号是空的（刚注册），把示例笔记变成真笔记，跟着一起同步上去 */
async function promoteDemoNotes(): Promise<void> {
  const demos = state.notes.filter((note) => note.origin === 'demo');
  if (demos.length === 0) return;
  const promoted = demos.map<StoredNote>((note) => ({
    id: note.id,
    body: note.body,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
    memory: note.memory,
    reviewCount: note.reviewCount,
    baseUpdatedAt: 0,
  }));
  const byId = new Map(state.notes.map((note) => [note.id, note]));
  for (const note of promoted) byId.set(note.id, note);
  set({ notes: [...byId.values()] });
  await local.putNotes(promoted);
}

export async function signIn(email: string, password: string, mode: 'login' | 'register'): Promise<void> {
  const result = mode === 'register' ? await api.register(email, password) : await api.login(email, password);
  setToken(result.token);
  set({ account: { email: result.user.email }, syncError: null });

  // 换账号要从头拉一遍，否则会带着上一个账号的游标
  await local.writeMeta('cursor', 0);

  const pulled = await syncNow(true);
  if (pulled === null) {
    toast('登录了，但第一次同步没成功，稍后会自动重试', 'warn');
    return;
  }

  if (pulled > 0) {
    await dropDemoNotes();
    toast(`接上了，拿到 ${pulled} 条笔记`);
    return;
  }

  await promoteDemoNotes();
  await syncNow(true);
  toast(mode === 'register' ? '账号建好了，本机的笔记开始同步' : '登录成功，这台设备的笔记已接上');
}

export async function signOut(): Promise<void> {
  const token = getToken();
  setToken(null);
  set({ account: null, lastSyncAt: null, syncError: null });
  if (token) {
    await api.logout(token).catch(() => undefined);
  }
  toast('已退出。数据仍然留在这台设备上');
}

/* ---------------------------------------------------------------- 导入导出 */

export function buildExport(): string {
  return JSON.stringify(
    {
      app: 'nicenotes',
      version: 2,
      exportedAt: new Date().toISOString(),
      notes: visibleNotes(state.notes).map(({ baseUpdatedAt, ...rest }) => {
        void baseUpdatedAt;
        return rest;
      }),
    },
    null,
    2,
  );
}

export async function importJson(raw: string): Promise<number> {
  const parsed = JSON.parse(raw) as { notes?: Partial<StoredNote>[] };
  const incoming = Array.isArray(parsed.notes) ? parsed.notes : [];
  const now = Date.now();
  const merged: StoredNote[] = [];

  for (const item of incoming) {
    if (!item?.body) continue;
    const id = typeof item.id === 'string' ? item.id : newId();
    const existing = state.notes.find((note) => note.id === id);
    const updatedAt = Number(item.updatedAt ?? now);
    const note: StoredNote = {
      id,
      body: String(item.body).slice(0, 20_000),
      createdAt: Number(item.createdAt ?? updatedAt),
      updatedAt,
      deletedAt: item.deletedAt ?? null,
      memory: {
        ...freshMemory(updatedAt),
        ...(item.memory ?? {}),
      },
      reviewCount: Number(item.reviewCount ?? 0),
      baseUpdatedAt: existing?.baseUpdatedAt ?? 0,
    };
    merged.push(note);
  }

  if (merged.length === 0) return 0;

  const byId = new Map(state.notes.map((note) => [note.id, note]));
  for (const note of merged) byId.set(note.id, note);
  set({ notes: [...byId.values()] });
  await local.putNotes(merged);
  advance();
  scheduleSync();
  return merged.length;
}

export interface ImportResult {
  added: number;
  skipped: number;
}/**
 * 批量导入 Markdown。一个文件里如果有 `## ` 分节，会拆成多条。
 * 内容指纹相同的直接跳过 —— 同一个文件导两次不该变成两份。
 */
export async function importMarkdownFiles(
  files: { name: string; text: string }[],
): Promise<ImportResult> {
  const seen = new Set(visibleNotes(state.notes).map((note) => contentHash(note.body)));
  const now = Date.now();
  const incoming: StoredNote[] = [];
  let skipped = 0;

  for (const file of files) {
    for (const parsed of parseMarkdownFile(file.name, file.text)) {
      const body = toBody(parsed).slice(0, 20_000).trim();
      if (!body) continue;

      const hash = contentHash(body);
      if (seen.has(hash)) {
        skipped += 1;
        continue;
      }

      seen.add(hash);
      incoming.push({
        id: newId(),
        body,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        memory: freshMemory(now),
        reviewCount: 0,
        baseUpdatedAt: 0,
      });
    }
  }

  if (incoming.length > 0) {
    // 时间按导入顺序递减，列表里第一条就是文件里的第一段
    incoming.forEach((note, index) => {
      const ts = now - index * 1000;
      note.createdAt = ts;
      note.updatedAt = ts;
    });

    set({ notes: [...state.notes, ...incoming] });
    await local.putNotes(incoming);
    scheduleSync();
  }

  return { added: incoming.length, skipped };
}

/** 转义 HTML，导出独立页面用 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 正文转成 HTML：该转义的转义，写着的网址留成可点的链接。
 *
 * 切段在转义之前做 —— 先转义再找网址的话，「&」已经变成「&amp;」，
 * 带查询串的地址会被切错位置。
 */
function htmlBody(text: string): string {
  return splitLinks(text)
    .map((segment) => {
      if (segment.kind !== 'link') return escapeHtml(segment.text);
      const href = escapeHtml(segment.text);
      return `<a href="${href}" target="_blank" rel="noreferrer noopener">${href}</a>`;
    })
    .join('');
}

/**
 * 导出成一个直接在浏览器里打开的 HTML。
 *
 * 和 Markdown 那份不一样：那个是给工具读的，这个是给人读的 ——
 * 发给不装应用的人，双击就能看，排版也保住了。
 */
export function buildHtml(): string {
  const notes = visibleNotes(state.notes).sort((a, b) => b.createdAt - a.createdAt);

  const items = notes
    .map((note) => {
      const { title, rest } = splitBody(note.body);
      const date = new Date(note.createdAt).toLocaleDateString('zh-CN');
      return `  <article>
    <h2>${escapeHtml(plainText(title))}</h2>
    <p class="meta">${escapeHtml(date)}</p>
    <pre>${htmlBody(rest)}</pre>
  </article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NiceNotes · ${notes.length} 条笔记</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 40px 20px 80px; background: #f7f4ee; color: #2a2722;
    font: 16px/1.9 "Noto Serif SC", "Songti SC", Georgia, serif;
  }
  main { max-width: 680px; margin: 0 auto; }
  article {
    background: #fff; border: 1px solid #e6e0d4; border-radius: 14px;
    padding: 24px 26px; margin-bottom: 18px;
  }
  h2 { margin: 0 0 4px; font-size: 20px; font-weight: 600; line-height: 1.5; }
  .meta { margin: 0 0 14px; color: #9a9488; font-size: 12px; font-family: system-ui, sans-serif; }
  pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font: 14px/1.85 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  a { color: #8d5a2c; text-decoration: none; border-bottom: 1px solid #e2cdb2; word-break: break-all; }
  @media (max-width: 520px) {
    body { padding: 20px 14px 60px; }
    article { padding: 18px; }
  }
</style>
</head>
<body>
<main>
${items}
</main>
</body>
</html>`;
}

/**
 * 导出成 Markdown。格式刻意和导入规则对齐：一条笔记就是 `## 标题` 加正文，
 * 所以这个文件能原样导回来，不会被拆散或合并。
 */
export function buildMarkdown(): string {
  const notes = visibleNotes(state.notes).sort((a, b) => a.createdAt - b.createdAt);

  return notes
    .map((note) => {
      const { title, rest } = splitBody(note.body);
      const heading = `## ${title || '未命名'}`;
      return rest ? `${heading}\n\n${rest}` : heading;
    })
    .join('\n\n');
}
