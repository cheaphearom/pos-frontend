<script setup lang="ts">
import { reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';

const notify = useNotify();
const list = usePagedList('/suppliers', { search: '' });
list.load();
const dlg = ref(false);
const saving = ref(false);
const empty = () => ({ id: '', code: '', name: '', contactName: '', phone: '', email: '', address: '', taxId: '', paymentTermsDays: 0, note: '', isActive: true });
const form = reactive(empty());

function open(s?: any) {
  Object.assign(form, empty(), s ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v ?? ''])) : {});
  dlg.value = true;
}
async function save() {
  saving.value = true;
  try {
    const { id, isActive, ...rest } = form as any;
    const body = Object.fromEntries(Object.entries(rest).filter(([k, v]) => v !== '' && !['_count', 'createdAt', 'updatedAt'].includes(k)));
    if (id) await api.patch(`/suppliers/${id}`, { ...body, isActive });
    else await api.post('/suppliers', body);
    notify.success('Supplier saved', form.name);
    dlg.value = false;
    list.load();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Suppliers</h1><div class="sub">Companies you buy stock from (shared by all stores)</div></div>
      <div class="actions"><Button label="New supplier" icon="pi pi-plus" @click="open()" /></div>
    </div>
    <div class="card">
      <div class="toolbar"><IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Name, code or phone" /></IconField></div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :loading="list.loading.value" size="small" @page="list.onPage" @row-click="open($event.data)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No suppliers yet</span></template>
        <Column header="Code"><template #body="{ data }"><span class="mono">{{ data.code }}</span></template></Column>
        <Column header="Name"><template #body="{ data }">{{ data.name }} <Tag v-if="!data.isActive" value="inactive" severity="secondary" /></template></Column>
        <Column field="contactName" header="Contact" />
        <Column field="phone" header="Phone" />
        <Column header="Terms"><template #body="{ data }">{{ data.paymentTermsDays ? `${data.paymentTermsDays} days` : 'On delivery' }}</template></Column>
        <Column header="Orders" class="right"><template #body="{ data }">{{ data._count?.purchaseOrders ?? 0 }}</template></Column>
      </DataTable>
    </div>
    <Dialog v-model:visible="dlg" :header="form.id ? 'Edit supplier' : 'New supplier'" modal :style="{ width: '600px' }" :breakpoints="{ '720px': '95vw' }">
      <form class="form" @submit.prevent="save">
        <div class="form-2">
          <div class="field"><label>Code *</label><InputText v-model="form.code" required maxlength="30" /></div>
          <div class="field"><label>Name *</label><InputText v-model="form.name" required /></div>
        </div>
        <div class="form-2">
          <div class="field"><label>Contact person</label><InputText v-model="form.contactName" /></div>
          <div class="field"><label>Phone</label><InputText v-model="form.phone" /></div>
        </div>
        <div class="form-2">
          <div class="field"><label>Email</label><InputText v-model="form.email" type="email" /></div>
          <div class="field"><label>Tax ID (VAT TIN)</label><InputText v-model="form.taxId" /></div>
        </div>
        <div class="field"><label>Address</label><InputText v-model="form.address" /></div>
        <div class="form-2">
          <div class="field"><label>Payment terms (days)</label><InputNumber v-model="form.paymentTermsDays" :min="0" fluid /></div>
          <div v-if="form.id" class="field"><label>Status</label><label class="row"><ToggleSwitch v-model="form.isActive" /> Active</label></div>
        </div>
        <div class="field"><label>Note</label><Textarea v-model="form.note" rows="2" auto-resize /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" :loading="saving" /></div>
      </form>
    </Dialog>
  </div>
</template>
