<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api/client';
import DateRange from '@/components/DateRange.vue';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { dateTime, humanize, money } from '@/utils/format';
import { formatKhr } from '@shared/cash';
import RegisterReport from '@/components/RegisterReport.vue';

const app = useApp();
const auth = useAuth();
const route = useRoute();
const notify = useNotify();
const list = usePagedList('/shifts', { storeId: app.currentStoreId, status: null, from: null, to: null });
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: any) => money(v, cur.value);
const mine = ref<any>(null);

async function loadMine() {
  mine.value = app.currentStoreId ? await api.get('/shifts/current', { storeId: app.currentStoreId }).catch(() => null) : null;
}

const openDlg = ref(false);
const openingCash = ref(0);
const openingKhr = ref(0);
/** Riel drawer when the store takes riel cash */
const khrOn = computed(() => !!(app.currentStore as any)?.khrRate);
async function openShift() {
  try {
    await api.post('/shifts/open', { storeId: app.currentStoreId, openingCash: openingCash.value, openingKhr: khrOn.value ? openingKhr.value || 0 : undefined });
    openDlg.value = false;
    notify.success('Shift opened');
    loadMine();
    list.load();
  } catch (e) { notify.error(e); }
}

const detail = ref<any>(null);
const showDetail = ref(false);
async function show(id: string) {
  try {
    detail.value = await api.get(`/shifts/${id}`);
    showDetail.value = true;
  } catch (e) { notify.error(e); }
}

const xDlg = ref(false);
const xReport = ref<any>(null);
async function openX() {
  try { xReport.value = await api.get(`/shifts/${detail.value.id}/x-report`); xDlg.value = true; } catch (e) { notify.error(e); }
}
function printX() {
  document.body.classList.add('printing-report');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-report'), 500);
}

const closeDlg = ref(false);
const close = reactive({ closingCash: 0, closingKhr: null as number | null, note: '' });
const closed = ref<any>(null);
function startClose() {
  close.closingCash = Number(detail.value.summary.expectedCash);
  close.closingKhr = khrOn.value || detail.value.openingKhr ? detail.value.summary.khr.expected : null;
  close.note = '';
  closed.value = null;
  closeDlg.value = true;
}
async function doClose() {
  try {
    closed.value = await api.post(`/shifts/${detail.value.id}/close`, { ...close, closingKhr: close.closingKhr ?? undefined });
    notify.success('Shift closed');
    loadMine();
    list.load();
    show(detail.value.id);
  } catch (e) { notify.error(e); }
}
const canClose = computed(() => detail.value?.status === 'OPEN' && (detail.value.userId === auth.user?.id || auth.isManager));

onMounted(() => {
  list.load();
  loadMine();
  if (route.query.open) show(route.query.open as string);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Shifts</h1><div class="sub">Cash drawer sessions in {{ app.currentStore?.name }}</div></div>
      <div class="actions">
        <Button v-if="mine" label="My open shift" icon="pi pi-clock" severity="secondary" @click="show(mine.id)" />
        <Button v-else label="Open shift" icon="pi pi-play" @click="openingCash = 0; openDlg = true" />
      </div>
    </div>
    <div class="card">
      <div class="toolbar">
        <Select v-model="list.filters.status" :options="['OPEN', 'CLOSED']" placeholder="All" show-clear />
        <DateRange v-model:from="list.filters.from" v-model:to="list.filters.to" />
      </div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :loading="list.loading.value" size="small" @page="list.onPage" @row-click="show($event.data.id)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No shifts</span></template>
        <Column header="Cashier"><template #body="{ data }">{{ data.user.fullName }}</template></Column>
        <Column header="Opened"><template #body="{ data }">{{ dateTime(data.openedAt) }}</template></Column>
        <Column header="Closed"><template #body="{ data }">{{ dateTime(data.closedAt) || '—' }}</template></Column>
        <Column header="Opening cash" class="right"><template #body="{ data }">{{ m(data.openingCash) }}</template></Column>
        <Column header="Expected" class="right"><template #body="{ data }">{{ data.expectedCash ? m(data.expectedCash) : '—' }}</template></Column>
        <Column header="Counted" class="right"><template #body="{ data }">{{ data.closingCash ? m(data.closingCash) : '—' }}</template></Column>
        <Column header="Difference" class="right">
          <template #body="{ data }">
            <span v-if="data.closingCash" class="num" :class="Number(data.closingCash) - Number(data.expectedCash) < 0 ? 'neg' : ''">{{ m(Number(data.closingCash) - Number(data.expectedCash)) }}</span>
          </template>
        </Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === 'OPEN' ? 'success' : 'secondary'" /></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="openDlg" header="Open shift" modal :style="{ width: '380px' }">
      <form class="form" @submit.prevent="openShift">
        <div class="field"><label>{{ khrOn ? 'Dollars in the drawer now' : 'Cash in the drawer now' }}</label><InputNumber v-model="openingCash" :min="0" :min-fraction-digits="2" fluid autofocus /></div>
        <div v-if="khrOn" class="field"><label>Riel in the drawer now</label><InputNumber v-model="openingKhr" :min="0" :step="100" prefix="៛" fluid /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Open shift" icon="pi pi-play" /></div>
      </form>
    </Dialog>

    <Drawer v-model:visible="showDetail" position="right" header="Shift summary" style="width: min(480px, 100vw)">
      <template v-if="detail">
        <dl class="kv">
          <dt>Cashier</dt><dd>{{ detail.user.fullName }}</dd>
          <dt>Store</dt><dd>{{ detail.store.name }}</dd>
          <dt>Opened</dt><dd>{{ dateTime(detail.openedAt) }}</dd>
          <dt>Closed</dt><dd>{{ dateTime(detail.closedAt) || 'still open' }}</dd>
          <dt>Sales</dt><dd>{{ detail.summary.salesCount }} · {{ m(detail.summary.salesTotal) }}</dd>
          <dt>Discounts</dt><dd>{{ m(detail.summary.discountTotal) }}</dd>
          <dt>Tax</dt><dd>{{ m(detail.summary.taxTotal) }}</dd>
        </dl>
        <h3 class="mt">Payments</h3>
        <dl class="kv">
          <template v-for="(v, k) in detail.summary.payments" :key="k"><dt>{{ humanize(String(k)) }}</dt><dd class="num">{{ m(v) }}</dd></template>
          <dt>Cash refunds</dt><dd class="num">−{{ m(detail.summary.cashRefunds) }}</dd>
          <template v-if="Number(detail.summary.cashIn?.usd)"><dt>Cash in</dt><dd class="num">+{{ m(detail.summary.cashIn.usd) }}</dd></template>
          <template v-if="Number(detail.summary.cashOut?.usd)"><dt>Cash out</dt><dd class="num">−{{ m(detail.summary.cashOut.usd) }}</dd></template>
          <template v-for="(v, k) in detail.summary.voucherSales ?? {}" :key="'v' + k"><dt>Vouchers sold · {{ humanize(String(k)) }}</dt><dd class="num">+{{ m(v) }}</dd></template>
          <template v-for="(v, k) in detail.summary.walletTopups ?? {}" :key="'t' + k"><dt>Wallet top-ups · {{ humanize(String(k)) }}</dt><dd class="num">+{{ m(v) }}</dd></template>
        </dl>
        <div class="card mt">
          <dl class="kv">
            <dt>Opening cash</dt><dd class="num">{{ m(detail.openingCash) }}</dd>
            <dt><b>Expected in drawer</b></dt><dd class="num"><b>{{ m(detail.summary.expectedCash) }}</b></dd>
            <template v-if="detail.closingCash">
              <dt>Counted</dt><dd class="num">{{ m(detail.closingCash) }}</dd>
              <dt>Difference</dt><dd class="num" :class="Number(detail.closingCash) - Number(detail.summary.expectedCash) < 0 ? 'neg' : 'pos'">{{ m(Number(detail.closingCash) - Number(detail.summary.expectedCash)) }}</dd>
            </template>
          </dl>
        </div>
        <div v-if="detail.summary.khr && (khrOn || detail.summary.khr.received || detail.openingKhr)" class="card mt" data-test="khr-drawer">
          <h3 style="margin-top: 0">Riel drawer</h3>
          <dl class="kv">
            <dt>Opening riel</dt><dd class="num">{{ formatKhr(detail.summary.khr.opening) }}</dd>
            <dt>Riel received ({{ detail.summary.khr.payments }})</dt><dd class="num">+{{ formatKhr(detail.summary.khr.received) }}</dd>
            <dt>Riel change given</dt><dd class="num">−{{ formatKhr(detail.summary.khr.change) }}</dd>
            <dt><b>Expected riel</b></dt><dd class="num"><b>{{ formatKhr(detail.summary.khr.expected) }}</b></dd>
            <template v-if="detail.closingKhr !== null && detail.closingKhr !== undefined">
              <dt>Counted</dt><dd class="num">{{ formatKhr(detail.closingKhr) }}</dd>
              <dt>Difference</dt><dd class="num" :class="detail.closingKhr - detail.summary.khr.expected < 0 ? 'neg' : 'pos'">{{ formatKhr(detail.closingKhr - detail.summary.khr.expected) }}</dd>
            </template>
          </dl>
        </div>
        <div class="row mt" style="justify-content: flex-end">
          <RouterLink :to="`/sales`"><Button label="Sales" text size="small" /></RouterLink>
          <Button label="X report" icon="pi pi-file" severity="secondary" outlined @click="openX" />
          <Button v-if="canClose" label="Close shift" icon="pi pi-stop" severity="danger" @click="startClose" />
        </div>
      </template>
    </Drawer>

    <Dialog v-model:visible="xDlg" :header="xReport?.shift?.closedAt ? 'Shift report' : 'X report'" modal :style="{ width: '440px' }" :breakpoints="{ '480px': '96vw' }">
      <RegisterReport v-if="xReport" :report="xReport" />
      <div class="row mt no-print" style="justify-content: flex-end"><Button label="Print" icon="pi pi-print" @click="printX" /></div>
    </Dialog>

    <Dialog v-model:visible="closeDlg" header="Close shift" modal :style="{ width: '400px' }">
      <form v-if="!closed" class="form" @submit.prevent="doClose">
        <div class="field"><label>{{ close.closingKhr !== null ? 'Dollars counted in the drawer' : 'Cash counted in the drawer' }}</label><InputNumber v-model="close.closingCash" :min="0" :min-fraction-digits="2" fluid /></div>
        <div v-if="close.closingKhr !== null" class="field"><label>Riel counted</label><InputNumber v-model="close.closingKhr" :min="0" :step="100" prefix="៛" fluid /></div>
        <div class="field"><label>Note</label><InputText v-model="close.note" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Close shift" severity="danger" /></div>
      </form>
      <div v-else class="form">
        <Message :severity="Number(closed.difference) === 0 ? 'success' : 'warn'" :closable="false">
          Expected {{ m(closed.expectedCash) }}, counted {{ m(closed.closingCash) }}.
          {{ Number(closed.difference) === 0 ? 'The drawer balances.' : `Difference: ${m(closed.difference)}` }}
        </Message>
        <Message v-if="closed.differenceKhr !== null && closed.differenceKhr !== undefined" :severity="closed.differenceKhr === 0 ? 'success' : 'warn'" :closable="false">
          Riel: expected {{ formatKhr(closed.expectedKhr) }}, counted {{ formatKhr(closed.closingKhr) }}.
          {{ closed.differenceKhr === 0 ? 'Balances.' : `Difference: ${formatKhr(closed.differenceKhr)}` }}
        </Message>
        <Button label="Done" @click="closeDlg = false" />
      </div>
    </Dialog>
  </div>
</template>
