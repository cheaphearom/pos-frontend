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
    <div class="card">
      <div class="toolbar"><IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Name" /></IconField></div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :loading="list.loading.value" size="small" @page="list.onPage" @row-click="auth.isAdmin && open($event.data)" :row-class="() => (auth.isAdmin ? 'clickable' : '')">
        <template #empty><span class="muted">No promotions yet</span></template>
        <Column header="Name"><template #body="{ data }"><b>{{ data.name }}</b><div class="small muted">{{ data.description }}</div></template></Column>
        <Column header="Deal"><template #body="{ data }">{{ describePromotion(data) }}</template></Column>
        <Column header="On"><template #body="{ data }">{{ scopeText(data) }}</template></Column>
        <Column header="Stores"><template #body="{ data }">{{ storesText(data) }}</template></Column>
        <Column header="When"><template #body="{ data }"><span class="small">{{ whenText(data) }}</span></template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="state(data).l" :severity="state(data).s" /></template></Column>
        <Column v-if="auth.isAdmin" style="width: 70px"><template #body="{ data }"><ToggleSwitch :model-value="data.isActive" @click.stop @update:model-value="toggle(data)" /></template></Column>
      </DataTable>
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
