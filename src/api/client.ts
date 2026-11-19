// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
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

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown; file?: Blob } = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.file) headers['Content-Type'] = opts.file.type || 'application/octet-stream';
  else if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: opts.file ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
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
    // an HTML page (e.g. Cloudflare's "Bad gateway") instead of the POS's own JSON answer
    const page = typeof body === 'string' && body.trimStart().startsWith('<');
    const fallback = res.status === 413 ? 'The file is too large.' : page ? `The server did not answer (error ${res.status}). Check that the POS server and its link are running, then try again.` : res.statusText || `Error ${res.status}`;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('; ') : msg || fallback, body);
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
  /** Sends a file as the request body (e.g. a picture), with optional query values */
  upload: <T = any>(path: string, file: Blob, query?: Query) => request<T>('POST', path, { file, query }),
};

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
