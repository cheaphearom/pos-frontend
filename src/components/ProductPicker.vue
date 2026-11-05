<script setup lang="ts">
/** Search box that finds products by name, SKU or barcode. Emits the chosen product. */
import { ref } from 'vue';
import { api } from '@/api/client';
import type { Product } from '@/api/types';
import { qty } from '@/utils/format';

const props = defineProps<{ storeId?: string | null; placeholder?: string }>();
const emit = defineEmits<{ select: [Product] }>();
const value = ref<any>(null);
const suggestions = ref<Product[]>([]);

async function search(e: { query: string }) {
  const res = await api.get('/products', { search: e.query, storeId: props.storeId ?? undefined, limit: 15 });
  suggestions.value = res.data;
}

function pick(e: { value: Product }) {
  emit('select', e.value);
  value.value = null;
}
</script>

<template>
  <AutoComplete
    v-model="value"
    :suggestions="suggestions"
    option-label="name"
    :placeholder="placeholder ?? 'Search product by name, SKU or barcode…'"
    :delay="250"
    fluid
    @complete="search"
    @option-select="pick"
  >
    <template #option="{ option }">
      <div style="display: flex; gap: 12px; width: 100%">
        <span class="mono muted">{{ option.sku }}</span>
        <span style="flex: 1">{{ option.name }}</span>
        <span v-if="option.stock !== undefined" class="muted small">stock {{ qty(option.stock) }}</span>
      </div>
    </template>
  </AutoComplete>
</template>
