import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  changePassword,
  clearAttempts,
  isValidEmail,
  loginUser,
  normalizeEmail,
  registerUser,
  resolveToken,
  revokeToken,
  tidySessions,
  tooManyAttempts,
} from './auth.js';
import { getUserById, getUserByEmail, listHistory } from './db.js';
import { runSync } from './sync.js';
import type { SyncNote } from './types.js';

type Variables = { userId: string };

const app = new Hono<{ Variables: Variables }>();

/**
 * 自己用的时候通常不想让陌生人注册。设 ALLOW_REGISTER=0 就把口子关上，
 * 前端会通过 /api/health 知道这件事，注册入口直接不显示。
 */
const allowRegister = process.env.ALLOW_REGISTER !== '0';

app.use('/api/*', cors({ origin: process.env.CORS_ORIGIN ?? '*' }));

/*
 * API 响应的两个基本头。
 *
 * no-store：同步结果是「此刻的数据」，被中间层或浏览器缓存住就会一直
 *   拿到旧的 —— 而且是带着 token 的响应，本来也不该进任何缓存。
 * nosniff：让浏览器别猜类型，省得哪天返回的内容被当成脚本执行。
 */
app.use('/api/*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'same-origin');
});

/*
 * startedAt 用来判断服务是不是刚重启过。
 *
 * 排查同步问题时第一个要问的就是这个：客户端说「一直连不上」，服务端
 * 一看 uptime 只有 5 秒 —— 那就是在重启，不用往下查了。
 */
const STARTED_AT = Date.now();

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    now: Date.now(),
    allowRegister,
    startedAt: STARTED_AT,
    uptimeMs: Date.now() - STARTED_AT,
  }),
);

app.post('/api/auth/register', async (c) => {
  if (!allowRegister) return c.json({ error: '这台服务器没开放注册' }, 403);

  // 登录有限流，注册同样要有：不然一个脚本就能把库塞满
  const registerKey = `reg:${c.req.header('x-forwarded-for') ?? 'local'}`;
  if (tooManyAttempts(registerKey)) {
    return c.json({ error: '注册太频繁，过十分钟再试' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const email = normalizeEmail(String(body?.email ?? ''));
  const password = String(body?.password ?? '');

  if (!isValidEmail(email)) return c.json({ error: '邮箱格式不对' }, 400);
  if (password.length < 8) return c.json({ error: '密码至少 8 位' }, 400);
  if (password.length > 200) return c.json({ error: '密码太长了' }, 400);
  if (getUserByEmail(email)) return c.json({ error: '这个邮箱已经注册过了' }, 409);

  const { token, user } = registerUser(email, password);
  return c.json({ token, user }, 201);
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizeEmail(String(body?.email ?? ''));
  const password = String(body?.password ?? '');

  if (!email || !password) return c.json({ error: '邮箱和密码都要填' }, 400);

  const throttleKey = `${c.req.header('x-forwarded-for') ?? 'local'}:${email}`;
  if (tooManyAttempts(throttleKey)) {
    return c.json({ error: '尝试太频繁，过十分钟再试' }, 429);
  }

  const result = loginUser(email, password);
  if (!result) return c.json({ error: '邮箱或密码不对' }, 401);

  clearAttempts(throttleKey);
  return c.json(result);
});

app.post('/api/auth/logout', (c) => {
  const token = bearer(c.req.header('authorization'));
  if (token) revokeToken(token);
  return c.json({ ok: true });
});

app.get('/api/auth/me', (c) => {
  const userId = resolveToken(bearer(c.req.header('authorization')));
  if (!userId) return c.json({ error: '未登录' }, 401);
  const user = getUserById(userId);
  if (!user) return c.json({ error: '未登录' }, 401);
  return c.json({ user });
});

const requireAuth: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const userId = resolveToken(bearer(c.req.header('authorization')));
  if (!userId) return c.json({ error: '需要先登录' }, 401);
  c.set('userId', userId);
  await next();
};

app.post('/api/auth/password', requireAuth, async (c) => {
  // 原密码可以拿来爆破，和登录一样要限流
  const limitKey = `pw:${c.get('userId')}`;
  if (tooManyAttempts(limitKey)) return c.json({ error: '试太多次了，过十分钟再试' }, 429);

  const body = await c.req.json().catch(() => null);
  const current = String(body?.currentPassword ?? '');
  const next = String(body?.newPassword ?? '');

  if (next.length < 8) return c.json({ error: '新密码至少 8 位' }, 400);
  if (next.length > 200) return c.json({ error: '新密码太长了' }, 400);
  if (current === next) return c.json({ error: '新密码和原密码一样' }, 400);

  const token = bearer(c.req.header('authorization')) ?? '';
  const revoked = changePassword(c.get('userId'), current, next, token);
  if (revoked === null) return c.json({ error: '原密码不对' }, 401);

  return c.json({ ok: true, revoked });
});

app.post('/api/sync', requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  const since = Number(body?.since ?? 0) || 0;
  const notes = (body?.notes ?? []) as SyncNote[];
  const outcome = runSync(c.get('userId'), since, notes);
  return c.json(outcome);
});

app.get('/api/notes/:id/history', requireAuth, (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const rows = listHistory(userId, id).map((row) => ({
    body: row.body,
    savedAt: row.saved_at,
    replacedAt: row.replaced_at,
  }));
  return c.json({ versions: rows });
});

const webDist = process.env.WEB_ROOT ?? resolve(import.meta.dirname, '..', '..', 'web', 'dist');
if (existsSync(join(webDist, 'index.html'))) {
  app.use('/*', serveStatic({ root: webDist }));
  app.get('*', serveStatic({ path: join(webDist, 'index.html') }));
}

app.notFound((c) =>
  c.req.path.startsWith('/api') ? c.json({ error: '没有这个接口' }, 404) : c.text('Not found', 404),
);

const port = Number(process.env.PORT ?? 8787);

tidySessions();
/*
 * 过期会话得定期清。
 *
 * 原来只在启动时清一次 —— Docker 里跑着的进程可能几周不重启，每次登录
 * 留一条过期记录在那儿躺着，越攒越多。
 * unref 是为了别让这个定时器把进程钉住、退不出去。
 */
setInterval(tidySessions, 60 * 60 * 1000).unref();

serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`NiceNotes API 已启动  http://127.0.0.1:${info.port}`);
  // 这三行是排查时最先要看的：会不会连错库、注册开没开、前端到底托管了没有
  console.log(`注册 ${allowRegister ? '开放' : '关闭（ALLOW_REGISTER=0）'}`);
  console.log(`数据库 ${process.env.DB_PATH ?? '(默认位置)'}`);
  if (existsSync(join(webDist, 'index.html'))) {
    console.log(`同时托管前端静态文件：${webDist}`);
  } else {
    console.log(`只跑 API（没找到 ${join(webDist, 'index.html')}）`);
  }
});

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
