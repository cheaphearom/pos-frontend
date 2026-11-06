<script setup lang="ts">
/** End of day: preview today's Z report, run it once all shifts are closed, reprint past ones. */
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '@/api/client';
import RegisterReport from '@/components/RegisterReport.vue';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { businessDay, money } from '@/utils/format';

const app = useApp();
const notify = useNotify();
const list = usePagedList('/z-reports', { storeId: app.currentStoreId });
const day = ref(businessDay(0));
const preview = ref<any>(null);
const loading = ref(false);
const running = ref(false);
const shown = ref<any>(null);
const dlg = ref(false);
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: any) => money(Number(v ?? 0), cur.value);
const zName = (z: any) => `${z.store?.code ?? app.currentStore?.code}-Z${String(z.zNo).padStart(4, '0')}`;

async function loadPreview() {
  if (!app.currentStoreId) return;
  loading.value = true;
  try { preview.value = await api.get('/z-reports/preview', { storeId: app.currentStoreId, date: day.value }); } catch (e) { notify.error(e); } finally { loading.value = false; }
}
async function run() {
  if (!confirm(`Close the business day ${day.value} for ${app.currentStore?.name}? The figures are saved and cannot change.`)) return;
  running.value = true;
  try {
    const z = await api.post('/z-reports', { storeId: app.currentStoreId, date: day.value });
    notify.success(`Z report ${zName(z)} saved`, `${z.sales.count} sales · net ${m(z.netAfterRefunds)}`);
    shown.value = z;
    dlg.value = true;
    list.load();
    loadPreview();
  } catch (e) { notify.error(e); } finally { running.value = false; }
}
async function open(id: string) {
  try { shown.value = await api.get(`/z-reports/${id}`); dlg.value = true; } catch (e) { notify.error(e); }
}
function showPreview() {
  shown.value = preview.value;
  dlg.value = true;
}
function print() {
  document.body.classList.add('printing-report');
  window.print();
  setTimeout(() => document.body.classList.remove('printing-report'), 500);
}
watch(() => app.currentStoreId, (id) => { list.filters.storeId = id; loadPreview(); });
watch(day, loadPreview);
onMounted(() => { list.load(); loadPreview(); });
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>End of day (Z report)</h1><div class="sub">{{ app.currentStore?.name }} · close the business day once every shift is closed</div></div>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 12px">
        <div class="row" style="gap: 10px">
          <label for="z-day" class="b">Business day</label>
          <InputText id="z-day" v-model="day" type="date" style="width: 170px" />
        </div>
        <div class="row" style="gap: 8px">
          <Button label="Preview" icon="pi pi-eye" severity="secondary" outlined :disabled="!preview" @click="showPreview" />
          <Button label="Run Z report" icon="pi pi-lock" :loading="running" :disabled="!preview || !!preview.alreadyClosed || preview.openShifts?.length > 0" data-test="run-z" @click="run" />
        </div>
      </div>
      <div v-if="preview" class="grid4 mt" data-test="z-preview">
        <div><span class="muted small">Sales</span><b>{{ preview.sales.count }}</b></div>
        <div><span class="muted small">Net after refunds</span><b>{{ m(preview.netAfterRefunds) }}</b></div>
        <div><span class="muted small">Shifts</span><b>{{ preview.shifts.length }}</b></div>
        <div><span class="muted small">Over / short</span><b :class="preview.shifts.reduce((a: number, s: any) => a + (s.difference ?? 0), 0) < 0 ? 'neg' : ''">{{ m(preview.shifts.reduce((a: number, s: any) => a + (s.difference ?? 0), 0)) }}</b></div>
      </div>
      <Message v-if="preview?.alreadyClosed" severity="info" :closable="false" class="mt">This day is closed: Z report {{ zName(preview.alreadyClosed) }}.</Message>
      <Message v-else-if="preview?.openShifts?.length" severity="warn" :closable="false" class="mt">Close these shifts first: {{ preview.openShifts.join(', ') }}</Message>
    </div>

    <div class="card mt">
      <h3>Z reports</h3>
      <DataTable :value="list.rows.value" :loading="list.loading.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        size="small" data-key="id" :row-class="() => 'clickable'" @page="list.onPage" @row-click="open($event.data.id)">
        <template #empty><span class="muted">No Z reports yet</span></template>
        <Column header="Z no."><template #body="{ data }"><span class="mono">{{ zName(data) }}</span></template></Column>
        <Column field="businessDay" header="Business day" />
        <Column header="Sales" class="right"><template #body="{ data }">{{ data.sales }}</template></Column>
        <Column header="Net" class="right"><template #body="{ data }">{{ m(data.net) }}</template></Column>
        <Column header="Shifts" class="right"><template #body="{ data }">{{ data.shifts }}</template></Column>
        <Column header="Over / short" class="right"><template #body="{ data }"><span :class="data.difference < 0 ? 'neg' : ''">{{ m(data.difference) }}</span></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dlg" :header="shown?.zNo ? `Z report ${zName(shown)}` : 'Z report preview'" modal :style="{ width: '440px' }" :breakpoints="{ '480px': '96vw' }">
      <RegisterReport v-if="shown" :report="shown" />
      <div class="row mt no-print" style="justify-content: flex-end"><Button label="Print" icon="pi pi-print" @click="print" /></div>
    </Dialog>
  </div>
</template>

<style scoped>
.grid4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.grid4 div { display: grid; gap: 2px; }
.grid4 b { font-size: 20px; }
.b { font-weight: 600; }
.mt { margin-top: 14px; }
.neg { color: var(--bad); }
</style>
