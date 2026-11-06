import { ref, shallowRef } from 'vue';
import { api } from '@/api/client';
import { idb } from './idb';

export interface CatalogItem {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  nameKm?: string | null;
  unit: string;
  price: string;
  taxable: boolean;
  trackStock: boolean;
  isActive: boolean;
  categoryId: string | null;
  stock: string;
  imageUrl?: string | null;
  /** Drink option groups (Size, Sugar...) in order */
  modifierGroupIds?: string[];
}

interface Saved { serverTime: string; products: CatalogItem[] }

/**
 * The store's whole product list kept in memory and in IndexedDB.
 * First load downloads everything; later syncs only fetch changes since the last sync.
 */
export function useCatalog(storeId: string) {
  const key = `catalog:${storeId}`;
  const items = shallowRef<CatalogItem[]>([]);
  const byCode = new Map<string, CatalogItem>();
  const lastSync = ref<string | null>(null);
  const syncing = ref(false);

  function index(list: CatalogItem[]) {
    byCode.clear();
    for (const p of list) {
      byCode.set(p.sku.toLowerCase(), p);
      if (p.barcode) byCode.set(p.barcode.toLowerCase(), p);
    }
    items.value = list;
  }

  async function loadLocal() {
    const saved = await idb.get<Saved>(key).catch(() => undefined);
    if (saved) {
      index(saved.products);
      lastSync.value = saved.serverTime;
    }
    return !!saved;
  }

  async function sync() {
    if (syncing.value) return;
    syncing.value = true;
    try {
      const res = await api.get<{ serverTime: string; full: boolean; products: CatalogItem[] }>('/products/catalog', {
        storeId,
        since: lastSync.value ?? undefined,
      });
      let list: CatalogItem[];
      if (res.full) list = res.products;
      else {
        const map = new Map(items.value.map((p) => [p.id, p]));
        for (const p of res.products) {
          if (p.isActive) map.set(p.id, p);
          else map.delete(p.id);
        }
        list = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
      }
      index(list);
      lastSync.value = res.serverTime;
      await idb.set(key, { serverTime: res.serverTime, products: list }).catch(() => undefined);
    } finally {
      syncing.value = false;
    }
  }

  /** Exact barcode / SKU match (what a scanner sends). */
  const findCode = (code: string) => byCode.get(code.trim().toLowerCase());

  function search(q: string, categoryId?: string | null, limit = 60) {
    const s = q.trim().toLowerCase();
    const out: CatalogItem[] = [];
    for (const p of items.value) {
      if (categoryId && p.categoryId !== categoryId) continue;
      if (s && !p.name.toLowerCase().includes(s) && !p.sku.toLowerCase().includes(s) && p.barcode !== s) continue;
      out.push(p);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Keep displayed stock roughly right after a sale, until the next sync. */
  function deduct(productId: string, qty: number) {
    const p = items.value.find((x) => x.id === productId);
    if (p && p.trackStock) p.stock = String(Number(p.stock) - qty);
  }

  return { items, lastSync, syncing, loadLocal, sync, findCode, search, deduct };
}
