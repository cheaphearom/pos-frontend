<script setup lang="ts">
import QRCode from 'qrcode';
import { onMounted, reactive, ref } from 'vue';
import { api } from '@/api/client';
import type { Store } from '@/api/types';
import { useNotify } from '@/composables/useNotify';
import { useApp } from '@/stores/app';

const notify = useNotify();
const app = useApp();
const rows = ref<Store[]>([]);
const loading = ref(false);
const dialog = ref(false);
const saving = ref(false);
const empty = () => ({ id: '', code: '', name: '', address: '', phone: '', currency: 'USD', taxPercent: 10, isActive: true, khqrAccountId: '', khqrMerchantName: '', khqrCity: '', khqrMerchantId: '', khqrBank: '', hasKitchen: false, onlineOrdering: false, cashierMaxDiscountPercent: 10, refundNeedsApproval: true, voidNeedsApproval: true, khrOn: true, khrRate: 4100 as number | null, cashOutNeedsApproval: true });
const form = reactive(empty());

async function load() {
  loading.value = true;
  try { rows.value = await api.get('/stores', { includeInactive: true }); } catch (e) { notify.error(e); } finally { loading.value = false; }
}
function open(s?: Store) {
  Object.assign(form, s ? { ...empty(), ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ?? ''])), taxPercent: Number(s.taxRate) * 100, cashierMaxDiscountPercent: Number((s as any).cashierMaxDiscountPercent ?? 10), refundNeedsApproval: (s as any).refundNeedsApproval !== false, voidNeedsApproval: (s as any).voidNeedsApproval !== false, khrOn: !!(s as any).khrRate, khrRate: (s as any).khrRate || 4100, cashOutNeedsApproval: (s as any).cashOutNeedsApproval !== false } : empty());
  dialog.value = true;
}
async function save() {
  saving.value = true;
  try {
    const body = {
      code: form.code.toUpperCase(), name: form.name, address: form.address || undefined, phone: form.phone || undefined,
      currency: form.currency.toUpperCase(), taxRate: Number((form.taxPercent / 100).toFixed(4)),
      khqrAccountId: form.khqrAccountId || null, khqrMerchantName: form.khqrMerchantName || null, khqrCity: form.khqrCity || null,
      khqrMerchantId: form.khqrMerchantId || null, khqrBank: form.khqrBank || null, hasKitchen: !!form.hasKitchen, onlineOrdering: !!form.onlineOrdering,
      cashierMaxDiscountPercent: Number(form.cashierMaxDiscountPercent ?? 0), refundNeedsApproval: !!form.refundNeedsApproval, voidNeedsApproval: !!form.voidNeedsApproval,
      khrRate: form.khrOn && form.khrRate ? Math.round(form.khrRate) : null, cashOutNeedsApproval: !!form.cashOutNeedsApproval,
    };
    if (form.id) await api.patch(`/stores/${form.id}`, { ...body, isActive: form.isActive });
    else await api.post('/stores', body);
    notify.success('Store saved', form.name);
    dialog.value = false;
    await Promise.all([load(), app.loadStores()]);
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}
// ── Table QR codes (printable)
const origin = window.location.origin;
const qrDlg = ref(false);
const qrTables = ref(12);
const qrCodes = ref<{ label: string; url: string; img: string }[]>([]);
function openQr() {
  qrDlg.value = true;
  makeQr();
}
async function makeQr() {
  const list = [{ label: 'Order ahead', url: `${origin}/order/${form.code}` }];
  for (let t = 1; t <= Math.min(qrTables.value, 100); t++) list.push({ label: `Table ${t}`, url: `${origin}/order/${form.code}?table=${t}` });
  qrCodes.value = await Promise.all(list.map(async (x) => ({ ...x, img: await QRCode.toDataURL(x.url, { width: 360, margin: 1 }) })));
}
function printQr() {
  document.body.classList.add('printing-qr');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-qr'), 500);
}

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Stores</h1><div class="sub">Branches, their tax rate and currency</div></div>
      <div class="actions"><Button label="New store" icon="pi pi-plus" @click="open()" /></div>
    </div>
    <div class="card">
      <DataTable :value="rows" :loading="loading" size="small" row-hover @row-click="open($event.data)" :row-class="() => 'clickable'">
        <Column header="Code"><template #body="{ data }"><b class="mono">{{ data.code }}</b></template></Column>
        <Column field="name" header="Name" />
        <Column field="address" header="Address" />
        <Column field="phone" header="Phone" />
        <Column field="currency" header="Currency" />
        <Column header="Tax" class="right"><template #body="{ data }">{{ (Number(data.taxRate) * 100).toFixed(2).replace(/\.?0+$/, '') }}%</template></Column>
        <Column header="Café"><template #body="{ data }"><i v-if="data.hasKitchen" class="pi pi-check" /></template></Column>
        <Column header="Online"><template #body="{ data }"><a v-if="data.onlineOrdering" :href="`/order/${data.code}`" target="_blank" @click.stop><i class="pi pi-external-link" /></a></template></Column>
        <Column header="Riel"><template #body="{ data }"><span v-if="data.khrRate" class="num">{{ Number(data.khrRate).toLocaleString() }}</span><span v-else class="muted">off</span></template></Column>
        <Column header="KHQR"><template #body="{ data }"><span v-if="data.khqrAccountId" class="mono small">{{ data.khqrAccountId }}</span><span v-else class="muted">off</span></template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="data.isActive ? 'active' : 'inactive'" :severity="data.isActive ? 'success' : 'secondary'" /></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dialog" :header="form.id ? 'Edit store' : 'New store'" modal :style="{ width: '560px' }" :breakpoints="{ '720px': '95vw' }">
      <form class="form" @submit.prevent="save">
        <div class="form-2">
          <div class="field"><label>Code *</label><InputText v-model="form.code" required maxlength="20" :disabled="!!form.id" /><span class="hint">Used in receipt numbers, e.g. PP01</span></div>
          <div class="field"><label>Name *</label><InputText v-model="form.name" required /></div>
        </div>
        <div class="field"><label>Address</label><InputText v-model="form.address" /></div>
        <div class="form-2">
          <div class="field"><label>Phone</label><InputText v-model="form.phone" /></div>
          <div class="field"><label>Currency</label><InputText v-model="form.currency" maxlength="3" /></div>
        </div>
        <div class="form-2">
          <div class="field"><label>Tax rate (%)</label><InputNumber v-model="form.taxPercent" :min="0" :max="100" :max-fraction-digits="2" suffix="%" fluid /></div>
          <div v-if="form.id" class="field"><label>Status</label><label class="row"><ToggleSwitch v-model="form.isActive" /> Active</label></div>
        </div>
        <label class="row"><ToggleSwitch v-model="form.hasKitchen" /> Café mode: queue numbers, dine-in / takeaway, barista screen</label>
        <label class="row"><ToggleSwitch v-model="form.onlineOrdering" /> Online ordering (order ahead and table QR codes)</label>
        <div v-if="form.onlineOrdering && form.code" class="small muted">
          Order page: <a :href="`/order/${form.code}`" target="_blank">{{ origin }}/order/{{ form.code }}</a>
          <Button v-if="form.id" label="Print table QR codes" icon="pi pi-qrcode" size="small" text @click="openQr" />
        </div>
        <h3 style="margin: 8px 0 0">Riel cash (USD / KHR)</h3>
        <div class="form-2">
          <label class="row" style="align-self: center"><ToggleSwitch v-model="form.khrOn" /> Take cash in riel and give change in riel</label>
          <div v-if="form.khrOn" class="field"><label>Exchange rate</label><InputNumber v-model="form.khrRate" :min="1000" :max="10000" suffix=" ៛ = $1" fluid /><span class="hint">Prices stay in dollars; riel is rounded to 100</span></div>
        </div>
        <h3 style="margin: 8px 0 0">Cashier controls</h3>
        <div class="form-2">
          <div class="field"><label>Cashier discount limit</label><InputNumber v-model="form.cashierMaxDiscountPercent" suffix=" %" :min="0" :max="100" :max-fraction-digits="2" fluid /><span class="hint">Manual discounts above this need a manager PIN (promotions and coupons do not count)</span></div>
          <div class="field" style="align-content: center; gap: 10px">
            <label class="row"><ToggleSwitch v-model="form.refundNeedsApproval" /> Cashier refunds need a manager PIN</label>
            <label class="row"><ToggleSwitch v-model="form.voidNeedsApproval" /> Cashier voids need a manager PIN</label>
            <label class="row"><ToggleSwitch v-model="form.cashOutNeedsApproval" /> Cashier cash-outs need a manager PIN</label>
          </div>
        </div>
        <h3 style="margin: 8px 0 0">KHQR payments (Bakong)</h3>
        <div class="form-2">
          <div class="field"><label>Bakong account ID</label><InputText v-model="form.khqrAccountId" placeholder="myshop@aclb" maxlength="32" /><span class="hint">Leave empty to turn KHQR off for this store</span></div>
          <div class="field"><label>Name shown to customers</label><InputText v-model="form.khqrMerchantName" maxlength="25" :placeholder="form.name.slice(0, 25)" /></div>
        </div>
        <div class="form-2">
          <div class="field"><label>City</label><InputText v-model="form.khqrCity" maxlength="15" placeholder="Phnom Penh" /></div>
          <div class="field"><label>Bank</label><InputText v-model="form.khqrBank" maxlength="32" placeholder="ACLEDA Bank Plc" /></div>
        </div>
        <div class="field"><label>Merchant ID <span class="hint">(only for Bakong merchant accounts)</span></label><InputText v-model="form.khqrMerchantId" maxlength="32" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" :loading="saving" /></div>
      </form>
    </Dialog>

    <Dialog v-model:visible="qrDlg" header="Table QR codes" modal :style="{ width: '900px' }" :breakpoints="{ '940px': '98vw' }">
      <div class="row" style="margin-bottom: 12px">
        <span>Tables</span><InputNumber v-model="qrTables" :min="1" :max="100" :input-style="{ width: '80px' }" @update:model-value="makeQr" />
        <span class="spacer" style="flex: 1" />
        <Button label="Print" icon="pi pi-print" @click="printQr" />
      </div>
      <div id="print-qr" class="qr-grid">
        <div v-for="q in qrCodes" :key="q.url" class="qr-card">
          <div class="qr-store">{{ form.name }}</div>
          <img :src="q.img" :alt="q.label" />
          <b>{{ q.label }}</b>
          <div class="qr-hint">Scan to order · pay with KHQR</div>
        </div>
      </div>
    </Dialog>
  </div>
</template>

<style>
.qr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; }
.qr-card { border: 1px dashed var(--border); border-radius: 12px; padding: 12px; text-align: center; display: grid; gap: 6px; justify-items: center; break-inside: avoid; }
.qr-card img { width: 160px; height: 160px; }
.qr-store { font-weight: 700; }
.qr-hint { font-size: 12px; color: var(--text-2); }
@media print {
  body.printing-qr * { visibility: hidden; }
  body.printing-qr #print-qr, body.printing-qr #print-qr * { visibility: visible; color: #000 !important; }
  body.printing-qr #print-qr { position: absolute; left: 0; top: 0; width: 100%; grid-template-columns: repeat(3, 1fr); }
}
</style>
