// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
/**
 * This till (this browser on this computer): its own id and its offline sale numbers.
 *
 * Offline sales are numbered 1, 2, 3… per till and printed as OFF-<code>-0001. Whenever the till is online it reports
 * how many numbers it has used and which sales still wait on it (POST /tills/report), so the server can show managers
 * any number that never arrived. The id and the counter are kept in two places (Local Storage and IndexedDB): losing one
 * does not reset the numbering.
 */
import { api } from '@/api/client';
import { idb } from './idb';
import { online } from './network';

const ID_KEY = 'pos.tillId';
const SEQ_KEY = 'pos.tillSeq';

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};
const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });

let idPromise: Promise<string> | null = null;
/** This till's id: kept in Local Storage and IndexedDB, created once. */
export function tillId(): Promise<string> {
  idPromise ??= (async () => {
    const fromLs = ls.get(ID_KEY);
    const fromDb = await idb.get<string>('till.id').catch(() => undefined);
    const id = fromLs || fromDb || uuid();
    if (fromLs !== id) ls.set(ID_KEY, id);
    if (fromDb !== id) await idb.set('till.id', id).catch(() => undefined);
    return id;
  })();
  return idPromise;
}

/** Short name printed on offline receipts (same rule as the server): first 4 characters of the id. */
export const tillCode = (id: string) => id.replace(/-/g, '').slice(0, 4).toUpperCase();

/** The highest offline number used so far (the larger of the two saved copies). */
export async function issuedSeq(): Promise<number> {
  const a = Number(ls.get(SEQ_KEY) ?? 0) || 0;
  const b = Number(await idb.get<number>('till.seq').catch(() => 0)) || 0;
  return Math.max(a, b);
}

let seqChain: Promise<unknown> = Promise.resolve();
/** The next offline number for this till (1, 2, 3…), saved before it is used. */
export function nextOfflineSeq(): Promise<number> {
  const run = seqChain.then(async () => {
    const n = (await issuedSeq()) + 1;
    ls.set(SEQ_KEY, String(n));
    await idb.set('till.seq', n);
    return n;
  });
  seqChain = run.catch(() => undefined);
  return run;
}

export const offlineReceiptNo = (code: string, seq: number) => `OFF-${code}-${String(seq).padStart(4, '0')}`;

/**
 * Tell the server how far this till has numbered and which numbered sales still wait here.
 * Needs a store and a login; quietly does nothing offline.
 */
export async function reportTill(storeId: string | null, waiting: { seq?: number; tillId?: string; total: number }[]) {
  if (!storeId || !online.value) return;
  const id = await tillId();
  const mine = waiting.filter((w) => w.seq && w.tillId === id).map((w) => ({ seq: w.seq!, total: Math.round(Number(w.total) * 100) / 100 }));
  await api.post('/tills/report', { tillId: id, storeId, issuedSeq: await issuedSeq(), waiting: mine }).catch(() => undefined);
}
