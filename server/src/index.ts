import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
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

app.get('/api/health', (c) => c.json({ ok: true, now: Date.now(), allowRegister }));

app.post('/api/auth/register', async (c) => {
  if (!allowRegister) return c.json({ error: '这台服务器没开放注册' }, 403);

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
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`NiceNotes API 已启动  http://127.0.0.1:${info.port}`);
  if (existsSync(join(webDist, 'index.html'))) {
    console.log(`同时托管前端静态文件：${webDist}`);
  }
});

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
