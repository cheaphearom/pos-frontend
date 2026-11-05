<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { ROLE_LABEL, type Role } from '@/api/types';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { dateTime } from '@/utils/format';

const auth = useAuth();
const app = useApp();
const notify = useNotify();
const list = usePagedList('/users', { search: '', role: null, storeId: null });

const roleOptions = computed(() =>
  (Object.keys(ROLE_LABEL) as Role[])
    .filter((r) => auth.isAdmin || r === 'CASHIER')
    .map((r) => ({ value: r, label: ROLE_LABEL[r] })),
);
const allRoles = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }));
const severity: Record<Role, string> = { SUPER_ADMIN: 'danger', STORE_MANAGER: 'info', CASHIER: 'secondary' };

const dialog = ref(false);
const saving = ref(false);
const empty = () => ({ id: '', email: '', fullName: '', phone: '', password: '', role: 'CASHIER' as Role, storeIds: [] as string[], isActive: true });
const form = reactive(empty());

function open(u?: any) {
  Object.assign(form, u ? { ...u, phone: u.phone ?? '', password: '', storeIds: u.stores.map((s: any) => s.id) } : { ...empty(), storeIds: app.currentStoreId ? [app.currentStoreId] : [] });
  dialog.value = true;
}
async function save() {
  saving.value = true;
  try {
    const body: any = {
      email: form.email, fullName: form.fullName, phone: form.phone || undefined, role: form.role,
      storeIds: form.role === 'SUPER_ADMIN' ? [] : form.storeIds,
    };
    if (form.password) body.password = form.password;
    if (form.id) await api.patch(`/users/${form.id}`, { ...body, isActive: form.isActive });
    else await api.post('/users', body);
    notify.success('User saved', form.fullName);
    dialog.value = false;
    list.load();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}
onMounted(list.load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Users</h1><div class="sub">Staff accounts and which stores they work in</div></div>
      <div class="actions"><Button label="New user" icon="pi pi-user-plus" @click="open()" /></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="list.filters.search" placeholder="Name or email" /></IconField>
        <Select v-model="list.filters.role" :options="allRoles" option-label="label" option-value="value" placeholder="All roles" show-clear />
        <Select v-model="list.filters.storeId" :options="app.stores" option-label="name" option-value="id" placeholder="All stores" show-clear />
      </div>
      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :loading="list.loading.value" size="small" @page="list.onPage" @row-click="open($event.data)" :row-class="() => 'clickable'">
        <Column header="Name">
          <template #body="{ data }">{{ data.fullName }} <Tag v-if="!data.isActive" value="inactive" severity="secondary" /><div class="small muted">{{ data.email }}</div></template>
        </Column>
        <Column header="Role"><template #body="{ data }"><Tag :value="ROLE_LABEL[data.role as Role]" :severity="severity[data.role as Role]" /></template></Column>
        <Column header="Stores"><template #body="{ data }">{{ data.role === 'SUPER_ADMIN' ? 'All stores' : data.stores.map((s: any) => s.code).join(', ') || '—' }}</template></Column>
        <Column header="Last login"><template #body="{ data }">{{ dateTime(data.lastLoginAt) || 'never' }}</template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dialog" :header="form.id ? 'Edit user' : 'New user'" modal :style="{ width: '560px' }" :breakpoints="{ '720px': '95vw' }">
      <form class="form" @submit.prevent="save">
        <div class="form-2">
          <div class="field"><label>Full name *</label><InputText v-model="form.fullName" required /></div>
          <div class="field"><label>Phone</label><InputText v-model="form.phone" /></div>
        </div>
        <div class="field"><label>Email *</label><InputText v-model="form.email" type="email" required /></div>
        <div class="field">
          <label>{{ form.id ? 'New password' : 'Password *' }}</label>
          <Password v-model="form.password" :required="!form.id" toggle-mask fluid :input-props="{ autocomplete: 'new-password', minlength: 8 }" />
          <span class="hint">{{ form.id ? 'Leave empty to keep the current password. ' : '' }}At least 8 characters.</span>
        </div>
        <div class="form-2">
          <div class="field"><label>Role *</label><Select v-model="form.role" :options="roleOptions" option-label="label" option-value="value" :disabled="form.id === auth.user?.id" /></div>
          <div v-if="form.role !== 'SUPER_ADMIN'" class="field">
            <label>Stores *</label>
            <MultiSelect v-model="form.storeIds" :options="app.stores" option-label="name" option-value="id" placeholder="Select stores" display="chip" />
          </div>
        </div>
        <label v-if="form.id && form.id !== auth.user?.id" class="row"><ToggleSwitch v-model="form.isActive" /> Active (can log in)</label>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" :loading="saving" /></div>
      </form>
    </Dialog>
  </div>
</template>
