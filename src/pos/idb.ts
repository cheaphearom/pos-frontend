/** Minimal key-value store on IndexedDB (survives reloads and works offline). */
const DB = 'pos-offline';
const STORE = 'kv';
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result as T);
        t.onerror = () => reject(t.error);
      }),
  );
}

export const idb = {
  get: <T>(key: string) => tx<T | undefined>('readonly', (s) => s.get(key)),
  set: (key: string, value: unknown) => tx<void>('readwrite', (s) => s.put(JSON.parse(JSON.stringify(value)), key)),
  del: (key: string) => tx<void>('readwrite', (s) => s.delete(key)),
};
