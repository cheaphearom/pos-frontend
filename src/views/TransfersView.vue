<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '@/api/client';
import type { Product } from '@/api/types';
import ProductPicker from '@/components/ProductPicker.vue';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { dateTime, qty } from '@/utils/format';

const app = useApp();
const notify = useNotify();
const confirm = useConfirm();
const list = usePagedList('/transfers', { storeId: app.currentStoreId, status: null });
list.load();
const statusSeverity: Record<string, string> = { IN_TRANSIT: 'warn', RECEIVED: 'success', CANCELLED: 'secondary' };
const statuses = [{ v: 'IN_TRANSIT', l: 'In transit' }, { v: 'RECEIVED', l: 'Received' }, { v: 'CANCELLED', l: 'Cancelled' }];

// All stores are possible destinations (need the full list, not just mine)
const allStores = ref<any[]>([]);
api.get('/stores/directory').then((s) => (allStores.value = s));
const destinations = computed(() => allStores.value.filter((s) => s.id !== app.currentStoreId));

const dlg = ref(false);
const saving = ref(false);
const form = reactive({ toStoreId: null as string | null, note: '', items: [] as { product: Product; quantity: number }[] });
function openNew() {
  Object.assign(form, { toStoreId: null, note: '', items: [] });
  dlg.value = true;
}
function addItem(p: Product) {
  const e = form.items.find((i) => i.product.id === p.id);
  if (e) e.quantity += 1;
  else form.items.push({ product: p, quantity: 1 });
}
async function create() {
  saving.value = true;
  try {
    const t = await api.post('/transfers', {
      fromStoreId: app.currentStoreId, toStoreId: form.toStoreId, note: form.note || undefined,
      items: form.items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
    });
    dlg.value = false;
    notify.success('Transfer sent', t.transferNo);
    list.load();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}

const detail = ref<any>(null);
const showDetail = ref(false);
async function open(row: any) {
  try {
    detail.value = await api.get(`/transfers/${row.id}`);
    showDetail.value = true;
  } catch (e) { notify.error(e); }
}
const canReceive = computed(() => detail.value?.status === 'IN_TRANSIT' && app.stores.some((s) => s.id === detail.value.toStoreId));
const canCancel = computed(() => detail.value?.status === 'IN_TRANSIT' && app.stores.some((s) => s.id === detail.value.fromStoreId));

function act(action: 'receive' | 'cancel') {
  confirm.require({
    header: action === 'receive' ? 'Receive transfer' : 'Cancel transfer',
    message: action === 'receive'
      ? `Confirm all items of ${detail.value.transferNo} arrived at ${detail.value.toStore.name}?`
      : `Cancel ${detail.value.transferNo}? The stock goes back to ${detail.value.fromStore.name}.`,
    acceptProps: { label: action === 'receive' ? 'Receive' : 'Cancel transfer', severity: action === 'receive' ? 'primary' : 'danger' },
    rejectProps: { label: 'Back', severity: 'secondary', text: true },
    accept: async () => {
      try {
        await api.post(`/transfers/${detail.value.id}/${action}`);
        notify.success(action === 'receive' ? 'Stock received' : 'Transfer cancelled');
        showDetail.value = false;
        list.load();
      } catch (e) { notify.error(e); }
    },
  });
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Transfers</h1><div class="sub">Move stock between stores · shown for {{ app.currentStore?.name }}</div></div>
      <div class="actions"><Button label="Send stock" icon="pi pi-send" @click="openNew" /></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <Select v-model="list.filters.status" :options="statuses" option-label="l" option-value="v" placeholder="All statuses" show-clear />
      </div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :loading="list.loading.value" size="small" @page="list.onPage" @row-click="open($event.data)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No transfers</span></template>
        <Column header="Number"><template #body="{ data }"><span class="mono">{{ data.transferNo }}</span></template></Column>
        <Column header="From → To"><template #body="{ data }"><b>{{ data.fromStore.code }}</b> → <b>{{ data.toStore.code }}</b></template></Column>
        <Column header="Items" class="right"><template #body="{ data }">{{ data._count.items }}</template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="data.status.replace('_', ' ')" :severity="statusSeverity[data.status]" /></template></Column>
        <Column header="Sent"><template #body="{ data }">{{ dateTime(data.createdAt) }}</template></Column>
        <Column header="Closed"><template #body="{ data }">{{ dateTime(data.receivedAt) }}</template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dlg" header="Send stock to another store" modal :style="{ width: '680px' }" :breakpoints="{ '720px': '95vw' }">
      <div class="form">
        <div class="form-2">
          <div class="field"><label>From</label><InputText :model-value="app.currentStore?.name" disabled /></div>
          <div class="field"><label>To *</label><Select v-model="form.toStoreId" :options="destinations" option-label="name" option-value="id" placeholder="Destination store" /></div>
        </div>
        <ProductPicker :store-id="app.currentStoreId" @select="addItem" />
        <DataTable :value="form.items" size="small">
          <template #empty><span class="muted">Search above to add products</span></template>
          <Column header="Product"><template #body="{ data }">{{ data.product.name }}</template></Column>
          <Column header="Available" class="right"><template #body="{ data }">{{ qty(data.product.stock) }}</template></Column>
          <Column header="Quantity" style="width: 150px"><template #body="{ data }"><InputNumber v-model="data.quantity" :min="0.001" :max-fraction-digits="3" show-buttons fluid size="small" /></template></Column>
          <Column style="width: 50px"><template #body="{ index }"><Button icon="pi pi-times" text rounded severity="secondary" aria-label="Remove" @click="form.items.splice(index, 1)" /></template></Column>
        </DataTable>
        <div class="field"><label>Note</label><InputText v-model="form.note" /></div>
        <Message severity="info" :closable="false">Stock leaves {{ app.currentStore?.code }} now. The destination store adds it when they press "Receive".</Message>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" severity="secondary" text @click="dlg = false" />
          <Button label="Send" icon="pi pi-send" :loading="saving" :disabled="!form.toStoreId || !form.items.length" @click="create" />
        </div>
      </div>
    </Dialog>

    <Drawer v-model:visible="showDetail" position="right" :header="detail?.transferNo" style="width: min(520px, 100vw)">
      <template v-if="detail">
        <dl class="kv">
          <dt>Status</dt><dd><Tag :value="detail.status.replace('_', ' ')" :severity="statusSeverity[detail.status]" /></dd>
          <dt>From</dt><dd>{{ detail.fromStore.name }}</dd>
          <dt>To</dt><dd>{{ detail.toStore.name }}</dd>
          <dt>Sent</dt><dd>{{ dateTime(detail.createdAt) }}</dd>
          <dt v-if="detail.receivedAt">Closed</dt><dd v-if="detail.receivedAt">{{ dateTime(detail.receivedAt) }}</dd>
          <dt v-if="detail.note">Note</dt><dd v-if="detail.note">{{ detail.note }}</dd>
        </dl>
        <DataTable :value="detail.items" size="small" class="mt">
          <Column header="Product"><template #body="{ data }">{{ data.product.name }} <span class="mono muted small">{{ data.product.sku }}</span></template></Column>
          <Column header="Qty" class="right"><template #body="{ data }">{{ qty(data.quantity) }} {{ data.product.unit }}</template></Column>
        </DataTable>
        <div class="row mt" style="justify-content: flex-end">
          <Button v-if="canCancel" label="Cancel transfer" severity="danger" text @click="act('cancel')" />
          <Button v-if="canReceive" label="Receive" icon="pi pi-check" @click="act('receive')" />
        </div>
      </template>
    </Drawer>
  </div>
</template>
