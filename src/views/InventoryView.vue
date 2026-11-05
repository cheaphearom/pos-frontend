<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api/client';
import type { Product } from '@/api/types';
import ProductPicker from '@/components/ProductPicker.vue';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { dateTime, humanize, money, qty } from '@/utils/format';

const app = useApp();
const route = useRoute();
const notify = useNotify();
const tab = ref<'stock' | 'history'>('stock');
const cur = computed(() => app.currentStore?.currency ?? 'USD');

const stock = usePagedList('/inventory', { storeId: app.currentStoreId, search: '', lowStock: route.query.lowStock === '1' });
const history = usePagedList('/inventory/movements', { storeId: app.currentStoreId, productId: null as string | null }, { enabled: computed(() => tab.value === 'history') });
stock.load();

const low = (r: any) => Number(r.reorderLevel) > 0 && Number(r.quantity) <= Number(r.reorderLevel);
const moveSeverity: Record<string, string> = { SALE: 'info', REFUND: 'warn', PURCHASE: 'success', ADJUSTMENT: 'secondary', TRANSFER_IN: 'success', TRANSFER_OUT: 'contrast' };

// ── Edit reorder level / store price
const editDlg = ref(false);
const edit = reactive({ productId: '', name: '', defaultPrice: '0', reorderLevel: 0, useOverride: false, priceOverride: 0 });
function openEdit(r: any) {
  Object.assign(edit, {
    productId: r.productId, name: r.product.name, defaultPrice: r.product.sellPrice,
    reorderLevel: Number(r.reorderLevel), useOverride: r.priceOverride !== null,
    priceOverride: Number(r.priceOverride ?? r.product.sellPrice),
  });
  editDlg.value = true;
}
async function saveEdit() {
  try {
    await api.put(`/inventory/${app.currentStoreId}/${edit.productId}`, {
      reorderLevel: edit.reorderLevel,
      priceOverride: edit.useOverride ? edit.priceOverride : null,
    });
    editDlg.value = false;
    notify.success('Saved', edit.name);
    stock.load();
  } catch (e) { notify.error(e); }
}

// ── Receive goods / adjust stock
const adjDlg = ref(false);
const saving = ref(false);
const adj = reactive({ type: 'PURCHASE' as 'PURCHASE' | 'ADJUSTMENT', reference: '', note: '', items: [] as { product: Product; quantity: number }[] });
function openAdjust(type: 'PURCHASE' | 'ADJUSTMENT') {
  Object.assign(adj, { type, reference: '', note: '', items: [] });
  adjDlg.value = true;
}
function addItem(p: Product) {
  const existing = adj.items.find((i) => i.product.id === p.id);
  if (existing) existing.quantity += 1;
  else adj.items.push({ product: p, quantity: adj.type === 'PURCHASE' ? 1 : -1 });
}
async function saveAdjust() {
  const items = adj.items.filter((i) => i.quantity);
  if (!items.length) return notify.error('Add at least one product with a quantity');
  saving.value = true;
  try {
    await api.post('/inventory/adjustments', {
      storeId: app.currentStoreId, type: adj.type, reference: adj.reference || undefined, note: adj.note || undefined,
      items: items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
    });
    adjDlg.value = false;
    notify.success(adj.type === 'PURCHASE' ? 'Goods received' : 'Stock adjusted', `${items.length} product(s)`);
    stock.load();
    if (tab.value === 'history') history.load();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}

function showHistory(productId: string) {
  history.filters.productId = productId;
  tab.value = 'history';
}
watch(tab, (t) => t === 'stock' && (history.filters.productId = null));
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Inventory</h1><div class="sub">Stock in {{ app.currentStore?.name }}</div></div>
      <div class="actions">
        <Button label="Receive goods" icon="pi pi-download" @click="openAdjust('PURCHASE')" />
        <Button label="Adjust stock" icon="pi pi-sliders-h" severity="secondary" @click="openAdjust('ADJUSTMENT')" />
      </div>
    </div>

    <SelectButton v-model="tab" :options="[{ l: 'Stock levels', v: 'stock' }, { l: 'Stock history', v: 'history' }]" option-label="l" option-value="v" :allow-empty="false" style="margin-bottom: 14px" />

    <div v-if="tab === 'stock'" class="card">
      <div class="toolbar">
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="stock.filters.search" placeholder="Name, SKU or barcode" /></IconField>
        <label class="row small"><ToggleSwitch v-model="stock.filters.lowStock" /> Low stock only</label>
      </div>
      <DataTable :value="stock.rows.value" lazy paginator :rows="stock.page.rows" :first="stock.page.first" :total-records="stock.total.value"
        :rows-per-page-options="[25, 50, 100]" :loading="stock.loading.value" size="small" @page="stock.onPage">
        <template #empty><span class="muted">Nothing here</span></template>
        <Column header="SKU"><template #body="{ data }"><span class="mono">{{ data.product.sku }}</span></template></Column>
        <Column header="Product"><template #body="{ data }">{{ data.product.name }}</template></Column>
        <Column header="In stock" class="right">
          <template #body="{ data }">
            <span :class="{ neg: low(data) || Number(data.quantity) <= 0 }" class="num">{{ qty(data.quantity) }} {{ data.product.unit }}</span>
            <Tag v-if="low(data)" value="low" severity="warn" style="margin-left: 6px" />
          </template>
        </Column>
        <Column header="Reorder at" class="right"><template #body="{ data }">{{ qty(data.reorderLevel) }}</template></Column>
        <Column header="Store price" class="right">
          <template #body="{ data }">
            {{ money(data.priceOverride ?? data.product.sellPrice, cur) }}
            <div v-if="data.priceOverride !== null" class="small muted">default {{ money(data.product.sellPrice, cur) }}</div>
          </template>
        </Column>
        <Column header="Stock value (cost)" class="right"><template #body="{ data }">{{ money(Math.max(0, Number(data.quantity)) * Number(data.product.costPrice), cur) }}</template></Column>
        <Column class="right" style="width: 110px">
          <template #body="{ data }">
            <Button icon="pi pi-history" text rounded aria-label="History" v-tooltip="'History'" @click="showHistory(data.productId)" />
            <Button icon="pi pi-pencil" text rounded aria-label="Edit" v-tooltip="'Reorder level & price'" @click="openEdit(data)" />
          </template>
        </Column>
      </DataTable>
    </div>

    <div v-else class="card">
      <div class="toolbar">
        <Tag v-if="history.filters.productId" severity="info">
          <span>One product</span>
          <i class="pi pi-times" style="cursor: pointer; margin-left: 6px" @click="history.filters.productId = null" />
        </Tag>
      </div>
      <DataTable :value="history.rows.value" lazy paginator :rows="history.page.rows" :first="history.page.first" :total-records="history.total.value"
        :loading="history.loading.value" size="small" @page="history.onPage">
        <template #empty><span class="muted">No stock movements</span></template>
        <Column header="Time"><template #body="{ data }">{{ dateTime(data.createdAt) }}</template></Column>
        <Column header="Product"><template #body="{ data }">{{ data.product.name }} <span class="mono muted small">{{ data.product.sku }}</span></template></Column>
        <Column header="Type"><template #body="{ data }"><Tag :value="humanize(data.type)" :severity="moveSeverity[data.type]" /></template></Column>
        <Column header="Change" class="right"><template #body="{ data }"><span class="num" :class="Number(data.quantity) > 0 ? 'pos' : 'neg'">{{ Number(data.quantity) > 0 ? '+' : '' }}{{ qty(data.quantity) }}</span></template></Column>
        <Column header="Balance" class="right"><template #body="{ data }"><span class="num">{{ qty(data.balanceAfter) }}</span></template></Column>
        <Column header="Reference"><template #body="{ data }"><span class="mono small">{{ data.referenceId }}</span> <span class="muted small">{{ data.note }}</span></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="editDlg" :header="edit.name" modal :style="{ width: '440px' }">
      <form class="form" @submit.prevent="saveEdit">
        <div class="field"><label>Reorder level</label><InputNumber v-model="edit.reorderLevel" :min="0" :max-fraction-digits="3" fluid /><span class="hint">Shown as low stock at or below this quantity. 0 = no alert.</span></div>
        <label class="row"><ToggleSwitch v-model="edit.useOverride" /> Use a special price in this store</label>
        <div v-if="edit.useOverride" class="field"><label>Store price (default {{ money(edit.defaultPrice, cur) }})</label><InputNumber v-model="edit.priceOverride" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" fluid /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" /></div>
      </form>
    </Dialog>

    <Dialog v-model:visible="adjDlg" :header="adj.type === 'PURCHASE' ? 'Receive goods' : 'Adjust stock'" modal :style="{ width: '680px' }" :breakpoints="{ '720px': '95vw' }">
      <div class="form">
        <Message v-if="adj.type === 'ADJUSTMENT'" severity="info" :closable="false">Use a negative number to remove stock (damaged, lost, count correction) and a positive one to add.</Message>
        <ProductPicker :store-id="app.currentStoreId" @select="addItem" />
        <DataTable :value="adj.items" size="small">
          <template #empty><span class="muted">Search above to add products</span></template>
          <Column header="Product"><template #body="{ data }">{{ data.product.name }} <span class="mono muted small">{{ data.product.sku }}</span></template></Column>
          <Column header="Current" class="right"><template #body="{ data }">{{ qty(data.product.stock) }}</template></Column>
          <Column header="Quantity" style="width: 150px"><template #body="{ data }"><InputNumber v-model="data.quantity" :max-fraction-digits="3" :min="adj.type === 'PURCHASE' ? 0.001 : undefined" show-buttons fluid size="small" /></template></Column>
          <Column style="width: 50px"><template #body="{ index }"><Button icon="pi pi-times" text rounded severity="secondary" aria-label="Remove" @click="adj.items.splice(index, 1)" /></template></Column>
        </DataTable>
        <div class="form-2">
          <div class="field"><label>{{ adj.type === 'PURCHASE' ? 'Supplier invoice no.' : 'Reference' }}</label><InputText v-model="adj.reference" /></div>
          <div class="field"><label>Note</label><InputText v-model="adj.note" /></div>
        </div>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" severity="secondary" text @click="adjDlg = false" />
          <Button label="Save" icon="pi pi-check" :loading="saving" :disabled="!adj.items.length" @click="saveAdjust" />
        </div>
      </div>
    </Dialog>
  </div>
</template>
