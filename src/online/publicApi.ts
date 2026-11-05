/** Calls to the public online-ordering API (no staff login). Sends the member app token when the customer is logged in. */
const BASE = '/api/v1/public';
const memberToken = () => { try { return JSON.parse(localStorage.getItem('member.session') ?? 'null')?.token ?? null; } catch { return null; } };

export class PublicError extends Error {}

export async function pub<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(memberToken() && { Authorization: `Bearer ${memberToken()}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = Array.isArray(j.message) ? j.message.join('; ') : j.message;
    throw new PublicError(res.status === 429 ? 'Too many tries, please wait a minute' : m || `Error ${res.status}`);
  }
  return j as T;
}

/** Orders placed on this phone, so customers can reopen their status page. */
export const myOrders = {
  list(): { token: string; store: string; at: string }[] {
    try { return JSON.parse(localStorage.getItem('order.mine') ?? '[]'); } catch { return []; }
  },
  add(token: string, store: string) {
    try { localStorage.setItem('order.mine', JSON.stringify([{ token, store, at: new Date().toISOString() }, ...myOrders.list()].slice(0, 10))); } catch { /* ignore */ }
  },
};
