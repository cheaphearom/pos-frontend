<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '@/api/client';
import type { Category } from '@/api/types';
import { useNotify } from '@/composables/useNotify';

const notify = useNotify();
const confirm = useConfirm();
const rows = ref<Category[]>([]);
const loading = ref(false);
const dialog = ref(false);
const form = reactive({ id: '', name: '', parentId: null as string | null });

const nameOf = (id: string | null) => rows.value.find((c) => c.id === id)?.name ?? '—';
const parents = computed(() => rows.value.filter((c) => c.id !== form.id));

async function load() {
  loading.value = true;
  try { rows.value = await api.get('/categories'); } catch (e) { notify.error(e); } finally { loading.value = false; }
}
function open(c?: Category) {
  Object.assign(form, c ? { id: c.id, name: c.name, parentId: c.parentId } : { id: '', name: '', parentId: null });
  dialog.value = true;
}
async function save() {
  try {
    const body = { name: form.name, parentId: form.parentId ?? undefined };
    if (form.id) await api.patch(`/categories/${form.id}`, body);
    else await api.post('/categories', body);
    dialog.value = false;
    notify.success('Category saved');
    load();
  } catch (e) { notify.error(e); }
}
function remove(c: Category) {
  confirm.require({
    header: 'Delete category',
    message: `Delete "${c.name}"? Its ${c._count?.products ?? 0} products become uncategorised.`,
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', text: true },
    accept: async () => {
      try { await api.del(`/categories/${c.id}`); load(); } catch (e) { notify.error(e); }
    },
  });
}
onMounted(load);
</script>

<template>
  <div class="page" style="max-width: 900px">
    <div class="page-head">
      <h1>Categories</h1>
      <div class="actions"><Button label="New category" icon="pi pi-plus" @click="open()" /></div>
    </div>
    <div class="card">
      <DataTable :value="rows" :loading="loading" size="small">
        <Column field="name" header="Name" />
        <Column header="Parent"><template #body="{ data }">{{ nameOf(data.parentId) }}</template></Column>
        <Column header="Products" class="right"><template #body="{ data }">{{ data._count?.products ?? 0 }}</template></Column>
        <Column class="right" style="width: 110px">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded aria-label="Edit" @click="open(data)" />
            <Button icon="pi pi-trash" text rounded severity="danger" aria-label="Delete" @click="remove(data)" />
          </template>
        </Column>
      </DataTable>
    </div>
    <Dialog v-model:visible="dialog" :header="form.id ? 'Edit category' : 'New category'" modal :style="{ width: '420px' }">
      <form class="form" @submit.prevent="save">
        <div class="field"><label>Name</label><InputText v-model="form.name" required autofocus /></div>
        <div class="field"><label>Parent category</label><Select v-model="form.parentId" :options="parents" option-label="name" option-value="id" show-clear placeholder="None (top level)" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" /></div>
      </form>
    </Dialog>
  </div>
</template>
