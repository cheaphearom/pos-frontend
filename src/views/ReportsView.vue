<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import DateRange from '@/components/DateRange.vue';
import SimpleChart from '@/components/SimpleChart.vue';
import { useNotify } from '@/composables/useNotify';
import { useApp } from '@/stores/app';
import { downloadCsv } from '@/utils/csv';
import { businessDay, humanize, money, num } from '@/utils/format';

const app = useApp();
const notify = useNotify();
const f = reactive({ from: businessDay(29) as string | null, to: businessDay(0) as string | null, scope: 'store' as 'store' | 'all', groupBy: 'day' });
const loading = ref(false);
const r = reactive<Record<string, any>>({});
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: any) => money(v, cur.value);

const params = computed(() => ({ from: f.from ?? undefined, to: f.to ?? undefined, storeId: f.scope === 'store' ? app.currentStoreId ?? undefined : undefined }));

async function load() {
  loading.value = true;
  try {
    const p = params.value;
    const [summary, profit, top, payments, cashiers, loyalty, stock, promotions, wallet, cv, ingredients, production] = await Promise.all([
      api.get('/reports/sales-summary', { ...p, groupBy: f.groupBy }),
      api.get('/reports/profit', { ...p, groupBy: f.groupBy }),
      api.get('/reports/top-products', { ...p, limit: 20 }),
      api.get('/reports/payments', p),
      api.get('/reports/cashiers', p),
      api.get('/reports/loyalty', { ...p, limit: 10 }),
      api.get('/reports/inventory-value', { storeId: p.storeId }),
      api.get('/reports/promotions', p),
      api.get('/reports/wallet', p),
      api.get('/reports/coupons-vouchers', p),
      api.get('/reports/ingredient-usage', p),
      api.get('/production/report', p),
    ]);
    Object.assign(r, { summary, profit, top, payments, cashiers, loyalty, stock, promotions, wallet, cv, ingredients, production });
  } catch (e) {
    notify.error(e);
  } finally {
    loading.value = false;
  }
}

const keyLabel = (k: string) => (f.groupBy === 'store' ? k : f.groupBy === 'month' ? new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
const profitTotals = computed(() => {
  const rows = r.profit?.data ?? [];
  const revenue = rows.reduce((s: number, x: any) => s + x.revenue, 0);
  const cost = rows.reduce((s: number, x: any) => s + x.cost, 0);
  return { revenue, cost, profit: revenue - cost, margin: revenue ? ((revenue - cost) / revenue) * 100 : 0 };
});

function exportSummary() {
  downloadCsv(`sales-${f.from}-${f.to}.csv`, [
    { key: 'key', label: f.groupBy === 'store' ? 'Store' : 'Period' }, { key: 'salesCount', label: 'Sales' }, { key: 'subtotal', label: 'Subtotal' },
    { key: 'discount', label: 'Discount' }, { key: 'tax', label: 'Tax' }, { key: 'total', label: 'Total' }, { key: 'pointsDiscount', label: 'Paid with points' },
    { key: 'refunds', label: 'Refunds' }, { key: 'net', label: 'Net' },
  ], r.summary.data);
}
function exportTop() {
  downloadCsv(`top-products-${f.from}-${f.to}.csv`, [
    { key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'quantity', label: 'Quantity' }, { key: 'revenue', label: 'Revenue' }, { key: 'profit', label: 'Profit' },
  ], r.top.data);
}

onMounted(load);
watch(() => [f.from, f.to, f.scope, f.groupBy], load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Reports</h1><div class="sub">{{ f.scope === 'store' ? app.currentStore?.name : 'All my stores' }} · {{ f.from }} to {{ f.to }}</div></div>
    </div>
    <div class="card toolbar" style="position: sticky; top: 60px; z-index: 3">
      <DateRange v-model:from="f.from" v-model:to="f.to" />
      <SelectButton v-if="app.stores.length > 1" v-model="f.scope" :options="[{ l: 'This store', v: 'store' }, { l: 'All stores', v: 'all' }]" option-label="l" option-value="v" :allow-empty="false" />
      <Select v-model="f.groupBy" :options="[{ l: 'By day', v: 'day' }, { l: 'By week', v: 'week' }, { l: 'By month', v: 'month' }, { l: 'By store', v: 'store' }]" option-label="l" option-value="v" />
      <i v-if="loading" class="pi pi-spin pi-spinner muted" />
    </div>

    <template v-if="r.summary">
      <div class="grid grid-4 mt">
        <div class="card"><div class="muted">Net sales</div><div class="big num">{{ m(r.summary.totals.net) }}</div><div class="small muted">after refunds and points</div></div>
        <div class="card"><div class="muted">Transactions</div><div class="big num">{{ num(r.summary.totals.salesCount) }}</div><div class="small muted">avg {{ m(r.summary.totals.salesCount ? r.summary.totals.total / r.summary.totals.salesCount : 0) }}</div></div>
        <div class="card"><div class="muted">Gross profit</div><div class="big num">{{ m(profitTotals.profit) }}</div><div class="small muted">margin {{ profitTotals.margin.toFixed(1) }}%</div></div>
        <div class="card"><div class="muted">Refunds</div><div class="big num">{{ m(r.summary.totals.refunds) }}</div><div class="small muted">tax collected {{ m(r.summary.totals.tax) }}</div></div>
      </div>

      <div class="card mt">
        <div class="row" style="justify-content: space-between"><h3>Net sales {{ f.groupBy === 'store' ? 'by store' : 'by ' + f.groupBy }}</h3><Button label="CSV" icon="pi pi-download" size="small" text @click="exportSummary" /></div>
        <SimpleChart :type="f.groupBy === 'day' && r.summary.data.length > 20 ? 'line' : 'bar'" :labels="r.summary.data.map((x: any) => keyLabel(x.key))" :values="r.summary.data.map((x: any) => x.net)" :format="m" :height="280" />
        <DataTable :value="r.summary.data" size="small" class="mt" scrollable scroll-height="320px">
          <template #empty><span class="muted">No sales in this period</span></template>
          <Column header="Period"><template #body="{ data }">{{ keyLabel(data.key) }}</template></Column>
          <Column field="salesCount" header="Sales" class="right" />
          <Column header="Subtotal" class="right"><template #body="{ data }">{{ m(data.subtotal) }}</template></Column>
          <Column header="Discount" class="right"><template #body="{ data }">{{ m(data.discount) }}</template></Column>
          <Column header="Tax" class="right"><template #body="{ data }">{{ m(data.tax) }}</template></Column>
          <Column header="Total" class="right"><template #body="{ data }">{{ m(data.total) }}</template></Column>
          <Column header="Points" class="right"><template #body="{ data }">{{ m(data.pointsDiscount) }}</template></Column>
          <Column header="Refunds" class="right"><template #body="{ data }">{{ m(data.refunds) }}</template></Column>
          <Column header="Net" class="right"><template #body="{ data }"><b>{{ m(data.net) }}</b></template></Column>
        </DataTable>
      </div>

      <div class="grid grid-2 mt">
        <div class="card">
          <div class="row" style="justify-content: space-between"><h3>Top products</h3><Button label="CSV" icon="pi pi-download" size="small" text @click="exportTop" /></div>
          <DataTable :value="r.top.data" size="small" scrollable scroll-height="360px">
            <template #empty><span class="muted">No data</span></template>
            <Column header="#"><template #body="{ index }">{{ index + 1 }}</template></Column>
            <Column header="Product"><template #body="{ data }">{{ data.name }}<div class="small muted mono">{{ data.sku }}</div></template></Column>
            <Column header="Qty" class="right"><template #body="{ data }">{{ num(data.quantity, 3) }}</template></Column>
            <Column header="Revenue" class="right"><template #body="{ data }">{{ m(data.revenue) }}</template></Column>
            <Column header="Profit" class="right"><template #body="{ data }">{{ m(data.profit) }}</template></Column>
          </DataTable>
        </div>
        <div class="card">
          <h3>Payment methods</h3>
          <SimpleChart horizontal :labels="r.payments.data.map((x: any) => humanize(x.method))" :values="r.payments.data.map((x: any) => x.amount)" :format="m" :height="Math.max(120, r.payments.data.length * 44)" />
          <DataTable :value="r.payments.data" size="small" class="mt">
            <Column header="Method"><template #body="{ data }">{{ humanize(data.method) }}</template></Column>
            <Column field="count" header="Payments" class="right" />
            <Column header="Amount" class="right"><template #body="{ data }">{{ m(data.amount) }}</template></Column>
          </DataTable>
        </div>
      </div>

      <div class="grid grid-2 mt">
        <div class="card">
          <h3>Profit</h3>
          <DataTable :value="r.profit.data" size="small" scrollable scroll-height="320px">
            <template #empty><span class="muted">No data</span></template>
            <Column header="Period"><template #body="{ data }">{{ keyLabel(data.key) }}</template></Column>
            <Column header="Revenue (ex tax)" class="right"><template #body="{ data }">{{ m(data.revenue) }}</template></Column>
            <Column header="Cost" class="right"><template #body="{ data }">{{ m(data.cost) }}</template></Column>
            <Column header="Profit" class="right"><template #body="{ data }"><b>{{ m(data.profit) }}</b></template></Column>
            <Column header="Margin" class="right"><template #body="{ data }">{{ data.marginPercent }}%</template></Column>
          </DataTable>
        </div>
        <div class="card">
          <h3>Cashiers</h3>
          <DataTable :value="r.cashiers.data" size="small">
            <template #empty><span class="muted">No data</span></template>
            <Column field="name" header="Cashier / channel" />
            <Column field="salesCount" header="Sales" class="right" />
            <Column header="Total" class="right"><template #body="{ data }">{{ m(data.total) }}</template></Column>
            <Column header="Refunds" class="right"><template #body="{ data }">{{ m(data.refunds) }}</template></Column>
          </DataTable>
        </div>
      </div>

      <div class="card mt">
        <div class="row" style="justify-content: space-between"><h3>Ingredients used</h3><span class="muted small">total {{ m(r.ingredients.data.reduce((s: number, x: any) => s + x.cost, 0)) }}</span></div>
        <DataTable :value="r.ingredients.data" size="small" scrollable scroll-height="320px">
          <template #empty><span class="muted">No recipe ingredients used in this period</span></template>
          <Column header="Ingredient"><template #body="{ data }">{{ data.name }} <span class="mono small muted">{{ data.sku }}</span></template></Column>
          <Column header="Used" class="right"><template #body="{ data }">{{ num(data.used, 1) }} {{ data.unit }}</template></Column>
          <Column header="Cost" class="right"><template #body="{ data }">{{ m(data.cost) }}</template></Column>
        </DataTable>
      </div>

      <div class="card mt">
        <div class="row" style="justify-content: space-between"><h3>Bakery production and waste</h3><span class="muted small">made {{ m(r.production.totals.productionCost) }} · wasted <b class="neg">{{ m(r.production.totals.wasteCost) }}</b></span></div>
        <DataTable :value="r.production.data" size="small" scrollable scroll-height="320px">
          <template #empty><span class="muted">Nothing baked or written off in this period</span></template>
          <Column header="Item"><template #body="{ data }">{{ data.name }} <span class="mono small muted">{{ data.sku }}</span></template></Column>
          <Column header="Batches" class="right"><template #body="{ data }">{{ data.batches }}</template></Column>
          <Column header="Made" class="right"><template #body="{ data }">{{ num(data.produced, 1) }}</template></Column>
          <Column header="Sold" class="right"><template #body="{ data }">{{ num(data.sold, 1) }}</template></Column>
          <Column header="Wasted" class="right"><template #body="{ data }">{{ num(data.wasted, 1) }} {{ data.unit }}</template></Column>
          <Column header="Waste %" class="right"><template #body="{ data }"><b v-if="data.wastePercent !== null" :class="{ neg: data.wastePercent > 10 }">{{ data.wastePercent }}%</b><span v-else class="muted">—</span></template></Column>
          <Column header="Cost made" class="right"><template #body="{ data }">{{ m(data.productionCost) }}</template></Column>
          <Column header="Cost wasted" class="right"><template #body="{ data }">{{ m(data.wasteCost) }}</template></Column>
        </DataTable>
        <div v-if="r.production.byReason.length" class="row mt small" style="flex-wrap: wrap; gap: 14px">
          <span v-for="w in r.production.byReason" :key="w.reason">{{ humanize(w.reason) }}: <b>{{ m(w.cost) }}</b></span>
        </div>
      </div>

      <div class="card mt">
        <h3>Wallet cards</h3>
        <div class="grid grid-4">
          <div><div class="muted">Held by customers now</div><div class="big num">{{ m(r.wallet.outstanding) }}</div><div class="small muted">money you owe on {{ r.wallet.activeCards }} active cards</div></div>
          <div><div class="muted">Unused cards in stock</div><div class="big num">{{ r.wallet.unusedCards }}</div></div>
        </div>
        <DataTable :value="r.wallet.data" size="small" class="mt">
          <template #empty><span class="muted">No wallet activity in this period</span></template>
          <Column header="Type"><template #body="{ data }">{{ humanize(data.type) }}<span v-if="data.method" class="muted"> · {{ humanize(data.method) }}</span></template></Column>
          <Column field="count" header="Count" class="right" />
          <Column header="Amount" class="right"><template #body="{ data }">{{ m(data.amount) }}</template></Column>
        </DataTable>
      </div>

      <div class="grid grid-2 mt">
        <div class="card">
          <h3>Coupons</h3>
          <DataTable :value="r.cv.coupons" size="small">
            <template #empty><span class="muted">No coupons used in this period</span></template>
            <Column field="name" header="Campaign" />
            <Column field="uses" header="Uses" class="right" />
            <Column header="Discount given" class="right"><template #body="{ data }">{{ m(data.discount) }}</template></Column>
          </DataTable>
        </div>
        <div class="card">
          <h3>Gift vouchers</h3>
          <dl class="kv">
            <dt>Sold in period</dt><dd>{{ r.cv.vouchers.soldInPeriod.count }} · {{ m(r.cv.vouchers.soldInPeriod.value) }}</dd>
            <dt>Spent in period</dt><dd>{{ r.cv.vouchers.spentInPeriod.count }} · {{ m(r.cv.vouchers.spentInPeriod.value) }}</dd>
            <dt><b>Unspent sold vouchers</b></dt><dd><b>{{ m(r.cv.vouchers.outstandingSold.value) }}</b> <span class="muted small">on {{ r.cv.vouchers.outstandingSold.count }} (money you owe)</span></dd>
            <dt>Unspent free vouchers</dt><dd>{{ m(r.cv.vouchers.outstandingFree.value) }} <span class="muted small">on {{ r.cv.vouchers.outstandingFree.count }}</span></dd>
          </dl>
        </div>
      </div>

      <div class="card mt">
        <h3>Promotions</h3>
        <DataTable :value="r.promotions.data" size="small">
          <template #empty><span class="muted">No promotion was used in this period</span></template>
          <Column field="name" header="Promotion" />
          <Column field="sales" header="Sales" class="right" />
          <Column header="Items" class="right"><template #body="{ data }">{{ num(data.quantity, 3) }}</template></Column>
          <Column header="Given away" class="right"><template #body="{ data }"><b>{{ m(data.discount) }}</b></template></Column>
          <Column header="Revenue on these items" class="right"><template #body="{ data }">{{ m(data.revenue) }}</template></Column>
        </DataTable>
      </div>

      <div class="grid grid-2 mt">
        <div class="card">
          <h3>Loyalty</h3>
          <dl class="kv">
            <dt>Sales to members</dt><dd>{{ r.loyalty.totals.memberSales }} of {{ r.loyalty.totals.allSales }} ({{ r.loyalty.totals.allSales ? ((r.loyalty.totals.memberSales / r.loyalty.totals.allSales) * 100).toFixed(0) : 0 }}%)</dd>
            <dt>Points earned</dt><dd>{{ num(r.loyalty.totals.pointsEarned) }}</dd>
            <dt>Points redeemed</dt><dd>{{ num(r.loyalty.totals.pointsRedeemed) }} ({{ m(r.loyalty.totals.pointsDiscount) }})</dd>
          </dl>
          <DataTable :value="r.loyalty.topCustomers" size="small" class="mt">
            <template #empty><span class="muted">No member purchases</span></template>
            <Column field="name" header="Top customers" />
            <Column field="visits" header="Visits" class="right" />
            <Column header="Spent" class="right"><template #body="{ data }">{{ m(data.spent) }}</template></Column>
          </DataTable>
        </div>
        <div class="card">
          <h3>Stock value now</h3>
          <DataTable :value="r.stock" size="small">
            <Column header="Store"><template #body="{ data }"><b>{{ data.code }}</b> {{ data.name }}</template></Column>
            <Column field="products" header="Products" class="right" />
            <Column header="Low" class="right"><template #body="{ data }"><span :class="{ neg: data.lowStock }">{{ data.lowStock }}</span></template></Column>
            <Column header="At cost" class="right"><template #body="{ data }">{{ m(data.costValue) }}</template></Column>
            <Column header="At retail" class="right"><template #body="{ data }">{{ m(data.retailValue) }}</template></Column>
          </DataTable>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.big { font-size: 24px; font-weight: 650; margin: 4px 0; }
</style>
