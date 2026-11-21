<!-- Copyright (c) 2026 Chea Phearom. All rights reserved. Proprietary and confidential: see the LICENSE file. -->
<script setup lang="ts">
/**
 * Price history: every change to a price customers pay (normal price, a store's price, each size's price),
 * newest first. For one product, or for all of them with search, store and dates.
 */
import { computed, ref, watch } from 'vue';
import DateRange from '@/components/DateRange.vue';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { dateTime, money } from '@/utils/format';

const props = defineProps<{ productId?: string | null; productName?: string | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const app = useApp();
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: number | string) => money(v, cur.value);

const open = ref(false);
const list = usePagedList('/price-history', { productId: null as string | null, storeId: null as string | null, search: '', from: null, to: null }, { enabled: open });
watch(visible, (v) => {
  open.value = v;
  if (!v) return;
  Object.assign(list.filters, { productId: props.productId ?? null, search: '', storeId: null, from: null, to: null });
  list.load();
});

const storeOptions = computed(() => [{ id: null, label: 'All stores' }, ...app.stores.map((s) => ({ id: s.id, label: `${s.code} · ${s.name}` }))]);
const SOURCE: Record<string, string> = {
  CREATE: 'New product', EDIT: 'Edited', STORE_PRICE: 'Store price', SIZE_PRICES: 'Size prices', BULK: 'Bulk change',
  SCHEDULED: 'Scheduled change', BROWN_SYNC: 'BROWN sync', IMPORT: 'Import',
};
function diff(r: any) {
  if (r.oldPrice === null) return { text: 'new', cls: 'muted' };
  const d = Number(r.newPrice) - Number(r.oldPrice);
  const pct = Number(r.oldPrice) ? (d / Number(r.oldPrice)) * 100 : 0;
  return { text: `${d > 0 ? '+' : '−'}${m(Math.abs(d))} (${d > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)`, cls: d > 0 ? 'up' : 'down' };
}
</script>

<template>
  <Dialog v-model:visible="visible" :header="productId ? `Price history: ${productName ?? ''}` : 'Price history'" modal :style="{ width: '980px' }" :breakpoints="{ '1040px': '96vw' }">
    <p class="muted small" style="margin-top: 0">Every change to a price customers pay, newest first: the normal price, each store's price and each size. Kept since price history was turned on.</p>
    <div class="toolbar">
      <IconField v-if="!productId"><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Product name or SKU" /></IconField>
      <Select v-model="list.filters.storeId" :options="storeOptions" option-label="label" option-value="id" placeholder="All stores" />
      <DateRange v-model:from="list.filters.from" v-model:to="list.filters.to" />
    </div>
    <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
      :rows-per-page-options="[25, 50, 100]" :loading="list.loading.value" size="small" @page="list.onPage" data-test="price-history">
      <template #empty><span class="muted">No price changes yet</span></template>
      <Column header="When"><template #body="{ data }"><span class="small">{{ dateTime(data.createdAt) }}</span></template></Column>
      <Column v-if="!productId" header="Product"><template #body="{ data }"><b>{{ data.product.name }}</b><div class="mono small muted">{{ data.product.sku }}</div></template></Column>
      <Column header="Price">
        <template #body="{ data }">
          <span v-if="!data.storeId" class="muted">Normal price</span>
          <span v-else><b>{{ data.store?.code }}</b><span v-if="data.sizeName"> · {{ data.sizeName }}</span></span>
        </template>
      </Column>
      <Column header="Old → new" class="right">
        <template #body="{ data }"><span class="muted">{{ data.oldPrice === null ? '—' : m(data.oldPrice) }}</span> → <b>{{ m(data.newPrice) }}</b></template>
      </Column>
      <Column header="Change" class="right"><template #body="{ data }"><span class="small" :class="diff(data).cls">{{ diff(data).text }}</span></template></Column>
      <Column header="How"><template #body="{ data }"><Tag :value="SOURCE[data.source] ?? data.source" severity="secondary" /><div v-if="data.note" class="small muted">{{ data.note }}</div></template></Column>
      <Column header="By"><template #body="{ data }"><span class="small">{{ data.userName ?? '—' }}</span></template></Column>
    </DataTable>
  </Dialog>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; align-items: center; }
.up { color: var(--bad); font-weight: 600; }
.down { color: var(--good); font-weight: 600; }
</style>
