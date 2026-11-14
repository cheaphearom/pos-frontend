<script setup lang="ts">
import QRCode from 'qrcode';
import { computed, onMounted, reactive, ref } from 'vue';
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
const empty = () => ({ id: '', code: '', name: '', externalId: '', address: '', phone: '', currency: 'USD', taxPercent: 10, isActive: true, khqrAccountId: '', khqrMerchantName: '', khqrCity: '', khqrMerchantId: '', khqrBank: '', hasKitchen: false, onlineOrdering: false, cashierMaxDiscountPercent: 10, refundNeedsApproval: true, voidNeedsApproval: true, khrOn: true, khrRate: 4100 as number | null, cashOutNeedsApproval: true, copyProductsFrom: null as string | null });
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
      code: form.code.toUpperCase(), name: form.name, externalId: form.externalId.trim() || null, address: form.address || undefined, phone: form.phone || undefined,
      currency: form.currency.toUpperCase(), taxRate: Number((form.taxPercent / 100).toFixed(4)),
      khqrAccountId: form.khqrAccountId || null, khqrMerchantName: form.khqrMerchantName || null, khqrCity: form.khqrCity || null,
      khqrMerchantId: form.khqrMerchantId || null, khqrBank: form.khqrBank || null, hasKitchen: !!form.hasKitchen, onlineOrdering: !!form.onlineOrdering,
      cashierMaxDiscountPercent: Number(form.cashierMaxDiscountPercent ?? 0), refundNeedsApproval: !!form.refundNeedsApproval, voidNeedsApproval: !!form.voidNeedsApproval,
      khrRate: form.khrOn && form.khrRate ? Math.round(form.khrRate) : null, cashOutNeedsApproval: !!form.cashOutNeedsApproval,
    };
    if (form.id) await api.patch(`/stores/${form.id}`, { ...body, isActive: form.isActive });
    else await api.post('/stores', { ...body, copyProductsFrom: form.copyProductsFrom || undefined });
    notify.success('Store saved', form.name);
    dialog.value = false;
    await Promise.all([load(), app.loadStores()]);
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}
// ── Sync the menu from the BROWN system
interface SyncResult { store: string; items: number; categoriesCreated: number; productsCreated: number; productsUpdated: number; addedToStore: number; storePrices: number }
const remembered = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const syncDlg = ref(false);
const syncing = ref(false);
const syncStore = ref<Store | null>(null);
const syncResult = ref<SyncResult | null>(null);
const syncError = ref('');
const sync = reactive({ mode: 'api' as 'api' | 'paste', brownStoreId: '', apiUrl: remembered('pos.brown.apiUrl'), username: remembered('pos.brown.username'), devKid: remembered('pos.brown.devKid'), accessToken: '', dataEncryption: '', pasted: '' });
const defaultUrl = ref('');
const isAppApi = computed(() => /brown_app_menu_listing/i.test(sync.apiUrl));
const syncModes = [{ label: 'From the BROWN API', value: 'api' }, { label: 'Paste a response', value: 'paste' }];
function openSync(s: Store) {
  syncStore.value = s;
  Object.assign(sync, { brownStoreId: s.externalId ?? '', accessToken: sync.accessToken, dataEncryption: '', pasted: '' });
  syncResult.value = null;
  syncError.value = '';
  syncDlg.value = true;
  if (!defaultUrl.value) api.get<{ menuUrl: string }>('/stores/brown-sync/settings').then((r) => (defaultUrl.value = r.menuUrl)).catch(() => {});
}
async function runSync() {
  if (!syncStore.value) return;
  syncError.value = '';
  syncResult.value = null;
  let body: Record<string, unknown> = { brownStoreId: sync.brownStoreId.trim() || undefined };
  if (sync.mode === 'paste') {
    try { body.response = JSON.parse(sync.pasted); } catch { syncError.value = 'That is not the whole response: it must start with { and end with } (copy it again from Postman).'; return; }
  } else {
    body = { ...body, apiUrl: sync.apiUrl.trim() || undefined, username: isAppApi.value ? sync.username.trim() : undefined, devKid: sync.devKid.trim(), accessToken: sync.accessToken.trim(), dataEncryption: sync.dataEncryption.trim() || undefined };
    try {
      localStorage.setItem('pos.brown.devKid', sync.devKid.trim());
      localStorage.setItem('pos.brown.apiUrl', sync.apiUrl.trim());
      if (isAppApi.value) localStorage.setItem('pos.brown.username', sync.username.trim());
    } catch { /* private window */ }
  }
  syncing.value = true;
  try {
    syncResult.value = await api.post<SyncResult>(`/stores/${syncStore.value.id}/brown-sync`, body);
    notify.success('Menu synced', `${syncResult.value.store}: ${syncResult.value.items} items`);
    await load();
  } catch (e: any) {
    syncError.value = e?.message ?? String(e);
  } finally { syncing.value = false; }
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
        <Column header="BROWN menu"><template #body="{ data }"><Button label="Sync" icon="pi pi-sync" size="small" outlined @click.stop="openSync(data)" /></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dialog" :header="form.id ? 'Edit store' : 'New store'" modal :style="{ width: '560px' }" :breakpoints="{ '720px': '95vw' }">
      <form class="form" @submit.prevent="save">
        <div class="form-2">
          <div class="field"><label>Code *</label><InputText v-model="form.code" required maxlength="20" :disabled="!!form.id" /><span class="hint">Used in receipt numbers, e.g. PP01</span></div>
          <div class="field"><label>Name *</label><InputText v-model="form.name" required /></div>
        </div>
        <div class="field"><label>Address</label><InputText v-model="form.address" /></div>
        <div class="field"><label>BROWN store id</label><InputText v-model="form.externalId" maxlength="50" placeholder="e.g. 820161780837506397" /><span class="hint">This store's id in the BROWN system (idoutlet), used to sync its menu</span></div>
        <div class="form-2">
          <div class="field"><label>Phone</label><InputText v-model="form.phone" /></div>
          <div class="field"><label>Currency</label><InputText v-model="form.currency" maxlength="3" /></div>
        </div>
        <div class="form-2">
          <div class="field"><label>Tax rate (%)</label><InputNumber v-model="form.taxPercent" :min="0" :max="100" :max-fraction-digits="2" suffix="%" fluid /></div>
          <div v-if="form.id" class="field"><label>Status</label><label class="row"><ToggleSwitch v-model="form.isActive" /> Active</label></div>
        </div>
        <div v-if="!form.id" class="field">
          <label>Products <span class="hint">(you can change them later on the Products page)</span></label>
          <Select v-model="form.copyProductsFrom" :options="rows.filter((s) => s.isActive)" :option-label="(s: Store) => `Same products and prices as ${s.code} · ${s.name}`" option-value="id" show-clear placeholder="Every active product, at the normal price" fluid />
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

    <Dialog v-model:visible="syncDlg" :header="`Sync BROWN menu · ${syncStore?.code ?? ''}`" modal :style="{ width: '560px' }" :breakpoints="{ '720px': '95vw' }">
      <form class="form" @submit.prevent="runSync">
        <div class="small muted">{{ syncStore?.name }}: items with the same SKU are updated (name, picture, category), new items are created, and every item is sold in this store at the BROWN price.</div>
        <SelectButton v-model="sync.mode" :options="syncModes" option-label="label" option-value="value" :allow-empty="false" />
        <div class="field"><label>BROWN store id {{ sync.mode === 'api' ? '*' : '' }}</label><InputText v-model="sync.brownStoreId" :required="sync.mode === 'api'" maxlength="50" placeholder="e.g. 820161780837506397" /><span class="hint">Saved on the store for next time</span></div>
        <template v-if="sync.mode === 'api'">
          <div class="field">
            <label>API URL <span class="hint">(optional)</span></label>
            <InputText v-model="sync.apiUrl" type="url" autocomplete="off" class="mono small" :placeholder="defaultUrl ? `Default: ${defaultUrl}` : 'Leave empty for the default address'" />
            <span class="hint">Leave empty for the default. The POS server calls this address, so the server must be able to reach it. Remembered in this browser.</span>
          </div>
          <div v-if="isAppApi" class="field"><label>Username</label><InputText v-model="sync.username" autocomplete="off" /><span class="hint">The BROWN app username used for the access token</span></div>
          <div class="field"><label>dev_kid *</label><InputText v-model="sync.devKid" required inputmode="numeric" autocomplete="off" /></div>
          <div class="field"><label>Access token *</label><Textarea v-model="sync.accessToken" required rows="3" auto-resize spellcheck="false" autocomplete="off" class="mono small" /><span class="hint">user_access_token from the BROWN guest login. It is not saved.</span></div>
          <div class="field"><label>data_encryption <span class="hint">(optional)</span></label><InputText v-model="sync.dataEncryption" autocomplete="off" class="mono small" placeholder="Leave empty: calculated for you every month" /></div>
        </template>
        <div v-else class="field">
          <label>Menu response *</label>
          <Textarea v-model="sync.pasted" required rows="8" spellcheck="false" class="mono small" placeholder='Paste the whole Postman response: { "code": 100, "name": "ITEM MENU ...", "result": { "groups": [ ... ] } }' />
          <span class="hint">Use this when the POS server cannot reach the BROWN API</span>
        </div>
        <Message v-if="syncError" severity="error" :closable="false">{{ syncError }}</Message>
        <Message v-if="syncResult" severity="success" :closable="false">
          <b>{{ syncResult.items }} items</b> in the {{ syncResult.store }} menu:
          {{ syncResult.productsCreated }} new, {{ syncResult.productsUpdated }} updated,
          {{ syncResult.addedToStore }} added to this store, {{ syncResult.categoriesCreated }} new categories,
          {{ syncResult.storePrices }} with this store's own price.
        </Message>
        <div class="row" style="justify-content: flex-end">
          <Button label="Close" text @click="syncDlg = false" />
          <Button type="submit" label="Sync" icon="pi pi-sync" :loading="syncing" />
        </div>
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
