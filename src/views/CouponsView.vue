<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { describeCoupon } from '@shared/coupons';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { downloadCsv } from '@/utils/csv';
import { date, money } from '@/utils/format';

const app = useApp();
const auth = useAuth();
const notify = useNotify();
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: any) => money(v, cur.value);
const list = usePagedList('/coupons', { search: '' });
const allStores = ref<any[]>([]);

const state = (c: any) => {
  if (!c.isActive) return { l: 'Off', s: 'secondary' };
  if (c.endsAt && new Date(c.endsAt) < new Date()) return { l: 'Expired', s: 'secondary' };
  if (c.startsAt && new Date(c.startsAt) > new Date()) return { l: 'Scheduled', s: 'info' };
  if (c.usageLimit && c.usedCount >= c.usageLimit) return { l: 'Used up', s: 'warn' };
  return { l: 'Active', s: 'success' };
};

// ── Create
const dlg = ref(false);
const saving = ref(false);
const empty = () => ({
  name: '', type: 'PERCENT', value: 10, minSpend: 0, maxDiscount: null as number | null, storeIds: [] as string[],
  startsAt: null as Date | null, endsAt: null as Date | null, usageLimit: null as number | null, perCustomerLimit: null as number | null,
  membersOnly: false, mode: 'shared' as 'shared' | 'unique', sharedCode: '', uniqueCount: 100, prefix: '',
});
const form = reactive(empty());
const preview = computed(() => describeCoupon({ type: form.type as any, value: form.value, minSpend: form.minSpend, maxDiscount: form.maxDiscount }));
async function create() {
  saving.value = true;
  try {
    const body: any = {
      name: form.name, type: form.type, value: form.value, minSpend: form.minSpend || undefined,
      maxDiscount: form.type === 'PERCENT' && form.maxDiscount ? form.maxDiscount : undefined, storeIds: form.storeIds,
      startsAt: form.startsAt?.toISOString(), endsAt: form.endsAt?.toISOString(),
      usageLimit: form.usageLimit || undefined, perCustomerLimit: form.perCustomerLimit || undefined, membersOnly: form.membersOnly,
      ...(form.mode === 'shared' ? { sharedCode: form.sharedCode.trim().toUpperCase() } : { uniqueCount: form.uniqueCount, prefix: form.prefix || undefined }),
    };
    const c = await api.post('/coupons', body);
    if (form.mode === 'unique') await exportCodes(c);
    notify.success('Coupon campaign created', c.name);
    dlg.value = false;
    list.load();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}

// ── Detail
const detail = ref<any>(null);
const codes = ref<any[]>([]);
const show = ref(false);
const more = ref(100);
async function open(c: any) {
  try {
    [detail.value, codes.value] = await Promise.all([api.get(`/coupons/${c.id}`), api.get(`/coupons/${c.id}/codes`, { limit: 50 }).then((r) => r.data)]);
    show.value = true;
  } catch (e) { notify.error(e); }
}
async function exportCodes(c: any) {
  const all = await api.get(`/coupons/${c.id}/codes`, { all: 'true' });
  downloadCsv(`coupons-${c.name.replace(/\W+/g, '-')}.csv`, [{ key: 'code', label: 'Code' }, { key: 'usedCount', label: 'Times used' }], all);
}
async function addCodes() {
  try {
    const r = await api.post(`/coupons/${detail.value.id}/codes`, { count: more.value });
    notify.success(`${r.created} codes added`);
    await open(detail.value);
    list.load();
  } catch (e) { notify.error(e); }
}
async function toggle(c: any) {
  try { await api.patch(`/coupons/${c.id}`, { isActive: !c.isActive }); list.load(); if (detail.value?.id === c.id) open(c); } catch (e) { notify.error(e); }
}
onMounted(async () => {
  list.load();
  allStores.value = await api.get('/stores/directory');
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Coupons</h1><div class="sub">Discount codes the cashier scans or types at the POS</div></div>
      <div class="actions"><Button v-if="auth.isAdmin" label="New coupon" icon="pi pi-plus" @click="Object.assign(form, empty()); dlg = true" /></div>
    </div>
    <div class="card">
      <div class="toolbar"><IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Campaign name" /></IconField></div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :loading="list.loading.value" size="small" @page="list.onPage" @row-click="open($event.data)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No coupons yet</span></template>
        <Column header="Campaign"><template #body="{ data }"><b>{{ data.name }}</b><div class="small muted">{{ describeCoupon(data) }}</div></template></Column>
        <Column header="Codes" class="right"><template #body="{ data }">{{ data._count.codes }}</template></Column>
        <Column header="Used" class="right"><template #body="{ data }">{{ data.usedCount }}<span v-if="data.usageLimit" class="muted"> / {{ data.usageLimit }}</span></template></Column>
        <Column header="Discount given" class="right"><template #body="{ data }">{{ m(data.discountGiven) }}</template></Column>
        <Column header="Valid"><template #body="{ data }"><span class="small">{{ data.startsAt ? date(data.startsAt) : 'now' }} → {{ data.endsAt ? date(data.endsAt) : 'no end' }}</span></template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="state(data).l" :severity="state(data).s" /></template></Column>
        <Column v-if="auth.isAdmin" style="width: 70px"><template #body="{ data }"><ToggleSwitch :model-value="data.isActive" @click.stop @update:model-value="toggle(data)" /></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dlg" header="New coupon" modal :style="{ width: '680px' }" :breakpoints="{ '720px': '98vw' }">
      <form class="form" @submit.prevent="create">
        <div class="field"><label>Name (shown on the receipt) *</label><InputText v-model="form.name" required maxlength="100" placeholder="e.g. New Year 10%" /></div>
        <div class="form-2">
          <div class="field"><label>Type</label><SelectButton v-model="form.type" :options="[{ l: '% off', v: 'PERCENT' }, { l: 'Amount off', v: 'AMOUNT' }]" option-label="l" option-value="v" :allow-empty="false" /></div>
          <div class="field"><label>{{ form.type === 'PERCENT' ? 'Percent' : 'Amount' }} *</label><InputNumber v-model="form.value" :min="0.01" :max="form.type === 'PERCENT' ? 100 : undefined" :max-fraction-digits="2" :suffix="form.type === 'PERCENT' ? ' %' : ''" fluid /></div>
        </div>
        <div class="form-2">
          <div class="field"><label>Minimum spend</label><InputNumber v-model="form.minSpend" :min="0" :min-fraction-digits="2" fluid /></div>
          <div v-if="form.type === 'PERCENT'" class="field"><label>Maximum discount</label><InputNumber v-model="form.maxDiscount" :min="0" :min-fraction-digits="2" fluid placeholder="No limit" /></div>
        </div>
        <div class="secret">{{ preview }}</div>

        <div class="field"><label>Codes</label><SelectButton v-model="form.mode" :options="[{ l: 'One shared code', v: 'shared' }, { l: 'Unique single-use codes', v: 'unique' }]" option-label="l" option-value="v" :allow-empty="false" /></div>
        <div v-if="form.mode === 'shared'" class="field"><label>Code customers type *</label><InputText v-model="form.sharedCode" placeholder="e.g. SAVE10" style="text-transform: uppercase" required /><span class="hint">Everyone uses the same code, until the limits below.</span></div>
        <div v-else class="form-2">
          <div class="field"><label>How many codes</label><InputNumber v-model="form.uniqueCount" :min="1" :max="10000" fluid /></div>
          <div class="field"><label>Code prefix</label><InputText v-model="form.prefix" maxlength="10" placeholder="e.g. NOV" style="text-transform: uppercase" /><span class="hint">Codes look like NOV-7KQ2M9XP; each works once. A CSV downloads when you save.</span></div>
        </div>

        <div class="form-2">
          <div class="field"><label>Total uses allowed</label><InputNumber v-model="form.usageLimit" :min="1" fluid placeholder="No limit" /></div>
          <div class="field"><label>Uses per customer</label><InputNumber v-model="form.perCustomerLimit" :min="1" fluid placeholder="No limit" /><span class="hint">Needs the customer to be added at the POS</span></div>
        </div>
        <label class="row"><ToggleSwitch v-model="form.membersOnly" /> Members only</label>
        <div class="field"><label>Stores</label><MultiSelect v-model="form.storeIds" :options="allStores" option-label="name" option-value="id" display="chip" placeholder="All stores" /></div>
        <div class="form-2">
          <div class="field"><label>Valid from</label><DatePicker v-model="form.startsAt" show-time hour-format="24" show-button-bar placeholder="Now" /></div>
          <div class="field"><label>Valid until</label><DatePicker v-model="form.endsAt" show-time hour-format="24" show-button-bar placeholder="No end" /></div>
        </div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Create" icon="pi pi-check" :loading="saving" /></div>
      </form>
    </Dialog>

    <Drawer v-model:visible="show" position="right" :header="detail?.name" style="width: min(600px, 100vw)">
      <template v-if="detail">
        <div class="grid" style="grid-template-columns: repeat(3, 1fr)">
          <div class="card"><div class="small muted">Used</div><div class="stat">{{ detail.usedCount }}<span v-if="detail.usageLimit" class="small muted"> / {{ detail.usageLimit }}</span></div></div>
          <div class="card"><div class="small muted">Discount given</div><div class="stat">{{ m(detail.discountGiven) }}</div></div>
          <div class="card"><div class="small muted">Codes</div><div class="stat">{{ detail._count.codes }}</div></div>
        </div>
        <dl class="kv mt">
          <dt>Deal</dt><dd>{{ describeCoupon(detail) }}</dd>
          <dt>Status</dt><dd><Tag :value="state(detail).l" :severity="state(detail).s" /></dd>
          <dt>Members only</dt><dd>{{ detail.membersOnly ? 'Yes' : 'No' }}</dd>
          <dt>Per customer</dt><dd>{{ detail.perCustomerLimit ?? 'No limit' }}</dd>
          <dt>Stores</dt><dd>{{ detail.storeIds.length ? detail.storeIds.map((id: string) => allStores.find((s) => s.id === id)?.code).join(', ') : 'All' }}</dd>
        </dl>
        <div class="row mt" style="flex-wrap: wrap">
          <Button label="Download codes (CSV)" icon="pi pi-download" severity="secondary" @click="exportCodes(detail)" />
          <template v-if="auth.isAdmin && codes[0]?.maxUses === 1">
            <InputNumber v-model="more" :min="1" :max="10000" style="width: 110px" />
            <Button label="Add codes" icon="pi pi-plus" severity="secondary" @click="addCodes" />
          </template>
        </div>
        <DataTable :value="codes" size="small" class="mt">
          <Column header="Code"><template #body="{ data }"><span class="mono">{{ data.code }}</span></template></Column>
          <Column header="Used" class="right"><template #body="{ data }">{{ data.usedCount }}{{ data.maxUses ? ' / ' + data.maxUses : '' }}</template></Column>
        </DataTable>
        <div v-if="detail._count.codes > codes.length" class="small muted mt">Showing the first {{ codes.length }} codes. Download the CSV for all of them.</div>
      </template>
    </Drawer>
  </div>
</template>

<style scoped>
.stat { font-size: 20px; font-weight: 650; }
</style>
