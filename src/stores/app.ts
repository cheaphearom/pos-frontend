import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { api } from '@/api/client';
import type { Store } from '@/api/types';

const KEY = 'pos.currentStoreId';

/** The list of stores the user can access and the one currently selected in the top bar. */
export const useApp = defineStore('app', () => {
  const stores = ref<Store[]>([]);
  const currentStoreId = ref<string | null>(readSaved());

  const currentStore = computed(() => stores.value.find((s) => s.id === currentStoreId.value) ?? null);

  async function loadStores() {
    stores.value = await api.get<Store[]>('/stores');
    if (!stores.value.some((s) => s.id === currentStoreId.value)) {
      currentStoreId.value = stores.value[0]?.id ?? null;
    }
  }

  watch(currentStoreId, (id) => {
    try {
      if (id) localStorage.setItem(KEY, id);
    } catch {
      /* storage unavailable */
    }
  });

  return { stores, currentStoreId, currentStore, loadStores };
});

function readSaved() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
