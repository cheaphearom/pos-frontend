<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '@/api/client';
import type { Product } from '@/api/types';
import ProductPicker from '@/components/ProductPicker.vue';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { date, dateTime, humanize, money, qty } from '@/utils/format';

const app = useApp();
const notify = useNotify();
const confirm = useConfirm();
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: any) => money(v, cur.value);
const list = usePagedList('/purchase-orders', { storeId: app.currentStoreId, status: null, supplierId: null, search: '' });
list.load();
const statuses = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].map((v) => ({ v, l: humanize(v) }));
const sev: Record<string, string> = { DRAFT: 'secondary', ORDERED: 'info', PARTIALLY_RECEIVED: 'warn', RECEIVED: 'success', CANCELLED: 'contrast' };

const suppliers = ref<any[]>([]);
api.get('/suppliers', { limit: 200 }).then((r) => (suppliers.value = r.data.filter((s: any) => s.isActive)));

// ── Create / edit draft
const editDlg = ref(false);
const saving = ref(false);
const form = reactive({ id: '', supplierId: null as string | null, expectedAt: null as Date | null, note: '', items: [] as { product: any; quantity: number; unitCost: number }[] });
const formTotal = computed(() => form.items.reduce((s, i) => s + i.quantity * i.unitCost, 0));
function openNew(prefill: typeof form.items = []) {
  Object.assign(form, { id: '', supplierId: null, expectedAt: null, note: '', items: prefill });
  editDlg.value = true;
}
function addItem(p: Product) {
  const e = form.items.find((i) => i.product.id === p.id);
  if (e) e.quantity += 1;
  else form.items.push({ product: p, quantity: 1, unitCost: Number(p.costPrice) });
}
async function fromSuggestions() {
  try {
    const s = await api.get('/purchase-orders/suggestions', { storeId: app.currentStoreId });
    if (!s.length) return notify.success('Nothing to reorder', 'No products are at or below their reorder level');
    openNew(s.map((x: any) => ({ product: { id: x.productId, name: x.name, sku: x.sku, unit: x.unit, stock: x.stock }, quantity: Number(x.suggestedQty), unitCost: Number(x.unitCost) })));
  } catch (e) { notify.error(e); }
}
function editDraft() {
  const po = detail.value;
  Object.assign(form, {
    id: po.id, supplierId: po.supplierId, expectedAt: po.expectedAt ? new Date(po.expectedAt) : null, note: po.note ?? '',
    items: po.items.map((i: any) => ({ product: i.product, quantity: Number(i.quantity), unitCost: Number(i.unitCost) })),
  });
  showDetail.value = false;
  editDlg.value = true;
}
async function saveDraft() {
  saving.value = true;
  try {
    const body = {
      supplierId: form.supplierId, storeId: app.currentStoreId, note: form.note || undefined,
      expectedAt: form.expectedAt ? form.expectedAt.toISOString() : undefined,
      items: form.items.map((i) => ({ productId: i.product.id, quantity: i.quantity, unitCost: i.unitCost })),
    };
    const po = form.id ? await api.patch(`/purchase-orders/${form.id}`, body) : await api.post('/purchase-orders', body);
    notify.success('Purchase order saved', po.poNo);
    editDlg.value = false;
    list.load();
    open(po.id);
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}

// ── Detail
const detail = ref<any>(null);
const showDetail = ref(false);
async function open(id: string) {
  try {
    detail.value = await api.get(`/purchase-orders/${id}`);
    showDetail.value = true;
  } catch (e) { notify.error(e); }
}
async function act(action: 'order' | 'cancel') {
  const run = async () => {
    try {
      detail.value = await api.post(`/purchase-orders/${detail.value.id}/${action}`);
      notify.success(action === 'order' ? 'Marked as ordered' : 'Order cancelled');
      list.load();
    } catch (e) { notify.error(e); }
  };
  if (action === 'order') return run();
  confirm.require({ header: 'Cancel order', message: `Cancel ${detail.value.poNo}?`, acceptProps: { label: 'Cancel order', severity: 'danger' }, rejectProps: { label: 'Back', text: true, severity: 'secondary' }, accept: run });
}
function printPo() {
  document.body.classList.add('printing-po');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-po'), 500);
}

// ── Receive delivery
const recvDlg = ref(false);
const recv = reactive({ reference: '', note: '', updateCost: true, lines: [] as { itemId: string; name: string; left: number; quantity: number; unitCost: number }[] });
function openReceive() {
  recv.reference = '';
  recv.note = '';
  recv.updateCost = true;
  recv.lines = detail.value.items
    .map((i: any) => ({ itemId: i.id, name: i.product.name, left: Number(i.quantity) - Number(i.receivedQty), quantity: Number(i.quantity) - Number(i.receivedQty), unitCost: Number(i.unitCost) }))
    .filter((l: any) => l.left > 0);
  recvDlg.value = true;
}
async function doReceive() {
  const items = recv.lines.filter((l) => l.quantity > 0).map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost }));
  if (!items.length) return notify.error('Enter at least one quantity');
  saving.value = true;
  try {
    detail.value = await api.post(`/purchase-orders/${detail.value.id}/receive`, { items, reference: recv.reference || undefined, note: recv.note || undefined, updateCost: recv.updateCost });
    notify.success('Goods received', `Stock updated in ${detail.value.store.code}`);
    recvDlg.value = false;
    list.load();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Purchase orders</h1><div class="sub">Buying stock for {{ app.currentStore?.name }}</div></div>
      <div class="actions">
        <Button label="Reorder low stock" icon="pi pi-bolt" severity="secondary" @click="fromSuggestions" />
        <Button label="New order" icon="pi pi-plus" @click="openNew()" />
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="PO number" /></IconField>
        <Select v-model="list.filters.status" :options="statuses" option-label="l" option-value="v" placeholder="All statuses" show-clear />
        <Select v-model="list.filters.supplierId" :options="suppliers" option-label="name" option-value="id" placeholder="All suppliers" show-clear filter />
      </div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :loading="list.loading.value" size="small" @page="list.onPage" @row-click="open($event.data.id)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No purchase orders</span></template>
        <Column header="PO"><template #body="{ data }"><span class="mono">{{ data.poNo }}</span></template></Column>
        <Column header="Supplier"><template #body="{ data }">{{ data.supplier.name }}</template></Column>
        <Column header="Lines" class="right"><template #body="{ data }">{{ data._count.items }}</template></Column>
        <Column header="Total" class="right"><template #body="{ data }">{{ m(data.subtotal) }}</template></Column>
        <Column header="Expected"><template #body="{ data }">{{ date(data.expectedAt) || '—' }}</template></Column>
        <Column header="Created"><template #body="{ data }">{{ date(data.createdAt) }}</template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="humanize(data.status)" :severity="sev[data.status]" /></template></Column>
      </DataTable>
    </div>

    <!-- Create / edit -->
    <Dialog v-model:visible="editDlg" :header="form.id ? 'Edit draft order' : 'New purchase order'" modal :style="{ width: '820px' }" :breakpoints="{ '900px': '98vw' }">
      <div class="form">
        <div class="form-2">
          <div class="field"><label>Supplier *</label><Select v-model="form.supplierId" :options="suppliers" option-label="name" option-value="id" placeholder="Choose supplier" filter /></div>
          <div class="field"><label>Expected delivery</label><DatePicker v-model="form.expectedAt" show-button-bar date-format="dd M yy" /></div>
        </div>
        <ProductPicker :store-id="app.currentStoreId" @select="addItem" />
        <DataTable :value="form.items" size="small" scrollable scroll-height="340px">
          <template #empty><span class="muted">Search above to add products</span></template>
          <Column header="Product"><template #body="{ data }">{{ data.product.name }} <span class="mono small muted">{{ data.product.sku }}</span></template></Column>
          <Column header="In stock" class="right"><template #body="{ data }">{{ data.product.stock !== undefined ? qty(data.product.stock) : '' }}</template></Column>
          <Column header="Quantity" style="width: 140px"><template #body="{ data }"><InputNumber v-model="data.quantity" :min="0.001" :max-fraction-digits="3" fluid size="small" /></template></Column>
          <Column header="Unit cost" style="width: 130px"><template #body="{ data }"><InputNumber v-model="data.unitCost" :min="0" :min-fraction-digits="2" :max-fraction-digits="6" fluid size="small" /></template></Column>
          <Column header="Line total" class="right"><template #body="{ data }">{{ m(data.quantity * data.unitCost) }}</template></Column>
          <Column style="width: 44px"><template #body="{ index }"><Button icon="pi pi-times" text rounded severity="secondary" aria-label="Remove" @click="form.items.splice(index, 1)" /></template></Column>
        </DataTable>
        <div class="row" style="justify-content: space-between">
          <div class="field" style="flex: 1"><InputText v-model="form.note" placeholder="Note for the supplier" /></div>
          <b style="margin-left: 16px">Total {{ m(formTotal) }}</b>
        </div>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" text severity="secondary" @click="editDlg = false" />
          <Button label="Save draft" icon="pi pi-check" :loading="saving" :disabled="!form.supplierId || !form.items.length" @click="saveDraft" />
        </div>
      </div>
    </Dialog>

    <!-- Detail -->
    <Drawer v-model:visible="showDetail" position="right" :header="detail?.poNo" style="width: min(720px, 100vw)">
      <template v-if="detail">
        <div id="print-po">
          <div class="row" style="justify-content: space-between; align-items: flex-start">
            <div>
              <div class="small muted">Supplier</div>
              <b>{{ detail.supplier.name }}</b>
              <div class="small">{{ detail.supplier.phone }} {{ detail.supplier.email }}</div>
            </div>
            <div style="text-align: right">
              <div class="small muted">Deliver to</div>
              <b>{{ detail.store.name }}</b>
              <div class="small">{{ detail.store.address }}</div>
            </div>
          </div>
          <dl class="kv mt">
            <dt>Status</dt><dd><Tag :value="humanize(detail.status)" :severity="sev[detail.status]" /></dd>
            <dt>Created</dt><dd>{{ dateTime(detail.createdAt) }}</dd>
            <dt v-if="detail.orderedAt">Ordered</dt><dd v-if="detail.orderedAt">{{ dateTime(detail.orderedAt) }}</dd>
            <dt v-if="detail.expectedAt">Expected</dt><dd v-if="detail.expectedAt">{{ date(detail.expectedAt) }}</dd>
            <dt>Payment terms</dt><dd>{{ detail.supplier.paymentTermsDays ? `${detail.supplier.paymentTermsDays} days` : 'On delivery' }}</dd>
            <dt v-if="detail.note">Note</dt><dd v-if="detail.note">{{ detail.note }}</dd>
          </dl>
          <DataTable :value="detail.items" size="small" class="mt">
            <Column header="#"><template #body="{ data }">{{ data.lineNo }}</template></Column>
            <Column header="Product"><template #body="{ data }">{{ data.product.name }}<div class="mono small muted">{{ data.product.sku }} {{ data.product.barcode }}</div></template></Column>
            <Column header="Ordered" class="right"><template #body="{ data }">{{ qty(data.quantity) }} {{ data.product.unit }}</template></Column>
            <Column header="Received" class="right"><template #body="{ data }"><span :class="{ pos: Number(data.receivedQty) >= Number(data.quantity) }">{{ qty(data.receivedQty) }}</span></template></Column>
            <Column header="Unit cost" class="right"><template #body="{ data }">{{ m(data.unitCost) }}</template></Column>
            <Column header="Total" class="right"><template #body="{ data }">{{ m(Number(data.unitCost) * Number(data.quantity)) }}</template></Column>
          </DataTable>
          <div class="row mt" style="justify-content: flex-end"><b>Total {{ m(detail.subtotal) }}</b></div>
        </div>
        <div v-if="detail.receipts.length" class="mt">
          <h3>Deliveries</h3>
          <div v-for="(r, i) in detail.receipts" :key="r.id" class="small row" style="justify-content: space-between; padding: 4px 0">
            <span>#{{ i + 1 }} · {{ dateTime(r.createdAt) }} <span v-if="r.reference" class="mono">· {{ r.reference }}</span></span>
            <span>{{ r.items.length }} line(s)</span>
          </div>
        </div>
        <div class="row mt" style="justify-content: flex-end; flex-wrap: wrap">
          <Button label="Print" icon="pi pi-print" text severity="secondary" @click="printPo" />
          <Button v-if="['DRAFT', 'ORDERED'].includes(detail.status)" label="Cancel order" text severity="danger" @click="act('cancel')" />
          <Button v-if="detail.status === 'DRAFT'" label="Edit" icon="pi pi-pencil" severity="secondary" @click="editDraft" />
          <Button v-if="detail.status === 'DRAFT'" label="Mark as ordered" icon="pi pi-send" @click="act('order')" />
          <Button v-if="['ORDERED', 'PARTIALLY_RECEIVED'].includes(detail.status)" label="Receive delivery" icon="pi pi-download" @click="openReceive" />
        </div>
      </template>
    </Drawer>

    <Dialog v-model:visible="recvDlg" header="Receive delivery" modal :style="{ width: '720px' }" :breakpoints="{ '760px': '98vw' }">
      <div class="form">
        <DataTable :value="recv.lines" size="small">
          <Column field="name" header="Product" />
          <Column header="Still to come" class="right"><template #body="{ data }">{{ qty(data.left) }}</template></Column>
          <Column header="Received now" style="width: 140px"><template #body="{ data }"><InputNumber v-model="data.quantity" :min="0" :max="data.left" :max-fraction-digits="3" fluid size="small" /></template></Column>
          <Column header="Invoice cost" style="width: 130px"><template #body="{ data }"><InputNumber v-model="data.unitCost" :min="0" :min-fraction-digits="2" :max-fraction-digits="6" fluid size="small" /></template></Column>
        </DataTable>
        <div class="form-2">
          <div class="field"><label>Supplier invoice / delivery note no.</label><InputText v-model="recv.reference" /></div>
          <div class="field"><label>Note</label><InputText v-model="recv.note" /></div>
        </div>
        <label class="row"><ToggleSwitch v-model="recv.updateCost" /> Update product cost prices to these costs</label>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" text severity="secondary" @click="recvDlg = false" />
          <Button label="Add to stock" icon="pi pi-check" :loading="saving" @click="doReceive" />
        </div>
      </div>
    </Dialog>
  </div>
</template>

<style>
@media print {
  body.printing-po * { visibility: hidden; }
  body.printing-po #print-po, body.printing-po #print-po * { visibility: visible; color: #000 !important; }
  body.printing-po #print-po { position: absolute; left: 0; top: 0; width: 100%; }
}
</style>
