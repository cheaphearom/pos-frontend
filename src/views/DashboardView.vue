<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '@/api/client';
import SimpleChart from '@/components/SimpleChart.vue';
import StatCard from '@/components/StatCard.vue';
import { useNotify } from '@/composables/useNotify';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { dateTime, isoDate, money, num } from '@/utils/format';

const auth = useAuth();
const app = useApp();
const notify = useNotify();
const scope = ref<'store' | 'all'>('store');
const dash = ref<any>(null);
const trend = ref<any>(null);
const recent = ref<any[]>([]);
const shift = ref<any>(null);
const loading = ref(true);

const storeParam = computed(() => (scope.value === 'store' ? app.currentStoreId ?? undefined : undefined));
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: number) => money(v, cur.value);

async function load() {
  loading.value = true;
  try {
    if (auth.isManager) {
      const [d, t] = await Promise.all([
        api.get('/reports/dashboard', { storeId: storeParam.value }),
        api.get('/reports/sales-summary', { storeId: storeParam.value, groupBy: 'day' }),
      ]);
      dash.value = d;
      trend.value = t;
    }
    if (app.currentStoreId) {
      const [s, sh] = await Promise.all([
        api.get('/sales', { storeId: app.currentStoreId, limit: 8, ...(auth.role === 'CASHIER' && { cashierId: auth.user!.id }) }),
        api.get('/shifts/current', { storeId: app.currentStoreId }),
      ]);
      recent.value = s.data;
      shift.value = sh;
    }
  } catch (e) {
    notify.error(e);
  } finally {
    loading.value = false;
  }
}

/** Fill missing days with 0 so the chart has no gaps. */
const series = computed(() => {
  if (!trend.value) return { labels: [], values: [] };
  const map = new Map(trend.value.data.map((r: any) => [r.key, r.net]));
  const labels: string[] = [];
  const values: number[] = [];
  const d = new Date(trend.value.from + 'T00:00:00');
  const end = new Date(trend.value.to + 'T00:00:00');
  while (d <= end) {
    const k = isoDate(d);
    labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    values.push(Number(map.get(k) ?? 0));
    d.setDate(d.getDate() + 1);
  }
  return { labels, values };
});

const avg = (t: any) => (t?.salesCount ? t.total / t.salesCount : 0);

onMounted(load);
watch(scope, load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Hello, {{ auth.user?.fullName?.split(' ')[0] }}</h1>
        <div class="sub">{{ dash?.date ?? new Date().toDateString() }} · {{ scope === 'store' ? app.currentStore?.name : 'All my stores' }}</div>
      </div>
      <div v-if="auth.isManager && app.stores.length > 1" class="actions">
        <SelectButton v-model="scope" :options="[{ l: 'This store', v: 'store' }, { l: 'All stores', v: 'all' }]" option-label="l" option-value="v" :allow-empty="false" />
      </div>
    </div>

    <template v-if="auth.isManager && dash">
      <div class="grid grid-4">
        <StatCard label="Net sales today" icon="pi pi-wallet" :value="m(dash.today.net)" :current="dash.today.net" :previous="dash.yesterday.net" />
        <StatCard label="Transactions" icon="pi pi-receipt" :value="num(dash.today.salesCount)" :current="dash.today.salesCount" :previous="dash.yesterday.salesCount" />
        <StatCard label="Average sale" icon="pi pi-calculator" :value="m(avg(dash.today))" :current="avg(dash.today)" :previous="avg(dash.yesterday)" />
        <RouterLink to="/inventory?lowStock=1" style="text-decoration: none; color: inherit">
          <StatCard label="Low-stock items" icon="pi pi-exclamation-triangle" :value="num(dash.lowStockItems)" previous-label="" />
        </RouterLink>
      </div>

      <div class="grid grid-2 mt">
        <div class="card">
          <h3>Net sales, last 30 days</h3>
          <SimpleChart :labels="series.labels" :values="series.values" :format="m" />
        </div>
        <div class="card">
          <h3>Top products today</h3>
          <DataTable :value="dash.topProductsToday" size="small">
            <template #empty><span class="muted">No sales yet today</span></template>
            <Column field="name" header="Product" />
            <Column header="Qty" class="right"><template #body="{ data }">{{ num(data.quantity, 3) }}</template></Column>
            <Column header="Revenue" class="right"><template #body="{ data }">{{ m(data.revenue) }}</template></Column>
          </DataTable>
          <template v-if="scope === 'all' && dash.byStore.length">
            <h3 class="mt">Today by store</h3>
            <DataTable :value="dash.byStore" size="small">
              <Column field="key" header="Store" />
              <Column field="salesCount" header="Sales" class="right" />
              <Column header="Net" class="right"><template #body="{ data }">{{ m(data.net) }}</template></Column>
            </DataTable>
          </template>
        </div>
      </div>
    </template>

    <div class="grid grid-2 mt">
      <div class="card">
        <h3>My shift</h3>
        <div v-if="shift">
          <Tag severity="success" value="OPEN" /> since {{ dateTime(shift.openedAt) }} · opening cash {{ m(shift.openingCash) }}
          <div class="mt"><RouterLink :to="`/shifts?open=${shift.id}`">View shift summary →</RouterLink></div>
        </div>
        <div v-else class="muted">No open shift in this store. Shifts are opened from the POS screen or the Shifts page.</div>
      </div>
      <div class="card">
        <h3>{{ auth.role === 'CASHIER' ? 'My recent sales' : 'Recent sales in this store' }}</h3>
        <DataTable :value="recent" size="small" :loading="loading">
          <template #empty><span class="muted">No sales yet</span></template>
          <Column header="Receipt"><template #body="{ data }"><RouterLink class="mono" :to="`/sales?receipt=${data.receiptNo}`">{{ data.receiptNo }}</RouterLink></template></Column>
          <Column header="Time"><template #body="{ data }">{{ dateTime(data.createdAt) }}</template></Column>
          <Column header="Total" class="right"><template #body="{ data }">{{ m(data.total) }}</template></Column>
        </DataTable>
      </div>
    </div>
  </div>
</template>
