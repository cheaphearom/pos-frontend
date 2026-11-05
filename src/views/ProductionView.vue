<script setup lang="ts">
/** Bakery production: what to bake today, batches, end-of-day leftovers and waste. */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import type { Product } from '@/api/types';
import ProductPicker from '@/components/ProductPicker.vue';
import { useNotify } from '@/composables/useNotify';
import { useApp } from '@/stores/app';
import { money } from '@/utils/format';

const app = useApp();
const notify = useNotify();
const tab = ref<'plan' | 'eod' | 'waste'>('plan');
const TABS = [{ v: 'plan', l: "Today's baking" }, { v: 'eod', l: 'End of day' }, { v: 'waste', l: 'Record waste' }];
const storeId = computed(() => app.currentStoreId);
const q = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const time = (d: string) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ── Plan + batches
const plan = ref<any>(null);
const batches = ref<any[]>([]);
const loading = ref(false);
async function loadPlan() {
  if (!storeId.value) return;
  loading.value = true;
  try {
    [plan.value, batches.value] = await Promise.all([
      api.get('/production/plan', { storeId: storeId.value }),
      api.get('/production/batches', { storeId: storeId.value }),
    ]);
  } catch (e) { notify.error(e); } finally { loading.value = false; }
}
const toBake = computed(() => (plan.value?.products ?? []).reduce((s: number, p: any) => s + p.suggestedQty, 0));

const bakeDlg = ref(false);
const bake = reactive({ product: null as any, quantity: 0, done: true, note: '', busy: false });
function openBake(p: any) {
  Object.assign(bake, { product: p, quantity: p.suggestedQty || p.batchYield, done: true, note: '', busy: false });
  bakeDlg.value = true;
}
const bakeBatches = computed(() => (bake.product ? bake.quantity / (bake.product.batchYield || 1) : 0));
async function saveBake() {
  bake.busy = true;
  try {
    const b = await api.post('/production/batches', { storeId: storeId.value, productId: bake.product.id, quantity: bake.quantity, done: bake.done, note: bake.note || undefined });
    notify.success(bake.done ? `Baked ${q(Number(b.producedQty))} × ${b.product.name}` : `Planned ${q(Number(b.plannedQty))} × ${b.product.name}`,
      bake.done ? `Cost ${money(b.unitCost)} per piece · ingredients taken from stock` : 'Press "Done" when it comes out of the oven');
    bakeDlg.value = false;
    loadPlan();
  } catch (e) { notify.error(e); } finally { bake.busy = false; }
}

const doneDlg = ref(false);
const done = reactive({ batch: null as any, producedQty: 0, busy: false });
function openDone(b: any) {
  Object.assign(done, { batch: b, producedQty: Number(b.plannedQty), busy: false });
  doneDlg.value = true;
}
async function saveDone() {
  done.busy = true;
  try {
    const b = await api.post(`/production/batches/${done.batch.id}/complete`, { producedQty: done.producedQty });
    notify.success(`${b.product.name}: ${q(Number(b.producedQty))} in stock`, `Cost ${money(b.unitCost)} per piece`);
    doneDlg.value = false;
    loadPlan();
  } catch (e) { notify.error(e); } finally { done.busy = false; }
}
async function cancelBatch(b: any) {
  if (!confirm(`Cancel the planned batch of ${b.product.name}?`)) return;
  try { await api.post(`/production/batches/${b.id}/cancel`, {}); loadPlan(); } catch (e) { notify.error(e); }
}
const sheet = ref<any>(null);

// ── End of day
const eod = ref<any[]>([]);
const eodQty = reactive<Record<string, number>>({});
async function loadEod() {
  if (!storeId.value) return;
  loading.value = true;
  try {
    eod.value = await api.get('/production/end-of-day', { storeId: storeId.value });
    for (const r of eod.value) eodQty[r.id] = r.expired;
  } catch (e) { notify.error(e); } finally { loading.value = false; }
}
const eodTotal = computed(() => eod.value.reduce((s, r) => s + (eodQty[r.id] ?? 0) * r.costPrice, 0));
const eodBusy = ref(false);
async function writeOff() {
  const items = eod.value.filter((r) => (eodQty[r.id] ?? 0) > 0).map((r) => ({ productId: r.id, quantity: eodQty[r.id], reason: r.expired >= eodQty[r.id] ? 'EXPIRED' : 'UNSOLD' }));
  if (!items.length) return;
  eodBusy.value = true;
  try {
    await api.post('/production/waste', { storeId: storeId.value, items });
    notify.success('Written off', `${items.length} product(s), cost ${money(eodTotal.value)}`);
    loadEod();
  } catch (e) { notify.error(e); } finally { eodBusy.value = false; }
}

// ── Waste (any product)
const REASONS = [{ v: 'EXPIRED', l: 'Expired' }, { v: 'UNSOLD', l: 'Unsold' }, { v: 'DAMAGED', l: 'Damaged / dropped' }, { v: 'QUALITY', l: 'Quality (burnt, wrong)' }, { v: 'OTHER', l: 'Other' }];
const wLines = ref<{ product: Product; quantity: number; reason: string; note: string }[]>([]);
function addWaste(p: Product) {
  if (!wLines.value.some((l) => l.product.id === p.id)) wLines.value.push({ product: p, quantity: 1, reason: 'DAMAGED', note: '' });
}
const wCost = computed(() => wLines.value.reduce((s, l) => s + l.quantity * Number(l.product.costPrice), 0));
const wBusy = ref(false);
async function saveWaste() {
  wBusy.value = true;
  try {
    await api.post('/production/waste', { storeId: storeId.value, items: wLines.value.filter((l) => l.quantity > 0).map((l) => ({ productId: l.product.id, quantity: l.quantity, reason: l.reason, note: l.note || undefined })) });
    notify.success('Waste recorded', `Cost ${money(wCost.value)}`);
    wLines.value = [];
  } catch (e) { notify.error(e); } finally { wBusy.value = false; }
}

function reload() { return tab.value === 'eod' ? loadEod() : tab.value === 'plan' ? loadPlan() : undefined; }
watch([tab, storeId], reload);
onMounted(reload);
</script>

<template>
  <div>
    <div class="page-head">
      <div><h1>Bakery production</h1><div class="sub">{{ app.currentStore?.name }} · bake, then write off what is left at the end of the day</div></div>
      <SelectButton v-model="tab" :options="TABS" option-label="l" option-value="v" :allow-empty="false" />
    </div>

    <!-- Plan -->
    <template v-if="tab === 'plan'">
      <div class="card">
        <div class="row" style="justify-content: space-between; margin-bottom: 8px">
          <h3 style="margin: 0">What to bake today <span v-if="plan" class="muted small">({{ plan.date }})</span></h3>
          <span v-if="plan?.products.length" class="muted small">Suggested: {{ q(toBake) }} pieces · from what usually sells on this weekday (last 4 weeks) + 10%, minus what is still fresh</span>
        </div>
        <DataTable :value="plan?.products ?? []" :loading="loading" size="small" data-key="id">
          <template #empty><span class="muted">No bakery items. On the Products page turn on "Made here (bakery)" and give it a batch recipe.</span></template>
          <Column header="Item"><template #body="{ data }"><b>{{ data.name }}</b><div class="small muted">batch of {{ q(data.batchYield) }}<template v-if="data.shelfLifeHours"> · fresh {{ data.shelfLifeHours }} h</template><span v-if="!data.hasRecipe" class="neg"> · no recipe</span></div></template></Column>
          <Column header="Usually sells" class="right"><template #body="{ data }">{{ q(data.usuallySells) }}</template></Column>
          <Column header="Sold today" class="right"><template #body="{ data }">{{ q(data.soldToday) }}</template></Column>
          <Column header="In stock" class="right"><template #body="{ data }">{{ q(data.stock) }}<div v-if="data.shelfLifeHours && data.fresh < data.stock" class="small warnc">{{ q(data.fresh) }} fresh</div></template></Column>
          <Column header="Baked / planned" class="right"><template #body="{ data }">{{ q(data.bakedToday) }}<span v-if="data.plannedQty" class="muted"> + {{ q(data.plannedQty) }}</span></template></Column>
          <Column header="Bake" class="right"><template #body="{ data }"><b v-if="data.suggestedQty" class="bake-n">{{ q(data.suggestedQty) }}</b><span v-else class="muted">enough</span><div v-if="data.suggestedBatches" class="small muted">{{ data.suggestedBatches }} batch{{ data.suggestedBatches > 1 ? 'es' : '' }}</div></template></Column>
          <Column header="Cost / piece" class="right"><template #body="{ data }">{{ money(data.costPerPiece) }}</template></Column>
          <Column style="width: 110px"><template #body="{ data }"><Button label="Bake" icon="pi pi-plus" size="small" @click="openBake(data)" /></template></Column>
        </DataTable>
      </div>

      <div class="card mt">
        <h3>Today's batches</h3>
        <DataTable :value="batches" size="small" data-key="id">
          <template #empty><span class="muted">Nothing baked yet today</span></template>
          <Column header="Batch"><template #body="{ data }"><span class="mono small">{{ data.batchNo }}</span></template></Column>
          <Column header="Item"><template #body="{ data }">{{ data.product.name }}</template></Column>
          <Column header="Pieces" class="right"><template #body="{ data }">{{ q(Number(data.producedQty ?? data.plannedQty)) }}</template></Column>
          <Column header="Status"><template #body="{ data }"><Tag :value="data.status.toLowerCase()" :severity="data.status === 'DONE' ? 'success' : data.status === 'PLANNED' ? 'warn' : 'secondary'" /></template></Column>
          <Column header="Time"><template #body="{ data }">{{ time(data.completedAt ?? data.createdAt) }}</template></Column>
          <Column header="Fresh until"><template #body="{ data }">{{ data.expiresAt ? new Date(data.expiresAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—' }}</template></Column>
          <Column header="Cost" class="right"><template #body="{ data }"><template v-if="data.totalCost">{{ money(data.totalCost) }} <span class="small muted">({{ money(data.unitCost) }}/pc)</span></template></template></Column>
          <Column style="width: 190px">
            <template #body="{ data }">
              <div class="row" style="justify-content: flex-end">
                <template v-if="data.status === 'PLANNED'">
                  <Button label="Done" icon="pi pi-check" size="small" severity="success" @click="openDone(data)" />
                  <Button icon="pi pi-times" size="small" text severity="secondary" aria-label="Cancel batch" @click="cancelBatch(data)" />
                </template>
                <Button v-else-if="data.status === 'DONE'" label="Sheet" icon="pi pi-list" size="small" text @click="sheet = data" />
              </div>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>

    <!-- End of day -->
    <div v-else-if="tab === 'eod'" class="card">
      <h3>Leftovers</h3>
      <p class="small muted" style="margin-top: 0">Pieces are counted as selling oldest first. <b>Expired</b> = older than the shelf life now. Change the numbers to what you actually throw away, then write off.</p>
      <DataTable :value="eod" :loading="loading" size="small" data-key="id">
        <template #empty><span class="muted">No bakery stock left</span></template>
        <Column header="Item"><template #body="{ data }"><b>{{ data.name }}</b><div v-if="data.shelfLifeHours" class="small muted">fresh {{ data.shelfLifeHours }} h</div></template></Column>
        <Column header="In stock" class="right"><template #body="{ data }">{{ q(data.stock) }}</template></Column>
        <Column header="Expired" class="right"><template #body="{ data }"><b :class="{ neg: data.expired > 0 }">{{ q(data.expired) }}</b></template></Column>
        <Column header="Expires tonight" class="right"><template #body="{ data }"><span :class="{ warnc: data.expiresToday > 0 }">{{ q(data.expiresToday) }}</span></template></Column>
        <Column header="Good tomorrow" class="right"><template #body="{ data }">{{ q(data.goodTomorrow) }}</template></Column>
        <Column header="Written off today" class="right"><template #body="{ data }">{{ q(data.wastedToday) }}</template></Column>
        <Column header="Write off" style="width: 130px"><template #body="{ data }"><InputNumber v-model="eodQty[data.id]" :min="0" :max="Math.max(0, data.stock)" :max-fraction-digits="3" size="small" :input-style="{ width: '80px' }" /></template></Column>
      </DataTable>
      <div class="row mt" style="justify-content: space-between">
        <span>Cost written off: <b>{{ money(eodTotal) }}</b></span>
        <Button label="Write off" icon="pi pi-trash" severity="danger" :loading="eodBusy" :disabled="!eodTotal && !eod.some((r) => (eodQty[r.id] ?? 0) > 0)" @click="writeOff" />
      </div>
    </div>

    <!-- Waste of anything -->
    <div v-else class="card">
      <h3>Record waste</h3>
      <p class="small muted" style="margin-top: 0">Anything that leaves stock without a sale: a dropped cake, spilled milk, a burnt batch. The cost goes to the waste report.</p>
      <ProductPicker placeholder="Product or ingredient…" @select="addWaste" />
      <DataTable :value="wLines" size="small" class="mt">
        <template #empty><span class="muted">Search for a product above</span></template>
        <Column header="Product"><template #body="{ data }">{{ data.product.name }} <span class="muted small">{{ data.product.unit }}</span></template></Column>
        <Column header="Quantity" style="width: 140px"><template #body="{ data }"><InputNumber v-model="data.quantity" :min="0" :max-fraction-digits="3" size="small" :input-style="{ width: '90px' }" /></template></Column>
        <Column header="Reason" style="width: 210px"><template #body="{ data }"><Select v-model="data.reason" :options="REASONS" option-label="l" option-value="v" size="small" fluid /></template></Column>
        <Column header="Note"><template #body="{ data }"><InputText v-model="data.note" size="small" maxlength="200" fluid /></template></Column>
        <Column header="Cost" class="right"><template #body="{ data }">{{ money(data.quantity * Number(data.product.costPrice)) }}</template></Column>
        <Column style="width: 40px"><template #body="{ index }"><Button icon="pi pi-times" text rounded size="small" severity="secondary" aria-label="Remove" @click="wLines.splice(index, 1)" /></template></Column>
      </DataTable>
      <div class="row mt" style="justify-content: space-between">
        <span>Total cost: <b>{{ money(wCost) }}</b></span>
        <Button label="Save waste" icon="pi pi-check" :loading="wBusy" :disabled="!wLines.length" @click="saveWaste" />
      </div>
    </div>

    <Dialog v-model:visible="bakeDlg" modal :header="bake.product ? `Bake ${bake.product.name}` : ''" :style="{ width: '420px' }" :breakpoints="{ '480px': '96vw' }">
      <form v-if="bake.product" class="form" @submit.prevent="saveBake">
        <div class="field">
          <label>Pieces</label>
          <InputNumber v-model="bake.quantity" :min="0.001" :max-fraction-digits="3" :step="bake.product.batchYield" show-buttons fluid autofocus />
          <span class="hint">{{ q(bakeBatches) }} batch{{ bakeBatches === 1 ? '' : 'es' }} of {{ q(bake.product.batchYield) }} · about {{ money(bake.quantity * bake.product.costPerPiece) }} of ingredients</span>
        </div>
        <div class="field"><label>Note</label><InputText v-model="bake.note" maxlength="200" placeholder="Optional" /></div>
        <label class="row"><ToggleSwitch v-model="bake.done" /> Already out of the oven (put in stock now)</label>
        <Message v-if="!bake.product.hasRecipe" severity="warn" :closable="false" size="small">No batch recipe yet: no ingredients will be taken out of stock.</Message>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" severity="secondary" text @click="bakeDlg = false" />
          <Button type="submit" :label="bake.done ? 'Add to stock' : 'Plan batch'" icon="pi pi-check" :loading="bake.busy" :disabled="!bake.quantity" />
        </div>
      </form>
    </Dialog>

    <Dialog v-model:visible="doneDlg" modal :header="done.batch ? `${done.batch.product.name} is done` : ''" :style="{ width: '380px' }">
      <form class="form" @submit.prevent="saveDone">
        <div class="field"><label>Good pieces made</label><InputNumber v-model="done.producedQty" :min="0.001" :max-fraction-digits="3" fluid autofocus /><span class="hint">Burnt or broken pieces are not counted; ingredients are taken for the pieces made.</span></div>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" severity="secondary" text @click="doneDlg = false" />
          <Button type="submit" label="Put in stock" icon="pi pi-check" :loading="done.busy" />
        </div>
      </form>
    </Dialog>

    <Dialog :visible="!!sheet" modal :header="sheet ? `Batch ${sheet.batchNo}` : ''" :style="{ width: '480px' }" @update:visible="sheet = null">
      <template v-if="sheet">
        <p><b>{{ q(Number(sheet.producedQty)) }} × {{ sheet.product.name }}</b> · {{ new Date(sheet.completedAt).toLocaleString() }}</p>
        <DataTable :value="sheet.ingredients ?? []" size="small">
          <template #empty><span class="muted">No recipe: no ingredients used</span></template>
          <Column field="name" header="Ingredient" />
          <Column header="Used" class="right"><template #body="{ data }">{{ q(data.quantity) }} {{ data.unit }}</template></Column>
          <Column header="Cost" class="right"><template #body="{ data }">{{ money(data.cost) }}</template></Column>
        </DataTable>
        <p class="mt">Total {{ money(sheet.totalCost) }} · <b>{{ money(sheet.unitCost) }} per piece</b></p>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.bake-n { font-size: 16px; color: var(--p-primary-color); }
.warnc { color: #b45309; }
.neg { color: var(--bad); }
.mt { margin-top: 14px; }
</style>
