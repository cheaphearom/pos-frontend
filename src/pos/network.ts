import { ref } from 'vue';

/** true while the browser thinks it is online. Requests can still fail; callers handle that. */
export const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine);
window.addEventListener('online', () => (online.value = true));
window.addEventListener('offline', () => (online.value = false));

/** A fetch that failed because there is no connection (not an HTTP error). */
export const isNetworkError = (e: unknown) => e instanceof TypeError || (e as any)?.name === 'TypeError';
