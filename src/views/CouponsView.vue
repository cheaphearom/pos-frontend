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

// ── Cards
const STATE_COLOR: Record<string, string> = { Active: 'var(--good)', Scheduled: '#2c6e9b', 'Used up': 'var(--warn)', Expired: 'var(--text-3)', Off: 'var(--text-3)' };
const which = ref<'all' | 'Active' | 'Scheduled' | 'Used up' | 'Expired' | 'Off'>('all');
const shown = computed(() => (which.value === 'all' ? list.rows.value : list.rows.value.filter((c: any) => state(c).l === which.value)));
const countOf = (l: string) => list.rows.value.filter((c: any) => state(c).l === l).length;
function bigDeal(c: any) {
  const v = Number(c.value);
  return c.type === 'PERCENT' ? { big: `${v.toFixed(v % 1 ? 1 : 0)}%`, small: 'off the sale' } : { big: m(v).replace(/\.00$/, ''), small: 'off the sale' };
}
const usedPct = (c: any) => (c.usageLimit ? Math.min(100, Math.round((c.usedCount / c.usageLimit) * 100)) : 0);
const pages = computed(() => Math.max(1, Math.ceil(list.total.value / list.page.rows)));
const pageNo = computed(() => Math.floor(list.page.first / list.page.rows) + 1);
const goPage = (n: number) => list.onPage({ first: (n - 1) * list.page.rows, rows: list.page.rows });

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
    <div class="toolbar cp-tools">
      <IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Campaign name" /></IconField>
      <SelectButton v-model="which" :options="[{ l: `All ${list.rows.value.length}`, v: 'all' }, { l: `Active ${countOf('Active')}`, v: 'Active' }, { l: `Scheduled ${countOf('Scheduled')}`, v: 'Scheduled' }, { l: `Used up ${countOf('Used up')}`, v: 'Used up' }, { l: `Expired ${countOf('Expired')}`, v: 'Expired' }, { l: `Off ${countOf('Off')}`, v: 'Off' }]" option-label="l" option-value="v" :allow-empty="false" />
    </div>
    <div v-if="list.loading.value && !list.rows.value.length" class="muted">Loading…</div>
    <div v-else-if="!shown.length" class="card muted">{{ list.rows.value.length ? 'No coupon in this list.' : 'No coupons yet.' }}</div>
    <div class="cp-grid">
      <article v-for="c in shown" :key="c.id" class="cp-card" :class="{ dim: ['Expired', 'Off'].includes(state(c).l) }" :style="{ '--s': STATE_COLOR[state(c).l] }" @click="open(c)">
        <div class="deal">
          <i class="pi pi-ticket" />
          <span class="big">{{ bigDeal(c).big }}</span>
          <span class="dsmall">{{ bigDeal(c).small }}</span>
        </div>
        <div class="body">
          <div class="top">
            <span class="state"><span class="dot" />{{ state(c).l }}</span>
            <ToggleSwitch v-if="auth.isAdmin" :model-value="c.isActive" @click.stop @update:model-value="toggle(c)" v-tooltip.left="c.isActive ? 'Turn off' : 'Turn on'" />
          </div>
          <h3>{{ c.name }}</h3>
          <div class="small muted">{{ describeCoupon(c) }}</div>
          <div class="nums">
            <span><b>{{ c._count.codes }}</b> {{ c._count.codes === 1 ? 'code' : 'codes' }}</span>
            <span><b>{{ c.usedCount }}</b><template v-if="c.usageLimit"> / {{ c.usageLimit }}</template> used</span>
            <span><b>{{ m(c.discountGiven) }}</b> given</span>
          </div>
          <div v-if="c.usageLimit" class="bar" :title="`${usedPct(c)}% used`"><span :style="{ width: usedPct(c) + '%' }" /></div>
          <div class="small muted when"><i class="pi pi-calendar" /> {{ c.startsAt ? date(c.startsAt) : 'now' }} → {{ c.endsAt ? date(c.endsAt) : 'no end' }}</div>
        </div>
      </article>
    </div>
    <div v-if="pages > 1" class="pager">
      <Button icon="pi pi-angle-left" text rounded :disabled="pageNo <= 1" aria-label="Previous page" @click="goPage(pageNo - 1)" />
      <span class="small muted">Page {{ pageNo }} of {{ pages }}</span>
      <Button icon="pi pi-angle-right" text rounded :disabled="pageNo >= pages" aria-label="Next page" @click="goPage(pageNo + 1)" />
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
.cp-tools { margin-bottom: 14px; }
.cp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; align-items: stretch; }
.cp-card { display: flex; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }
.cp-card:hover { transform: translateY(-2px); box-shadow: 0 6px 22px rgba(60, 35, 15, .12); }
.cp-card.dim { opacity: .65; }
.deal { flex-shrink: 0; width: 112px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 12px 8px; color: #fff; text-align: center; position: relative;
  background: linear-gradient(160deg, var(--accent-2, #c8893f), color-mix(in srgb, var(--accent-2, #c8893f) 60%, #000)); }
.deal::after { content: ''; position: absolute; right: -7px; top: 0; bottom: 0; width: 14px; background: radial-gradient(circle at 7px 7px, var(--surface) 4.5px, transparent 5px) 0 0 / 14px 14px repeat-y; }
.deal .pi { font-size: 1rem; opacity: .85; }
.big { font-size: 1.8rem; font-weight: 850; line-height: 1; letter-spacing: -.02em; }
.dsmall { font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; opacity: .9; }
.body { flex: 1; min-width: 0; padding: 12px 14px 12px 18px; display: flex; flex-direction: column; gap: 4px; }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.state { display: inline-flex; align-items: center; gap: 6px; font-size: .75rem; font-weight: 750; text-transform: uppercase; letter-spacing: .04em; color: var(--s); }
.state .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--s); }
.body h3 { margin: 2px 0 0; font-size: 1.02rem; font-weight: 750; }
.nums { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: .84rem; color: var(--text-2); margin-top: 6px; }
.nums b { color: var(--text); font-weight: 800; }
.bar { height: 6px; border-radius: 999px; background: var(--bg); overflow: hidden; }
.bar span { display: block; height: 100%; border-radius: 999px; background: var(--accent-2, #c8893f); }
.when { margin-top: 2px; }
.pager { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 14px; }
@media (max-width: 420px) { .cp-grid { grid-template-columns: 1fr; } .deal { width: 92px; } .big { font-size: 1.45rem; } }
@media (prefers-reduced-motion: reduce) { .cp-card, .cp-card:hover { transition: none; transform: none; } }

.stat { font-size: 20px; font-weight: 650; }
</style>
