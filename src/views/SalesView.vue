<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api/client';
import { PAYMENT_METHODS } from '@/api/types';
import DateRange from '@/components/DateRange.vue';
import ManagerApproval from '@/components/ManagerApproval.vue';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { dateTime, humanize, money, qty } from '@/utils/format';
import { optionsText } from '@/utils/modifiers';

const app = useApp();
const auth = useAuth();
const route = useRoute();
const notify = useNotify();
const list = usePagedList('/sales', {
  storeId: app.currentStoreId, search: (route.query.receipt as string) ?? '', status: null, from: null, to: null,
  ...(auth.role === 'CASHIER' && { cashierId: auth.user?.id }),
});
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: any) => money(v, cur.value);
const statusSeverity: Record<string, string> = { COMPLETED: 'success', PARTIALLY_REFUNDED: 'warn', REFUNDED: 'danger', VOIDED: 'secondary' };
const statuses = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED'].map((v) => ({ v, l: humanize(v) }));

// ── Receipt
const sale = ref<any>(null);
const showSale = ref(false);
async function open(idOrReceipt: string) {
  try {
    sale.value = await api.get(`/sales/${encodeURIComponent(idOrReceipt)}`);
    showSale.value = true;
  } catch (e) { notify.error(e); }
}
const canRefund = computed(() => sale.value && !['REFUNDED', 'VOIDED'].includes(sale.value.status));
const saleStore = computed(() => app.stores.find((s) => s.id === sale.value?.storeId) as any);
/** Cashiers need a manager PIN when the store says so */
const pinFor = (what: 'refund' | 'void') => auth.role === 'CASHIER' && (what === 'refund' ? saleStore.value?.refundNeedsApproval : saleStore.value?.voidNeedsApproval) !== false;
const today = (d: string) => new Date(d).toDateString() === new Date().toDateString();
const canVoid = computed(() => sale.value && sale.value.status === 'COMPLETED' && !sale.value.refunds?.length && today(sale.value.createdAt)
  && new Set(sale.value.payments.map((x: any) => x.method)).size <= 1);

// ── Manager approval (cashiers)
const apprDlg = ref(false);
const appr = reactive({ action: 'REFUND' as 'REFUND' | 'VOID', message: '', then: (_id: string) => {} });
function withApproval(action: 'REFUND' | 'VOID', message: string, run: (approvalId?: string) => void) {
  if (!pinFor(action === 'REFUND' ? 'refund' : 'void')) return run();
  Object.assign(appr, { action, message, then: run });
  apprDlg.value = true;
}

// ── Void
const voidDlg = ref(false);
const voiding = ref(false);
const voidForm = reactive({ reason: '', restock: true });
function openVoid() {
  Object.assign(voidForm, { reason: '', restock: true });
  voidDlg.value = true;
}
function doVoid() {
  if (voidForm.reason.trim().length < 3) return notify.error('Say why the sale is voided');
  withApproval('VOID', `Void ${sale.value.receiptNo} (${m(sale.value.amountDue)}): ${voidForm.reason}`, async (approvalId) => {
    voiding.value = true;
    try {
      await api.post(`/sales/${sale.value.id}/void`, { reason: voidForm.reason.trim(), restock: voidForm.restock, approvalId });
      notify.success('Sale voided', `${sale.value.receiptNo}: give back ${m(sale.value.amountDue)} by ${humanize(sale.value.payments[0]?.method ?? 'CASH')}`);
      voidDlg.value = false;
      await open(sale.value.id);
      list.load();
    } catch (e) { notify.error(e); } finally { voiding.value = false; }
  });
}

function printReceipt() {
  document.body.classList.add('printing-receipt');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-receipt'), 500);
}

// ── Refund
const refundDlg = ref(false);
const refunding = ref(false);
const refund = reactive({ method: 'CASH', restock: true, reason: '', lines: [] as { id: string; name: string; max: number; unit: number; quantity: number }[] });
function openRefund() {
  refund.method = 'CASH';
  refund.restock = true;
  refund.reason = '';
  refund.lines = sale.value.items
    .map((i: any) => ({ id: i.id, name: i.name, max: Number(i.quantity) - Number(i.refundedQty), unit: Number(i.lineTotal) / Number(i.quantity), quantity: 0 }))
    .filter((l: any) => l.max > 0);
  refundDlg.value = true;
}
const refundAll = () => refund.lines.forEach((l) => (l.quantity = l.max));
const refundEstimate = computed(() => refund.lines.reduce((s, l) => s + l.unit * l.quantity, 0));
function doRefund() {
  const items = refund.lines.filter((l) => l.quantity > 0).map((l) => ({ saleItemId: l.id, quantity: l.quantity }));
  if (!items.length) return notify.error('Choose at least one item to refund');
  withApproval('REFUND', `Refund about ${m(refundEstimate.value)} on ${sale.value.receiptNo}${refund.reason ? `: ${refund.reason}` : ''}`, async (approvalId) => {
    refunding.value = true;
    try {
      const r = await api.post(`/sales/${sale.value.id}/refunds`, { items, method: refund.method, restock: refund.restock, reason: refund.reason || undefined, approvalId });
      notify.success('Refund done', `${r.refundNo}: give back ${m(r.amount)}`);
      refundDlg.value = false;
      await open(sale.value.id);
      list.load();
    } catch (e) { notify.error(e); } finally { refunding.value = false; }
  });
}

onMounted(() => {
  list.load();
  if (route.query.receipt) open(route.query.receipt as string);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Sales</h1><div class="sub">Receipts in {{ app.currentStore?.name }}</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Receipt number" /></IconField>
        <Select v-model="list.filters.status" :options="statuses" option-label="l" option-value="v" placeholder="All statuses" show-clear />
        <DateRange v-model:from="list.filters.from" v-model:to="list.filters.to" />
      </div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :rows-per-page-options="[25, 50, 100]" :loading="list.loading.value" size="small" @page="list.onPage" @row-click="open($event.data.id)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No sales found</span></template>
        <Column header="Receipt"><template #body="{ data }"><span class="mono">{{ data.receiptNo }}</span></template></Column>
        <Column header="Time"><template #body="{ data }">{{ dateTime(data.createdAt) }}</template></Column>
        <Column header="Cashier"><template #body="{ data }">{{ data.cashier?.fullName ?? data.channel }}</template></Column>
        <Column header="Customer"><template #body="{ data }">{{ data.customer?.name ?? '—' }}</template></Column>
        <Column header="Items" class="right"><template #body="{ data }">{{ data._count.items }}</template></Column>
        <Column header="Total" class="right"><template #body="{ data }"><b class="num">{{ m(data.total) }}</b></template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="humanize(data.status)" :severity="statusSeverity[data.status]" /></template></Column>
      </DataTable>
    </div>

    <Drawer v-model:visible="showSale" position="right" :header="sale?.receiptNo" style="width: min(480px, 100vw)">
      <div v-if="sale" class="receipt">
        <div class="r-head">
          <b>{{ sale.store.name }}</b>
          <div class="small muted">{{ sale.store.address }}<br />{{ sale.store.phone }}</div>
          <div v-if="sale.queueNo" class="small mt"><b>Order {{ sale.queueNo }}</b> · {{ sale.orderType === 'DINE_IN' ? 'Dine-in' + (sale.tableNo ? ' table ' + sale.tableNo : '') : humanize(sale.orderType) }} · {{ humanize(sale.kitchenStatus) }}</div>
          <div class="small mt">Receipt <span class="mono">{{ sale.receiptNo }}</span> · {{ dateTime(sale.createdAt) }}</div>
          <div class="small">Cashier: {{ sale.cashier?.fullName ?? sale.channel }}</div>
          <div class="small" v-if="sale.customer">Member: {{ sale.customer.name }} ({{ sale.customer.code }})</div>
          <Tag class="mt no-print" :value="humanize(sale.status)" :severity="statusSeverity[sale.status]" />
        </div>
        <table class="r-items">
          <tr v-for="i in sale.items" :key="i.id">
            <td>
              {{ i.name }}
              <div class="small muted">{{ qty(i.quantity) }} × {{ m(i.unitPrice) }}<span v-if="Number(i.discount)"> · disc −{{ m(i.discount) }}</span><span v-if="Number(i.refundedQty)" class="neg"> · refunded {{ qty(i.refundedQty) }}</span></div>
              <div v-if="i.modifiers?.length" class="small muted">{{ optionsText(i.modifiers, true) }}<span v-if="i.note"> · “{{ i.note }}”</span></div>
              <div v-if="i.promotion" class="small" style="color: var(--p-primary-color)"><i class="pi pi-tag" /> {{ i.promotion.name }} −{{ m(i.promoDiscount) }}</div>
            </td>
            <td class="right num">{{ m(i.lineTotal) }}</td>
          </tr>
        </table>
        <table class="r-totals">
          <tr><td>Subtotal</td><td class="right num">{{ m(sale.subtotal) }}</td></tr>
          <tr v-if="Number(sale.discountTotal)"><td>Discount<div v-if="sale.couponName" class="small muted">incl. coupon {{ sale.couponName }} −{{ m(sale.couponDiscount) }}</div></td><td class="right num">−{{ m(sale.discountTotal) }}</td></tr>
          <tr><td>Tax</td><td class="right num">{{ m(sale.taxTotal) }}</td></tr>
          <tr class="big"><td>Total</td><td class="right num">{{ m(sale.total) }}</td></tr>
          <tr v-if="sale.pointsRedeemed"><td>Points used ({{ sale.pointsRedeemed }})</td><td class="right num">−{{ m(sale.pointsDiscount) }}</td></tr>
          <tr v-for="p in sale.payments" :key="p.id"><td>Paid · {{ humanize(p.method) }} <span class="mono small muted">{{ p.reference }}</span></td><td class="right num">{{ m(p.amount) }}</td></tr>
          <tr v-if="Number(sale.changeDue)"><td>Change</td><td class="right num">{{ m(sale.changeDue) }}</td></tr>
          <tr v-if="sale.pointsEarned"><td>Points earned</td><td class="right num">+{{ sale.pointsEarned }}</td></tr>
        </table>
        <div v-if="sale.refunds.length" class="mt">
          <b>Refunds</b>
          <div v-for="r in sale.refunds" :key="r.id" class="small row" style="justify-content: space-between">
            <span><span class="mono">{{ r.refundNo }}</span> · {{ dateTime(r.createdAt) }} · {{ humanize(r.method) }}<span v-if="r.reason" class="muted"> · {{ r.reason }}</span></span>
            <span class="neg num">−{{ m(r.amount) }}</span>
          </div>
        </div>
        <div class="row mt no-print" style="justify-content: flex-end">
          <Button label="Print" icon="pi pi-print" severity="secondary" text @click="printReceipt" />
          <Button v-if="canVoid" label="Void" icon="pi pi-ban" severity="danger" text @click="openVoid" />
          <Button v-if="canRefund" label="Refund" icon="pi pi-replay" severity="danger" outlined @click="openRefund" />
        </div>
      </div>
    </Drawer>

    <ManagerApproval v-model:visible="apprDlg" :store-id="sale?.storeId ?? null" :action="appr.action" :sale-id="sale?.id" :message="appr.message" @approved="(a) => appr.then(a.approvalId)" />

    <Dialog v-model:visible="voidDlg" header="Void the whole sale" modal :style="{ width: '440px' }" :breakpoints="{ '480px': '95vw' }">
      <form class="form" @submit.prevent="doVoid">
        <p v-if="sale" style="margin: 0">Cancels <b class="mono">{{ sale.receiptNo }}</b> and gives back <b>{{ m(sale.amountDue) }}</b> by {{ humanize(sale.payments[0]?.method ?? 'CASH') }}. Points, coupons and wallet are put back too.</p>
        <div class="field"><label>Reason *</label><InputText v-model="voidForm.reason" maxlength="200" placeholder="Wrong order, customer changed mind…" autofocus /></div>
        <label class="row"><ToggleSwitch v-model="voidForm.restock" /> Put items back into stock</label>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" severity="secondary" text @click="voidDlg = false" />
          <Button type="submit" label="Void sale" icon="pi pi-ban" severity="danger" :loading="voiding" />
        </div>
      </form>
    </Dialog>

    <Dialog v-model:visible="refundDlg" header="Refund items" modal :style="{ width: '600px' }" :breakpoints="{ '720px': '95vw' }">
      <div class="form">
        <DataTable :value="refund.lines" size="small">
          <Column field="name" header="Item" />
          <Column header="Can refund" class="right"><template #body="{ data }">{{ qty(data.max) }}</template></Column>
          <Column header="Refund qty" style="width: 150px"><template #body="{ data }"><InputNumber v-model="data.quantity" :min="0" :max="data.max" :max-fraction-digits="3" show-buttons fluid size="small" /></template></Column>
        </DataTable>
        <Button label="Refund everything" size="small" text @click="refundAll" style="justify-self: start" />
        <div class="form-2">
          <div class="field"><label>Give money back by</label><Select v-model="refund.method" :options="[...PAYMENT_METHODS]" :option-label="(o: string) => humanize(o)" /></div>
          <div class="field"><label>Reason</label><InputText v-model="refund.reason" placeholder="Damaged, wrong item…" /></div>
        </div>
        <label class="row"><ToggleSwitch v-model="refund.restock" /> Put items back into stock</label>
        <Message severity="secondary" :closable="false">
          Items value about {{ m(refundEstimate) }}. If points were used, the money back is a little less and the points are returned.
        </Message>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" severity="secondary" text @click="refundDlg = false" />
          <Button label="Refund" icon="pi pi-replay" severity="danger" :loading="refunding" @click="doRefund" />
        </div>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.receipt { display: grid; gap: 14px; }
.r-head { text-align: center; }
.r-items, .r-totals { width: 100%; border-collapse: collapse; }
.r-items td { padding: 6px 0; border-bottom: 1px dashed var(--border); vertical-align: top; }
.r-totals td { padding: 3px 0; }
.r-totals .big td { font-size: 17px; font-weight: 700; border-top: 1px solid var(--border); padding-top: 8px; }
</style>
