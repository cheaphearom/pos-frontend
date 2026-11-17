<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { describePromotion, isPromoActive } from '@shared/promotions';
import { api } from '@/api/client';
import type { Category, Product } from '@/api/types';
import ProductPicker from '@/components/ProductPicker.vue';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { dateTime } from '@/utils/format';

const app = useApp();
const auth = useAuth();
const notify = useNotify();
const confirm = useConfirm();
const list = usePagedList('/promotions', { search: '' });
const categories = ref<Category[]>([]);
const allStores = ref<any[]>([]);
const timeZone = ref('UTC');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TYPES = [
  { v: 'PERCENT_OFF', l: '% off' },
  { v: 'AMOUNT_OFF', l: 'Amount off each' },
  { v: 'BUY_X_GET_Y', l: 'Buy X get Y free' },
];

const hhmm = (m?: number | null) => (m == null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
const minutesOf = (d: Date | null) => (d ? d.getHours() * 60 + d.getMinutes() : null);
const dateOfMinutes = (m: number | null | undefined) => {
  if (m == null) return null;
  const d = new Date();
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d;
};

/** "Running now", "Scheduled", "Ended" or "Off", using the same engine as checkout. */
function state(p: any) {
  if (!p.isActive) return { l: 'Off', s: 'secondary' };
  if (p.endsAt && new Date(p.endsAt) < new Date()) return { l: 'Ended', s: 'secondary' };
  const anyStore = p.storeIds.length ? p.storeIds[0] : app.currentStoreId ?? '';
  return isPromoActive({ ...p, value: p.value }, anyStore, new Date(), timeZone.value) ? { l: 'Running now', s: 'success' } : { l: 'Scheduled', s: 'info' };
}
function scopeText(p: any) {
  if (p.allProducts) return 'All products';
  const parts = [];
  if (p.categoryIds.length) parts.push(p.categoryIds.map((id: string) => categories.value.find((c) => c.id === id)?.name ?? '?').join(', '));
  if (p.productIds.length) parts.push(`${p.productIds.length} product(s)`);
  return parts.join(' + ');
}
function whenText(p: any) {
  const parts = [];
  if (p.startsAt || p.endsAt) parts.push(`${p.startsAt ? dateTime(p.startsAt) : '…'} → ${p.endsAt ? dateTime(p.endsAt) : '…'}`);
  if (p.daysOfWeek.length) parts.push(p.daysOfWeek.map((d: number) => DAYS[d]).join(' '));
  if (p.startMinute != null || p.endMinute != null) parts.push(`${hhmm(p.startMinute ?? 0)}–${hhmm(p.endMinute ?? 1440)}`);
  return parts.join(' · ') || 'Always';
}
/** The deal in big letters on the card */
function bigDeal(p: any) {
  const v = Number(p.value);
  if (p.type === 'PERCENT_OFF') return { big: `${v.toFixed(v % 1 ? 1 : 0)}%`, small: 'off' };
  if (p.type === 'AMOUNT_OFF') return { big: `$${v.toFixed(2)}`, small: 'off each' };
  return { big: `${p.buyQty}+${p.getQty}`, small: `buy ${p.buyQty} get ${p.getQty} free` };
}
const STATE_COLOR: Record<string, string> = { 'Running now': 'var(--good)', Scheduled: '#2c6e9b', Ended: 'var(--text-3)', Off: 'var(--text-3)' };
const show = ref<'all' | 'Running now' | 'Scheduled' | 'Ended' | 'Off'>('all');
const shown = computed(() => (show.value === 'all' ? list.rows.value : list.rows.value.filter((p: any) => state(p).l === show.value)));
const countOf = (l: string) => list.rows.value.filter((p: any) => state(p).l === l).length;
const pages = computed(() => Math.max(1, Math.ceil(list.total.value / list.page.rows)));
const pageNo = computed(() => Math.floor(list.page.first / list.page.rows) + 1);
const goPage = (n: number) => list.onPage({ first: (n - 1) * list.page.rows, rows: list.page.rows });
const storesText = (p: any) => (p.storeIds.length ? p.storeIds.map((id: string) => allStores.value.find((s) => s.id === id)?.code ?? '?').join(', ') : 'All stores');

// ── Edit
const dlg = ref(false);
const saving = ref(false);
const empty = () => ({
  id: '', name: '', description: '', type: 'PERCENT_OFF', value: 10, buyQty: 2, getQty: 1, allProducts: false,
  products: [] as { id: string; name: string }[], categoryIds: [] as string[], storeIds: [] as string[],
  startsAt: null as Date | null, endsAt: null as Date | null, daysOfWeek: [] as number[],
  happyHour: false, start: null as Date | null, end: null as Date | null, priority: 0, isActive: true,
});
const form = reactive(empty());
async function open(p?: any) {
  Object.assign(form, empty());
  if (p) {
    Object.assign(form, {
      ...p, value: Number(p.value), description: p.description ?? '', buyQty: p.buyQty ?? 2, getQty: p.getQty ?? 1,
      startsAt: p.startsAt ? new Date(p.startsAt) : null, endsAt: p.endsAt ? new Date(p.endsAt) : null,
      happyHour: p.startMinute != null || p.endMinute != null, start: dateOfMinutes(p.startMinute), end: dateOfMinutes(p.endMinute),
      products: await Promise.all(p.productIds.map((id: string) => api.get(`/products/${id}`).then((x) => ({ id: x.id, name: x.name })).catch(() => ({ id, name: '(deleted product)' })))),
    });
  }
  dlg.value = true;
}
function addProduct(p: Product) {
  if (!form.products.some((x) => x.id === p.id)) form.products.push({ id: p.id, name: p.name });
}
async function save() {
  saving.value = true;
  try {
    const body: any = {
      name: form.name, description: form.description || undefined, type: form.type,
      value: form.type === 'BUY_X_GET_Y' ? 0 : form.value,
      buyQty: form.type === 'BUY_X_GET_Y' ? form.buyQty : undefined, getQty: form.type === 'BUY_X_GET_Y' ? form.getQty : undefined,
      allProducts: form.allProducts, productIds: form.allProducts ? [] : form.products.map((p) => p.id), categoryIds: form.allProducts ? [] : form.categoryIds,
      storeIds: form.storeIds, daysOfWeek: form.daysOfWeek, priority: form.priority, isActive: form.isActive,
      startsAt: form.startsAt?.toISOString() ?? undefined, endsAt: form.endsAt?.toISOString() ?? undefined,
      startMinute: form.happyHour ? minutesOf(form.start) ?? undefined : undefined, endMinute: form.happyHour ? minutesOf(form.end) ?? undefined : undefined,
    };
    if (form.id) await api.patch(`/promotions/${form.id}`, body);
    else await api.post('/promotions', body);
    notify.success('Promotion saved', form.name);
    dlg.value = false;
    list.load();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}
async function toggle(p: any) {
  try { await api.patch(`/promotions/${p.id}`, { isActive: !p.isActive }); list.load(); } catch (e) { notify.error(e); }
}
function remove() {
  confirm.require({
    header: 'Delete promotion', message: `Delete "${form.name}"? Past sales keep their discount.`,
    acceptProps: { label: 'Delete', severity: 'danger' }, rejectProps: { label: 'Cancel', text: true, severity: 'secondary' },
    accept: async () => { try { await api.del(`/promotions/${form.id}`); dlg.value = false; list.load(); } catch (e) { notify.error(e); } },
  });
}
const preview = computed(() => describePromotion({ type: form.type as any, value: form.value, buyQty: form.buyQty, getQty: form.getQty }));

onMounted(async () => {
  list.load();
  [categories.value, allStores.value] = await Promise.all([api.get('/categories'), api.get('/stores/directory')]);
  if (app.currentStoreId) timeZone.value = (await api.get('/promotions/active', { storeId: app.currentStoreId })).timeZone;
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Promotions</h1><div class="sub">Applied automatically at the POS, also offline · times use the {{ timeZone }} clock</div></div>
      <div class="actions"><Button v-if="auth.isAdmin" label="New promotion" icon="pi pi-plus" @click="open()" /></div>
    </div>
    <div class="toolbar pr-tools">
      <IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Search promotions" /></IconField>
      <SelectButton v-model="show" :options="[{ l: `All ${list.rows.value.length}`, v: 'all' }, { l: `Running ${countOf('Running now')}`, v: 'Running now' }, { l: `Scheduled ${countOf('Scheduled')}`, v: 'Scheduled' }, { l: `Ended ${countOf('Ended')}`, v: 'Ended' }, { l: `Off ${countOf('Off')}`, v: 'Off' }]" option-label="l" option-value="v" :allow-empty="false" />
    </div>
    <div v-if="list.loading.value && !list.rows.value.length" class="muted">Loading…</div>
    <div v-else-if="!shown.length" class="card muted">{{ list.rows.value.length ? 'No promotion in this list.' : 'No promotions yet.' }}</div>
    <div class="pr-grid">
      <article v-for="p in shown" :key="p.id" class="pr-card" :class="{ dim: ['Ended', 'Off'].includes(state(p).l), click: auth.isAdmin }" :style="{ '--s': STATE_COLOR[state(p).l] }" @click="auth.isAdmin && open(p)">
        <div class="deal">
          <span class="big">{{ bigDeal(p).big }}</span>
          <span class="dsmall">{{ bigDeal(p).small }}</span>
        </div>
        <div class="body">
          <div class="top">
            <span class="state"><span class="pulse" />{{ state(p).l }}</span>
            <ToggleSwitch v-if="auth.isAdmin" :model-value="p.isActive" @click.stop @update:model-value="toggle(p)" v-tooltip.left="p.isActive ? 'Turn off' : 'Turn on'" />
          </div>
          <h3>{{ p.name }}</h3>
          <div v-if="p.description" class="small muted desc">{{ p.description }}</div>
          <ul class="meta">
            <li><i class="pi pi-tag" /> {{ scopeText(p) }}</li>
            <li><i class="pi pi-building" /> {{ storesText(p) }}</li>
            <li><i class="pi pi-clock" /> {{ whenText(p) }}</li>
          </ul>
        </div>
      </article>
    </div>
    <div v-if="pages > 1" class="pager">
      <Button icon="pi pi-angle-left" text rounded :disabled="pageNo <= 1" aria-label="Previous page" @click="goPage(pageNo - 1)" />
      <span class="small muted">Page {{ pageNo }} of {{ pages }}</span>
      <Button icon="pi pi-angle-right" text rounded :disabled="pageNo >= pages" aria-label="Next page" @click="goPage(pageNo + 1)" />
    </div>

    <Dialog v-model:visible="dlg" :header="form.id ? 'Edit promotion' : 'New promotion'" modal :style="{ width: '720px' }" :breakpoints="{ '760px': '98vw' }">
      <form class="form" @submit.prevent="save">
        <div class="form-2">
          <div class="field"><label>Name (shown on receipts) *</label><InputText v-model="form.name" required maxlength="100" /></div>
          <div class="field"><label>Description</label><InputText v-model="form.description" /></div>
        </div>
        <div class="field"><label>Type</label><SelectButton v-model="form.type" :options="TYPES" option-label="l" option-value="v" :allow-empty="false" /></div>
        <div class="form-2">
          <div v-if="form.type === 'PERCENT_OFF'" class="field"><label>Percent off</label><InputNumber v-model="form.value" :min="0.01" :max="100" :max-fraction-digits="2" suffix=" %" fluid /></div>
          <div v-else-if="form.type === 'AMOUNT_OFF'" class="field"><label>Amount off each unit</label><InputNumber v-model="form.value" :min="0.01" :min-fraction-digits="2" :max-fraction-digits="2" fluid /></div>
          <template v-else>
            <div class="row" style="gap: 10px">
              <div class="field"><label>Buy</label><InputNumber v-model="form.buyQty" :min="1" show-buttons fluid /></div>
              <div class="field"><label>Get free</label><InputNumber v-model="form.getQty" :min="1" show-buttons fluid /></div>
            </div>
          </template>
          <div class="field"><label>Preview</label><div class="secret">{{ preview }}</div></div>
        </div>

        <label class="row"><ToggleSwitch v-model="form.allProducts" /> Applies to all products</label>
        <template v-if="!form.allProducts">
          <div class="field"><label>Categories</label><MultiSelect v-model="form.categoryIds" :options="categories" option-label="name" option-value="id" display="chip" placeholder="None" /></div>
          <div class="field">
            <label>Products</label>
            <ProductPicker :store-id="app.currentStoreId" placeholder="Add a product…" @select="addProduct" />
            <div class="row" style="flex-wrap: wrap; gap: 6px; margin-top: 4px">
              <Tag v-for="(p, i) in form.products" :key="p.id" severity="secondary">
                {{ p.name }} <i class="pi pi-times" style="cursor: pointer; margin-left: 6px; font-size: 10px" @click="form.products.splice(i, 1)" />
              </Tag>
            </div>
          </div>
        </template>

        <div class="field"><label>Stores</label><MultiSelect v-model="form.storeIds" :options="allStores" option-label="name" option-value="id" display="chip" placeholder="All stores" /></div>
        <div class="form-2">
          <div class="field"><label>Starts</label><DatePicker v-model="form.startsAt" show-time hour-format="24" show-button-bar placeholder="Now" /></div>
          <div class="field"><label>Ends</label><DatePicker v-model="form.endsAt" show-time hour-format="24" show-button-bar placeholder="No end" /></div>
        </div>
        <div class="field">
          <label>Days of the week <span class="hint">(none selected = every day)</span></label>
          <div class="row" style="flex-wrap: wrap">
            <label v-for="(d, i) in DAYS" :key="d" class="row small" style="gap: 4px; margin-right: 8px"><Checkbox v-model="form.daysOfWeek" :value="i" /> {{ d }}</label>
          </div>
        </div>
        <label class="row"><ToggleSwitch v-model="form.happyHour" /> Only at certain hours (happy hour)</label>
        <div v-if="form.happyHour" class="form-2">
          <div class="field"><label>From</label><DatePicker v-model="form.start" time-only hour-format="24" /></div>
          <div class="field"><label>Until</label><DatePicker v-model="form.end" time-only hour-format="24" /><span class="hint">A window like 22:00–02:00 continues past midnight.</span></div>
        </div>
        <div class="form-2">
          <div class="field"><label>Priority</label><InputNumber v-model="form.priority" show-buttons fluid /><span class="hint">Each item gets the single best deal; priority breaks ties.</span></div>
          <div class="field"><label>Status</label><label class="row"><ToggleSwitch v-model="form.isActive" /> Active</label></div>
        </div>
        <div class="row" style="justify-content: space-between">
          <Button v-if="form.id" label="Delete" text severity="danger" @click="remove" />
          <span v-else />
          <Button type="submit" label="Save" icon="pi pi-check" :loading="saving" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.pr-tools { margin-bottom: 14px; }
.pr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; align-items: stretch; }
.pr-card { display: flex; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; transition: transform .15s ease, box-shadow .15s ease; }
.pr-card.click { cursor: pointer; }
.pr-card.click:hover { transform: translateY(-2px); box-shadow: 0 6px 22px rgba(60, 35, 15, .12); }
.pr-card.dim { opacity: .65; }
.deal { flex-shrink: 0; width: 112px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 12px 8px; color: #fff; text-align: center;
  background: linear-gradient(160deg, var(--p-primary-color), color-mix(in srgb, var(--p-primary-color) 65%, #000)); position: relative; }
.deal::after { content: ''; position: absolute; right: -7px; top: 0; bottom: 0; width: 14px; background: radial-gradient(circle at 7px 7px, var(--surface) 4.5px, transparent 5px) 0 0 / 14px 14px repeat-y; }
.big { font-size: 1.9rem; font-weight: 850; line-height: 1; letter-spacing: -.02em; }
.dsmall { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; opacity: .9; }
.body { flex: 1; min-width: 0; padding: 12px 14px 12px 18px; display: flex; flex-direction: column; gap: 4px; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.state { display: inline-flex; align-items: center; gap: 6px; font-size: .75rem; font-weight: 750; text-transform: uppercase; letter-spacing: .04em; color: var(--s); }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--s); }
.pr-card:not(.dim) .state .pulse { animation: pulse 1.8s ease-out infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--s) 60%, transparent); } 100% { box-shadow: 0 0 0 7px transparent; } }
.body h3 { margin: 2px 0 0; font-size: 1.02rem; font-weight: 750; }
.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 3px; font-size: .84rem; color: var(--text-2); }
.meta li { display: flex; gap: 7px; align-items: baseline; min-width: 0; }
.meta .pi { font-size: .78rem; color: var(--text-3); }
.pager { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 14px; }
@media (max-width: 420px) { .pr-grid { grid-template-columns: 1fr; } .deal { width: 92px; } .big { font-size: 1.5rem; } }
@media (prefers-reduced-motion: reduce) { .pr-card, .pr-card:hover { transition: none; transform: none; } .state .pulse { animation: none !important; } }
</style>
