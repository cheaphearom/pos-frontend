<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { api } from '@/api/client';
import type { Store } from '@/api/types';
import { useNotify } from '@/composables/useNotify';
import { useApp } from '@/stores/app';

const notify = useNotify();
const app = useApp();
const rows = ref<Store[]>([]);
const loading = ref(false);
const dialog = ref(false);
const saving = ref(false);
const empty = () => ({ id: '', code: '', name: '', address: '', phone: '', currency: 'USD', taxPercent: 10, isActive: true, khqrAccountId: '', khqrMerchantName: '', khqrCity: '', khqrMerchantId: '', khqrBank: '' });
const form = reactive(empty());

async function load() {
  loading.value = true;
  try { rows.value = await api.get('/stores', { includeInactive: true }); } catch (e) { notify.error(e); } finally { loading.value = false; }
}
function open(s?: Store) {
  Object.assign(form, s ? { ...empty(), ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ?? ''])), taxPercent: Number(s.taxRate) * 100 } : empty());
  dialog.value = true;
}
async function save() {
  saving.value = true;
  try {
    const body = {
      code: form.code.toUpperCase(), name: form.name, address: form.address || undefined, phone: form.phone || undefined,
      currency: form.currency.toUpperCase(), taxRate: Number((form.taxPercent / 100).toFixed(4)),
      khqrAccountId: form.khqrAccountId || null, khqrMerchantName: form.khqrMerchantName || null, khqrCity: form.khqrCity || null,
      khqrMerchantId: form.khqrMerchantId || null, khqrBank: form.khqrBank || null,
    };
    if (form.id) await api.patch(`/stores/${form.id}`, { ...body, isActive: form.isActive });
    else await api.post('/stores', body);
    notify.success('Store saved', form.name);
    dialog.value = false;
    await Promise.all([load(), app.loadStores()]);
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}
onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Stores</h1><div class="sub">Branches, their tax rate and currency</div></div>
      <div class="actions"><Button label="New store" icon="pi pi-plus" @click="open()" /></div>
    </div>
    <div class="card">
      <DataTable :value="rows" :loading="loading" size="small" row-hover @row-click="open($event.data)" :row-class="() => 'clickable'">
        <Column header="Code"><template #body="{ data }"><b class="mono">{{ data.code }}</b></template></Column>
        <Column field="name" header="Name" />
        <Column field="address" header="Address" />
        <Column field="phone" header="Phone" />
        <Column field="currency" header="Currency" />
        <Column header="Tax" class="right"><template #body="{ data }">{{ (Number(data.taxRate) * 100).toFixed(2).replace(/\.?0+$/, '') }}%</template></Column>
        <Column header="KHQR"><template #body="{ data }"><span v-if="data.khqrAccountId" class="mono small">{{ data.khqrAccountId }}</span><span v-else class="muted">off</span></template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="data.isActive ? 'active' : 'inactive'" :severity="data.isActive ? 'success' : 'secondary'" /></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dialog" :header="form.id ? 'Edit store' : 'New store'" modal :style="{ width: '560px' }" :breakpoints="{ '720px': '95vw' }">
      <form class="form" @submit.prevent="save">
        <div class="form-2">
          <div class="field"><label>Code *</label><InputText v-model="form.code" required maxlength="20" :disabled="!!form.id" /><span class="hint">Used in receipt numbers, e.g. PP01</span></div>
          <div class="field"><label>Name *</label><InputText v-model="form.name" required /></div>
        </div>
        <div class="field"><label>Address</label><InputText v-model="form.address" /></div>
        <div class="form-2">
          <div class="field"><label>Phone</label><InputText v-model="form.phone" /></div>
          <div class="field"><label>Currency</label><InputText v-model="form.currency" maxlength="3" /></div>
        </div>
        <div class="form-2">
          <div class="field"><label>Tax rate (%)</label><InputNumber v-model="form.taxPercent" :min="0" :max="100" :max-fraction-digits="2" suffix="%" fluid /></div>
          <div v-if="form.id" class="field"><label>Status</label><label class="row"><ToggleSwitch v-model="form.isActive" /> Active</label></div>
        </div>
        <h3 style="margin: 8px 0 0">KHQR payments (Bakong)</h3>
        <div class="form-2">
          <div class="field"><label>Bakong account ID</label><InputText v-model="form.khqrAccountId" placeholder="myshop@aclb" maxlength="32" /><span class="hint">Leave empty to turn KHQR off for this store</span></div>
          <div class="field"><label>Name shown to customers</label><InputText v-model="form.khqrMerchantName" maxlength="25" :placeholder="form.name.slice(0, 25)" /></div>
        </div>
        <div class="form-2">
          <div class="field"><label>City</label><InputText v-model="form.khqrCity" maxlength="15" placeholder="Phnom Penh" /></div>
          <div class="field"><label>Bank</label><InputText v-model="form.khqrBank" maxlength="32" placeholder="ACLEDA Bank Plc" /></div>
        </div>
        <div class="field"><label>Merchant ID <span class="hint">(only for Bakong merchant accounts)</span></label><InputText v-model="form.khqrMerchantId" maxlength="32" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" :loading="saving" /></div>
      </form>
    </Dialog>
  </div>
</template>
