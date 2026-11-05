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
const empty = () => ({ id: '', code: '', name: '', address: '', phone: '', currency: 'USD', taxPercent: 10, isActive: true });
const form = reactive(empty());

async function load() {
  loading.value = true;
  try { rows.value = await api.get('/stores', { includeInactive: true }); } catch (e) { notify.error(e); } finally { loading.value = false; }
}
function open(s?: Store) {
  Object.assign(form, s ? { ...s, address: s.address ?? '', phone: s.phone ?? '', taxPercent: Number(s.taxRate) * 100 } : empty());
  dialog.value = true;
}
async function save() {
  saving.value = true;
  try {
    const body = {
      code: form.code.toUpperCase(), name: form.name, address: form.address || undefined, phone: form.phone || undefined,
      currency: form.currency.toUpperCase(), taxRate: Number((form.taxPercent / 100).toFixed(4)),
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
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" :loading="saving" /></div>
      </form>
    </Dialog>
  </div>
</template>
