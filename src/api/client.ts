/**
 * Small fetch wrapper for the POS API.
 * - Adds the access token.
 * - On 401, refreshes the token once and retries.
 * - Throws ApiError with the server's message.
 */
const BASE = '/api/v1';
const ACCESS = 'pos.accessToken';
const REFRESH = 'pos.refreshToken';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export const tokens = {
  get access() { return localStorage.getItem(ACCESS); },
  get refresh() { return localStorage.getItem(REFRESH); },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access);
    localStorage.setItem(REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
};

let refreshing: Promise<boolean> | null = null;
let onLoggedOut: () => void = () => {};
export const setLoggedOutHandler = (fn: () => void) => (onLoggedOut = fn);

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return false;
  // Several requests may fail at once; refresh only once.
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const j = await r.json();
      tokens.set(j.accessToken, j.refreshToken);
      return true;
    })
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null)));
  return refreshing;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${BASE}${path}${s ? `?${s}` : ''}`;
}

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refreshTokens()) return request<T>(method, path, opts, true);
    tokens.clear();
    onLoggedOut();
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const msg = (body as any)?.message;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('; ') : msg || res.statusText, body);
  }
  return body as T;
}

const safeJson = (t: string) => {
  try { return JSON.parse(t); } catch { return t; }
};

export const api = {
  get: <T = any>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T = any>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  del: <T = any>(path: string) => request<T>('DELETE', path),
};

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
