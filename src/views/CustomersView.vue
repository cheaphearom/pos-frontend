<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { dateTime, humanize, money, num } from '@/utils/format';

const app = useApp();
const auth = useAuth();
const notify = useNotify();
const list = usePagedList('/customers', { search: '' });
list.load();
const cur = computed(() => app.currentStore?.currency ?? 'USD');
const m = (v: any) => money(v, cur.value);

const dlg = ref(false);
const form = reactive({ id: '', name: '', phone: '', email: '', code: '', isActive: true });
function edit(c?: any) {
  Object.assign(form, c ? { ...c, phone: c.phone ?? '', email: c.email ?? '' } : { id: '', name: '', phone: '', email: '', code: '', isActive: true });
  dlg.value = true;
}
async function save() {
  try {
    const body = { name: form.name, phone: form.phone || undefined, email: form.email || undefined, code: form.code || undefined };
    const c = form.id ? await api.patch(`/customers/${form.id}`, { ...body, isActive: form.isActive }) : await api.post('/customers', body);
    notify.success('Customer saved', `${c.name} · card ${c.code}`);
    dlg.value = false;
    list.load();
    if (detail.value?.id === c.id) open(c);
  } catch (e) { notify.error(e); }
}

// ── Detail
const detail = ref<any>(null);
const showDetail = ref(false);
const tab = ref<'purchases' | 'points'>('purchases');
const purchases = ref<any[]>([]);
const points = ref<any[]>([]);
async function open(c: any) {
  try {
    const [d, p, h] = await Promise.all([
      api.get(`/customers/${c.id}`),
      api.get(`/customers/${c.id}/purchases`, { limit: 20 }),
      api.get(`/customers/${c.id}/points`, { limit: 30 }),
    ]);
    detail.value = d;
    purchases.value = p.data;
    points.value = h.data;
    showDetail.value = true;
  } catch (e) { notify.error(e); }
}

const adjDlg = ref(false);
const adj = reactive({ points: 0, reason: '' });
async function adjust() {
  try {
    await api.post(`/customers/${detail.value.id}/points/adjust`, { points: adj.points, reason: adj.reason });
    adjDlg.value = false;
    notify.success('Points updated');
    open(detail.value);
    list.load();
  } catch (e) { notify.error(e); }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Customers</h1><div class="sub">Loyalty members, shared by all stores</div></div>
      <div class="actions"><Button label="New customer" icon="pi pi-user-plus" @click="edit()" /></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Name, phone, email or card" /></IconField>
      </div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :loading="list.loading.value" size="small" @page="list.onPage" @row-click="open($event.data)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No customers</span></template>
        <Column header="Card"><template #body="{ data }"><span class="mono">{{ data.code }}</span></template></Column>
        <Column header="Name"><template #body="{ data }">{{ data.name }} <Tag v-if="!data.isActive" value="inactive" severity="secondary" /></template></Column>
        <Column field="phone" header="Phone" />
        <Column header="Points" class="right"><template #body="{ data }"><b class="num">{{ num(data.points) }}</b></template></Column>
        <Column header="Total spent" class="right"><template #body="{ data }">{{ m(data.totalSpent) }}</template></Column>
        <Column header="Visits" class="right"><template #body="{ data }">{{ data.visitCount }}</template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dlg" :header="form.id ? 'Edit customer' : 'New customer'" modal :style="{ width: '480px' }">
      <form class="form" @submit.prevent="save">
        <div class="field"><label>Name *</label><InputText v-model="form.name" required /></div>
        <div class="form-2">
          <div class="field"><label>Phone</label><InputText v-model="form.phone" /></div>
          <div class="field"><label>Email</label><InputText v-model="form.email" type="email" /></div>
        </div>
        <div class="field"><label>Member card number</label><InputText v-model="form.code" :disabled="!!form.id" placeholder="Leave empty to generate" /></div>
        <label v-if="form.id" class="row"><ToggleSwitch v-model="form.isActive" /> Active</label>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" /></div>
      </form>
    </Dialog>

    <Drawer v-model:visible="showDetail" position="right" :header="detail?.name" style="width: min(560px, 100vw)">
      <template v-if="detail">
        <div class="grid" style="grid-template-columns: repeat(3, 1fr)">
          <div class="card"><div class="small muted">Points</div><div style="font-size: 22px; font-weight: 650">{{ num(detail.points) }}</div><div class="small muted">worth {{ m(detail.pointsValue) }}</div></div>
          <div class="card"><div class="small muted">Total spent</div><div style="font-size: 22px; font-weight: 650">{{ m(detail.totalSpent) }}</div></div>
          <div class="card"><div class="small muted">Visits</div><div style="font-size: 22px; font-weight: 650">{{ detail.visitCount }}</div></div>
        </div>
        <dl class="kv mt">
          <dt>Card</dt><dd class="mono">{{ detail.code }}</dd>
          <dt>Phone</dt><dd>{{ detail.phone ?? '—' }}</dd>
          <dt>Email</dt><dd>{{ detail.email ?? '—' }}</dd>
          <dt>Member since</dt><dd>{{ dateTime(detail.createdAt) }}</dd>
        </dl>
        <div class="row mt">
          <Button label="Edit" icon="pi pi-pencil" size="small" severity="secondary" @click="edit(detail)" />
          <Button v-if="auth.isManager" label="Adjust points" icon="pi pi-star" size="small" severity="secondary" @click="Object.assign(adj, { points: 0, reason: '' }); adjDlg = true" />
        </div>
        <SelectButton v-model="tab" class="mt" :options="[{ l: 'Purchases', v: 'purchases' }, { l: 'Points history', v: 'points' }]" option-label="l" option-value="v" :allow-empty="false" />
        <DataTable v-if="tab === 'purchases'" :value="purchases" size="small" class="mt">
          <template #empty><span class="muted">No purchases yet</span></template>
          <Column header="Receipt"><template #body="{ data }"><RouterLink class="mono" :to="`/sales?receipt=${data.receiptNo}`">{{ data.receiptNo }}</RouterLink></template></Column>
          <Column header="Date"><template #body="{ data }">{{ dateTime(data.createdAt) }}</template></Column>
          <Column header="Total" class="right"><template #body="{ data }">{{ m(data.total) }}</template></Column>
          <Column header="Points" class="right"><template #body="{ data }">+{{ data.pointsEarned }}<span v-if="data.pointsRedeemed" class="neg"> −{{ data.pointsRedeemed }}</span></template></Column>
        </DataTable>
        <DataTable v-else :value="points" size="small" class="mt">
          <template #empty><span class="muted">No points activity</span></template>
          <Column header="Date"><template #body="{ data }">{{ dateTime(data.createdAt) }}</template></Column>
          <Column header="Type"><template #body="{ data }">{{ humanize(data.type) }}<div v-if="data.note" class="small muted">{{ data.note }}</div></template></Column>
          <Column header="Points" class="right"><template #body="{ data }"><span :class="data.points > 0 ? 'pos' : 'neg'">{{ data.points > 0 ? '+' : '' }}{{ data.points }}</span></template></Column>
          <Column header="Balance" class="right"><template #body="{ data }">{{ num(data.balanceAfter) }}</template></Column>
        </DataTable>
      </template>
    </Drawer>

    <Dialog v-model:visible="adjDlg" header="Adjust points" modal :style="{ width: '400px' }">
      <form class="form" @submit.prevent="adjust">
        <div class="field"><label>Points (negative to remove)</label><InputNumber v-model="adj.points" show-buttons fluid /></div>
        <div class="field"><label>Reason *</label><InputText v-model="adj.reason" required placeholder="Promotion, complaint…" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" :disabled="!adj.points" /></div>
      </form>
    </Dialog>
  </div>
</template>
