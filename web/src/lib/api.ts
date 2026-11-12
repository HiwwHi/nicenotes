import type { HistoryVersion, SyncPayload, SyncResult } from '../types';

const RAW_BASE = import.meta.env.VITE_API_BASE as string | undefined;
const BASE = RAW_BASE === undefined ? '/api' : RAW_BASE;

/** 纯静态部署时把 VITE_API_BASE 设成空串，同步功能会自动隐藏 */
export const hasBackend = BASE !== '';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface AuthResult {
  token: string;
  user: { id: string; email: string };
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError(0, '连不上服务器，看一眼网络');
  }

  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? `请求失败（${response.status}）`);
  }
  return data as T;
}

export const api = {
  register: (email: string, password: string) =>
    call<AuthResult>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    call<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  me: (token: string) => call<{ user: { id: string; email: string } }>('/auth/me', { token }),

  logout: (token: string) => call<{ ok: true }>('/auth/logout', { method: 'POST', token }),

  sync: (token: string, payload: SyncPayload) =>
    call<SyncResult>('/sync', { method: 'POST', token, body: JSON.stringify(payload) }),

  history: (token: string, noteId: string) =>
    call<{ versions: HistoryVersion[] }>(`/notes/${noteId}/history`, { token }),
};
