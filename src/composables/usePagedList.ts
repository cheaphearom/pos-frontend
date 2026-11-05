import { reactive, ref, watch, type Ref } from 'vue';
import { api, type Page } from '@/api/client';
import { useNotify } from './useNotify';

/**
 * Loads a paginated API list for a PrimeVue DataTable in "lazy" mode.
 * Filters are watched: changing one reloads page 1.
 */
export function usePagedList<T = any>(path: string | (() => string), filters: Record<string, any> = {}, opts: { enabled?: Ref<boolean> } = {}) {
  const rows = ref<T[]>([]) as Ref<T[]>;
  const total = ref(0);
  const loading = ref(false);
  const page = reactive({ first: 0, rows: 25 });
  const f = reactive(filters);
  const notify = useNotify();
  let seq = 0;

  async function load() {
    if (opts.enabled && !opts.enabled.value) return;
    const mine = ++seq;
    loading.value = true;
    try {
      const res = await api.get<Page<T>>(typeof path === 'function' ? path() : path, {
        ...f,
        page: Math.floor(page.first / page.rows) + 1,
        limit: page.rows,
      });
      if (mine !== seq) return; // a newer request finished first
      rows.value = res.data;
      total.value = res.meta.total;
    } catch (e) {
      notify.error(e);
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  function onPage(e: { first: number; rows: number }) {
    page.first = e.first;
    page.rows = e.rows;
    load();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    () => ({ ...f }),
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        page.first = 0;
        load();
      }, 250); // debounce typing in search boxes
    },
    { deep: true },
  );
  if (opts.enabled) watch(opts.enabled, (v) => v && load());

  return { rows, total, loading, page, filters: f, load, onPage };
}
