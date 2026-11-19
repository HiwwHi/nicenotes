/**
 * 服务端接口自检。
 *
 * 不需要数据库和网络：自己起一个进程、用临时库、跑完就删。
 * 改动同步逻辑之后跑一遍，比手动点界面快得多。
 *
 *   npm run check:server
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const PORT = Number(process.env.CHECK_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;

const dir = mkdtempSync(join(tmpdir(), 'nicenotes-check-'));
const dbPath = join(dir, 'check.sqlite');

const child = spawn(process.execPath, ['server/dist/index.js'], {
  cwd: REPO,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: dbPath },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const logs = [];
child.stdout.on('data', (d) => logs.push(d.toString()));
child.stderr.on('data', (d) => logs.push('ERR ' + d.toString()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    console.log(`  \u2717 ${name}${detail ? '  ' + detail : ''}`);
  }
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  throw new Error('服务没起来：\n' + logs.join(''));
}

try {
  await waitForServer();
  console.log(`服务已启动，端口 ${PORT}\n`);

  const health = await api('/api/health');
  check('健康检查', health.status === 200 && health.body?.ok === true);

  console.log('\n注册');
  const email = `check${Date.now()}@example.com`;
  const password = 'password123';

  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  check('注册返回 token', reg.status === 201 && Boolean(reg.body?.token));

  const dup = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  check('重复注册被拒', dup.status === 409);

  const weak = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: `w${Date.now()}@example.com`, password: '123' }),
  });
  check('短密码被拒', weak.status === 400);

  const badEmail = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-an-email', password }),
  });
  check('非法邮箱被拒', badEmail.status === 400);

  console.log('\n登录');
  const wrong = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'wrong-password' }),
  });
  check('错密码被拒', wrong.status === 401);

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  check('登录成功', login.status === 200 && Boolean(login.body?.token));

  const token = login.body?.token;
  const auth = { Authorization: `Bearer ${token}` };

  const me = await api('/api/auth/me', { headers: auth });
  check('GET /me 返回当前用户', me.status === 200 && me.body?.user?.email === email);

  const noAuth = await api('/api/auth/me');
  check('无 token 被拒', noAuth.status === 401);

  console.log('\n同步');
  const now = Date.now();
  const base = {
    createdAt: now - 2000,
    updatedAt: now - 1000,
    deletedAt: null,
    memory: { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0, lastReviewedAt: null, lastGrade: null },
    reviewCount: 0,
    archivedAt: null,
    baseUpdatedAt: 0,
  };
  const noteA = { ...base, id: 'check-aaaa-0001', body: '第一条：probe 慢，先怀疑 regulator' };
  const noteB = { ...base, id: 'check-bbbb-0002', body: '第二条：i2c 扫不到先量上拉' };

  const push = await api('/api/sync', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ since: 0, notes: [noteA, noteB] }),
  });
  check('推送两条', push.status === 200 && push.body?.notes?.length === 2);
  check('首次推送无冲突', (push.body?.conflicts ?? []).length === 0);

  const pull = await api('/api/sync', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ since: 0, notes: [] }),
  });
  check('全量拉取拿到两条', pull.body?.notes?.length === 2);
  check('正文一致', pull.body?.notes?.find((n) => n.id === noteA.id)?.body === noteA.body);

  const cursor = pull.body?.since ?? 0;
  const incremental = await api('/api/sync', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ since: cursor, notes: [] }),
  });
  check('增量同步不重复返回', (incremental.body?.notes ?? []).length === 0);

  const bad = await api('/api/sync', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ since: cursor, notes: [{ ...noteA, id: 'x' }] }),
  });
  check('非法 id 出现在 rejected 里', (bad.body?.rejected ?? []).length === 1);

  console.log('\n超量推送');
  // 服务端单次上限 500。第 501 条要明说没接收，不能悄悄切掉 ——
  // 悄悄切掉的话客户端以为同步成功了，那条笔记永远上不来。
  const flood = Array.from({ length: 501 }, (_, i) => ({
    ...noteA,
    id: `flood-${String(i).padStart(5, '0')}`,
    body: `洪水第 ${i} 条`,
    updatedAt: Date.now() + i,
    baseUpdatedAt: 0,
  }));
  const overflow = await api('/api/sync', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ since: cursor, notes: flood }),
  });
  const rejectedIds = (overflow.body?.rejected ?? []).map((item) => item.id);
  check('超出的那条进 rejected', rejectedIds.includes('flood-00500'));
  check('前 500 条被收下', !rejectedIds.includes('flood-00000'));

  console.log('\n冲突');
  const latest = pull.body.notes.find((n) => n.id === noteA.id);
  const first = await api('/api/sync', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      since: cursor,
      notes: [{ ...latest, body: '客户端 A 改的版本', updatedAt: Date.now(), baseUpdatedAt: latest.updatedAt }],
    }),
  });
  check('A 的修改被接受', (first.body?.conflicts ?? []).length === 0);

  const second = await api('/api/sync', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      since: cursor,
      notes: [{ ...latest, body: '客户端 B 改的版本', updatedAt: Date.now() + 10, baseUpdatedAt: latest.updatedAt }],
    }),
  });
  const conflicts = second.body?.conflicts ?? [];
  check('B 的修改被判为冲突', conflicts.length === 1);
  check('冲突记录带落败方正文', conflicts[0]?.lostBody?.includes('客户端 A'));

  const history = await api(`/api/notes/${noteA.id}/history`, { headers: auth });
  check('落败版本进了历史', (history.body?.versions ?? []).some((v) => v.body.includes('客户端 A')));

  console.log('\n脏数据');
  // lastReviewedAt 原本是 memory 里唯一没过 clamp 的字段：传字符串会变成 NaN，
  // 前端拿它算「上次复习是多久前」直接算出垃圾。
  const dirty = await api('/api/sync', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      since: cursor,
      notes: [
        {
          ...noteA,
          id: 'dirty-0001',
          body: '脏数据测试',
          updatedAt: Date.now() + 1,
          baseUpdatedAt: 0,
          memory: { ...noteA.memory, lastReviewedAt: 'abc', due: 'xyz', ease: null },
        },
      ],
    }),
  });
  const dirtyNote = (dirty.body?.notes ?? []).find((n) => n.id === 'dirty-0001');
  check('非数字的 lastReviewedAt 落成 null', dirtyNote ? dirtyNote.memory.lastReviewedAt === null : false);
  check('非数字的 due 兜底成 number', dirtyNote ? typeof dirtyNote.memory.due === 'number' && Number.isFinite(dirtyNote.memory.due) : false);
  check('ease 缺失时用默认值', dirtyNote ? dirtyNote.memory.ease === 2.5 : false);

  console.log('\n截断不切表情');
  // 第 20000 个字符正好是 emoji 的高位代理：直接 slice 会留下半个字符
  const longBody = 'a'.repeat(19_999) + '😀' + 'b'.repeat(20);
  const clipped = await api('/api/sync', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      since: cursor,
      notes: [{ ...noteA, id: 'clip-00001', body: longBody, updatedAt: Date.now() + 2, baseUpdatedAt: 0 }],
    }),
  });
  const clipNote = (clipped.body?.notes ?? []).find((n) => n.id === 'clip-00001');
  const stored = clipNote?.body ?? '';
  const tail = stored.charCodeAt(stored.length - 1);
  check('超长正文被截到上限', stored.length <= 20_000);
  check('末尾不是孤立的半个 emoji', !(tail >= 0xd800 && tail <= 0xdbff));

  console.log('\n健康检查');
  const meta = await api('/api/health');
  check('health 返回启动时间', typeof meta.body?.startedAt === 'number' && meta.body.startedAt > 0);
  check('uptimeMs 是非负数', typeof meta.body?.uptimeMs === 'number' && meta.body.uptimeMs >= 0);

  console.log('\n历史版本上限');
  // 连续制造 25 次冲突：旧的正文每次都会被写进 note_history，
  // 但库里只该留最近 20 条 —— 只插不删的话这张表会一直长。
  let histCursor = pull.since;
  const staleBase = pull.body.notes.find((n) => n.id === noteA.id)?.updatedAt ?? 0;
  for (let i = 0; i < 25; i += 1) {
    const res = await api('/api/sync', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        since: histCursor,
        notes: [
          {
            ...noteA,
            body: `冲突第 ${i} 次的内容`,
            updatedAt: Date.now() + 10_000 + i * 1000,
            baseUpdatedAt: staleBase,
          },
        ],
      }),
    });
    histCursor = res.body?.since ?? histCursor;
  }
  const hist = await api(`/api/notes/${noteA.id}/history`, { headers: auth });
  check('历史接口最多返回 20 条', (hist.body?.versions ?? []).length <= 20);
  // 历史存的是被顶掉的那一版，所以最前面应该停在第 23 次（第 24 次把它顶掉了）
  check('历史最前面是被顶掉的那一版', (hist.body?.versions ?? [])[0]?.body?.includes('冲突第 23 次') ?? false);
  globalThis.__histCheck = { noteId: noteA.id };

  console.log('\n其他');
  const badToken = await api('/api/sync', {
    method: 'POST',
    headers: { Authorization: 'Bearer nonsense' },
    body: JSON.stringify({ since: 0, notes: [] }),
  });
  check('假 token 被拒', badToken.status === 401);

  const logout = await api('/api/auth/logout', { method: 'POST', headers: auth });
  check('登出成功', logout.status === 200);

  const afterLogout = await api('/api/auth/me', { headers: auth });
  check('登出后 token 失效', afterLogout.status === 401);
} catch (error) {
  console.log('\n测试中断：', error.message);
  fail += 1;
} finally {
  child.kill();
  await sleep(300);
  // 进程停了再开库看：历史表到底留了多少行
  if (globalThis.__histCheck) {
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db.prepare('SELECT COUNT(*) AS n FROM note_history WHERE note_id = ?').get(globalThis.__histCheck.noteId);
      db.close();
      check(`历史表只留 20 行（实际 ${row?.n}）`, (row?.n ?? 99) <= 20);
    } catch (error) {
      console.log('  (历史表检查跳过：' + error.message + ')');
    }
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} 通过，${fail} 失败`);
  if (fail > 0 && logs.length) console.log('\n服务日志：\n' + logs.join('').slice(0, 1200));
  process.exit(fail > 0 ? 1 : 0);
}
