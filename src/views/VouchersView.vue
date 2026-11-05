<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { downloadCsv } from '@/utils/csv';
import { date, dateTime, humanize, money } from '@/utils/format';

const app = useApp();
const auth = useAuth();
const notify = useNotify();
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: any) => money(v, cur.value);
const batches = usePagedList('/vouchers/batches', {});
batches.load();
const sev: Record<string, string> = { INACTIVE: 'secondary', ACTIVE: 'success', USED: 'contrast', VOID: 'danger' };

// ── Create batch
const dlg = ref(false);
const saving = ref(false);
const form = reactive({ name: '', value: 10, count: 50, sold: true, expiresAt: null as Date | null });
async function create() {
  saving.value = true;
  try {
    const r = await api.post('/vouchers/batches', { ...form, expiresAt: form.expiresAt?.toISOString() });
    downloadCsv(`vouchers-${form.name.replace(/\W+/g, '-')}.csv`, [{ key: 'code', label: 'Code' }, { key: 'value', label: 'Value' }, { key: 'expiresAt', label: 'Expires' }], r.codes);
    notify.success(`${r.codes.length} vouchers created`, 'The CSV for printing was downloaded');
    dlg.value = false;
    batches.load();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}

// ── Batch detail / voucher list
const batch = ref<any>(null);
const showBatch = ref(false);
const vouchers = usePagedList(() => '/vouchers', { batchId: null as string | null, status: null, search: '' }, { enabled: computed(() => showBatch.value) });
function openBatch(b: any) {
  batch.value = b;
  vouchers.filters.batchId = b.id;
  showBatch.value = true;
}
async function exportBatch() {
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const r = await api.get('/vouchers', { batchId: batch.value.id, page, limit: 200 });
    all.push(...r.data);
    if (page >= r.meta.totalPages) break;
  }
  downloadCsv(`vouchers-${batch.value.name.replace(/\W+/g, '-')}.csv`, [{ key: 'code', label: 'Code' }, { key: 'value', label: 'Value' }, { key: 'balance', label: 'Balance' }, { key: 'status', label: 'Status' }], all);
}

// ── Look up one voucher
const code = ref('');
const v = ref<any>(null);
async function lookup() {
  if (!code.value.trim()) return;
  try { v.value = await api.get('/vouchers/lookup', { code: code.value.trim() }); } catch (e) { v.value = null; notify.error(e); }
}
async function voidVoucher() {
  if (!confirm(`Void voucher ${v.value.code}? It can no longer be used.`)) return;
  try { v.value = await api.post(`/vouchers/${v.value.code}/void`, { reason: 'Voided by manager' }); notify.success('Voucher voided'); } catch (e) { notify.error(e); }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Gift vouchers</h1><div class="sub">Prepaid codes customers pay with. Sold vouchers are activated at the POS when bought.</div></div>
      <div class="actions"><Button v-if="auth.isAdmin" label="Create vouchers" icon="pi pi-plus" @click="dlg = true" /></div>
    </div>

    <div class="card">
      <div class="toolbar">
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="code" placeholder="Scan or type a voucher code" @keydown.enter="lookup" /></IconField>
        <Button label="Check voucher" severity="secondary" @click="lookup" />
      </div>
      <div v-if="v" class="voucher">
        <div class="row" style="justify-content: space-between; flex-wrap: wrap">
          <div><span class="mono big">{{ v.code }}</span> <Tag :value="v.expired && v.status === 'ACTIVE' ? 'EXPIRED' : v.status" :severity="v.expired ? 'warn' : sev[v.status]" /></div>
          <div>Balance <b class="big">{{ m(v.balance) }}</b> <span class="muted">of {{ m(v.value) }}</span></div>
        </div>
        <div class="small muted">{{ v.batch.name }} · {{ v.batch.sold ? 'sold voucher' : 'free voucher' }}<span v-if="v.expiresAt"> · expires {{ date(v.expiresAt) }}</span><span v-if="v.soldAt"> · sold {{ dateTime(v.soldAt) }} ({{ humanize(v.soldMethod) }})</span></div>
        <div v-for="u in v.uses" :key="u.id" class="small row" style="justify-content: space-between"><span>{{ dateTime(u.createdAt) }} · {{ Number(u.amount) > 0 ? 'spent' : 'refunded' }}</span><span class="num">{{ m(Math.abs(Number(u.amount))) }}</span></div>
        <Button v-if="auth.isManager && ['INACTIVE', 'ACTIVE'].includes(v.status)" label="Void" severity="danger" text size="small" @click="voidVoucher" />
      </div>
    </div>

    <div class="card mt">
      <h3>Batches</h3>
      <DataTable :value="batches.rows.value" lazy paginator :rows="batches.page.rows" :first="batches.page.first" :total-records="batches.total.value"
        :loading="batches.loading.value" size="small" @page="batches.onPage" @row-click="openBatch($event.data)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No vouchers yet</span></template>
        <Column header="Batch"><template #body="{ data }"><b>{{ data.name }}</b><div class="small muted">{{ data.sold ? 'Sold to customers' : 'Free / promotional' }} · created {{ date(data.createdAt) }}</div></template></Column>
        <Column header="Value" class="right"><template #body="{ data }">{{ m(data.value) }}</template></Column>
        <Column header="Vouchers" class="right"><template #body="{ data }">{{ data.count }}</template></Column>
        <Column header="Not sold"><template #body="{ data }">{{ data.counts.INACTIVE ?? 0 }}</template></Column>
        <Column header="Active"><template #body="{ data }">{{ data.counts.ACTIVE ?? 0 }}</template></Column>
        <Column header="Used"><template #body="{ data }">{{ data.counts.USED ?? 0 }}</template></Column>
        <Column header="Unspent value" class="right"><template #body="{ data }">{{ m(data.outstanding) }}</template></Column>
        <Column header="Expires"><template #body="{ data }">{{ date(data.expiresAt) || 'Never' }}</template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dlg" header="Create gift vouchers" modal :style="{ width: '520px' }">
      <form class="form" @submit.prevent="create">
        <div class="field"><label>Name *</label><InputText v-model="form.name" required placeholder="e.g. $10 gift voucher" /></div>
        <div class="form-2">
          <div class="field"><label>Value of each voucher *</label><InputNumber v-model="form.value" :min="0.01" :min-fraction-digits="2" fluid /></div>
          <div class="field"><label>How many *</label><InputNumber v-model="form.count" :min="1" :max="10000" fluid /></div>
        </div>
        <div class="field"><label>Type</label><SelectButton v-model="form.sold" :options="[{ l: 'Sold to customers', v: true }, { l: 'Free (promotion)', v: false }]" option-label="l" option-value="v" :allow-empty="false" /></div>
        <Message severity="info" :closable="false" size="small">
          {{ form.sold ? 'Sold vouchers can only be used after the cashier sells them at the POS (money in).' : 'Free vouchers work straight away, e.g. as a gift for loyal customers.' }}
        </Message>
        <div class="field"><label>Expires</label><DatePicker v-model="form.expiresAt" show-button-bar placeholder="Never" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Create and download CSV" icon="pi pi-download" :loading="saving" /></div>
      </form>
    </Dialog>

    <Drawer v-model:visible="showBatch" position="right" :header="batch?.name" style="width: min(620px, 100vw)">
      <div class="toolbar">
        <Select v-model="vouchers.filters.status" :options="['INACTIVE', 'ACTIVE', 'USED', 'VOID']" placeholder="All" show-clear />
        <InputText v-model="vouchers.filters.search" placeholder="Code" />
        <Button label="CSV" icon="pi pi-download" severity="secondary" size="small" @click="exportBatch" />
      </div>
      <DataTable :value="vouchers.rows.value" lazy paginator :rows="vouchers.page.rows" :first="vouchers.page.first" :total-records="vouchers.total.value"
        :loading="vouchers.loading.value" size="small" @page="vouchers.onPage">
        <Column header="Code"><template #body="{ data }"><span class="mono">{{ data.code }}</span></template></Column>
        <Column header="Balance" class="right"><template #body="{ data }">{{ m(data.balance) }}</template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="data.status" :severity="sev[data.status]" /></template></Column>
        <Column header="Sold"><template #body="{ data }">{{ dateTime(data.soldAt) || '—' }}</template></Column>
      </DataTable>
    </Drawer>
  </div>
</template>

<style scoped>
.voucher { display: grid; gap: 8px; border: 1px dashed var(--border); border-radius: 12px; padding: 14px 16px; }
.big { font-size: 18px; font-weight: 700; }
</style>
