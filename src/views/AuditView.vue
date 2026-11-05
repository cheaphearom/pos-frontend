<script setup lang="ts">
/** Audit log: who did what (discounts, refunds, voids, PIN approvals, price and stock changes, logins). */
import { onMounted, ref, watch } from 'vue';
import { api } from '@/api/client';
import DateRange from '@/components/DateRange.vue';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { dateTime, humanize } from '@/utils/format';

const app = useApp();
const notify = useNotify();
const scope = ref<'store' | 'all'>('store');
const list = usePagedList('/audit', { storeId: app.currentStoreId, action: null as string | null, search: '', from: null as string | null, to: null as string | null });
const actions = ref<string[]>([]);
const detail = ref<any>(null);

/** Colour by risk: money given back or out of the normal flow is red, approvals amber. */
const SEVERITY: Record<string, string> = {
  VOID: 'danger', REFUND: 'danger', APPROVAL_DENIED: 'danger', LOGIN_FAILED: 'danger', WALLET_ADJUSTED: 'danger',
  DISCOUNT_APPROVED: 'warn', APPROVAL_GRANTED: 'warn', POINTS_ADJUSTED: 'warn', STOCK_ADJUSTED: 'warn', PRODUCT_CHANGED: 'warn', WALLET_BLOCKED: 'warn',
  DISCOUNT: 'info', LOGIN: 'secondary',
};
const QUICK = [
  { label: 'All', v: null },
  { label: 'Discounts', v: 'DISCOUNT_APPROVED' },
  { label: 'Refunds', v: 'REFUND' },
  { label: 'Voids', v: 'VOID' },
  { label: 'Wrong PINs', v: 'APPROVAL_DENIED' },
  { label: 'Failed logins', v: 'LOGIN_FAILED' },
];

watch(scope, (s) => { list.filters.storeId = s === 'store' ? app.currentStoreId : null; });
watch(() => app.currentStoreId, (id) => { if (scope.value === 'store') list.filters.storeId = id; });
onMounted(async () => {
  list.load();
  try { actions.value = await api.get('/audit/actions'); } catch (e) { notify.error(e); }
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Audit log</h1><div class="sub">Who did what: discounts above the limit, refunds, voids, manager PINs, price and stock changes, logins</div></div>
      <SelectButton v-model="scope" :options="[{ l: 'This store', v: 'store' }, { l: 'All my stores', v: 'all' }]" option-label="l" option-value="v" :allow-empty="false" />
    </div>
    <div class="card">
      <div class="toolbar" style="flex-wrap: wrap">
        <div class="row" style="gap: 4px; flex-wrap: wrap">
          <Button v-for="q in QUICK" :key="q.label" :label="q.label" size="small" :text="list.filters.action !== q.v" :severity="list.filters.action === q.v ? undefined : 'secondary'" @click="list.filters.action = q.v" />
        </div>
        <Select v-model="list.filters.action" :options="actions" :option-label="(a: string) => humanize(a)" placeholder="Any action" show-clear filter size="small" style="width: 200px" />
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Receipt, user, text" size="small" /></IconField>
        <DateRange v-model:from="list.filters.from" v-model:to="list.filters.to" />
      </div>
      <DataTable :value="list.rows.value" :loading="list.loading.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value" :rows-per-page-options="[25, 50, 100]"
        size="small" data-key="id" :row-class="() => 'clickable'" @page="list.onPage" @row-click="detail = $event.data">
        <template #empty><span class="muted">Nothing recorded</span></template>
        <Column header="When" style="width: 170px"><template #body="{ data }"><span class="small">{{ dateTime(data.createdAt) }}</span></template></Column>
        <Column header="Action" style="width: 190px"><template #body="{ data }"><Tag :value="humanize(data.action)" :severity="SEVERITY[data.action] ?? 'secondary'" /></template></Column>
        <Column header="What"><template #body="{ data }">{{ data.summary }}</template></Column>
        <Column header="By" style="width: 180px"><template #body="{ data }">{{ data.userName ?? '—' }}</template></Column>
        <Column header="Approved by" style="width: 160px"><template #body="{ data }"><span v-if="data.approvedByName"><i class="pi pi-key small" /> {{ data.approvedByName }}</span></template></Column>
      </DataTable>
    </div>

    <Dialog :visible="!!detail" modal :header="detail ? humanize(detail.action) : ''" :style="{ width: '560px' }" :breakpoints="{ '600px': '96vw' }" @update:visible="detail = null">
      <template v-if="detail">
        <p style="margin-top: 0"><b>{{ detail.summary }}</b></p>
        <div class="kv">
          <span>When</span><span>{{ dateTime(detail.createdAt) }}</span>
          <span>By</span><span>{{ detail.userName ?? '—' }}</span>
          <template v-if="detail.approvedByName"><span>Approved by</span><span>{{ detail.approvedByName }}</span></template>
          <template v-if="detail.entityId"><span>{{ humanize(detail.entityType ?? 'ref') }}</span><span class="mono">{{ detail.entityId }}</span></template>
          <template v-if="detail.storeId"><span>Store</span><span>{{ app.stores.find((s) => s.id === detail.storeId)?.name ?? detail.storeId }}</span></template>
        </div>
        <pre v-if="detail.details" class="json">{{ JSON.stringify(detail.details, null, 2) }}</pre>
        <RouterLink v-if="detail.entityType === 'sale'" :to="`/sales?receipt=${detail.entityId}`" class="small">Open the sale</RouterLink>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.kv { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px; font-size: 14px; }
.kv span:nth-child(odd) { color: var(--text-2); }
.json { background: var(--bg); border-radius: 8px; padding: 10px; font-size: 12px; max-height: 300px; overflow: auto; margin-top: 12px; }
</style>
