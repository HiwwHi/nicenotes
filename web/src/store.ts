import { useSyncExternalStore } from 'react';
import { ApiError, api, hasBackend } from './lib/api';
import { dayKey } from './lib/date';
import * as local from './lib/db';
import { applyGrade, freshMemory, isDue, isNew } from './lib/scheduler';
import type { Account, Grade, StoredNote } from './types';

const TOKEN_KEY = 'nicenotes.token';
const NEW_PER_DAY = 3;
const DAY = 86_400_000;

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn' | 'error';
}

export interface AppState {
  ready: boolean;
  fatal: string | null;
  notes: StoredNote[];
  account: Account | null;
  syncing: boolean;
  lastSyncAt: number | null;
  syncError: string | null;
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
  currentId: null,
  revealed: false,
  sessionDone: [],
  newToday: 0,
  newDay: '',
  log: {},
  toast: null,
};

let state: AppState = emptyState;
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

export function toast(text: string, tone: Toast['tone'] = 'ok'): void {
  const id = ++toastSeq;
  set({ toast: { id, text, tone } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (state.toast?.id === id) set({ toast: null });
  }, tone === 'error' ? 5200 : 3200);
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

function pickNext(app: Pick['kind'] | 'any' = 'any'): Pick | null {
  const now = Date.now();
  const exclude = new Set(app === 'any' ? state.sessionDone : state.sessionDone);
  const pool = visibleNotes(state.notes).filter((note) => !exclude.has(note.id));

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
    rest: '所以拿到一份现成的 dmesg，只能靠时间戳差值人工找嫌疑：\n```\n[    0.823] probe of 1c28000.i2c returned 0 after 1204 usecs\n[    1.457] probe of fe2b0000.ethernet returned -517 after 3 usecs\n```\n这两行差了 0.6 秒，真正的嫌疑是第一行 —— 它自己花了 1.2ms。',
    daysAgo: 5,
  },
  {
    title: 'I2C 通信失败，先量上拉电阻，再看时序。',
    rest: '`4.7k` 上拉在 `400k` 速率下边沿常常太慢。示波器看 SCL 上升沿，如果爬到 3.3V 用了几百纳秒，就是它。\n曾经因为这个换过一整批板子上的电阻。',
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
      id: crypto.randomUUID(),
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

export async function init(): Promise<void> {
  if (state.ready || initializing) return;
  initializing = true;
  try {
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
    id: crypto.randomUUID(),
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
  toast('删掉了');
  scheduleSync();
}

export async function grade(id: string, value: Grade): Promise<void> {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return;

  const now = Date.now();
  const wasNew = isNew(note);
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
  const pool = visibleNotes(state.notes).filter((note) => !isNew(note));
  if (pool.length === 0) return;
  pool.sort((a, b) => a.memory.due - b.memory.due);
  const note = pool[0];
  if (note) set({ currentId: note.id, revealed: false });
}

export function nextSoonest(): number | null {
  const upcoming = visibleNotes(state.notes)
    .filter((note) => !isNew(note) && note.memory.due > Date.now())
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

    // 当前卡片可能被远端覆盖了，重算一下
    if (state.currentId && !byId.has(state.currentId)) advance();

    const lost = result.conflicts.filter((item) => item.winner === 'remote').length;
    if (lost > 0) {
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
    }
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
    const id = typeof item.id === 'string' ? item.id : crypto.randomUUID();
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
