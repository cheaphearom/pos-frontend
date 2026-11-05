<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { downloadCsv } from '@/utils/csv';
import { cardNo, dateTime, humanize, money } from '@/utils/format';
import { uuid } from '@/pos/uuid';

const app = useApp();
const auth = useAuth();
const notify = useNotify();
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: any) => money(v, cur.value);
const list = usePagedList('/wallet/cards', { search: '', status: null });
list.load();
const statuses = ['INACTIVE', 'ACTIVE', 'BLOCKED', 'CLOSED'].map((v) => ({ v, l: humanize(v) }));
const sev: Record<string, string> = { INACTIVE: 'secondary', ACTIVE: 'success', BLOCKED: 'danger', CLOSED: 'contrast' };

// ── Generate cards
const genDlg = ref(false);
const genCount = ref(50);
const genBusy = ref(false);
async function generate() {
  genBusy.value = true;
  try {
    const r = await api.post('/wallet/cards', { count: genCount.value });
    downloadCsv(`wallet-cards-${new Date().toISOString().slice(0, 10)}.csv`, [{ key: 'cardNumber', label: 'Card number' }, { key: 'serialNumber', label: 'Serial number' }], r.cards);
    notify.success(`${r.created} cards created`, 'The CSV for the card printer was downloaded');
    genDlg.value = false;
    list.load();
  } catch (e) { notify.error(e); } finally { genBusy.value = false; }
}

// ── Detail
const card = ref<any>(null);
const txs = ref<any[]>([]);
const show = ref(false);
async function open(id: string) {
  try {
    [card.value, txs.value] = await Promise.all([api.get(`/wallet/cards/${id}`), api.get(`/wallet/cards/${id}/transactions`, { limit: 50 }).then((r) => r.data)]);
    show.value = true;
  } catch (e) { notify.error(e); }
}
const reload = () => { list.load(); return open(card.value.id); };

// ── Actions
const dlg = ref<'' | 'activate' | 'topup' | 'adjust' | 'pin' | 'replace'>('');
const busy = ref(false);
const f = reactive({ serial: '', mode: 'new' as 'new' | 'existing', customer: null as any, name: '', phone: '', pin: '', amount: 10, method: 'CASH', reference: '', reason: '', newNumber: '', newSerial: '' });
const custResults = ref<any[]>([]);
async function searchCustomers(e: { query: string }) {
  custResults.value = (await api.get('/customers', { search: e.query, limit: 10 })).data;
}
function start(kind: typeof dlg.value) {
  Object.assign(f, { serial: '', mode: 'new', customer: null, name: '', phone: '', pin: '', amount: 10, method: 'CASH', reference: '', reason: '', newNumber: '', newSerial: '' });
  dlg.value = kind;
}
async function run(fn: () => Promise<any>, msg: string) {
  busy.value = true;
  try {
    await fn();
    notify.success(msg);
    dlg.value = '';
    await reload();
  } catch (e) { notify.error(e); } finally { busy.value = false; }
}
const id = () => card.value.id;
const doActivate = () => run(() => api.post(`/wallet/cards/${id()}/activate`, {
  serialNumber: f.serial, pin: f.pin || undefined,
  ...(f.mode === 'existing' ? { customerId: f.customer?.id } : { name: f.name, phone: f.phone || undefined }),
}), 'Card activated');
const doTopup = () => run(() => api.post(`/wallet/cards/${id()}/topup`, { storeId: app.currentStoreId, amount: f.amount, method: f.method, reference: f.reference || undefined, clientRef: uuid() }), `Topped up ${m(f.amount)}`);
const doAdjust = () => run(() => api.post(`/wallet/cards/${id()}/adjust`, { amount: f.amount, reason: f.reason }), 'Balance adjusted');
const doPin = () => run(() => api.post(`/wallet/cards/${id()}/pin`, { pin: f.pin }), f.pin ? 'PIN saved' : 'PIN removed');
const doReplace = () => run(async () => {
  const fresh = await api.post(`/wallet/cards/${id()}/replace`, { newCardNumber: f.newNumber.replace(/\s/g, ''), newSerialNumber: f.newSerial });
  card.value = fresh;
}, 'Balance moved to the new card');
const setStatus = (action: 'block' | 'unblock') => run(() => api.post(`/wallet/cards/${id()}/${action}`, {}), action === 'block' ? 'Card blocked' : 'Card unblocked');
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Wallet cards</h1><div class="sub">Store-value cards: customers top up money and pay with the card</div></div>
      <div class="actions"><Button v-if="auth.isAdmin" label="Generate cards" icon="pi pi-plus" @click="genDlg = true" /></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Card number, serial, name, phone" style="width: 300px" /></IconField>
        <Select v-model="list.filters.status" :options="statuses" option-label="l" option-value="v" placeholder="All statuses" show-clear />
      </div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :rows-per-page-options="[25, 50, 100]" :loading="list.loading.value" size="small" @page="list.onPage" @row-click="open($event.data.id)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No cards</span></template>
        <Column header="Card number"><template #body="{ data }"><span class="mono">{{ cardNo(data.cardNumber) }}</span></template></Column>
        <Column header="Serial"><template #body="{ data }"><span class="mono small">{{ data.serialNumber }}</span></template></Column>
        <Column header="Customer"><template #body="{ data }">{{ data.customer?.name ?? '—' }}<div v-if="data.customer" class="small muted">{{ data.customer.phone }}</div></template></Column>
        <Column header="Balance" class="right"><template #body="{ data }"><b class="num">{{ m(data.balance) }}</b></template></Column>
        <Column header="Points" class="right"><template #body="{ data }">{{ data.customer?.points ?? '' }}</template></Column>
        <Column header="PIN"><template #body="{ data }"><i :class="data.hasPin ? 'pi pi-lock' : 'pi pi-lock-open muted'" /></template></Column>
        <Column header="Last used"><template #body="{ data }">{{ dateTime(data.lastUsedAt) || '—' }}</template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="humanize(data.status)" :severity="sev[data.status]" /></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="genDlg" header="Generate wallet cards" modal :style="{ width: '420px' }">
      <div class="form">
        <div class="field"><label>How many cards?</label><InputNumber v-model="genCount" :min="1" :max="5000" show-buttons fluid /></div>
        <Message severity="info" :closable="false">You get a CSV with card numbers (print as barcode on the front) and serial numbers (print on the back). Cards stay unused until a cashier activates them.</Message>
        <Button label="Generate and download CSV" icon="pi pi-download" :loading="genBusy" @click="generate" />
      </div>
    </Dialog>

    <Drawer v-model:visible="show" position="right" header="Wallet card" style="width: min(600px, 100vw)">
      <template v-if="card">
        <div class="wcard" :class="card.status.toLowerCase()">
          <div class="row" style="justify-content: space-between"><b>{{ app.currentStore?.name }}</b><Tag :value="humanize(card.status)" :severity="sev[card.status]" /></div>
          <div class="wnum mono">{{ cardNo(card.cardNumber) }}</div>
          <div class="row" style="justify-content: space-between; align-items: flex-end">
            <div><div class="small">Balance</div><div class="wbal">{{ m(card.balance) }}</div></div>
            <div style="text-align: right"><div class="small">{{ card.customer?.name ?? 'Not assigned' }}</div><div v-if="card.customer" class="small">{{ card.customer.points }} points</div></div>
          </div>
        </div>
        <dl class="kv mt">
          <dt>Serial</dt><dd class="mono">{{ card.serialNumber }}</dd>
          <dt>PIN</dt><dd>{{ card.hasPin ? 'Yes' : 'No' }}<span v-if="card.pinFailures" class="neg"> · {{ card.pinFailures }} wrong tries</span></dd>
          <dt>Issued</dt><dd>{{ dateTime(card.issuedAt) }}</dd>
          <dt v-if="card.activatedAt">Activated</dt><dd v-if="card.activatedAt">{{ dateTime(card.activatedAt) }}</dd>
          <dt v-if="card.note">Note</dt><dd v-if="card.note">{{ card.note }}</dd>
        </dl>
        <div class="row mt" style="flex-wrap: wrap">
          <Button v-if="card.status === 'INACTIVE'" label="Activate" icon="pi pi-check" @click="start('activate')" />
          <Button v-if="card.status === 'ACTIVE'" label="Top up" icon="pi pi-plus-circle" @click="start('topup')" />
          <Button v-if="auth.isManager && ['ACTIVE', 'BLOCKED'].includes(card.status)" label="Adjust" icon="pi pi-sliders-h" severity="secondary" @click="start('adjust')" />
          <Button v-if="['ACTIVE', 'BLOCKED'].includes(card.status)" :label="card.hasPin ? 'Change PIN' : 'Set PIN'" icon="pi pi-lock" severity="secondary" @click="start('pin')" />
          <Button v-if="auth.isManager && card.status === 'ACTIVE'" label="Block" icon="pi pi-ban" severity="danger" outlined @click="setStatus('block')" />
          <Button v-if="auth.isManager && card.status === 'BLOCKED'" label="Unblock" icon="pi pi-unlock" severity="success" outlined @click="setStatus('unblock')" />
          <Button v-if="auth.isManager && ['ACTIVE', 'BLOCKED'].includes(card.status)" label="Replace (lost card)" icon="pi pi-refresh" severity="secondary" text @click="start('replace')" />
        </div>
        <h3 class="mt">History</h3>
        <DataTable :value="txs" size="small">
          <template #empty><span class="muted">No transactions yet</span></template>
          <Column header="Time"><template #body="{ data }">{{ dateTime(data.createdAt) }}</template></Column>
          <Column header="Type"><template #body="{ data }">{{ humanize(data.type) }}<span v-if="data.method" class="muted small"> · {{ humanize(data.method) }}</span><div class="small muted">{{ data.reference }} {{ data.note }}</div></template></Column>
          <Column header="Amount" class="right"><template #body="{ data }"><span class="num" :class="Number(data.amount) > 0 ? 'pos' : 'neg'">{{ Number(data.amount) > 0 ? '+' : '' }}{{ m(data.amount) }}</span></template></Column>
          <Column header="Balance" class="right"><template #body="{ data }"><span class="num">{{ m(data.balanceAfter) }}</span></template></Column>
        </DataTable>
      </template>
    </Drawer>

    <Dialog :visible="dlg === 'activate'" header="Activate card" modal :style="{ width: '480px' }" @update:visible="dlg = ''">
      <form class="form" @submit.prevent="doActivate">
        <div class="field"><label>Serial number on the back of the card *</label><InputText v-model="f.serial" required autofocus /></div>
        <SelectButton v-model="f.mode" :options="[{ l: 'New customer', v: 'new' }, { l: 'Existing customer', v: 'existing' }]" option-label="l" option-value="v" :allow-empty="false" />
        <template v-if="f.mode === 'new'">
          <div class="form-2">
            <div class="field"><label>Name *</label><InputText v-model="f.name" required /></div>
            <div class="field"><label>Phone</label><InputText v-model="f.phone" /></div>
          </div>
        </template>
        <div v-else class="field"><label>Customer *</label><AutoComplete v-model="f.customer" :suggestions="custResults" option-label="name" placeholder="Name or phone" fluid @complete="searchCustomers" /></div>
        <div class="field"><label>PIN (optional, 4-6 digits)</label><InputText v-model="f.pin" inputmode="numeric" maxlength="6" placeholder="Customer types it when paying" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Activate" :loading="busy" /></div>
      </form>
    </Dialog>

    <Dialog :visible="dlg === 'topup'" header="Top up" modal :style="{ width: '420px' }" @update:visible="dlg = ''">
      <form class="form" @submit.prevent="doTopup">
        <div class="field"><label>Amount</label><InputNumber v-model="f.amount" :min="0.01" :min-fraction-digits="2" fluid autofocus /></div>
        <div class="row" style="flex-wrap: wrap"><Button v-for="a in [5, 10, 20, 50, 100]" :key="a" :label="m(a)" size="small" severity="secondary" outlined @click="f.amount = a" /></div>
        <div class="field"><label>Paid by</label><SelectButton v-model="f.method" :options="['CASH', 'KHQR', 'CARD', 'BANK_TRANSFER']" :option-label="(o: string) => humanize(o)" :allow-empty="false" /></div>
        <div v-if="f.method !== 'CASH'" class="field"><label>Reference</label><InputText v-model="f.reference" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" :label="`Top up ${m(f.amount)}`" :loading="busy" /></div>
      </form>
    </Dialog>

    <Dialog :visible="dlg === 'adjust'" header="Adjust balance" modal :style="{ width: '400px' }" @update:visible="dlg = ''">
      <form class="form" @submit.prevent="doAdjust">
        <div class="field"><label>Amount (negative to remove)</label><InputNumber v-model="f.amount" :min-fraction-digits="2" fluid /></div>
        <div class="field"><label>Reason *</label><InputText v-model="f.reason" required /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" :loading="busy" /></div>
      </form>
    </Dialog>

    <Dialog :visible="dlg === 'pin'" header="Card PIN" modal :style="{ width: '380px' }" @update:visible="dlg = ''">
      <form class="form" @submit.prevent="doPin">
        <div class="field"><label>New PIN (4-6 digits; empty = no PIN)</label><InputText v-model="f.pin" inputmode="numeric" maxlength="6" autofocus /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" :loading="busy" /></div>
      </form>
    </Dialog>

    <Dialog :visible="dlg === 'replace'" header="Replace lost or damaged card" modal :style="{ width: '440px' }" @update:visible="dlg = ''">
      <form class="form" @submit.prevent="doReplace">
        <Message severity="warn" :closable="false">The customer, balance and PIN move to the new card. The old card is closed for good.</Message>
        <div class="field"><label>New card number *</label><InputText v-model="f.newNumber" required autofocus placeholder="Scan the new card" /></div>
        <div class="field"><label>New card serial *</label><InputText v-model="f.newSerial" required /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Move to new card" :loading="busy" /></div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.wcard { border-radius: 16px; padding: 18px 20px; color: #fff; background: linear-gradient(135deg, #1c5cab, #6250d6); display: grid; gap: 14px; box-shadow: 0 8px 24px rgba(0, 0, 0, .15); }
.wcard.blocked, .wcard.closed { background: linear-gradient(135deg, #5b5f66, #33363b); }
.wnum { font-size: 20px; letter-spacing: .06em; }
.wbal { font-size: 26px; font-weight: 750; }
</style>
