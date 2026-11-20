<!-- Copyright (c) 2026 Chea Phearom. All rights reserved. Proprietary and confidential: see the LICENSE file. -->
<script setup lang="ts">
import QRCode from 'qrcode';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { api } from '@/api/client';
import type { Store } from '@/api/types';
import { useNotify } from '@/composables/useNotify';
import { useApp } from '@/stores/app';
import { nameColor } from '@/utils/colors';

const notify = useNotify();
const app = useApp();
const rows = ref<Store[]>([]);
const loading = ref(false);
const dialog = ref(false);
const saving = ref(false);
const empty = () => ({ id: '', code: '', name: '', externalId: '', address: '', phone: '', currency: 'USD', taxPercent: 10, isActive: true, khqrAccountId: '', khqrMerchantName: '', khqrCity: '', khqrMerchantId: '', khqrBank: '', hasKitchen: false, onlineOrdering: false, printAuto: false, printCustomer: true, printCashierCopy: false, printKitchen: false, cashierMaxDiscountPercent: 10, refundNeedsApproval: true, voidNeedsApproval: true, khrOn: true, khrRate: 4100 as number | null, cashOutNeedsApproval: true, copyProductsFrom: null as string | null });
const form = reactive(empty());

// ── Cards: search and filters
const q = ref('');
const show = ref<'all' | 'active' | 'inactive' | 'unlinked'>('active');
const shown = computed(() => {
  const s = q.value.trim().toLowerCase();
  return rows.value
    .filter((r) => show.value === 'all' || (show.value === 'active' ? r.isActive : show.value === 'inactive' ? !r.isActive : r.isActive && !r.externalId))
    .filter((r) => !s || [r.code, r.name, r.address, r.phone, r.externalId].some((x) => (x ?? '').toLowerCase().includes(s)));
});
const counts = computed(() => ({
  all: rows.value.length, active: rows.value.filter((r) => r.isActive).length, inactive: rows.value.filter((r) => !r.isActive).length,
  unlinked: rows.value.filter((r) => r.isActive && !r.externalId).length,
}));
const taxText = (r: Store) => (Number(r.taxRate) * 100).toFixed(2).replace(/\.?0+$/, '') + '%';

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
      printAuto: !!form.printAuto, printCustomer: !!form.printCustomer, printCashierCopy: !!form.printCashierCopy, printKitchen: !!form.printKitchen,
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
interface SyncResult { store: string; items: number; categoriesCreated: number; productsCreated: number; productsUpdated: number; addedToStore: number; storePrices: number; optionsUpdated?: number }
interface SyncAllRow { store: string; name: string; ok: boolean; items?: number; productsCreated?: number; productsUpdated?: number; optionsUpdated?: number; error?: string }
interface SyncAllJob { id: string; running: boolean; total: number; done: number; stopped: string | null; results: SyncAllRow[] }
// BROWN details (address, dev_kid, username, group ids, token) are kept in this page's memory only, never in the browser's storage.
// Remove what older versions saved.
try { for (const k of ['pos.brown.apiUrl', 'pos.brown.username', 'pos.brown.groupIds', 'pos.brown.devKid']) localStorage.removeItem(k); } catch { /* private window */ }
const syncDlg = ref(false);
const syncing = ref(false);
const syncStore = ref<Store | null>(null);
const syncResult = ref<SyncResult | null>(null);
const syncError = ref('');
const sync = reactive({ mode: 'api' as 'api' | 'paste', brownStoreId: '', apiUrl: '', username: '', groupIds: '', devKid: '', accessToken: '', dataEncryption: '', pasted: '' });
const defaultUrl = ref('');
/** The flat API_V16 bodies need the BROWN username; the Client_API ones do not */
const isAppApi = computed(() => /_menu_listing/i.test(sync.apiUrl) && !/client_api/i.test(sync.apiUrl));
/** "Sync all stores": every active store with a BROWN store id, in the background */
const syncAll = ref(false);
const allJob = ref<SyncAllJob | null>(null);
let allTimer: ReturnType<typeof setInterval> | undefined;
const allOk = computed(() => allJob.value?.results.filter((r) => r.ok).length ?? 0);
const allFailed = computed(() => allJob.value?.results.filter((r) => !r.ok) ?? []);
function openSyncAll() {
  syncAll.value = true;
  syncStore.value = null;
  Object.assign(sync, { mode: 'api', dataEncryption: '', pasted: '' });
  syncResult.value = null;
  syncError.value = '';
  syncDlg.value = true;
  if (!defaultUrl.value) api.get<{ menuUrl: string }>('/stores/brown-sync/settings').then((r) => (defaultUrl.value = r.menuUrl)).catch(() => {});
}
function followAll(job: SyncAllJob) {
  allJob.value = job;
  clearInterval(allTimer);
  if (!job.running) return;
  allTimer = setInterval(async () => {
    try {
      const j = await api.get<SyncAllJob>(`/stores/brown-sync-all/${job.id}`);
      allJob.value = j;
      if (!j.running) {
        clearInterval(allTimer);
        notify.success('All stores synced', `${j.results.filter((r) => r.ok).length} of ${j.total} stores`);
        load();
      }
    } catch (e: any) {
      clearInterval(allTimer);
      syncError.value = e?.message ?? String(e);
    }
  }, 1000);
}
onBeforeUnmount(() => clearInterval(allTimer));
const syncModes = [{ label: 'From the BROWN API', value: 'api' }, { label: 'Paste a response', value: 'paste' }];
function openSync(s: Store) {
  syncAll.value = false;
  syncStore.value = s;
  sync.mode = 'api';
  Object.assign(sync, { brownStoreId: s.externalId ?? '', accessToken: sync.accessToken, dataEncryption: '', pasted: '' });
  syncResult.value = null;
  syncError.value = '';
  syncDlg.value = true;
  if (!defaultUrl.value) api.get<{ menuUrl: string }>('/stores/brown-sync/settings').then((r) => (defaultUrl.value = r.menuUrl)).catch(() => {});
}
async function runSync() {
  if (!syncStore.value && !syncAll.value) return;
  syncError.value = '';
  syncResult.value = null;
  if (syncAll.value) {
    syncing.value = true;
    try {
      followAll(await api.post<SyncAllJob>('/stores/brown-sync-all', {
        apiUrl: sync.apiUrl.trim() || undefined, username: isAppApi.value ? sync.username.trim() : undefined, groupIds: sync.groupIds.trim() || undefined,
        devKid: sync.devKid.trim(), accessToken: sync.accessToken.trim(), dataEncryption: sync.dataEncryption.trim() || undefined,
      }));
    } catch (e: any) {
      syncError.value = e?.message ?? String(e);
    } finally { syncing.value = false; }
    return;
  }
  let body: Record<string, unknown> = { brownStoreId: sync.brownStoreId.trim() || undefined };
  if (sync.mode === 'paste') {
    try { body.response = JSON.parse(sync.pasted); } catch { syncError.value = 'That is not the whole response: it must start with { and end with } (copy it again from Postman).'; return; }
  } else {
    body = { ...body, apiUrl: sync.apiUrl.trim() || undefined, username: isAppApi.value ? sync.username.trim() : undefined, groupIds: sync.groupIds.trim() || undefined, devKid: sync.devKid.trim(), accessToken: sync.accessToken.trim(), dataEncryption: sync.dataEncryption.trim() || undefined };
  }
  syncing.value = true;
  try {
    syncResult.value = await api.post<SyncResult>(`/stores/${syncStore.value!.id}/brown-sync`, body);
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
      <div><h1>Stores</h1><div class="sub"><b>{{ counts.active }}</b> active stores<template v-if="counts.inactive"> · {{ counts.inactive }} inactive</template> · <b>{{ counts.active - counts.unlinked }}</b> linked to BROWN</div></div>
      <div class="actions">
        <Button :label="allJob?.running ? `Syncing ${allJob.done} of ${allJob.total}…` : 'Sync all stores'" icon="pi pi-sync" outlined :loading="allJob?.running" @click="openSyncAll" />
        <Button label="New store" icon="pi pi-plus" @click="open()" />
      </div>
    </div>
    <div class="toolbar st-tools">
      <IconField><InputIcon class="pi pi-search" /><InputText v-model="q" placeholder="Code, name, address, BROWN id" /></IconField>
      <SelectButton v-model="show" :options="[{ l: `Active ${counts.active}`, v: 'active' }, { l: `Not linked ${counts.unlinked}`, v: 'unlinked' }, { l: `Inactive ${counts.inactive}`, v: 'inactive' }, { l: `All ${counts.all}`, v: 'all' }]" option-label="l" option-value="v" :allow-empty="false" />
    </div>
    <div v-if="loading && !rows.length" class="muted">Loading…</div>
    <div v-else-if="!shown.length" class="card muted">No store matches.</div>
    <div class="st-grid">
      <article v-for="r in shown" :key="r.id" class="st-card" :class="{ off: !r.isActive }" :style="{ '--c': nameColor(r.code) }" tabindex="0" @click="open(r)" @keydown.enter.self="open(r)">
        <header>
          <span class="code">{{ r.code }}</span>
          <div class="t">
            <h3>{{ r.name }}</h3>
            <div class="small muted ell"><i class="pi pi-map-marker" /> {{ r.address || 'No address' }}</div>
          </div>
          <Tag v-if="!r.isActive" value="inactive" severity="secondary" />
        </header>
        <div class="feats">
          <span class="f"><i class="pi pi-percentage" /> Tax {{ taxText(r) }}</span>
          <span class="f">{{ r.currency }}</span>
          <span v-if="(r as any).khrRate" class="f">៛ {{ Number((r as any).khrRate).toLocaleString() }}</span>
          <span v-if="(r as any).khqrAccountId" class="f on"><i class="pi pi-qrcode" /> KHQR</span>
          <span v-if="(r as any).hasKitchen" class="f on"><i class="pi pi-th-large" /> Café</span>
          <a v-if="(r as any).onlineOrdering" class="f on" :href="`/order/${r.code}`" target="_blank" @click.stop><i class="pi pi-globe" /> Online</a>
          <span v-if="r.phone" class="f"><i class="pi pi-phone" /> {{ r.phone }}</span>
        </div>
        <footer>
          <span v-if="r.externalId" class="brown ok" v-tooltip.top="`BROWN store id ${r.externalId}`"><i class="pi pi-link" /> BROWN <span class="mono">…{{ r.externalId.slice(-6) }}</span></span>
          <span v-else class="brown"><i class="pi pi-exclamation-circle" /> Not linked to BROWN</span>
          <Button label="Sync" icon="pi pi-sync" size="small" outlined @click.stop="openSync(r)" />
        </footer>
      </article>
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
        <h3 style="margin: 8px 0 0">Printing after each sale</h3>
        <label class="row"><ToggleSwitch v-model="form.printAuto" /> Print automatically after payment (no Print button)</label>
        <div class="row" style="flex-wrap: wrap; gap: 6px 18px">
          <label class="row"><Checkbox v-model="form.printCustomer" binary /> Customer receipt</label>
          <label class="row"><Checkbox v-model="form.printCashierCopy" binary /> Cashier copy</label>
          <label class="row"><Checkbox v-model="form.printKitchen" binary /> Kitchen ticket (no prices)</label>
        </div>
        <span class="hint">Each till chooses its receipt and kitchen printers on the POS (Printers). Without QZ Tray on the till, slips use the browser's printing.</span>
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

    <Dialog v-model:visible="syncDlg" :header="syncAll ? 'Sync BROWN menu · all stores' : `Sync BROWN menu · ${syncStore?.code ?? ''}`" modal :style="{ width: '560px' }" :breakpoints="{ '720px': '95vw' }">
      <form class="form" @submit.prevent="runSync">
        <div v-if="syncAll" class="small muted">Every active store with a BROWN store id ({{ rows.filter((r) => r.isActive && r.externalId).length }} stores), one after the other. Items with the same SKU are updated, new items are created, and each store gets its own prices, sizes and options. A store that fails does not stop the others.</div>
        <div v-else class="small muted">{{ syncStore?.name }}: items with the same SKU are updated (name, picture, category), new items are created, and every item is sold in this store at the BROWN price, with its sizes and options.</div>
        <SelectButton v-if="!syncAll" v-model="sync.mode" :options="syncModes" option-label="label" option-value="value" :allow-empty="false" />
        <div v-if="!syncAll" class="field"><label>BROWN store id {{ sync.mode === 'api' ? '*' : '' }}</label><InputText v-model="sync.brownStoreId" :required="sync.mode === 'api'" maxlength="50" placeholder="e.g. 820161780837506397" /><span class="hint">Saved on the store for next time</span></div>
        <template v-if="sync.mode === 'api'">
          <div class="field">
            <label>API URL <span class="hint">(optional)</span></label>
            <InputText v-model="sync.apiUrl" type="url" autocomplete="off" class="mono small" :placeholder="defaultUrl ? `Default: ${defaultUrl}` : 'Leave empty for the default address'" />
            <span class="hint">Leave empty for the default. The POS server calls this address, so the server must be able to reach it. Not saved: type it each time.</span>
          </div>
          <div class="field">
            <label>BROWN group ids <span class="hint">(optional)</span></label>
            <InputText v-model="sync.groupIds" autocomplete="off" class="mono small" placeholder="Empty = all groups" />
            <span class="hint">Sent as group_id. To sync only some groups, list their ids with commas, e.g. 420160070859702031 (Beverages). Not saved: type it each time.</span>
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
          {{ syncResult.storePrices }} with this store's own price<template v-if="syncResult.optionsUpdated != null">, {{ syncResult.optionsUpdated }} with new sizes or options</template>.
        </Message>
        <div v-if="syncAll && allJob" class="all-progress">
          <div class="row" style="justify-content: space-between">
            <b>{{ allJob.running ? `Syncing ${allJob.done} of ${allJob.total} stores…` : `Done: ${allOk} of ${allJob.total} stores synced` }}</b>
            <span v-if="allFailed.length" class="bad">{{ allFailed.length }} failed</span>
          </div>
          <div class="bar"><span :style="{ width: `${allJob.total ? (allJob.done / allJob.total) * 100 : 0}%` }" /></div>
          <Message v-if="allJob.stopped" severity="warn" :closable="false">{{ allJob.stopped }}</Message>
          <div class="all-list">
            <div v-for="r in [...allJob.results].reverse()" :key="r.store" class="all-row" :class="{ bad: !r.ok }">
              <i :class="r.ok ? 'pi pi-check' : 'pi pi-times'" />
              <b class="mono">{{ r.store }}</b>
              <span v-if="r.ok" class="muted">{{ r.items }} items · {{ r.productsCreated }} new · {{ r.productsUpdated }} updated · {{ r.optionsUpdated }} with new sizes/options</span>
              <span v-else>{{ r.error }}</span>
            </div>
          </div>
        </div>
        <div class="row" style="justify-content: flex-end">
          <Button label="Close" text @click="syncDlg = false" />
          <Button type="submit" :label="syncAll ? 'Sync all stores' : 'Sync'" icon="pi pi-sync" :loading="syncing || !!(syncAll && allJob?.running)" />
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
.all-progress { display: grid; gap: 8px; }
.all-progress .bar { height: 8px; border-radius: 99px; background: var(--border); overflow: hidden; }
.all-progress .bar span { display: block; height: 100%; background: var(--p-primary-color); transition: width .3s; }
.all-progress .bad { color: var(--bad); }
.all-list { max-height: 240px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
.all-row { display: grid; grid-template-columns: 18px 56px minmax(0, 1fr); gap: 8px; align-items: baseline; padding: 6px 10px; font-size: 13px; border-top: 1px solid var(--border); }
.all-row:first-child { border-top: 0; }
.all-row .pi-check { color: var(--good, #16a34a); }
.all-row.bad .pi-times, .all-row.bad span { color: var(--bad); }
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

<style scoped>
.st-tools { margin-bottom: 14px; }
.st-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; align-items: start; }
.st-card { position: relative; display: flex; flex-direction: column; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 16px; cursor: pointer; overflow: hidden; transition: transform .15s ease, box-shadow .15s ease, border-color .15s; }
.st-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--c); }
.st-card:hover, .st-card:focus-visible { transform: translateY(-2px); box-shadow: 0 6px 22px rgba(15, 23, 42, .12); border-color: color-mix(in srgb, var(--c) 40%, var(--border)); outline: none; }
.st-card.off { opacity: .6; }
.st-card header { display: flex; align-items: center; gap: 12px; }
.code { flex-shrink: 0; min-width: 52px; height: 44px; padding: 0 8px; border-radius: 12px; display: grid; place-items: center; font-weight: 800; font-size: .9rem; letter-spacing: .02em; color: #fff; background: var(--c); }
.t { min-width: 0; flex: 1; }
.t h3 { margin: 0 0 2px; font-size: 1rem; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.feats { display: flex; flex-wrap: wrap; gap: 6px; }
.f { display: inline-flex; align-items: center; gap: 5px; font-size: .78rem; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--bg); color: var(--text-2); text-decoration: none; }
.f .pi { font-size: .75rem; }
.f.on { background: color-mix(in srgb, var(--c) 13%, transparent); color: var(--c); }
.st-card footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border); }
.brown { display: inline-flex; align-items: center; gap: 6px; font-size: .82rem; font-weight: 600; color: var(--warn); }
.brown.ok { color: var(--good); }
@media (prefers-reduced-motion: reduce) { .st-card, .st-card:hover { transition: none; transform: none; } }
</style>
