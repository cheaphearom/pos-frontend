// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
import { ref } from 'vue';
import { api, ApiError } from '@/api/client';
import { idb } from './idb';
import { isNetworkError, online } from './network';
import { reportTill } from './till';

/** A sale made while offline (or whose upload failed), waiting to be sent. */
export interface QueuedSale {
  clientRef: string;
  body: Record<string, any>; // POST /sales body, includes offlineCreatedAt
  createdAt: string;
  attempts: number;
  error?: string; // set when the server rejected it (needs a manager)
  receipt: Record<string, any>; // what was printed, for showing in the list
  tillId?: string; // the till that made it
  seq?: number; // its offline number on that till (OFF-<till>-0001)
}

const KEY = 'sales-queue';
export const queue = ref<QueuedSale[]>([]);
export const syncingQueue = ref(false);
let loaded = false;

async function save() {
  await idb.set(KEY, queue.value);
}

export async function loadQueue() {
  if (loaded) return;
  queue.value = (await idb.get<QueuedSale[]>(KEY).catch(() => undefined)) ?? [];
  loaded = true;
}

export async function enqueue(item: QueuedSale) {
  await loadQueue();
  if (!queue.value.some((q) => q.clientRef === item.clientRef)) queue.value.push(item);
  await save();
}

export async function removeFromQueue(clientRef: string) {
  queue.value = queue.value.filter((q) => q.clientRef !== clientRef);
  await save();
}

/**
 * Upload waiting sales one by one. Safe to run many times: the server returns the
 * existing sale for a clientRef it already has, so nothing is charged twice.
 */
export async function syncQueue(): Promise<{ sent: number; failed: number }> {
  await loadQueue();
  if (syncingQueue.value || !online.value) return { sent: 0, failed: 0 };
  syncingQueue.value = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const item of [...queue.value]) {
      if (item.error) continue; // rejected ones wait for a person to look at them
      try {
        await api.post('/sales', item.body);
        queue.value = queue.value.filter((q) => q.clientRef !== item.clientRef);
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break; // still offline; try later
        item.attempts++;
        // 4xx = the server will never accept it as is; keep it and show the reason.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
          item.error = e.message;
          failed++;
        }
      }
      await save();
    }
  } finally {
    syncingQueue.value = false;
  }
  await reportNow();
  return { sent, failed };
}

/** Tell the server this till's offline numbers and what still waits here (see till.ts). */
export async function reportNow() {
  await loadQueue();
  let storeId: string | null = null;
  try { storeId = localStorage.getItem('pos.currentStoreId'); } catch { /* private window */ }
  await reportTill(storeId, queue.value.map((q) => ({ seq: q.seq, tillId: q.tillId, total: Number(q.receipt?.total ?? 0) })));
}

/** Try again later for one that was rejected (e.g. after fixing a product). */
export async function retryQueued(clientRef: string) {
  const item = queue.value.find((q) => q.clientRef === clientRef);
  if (item) {
    delete item.error;
    await save();
    return syncQueue();
  }
}

// Upload automatically when the connection comes back, and every 30 seconds.
// Also report to the server every 5 minutes, so a till that keeps sales waiting is noticed.
window.addEventListener('online', () => setTimeout(syncQueue, 1500));
setInterval(() => queue.value.length && syncQueue(), 30_000);
setInterval(() => reportNow(), 5 * 60_000);
