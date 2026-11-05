/** Member app: login token kept on the phone, and calls to /member/* with it. */
import { reactive } from 'vue';
import { PublicError } from './publicApi';

const KEY = 'member.session';
const BASE = '/api/v1';

interface Session { token: string; name: string; code: string; phone: string }

function load(): Session | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

export const memberSession = reactive<{ s: Session | null }>({ s: load() });

export function setMemberSession(s: Session | null) {
  memberSession.s = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* private mode */ }
}

export const memberToken = () => memberSession.s?.token ?? null;

/** Called when the server no longer accepts the token. */
let onLoggedOut: () => void = () => undefined;
export const setMemberLoggedOutHandler = (fn: () => void) => (onLoggedOut = fn);

export async function mem<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = memberToken();
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: { ...(opts.body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && path.startsWith('/member/')) {
    setMemberSession(null);
    onLoggedOut();
  }
  if (!res.ok) {
    const m = Array.isArray(j.message) ? j.message.join('; ') : j.message;
    throw new PublicError(res.status === 429 ? 'Too many tries, please wait a minute' : m || `Error ${res.status}`);
  }
  return j as T;
}

export const money = (v: number | string | null | undefined) => '$' + Number(v ?? 0).toFixed(2);
export const cardShort = (n: string) => '•••• ' + n.slice(-4);
