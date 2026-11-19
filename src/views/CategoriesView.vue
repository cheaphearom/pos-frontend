<!-- Copyright (c) 2026 Chea Phearom. All rights reserved. Proprietary and confidential: see the LICENSE file. -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '@/api/client';
import type { Category } from '@/api/types';
import { useNotify } from '@/composables/useNotify';
import { categoryColor } from '@/utils/colors';

const notify = useNotify();
const confirm = useConfirm();
const rows = ref<Category[]>([]);
const loading = ref(false);
const dialog = ref(false);
const form = reactive({ id: '', name: '', nameKm: '', parentId: null as string | null });

const parents = computed(() => rows.value.filter((c) => c.id !== form.id));

async function load() {
  loading.value = true;
  try { rows.value = await api.get('/categories'); } catch (e) { notify.error(e); } finally { loading.value = false; }
}
function open(c?: Category, parentId: string | null = null) {
  Object.assign(form, c ? { id: c.id, name: c.name, nameKm: (c as any).nameKm ?? '', parentId: c.parentId } : { id: '', name: '', nameKm: '', parentId });
  dialog.value = true;
}

// ── List: each group (or stand-alone category), followed by its categories
/** Same colours as the category tiles on the cashier screen */
const color = (id: string) => categoryColor(rows.value, id);
const q = ref('');
const hideEmpty = ref(false);
const count = (c: Category) => c._count?.products ?? 0;
const kidsOf = (id: string) => rows.value.filter((c) => c.parentId === id);
const total = (c: Category): number => count(c) + kidsOf(c.id).reduce((n, k) => n + total(k), 0);
const matches = (c: Category) => { const s = q.value.trim().toLowerCase(); return !s || c.name.toLowerCase().includes(s) || ((c as any).nameKm ?? '').toLowerCase().includes(s); };
const cards = computed(() => {
  const known = new Set(rows.value.map((c) => c.id));
  return rows.value
    .filter((c) => !c.parentId || !known.has(c.parentId))
    .map((g) => ({ ...g, kids: kidsOf(g.id).filter((k) => (!hideEmpty.value || total(k) > 0) && (matches(g) || matches(k))) }))
    .filter((g) => (!hideEmpty.value || total(g) > 0) && (matches(g) || g.kids.length))
    // groups with categories first, then the biggest
    .sort((a, b) => Number(b.kids.length > 0) - Number(a.kids.length > 0) || total(b) - total(a) || a.name.localeCompare(b.name));
});
/** Table rows: a group, then its categories (indented) */
const listRows = computed(() => cards.value.flatMap((g) => [{ ...g, depth: 0, isGroup: g.kids.length > 0 }, ...g.kids.map((k) => ({ ...k, depth: 1, isGroup: false }))]));
const nameOf = (id: string | null) => rows.value.find((c) => c.id === id)?.name ?? '—';
const stats = computed(() => {
  const known = new Set(rows.value.map((c) => c.id));
  const groups = rows.value.filter((c) => (!c.parentId || !known.has(c.parentId)) && kidsOf(c.id).length).length;
  return { groups, categories: rows.value.length - groups, products: rows.value.reduce((n, c) => n + count(c), 0), empty: rows.value.filter((c) => !total(c)).length };
});
async function save() {
  try {
    const body = { name: form.name, nameKm: form.nameKm.trim() || null, parentId: form.parentId ?? undefined };
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
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Categories</h1>
        <div class="sub">{{ stats.groups }} groups · {{ stats.categories }} categories · {{ stats.products }} products<template v-if="stats.empty"> · {{ stats.empty }} empty</template></div>
      </div>
      <div class="actions">
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="q" placeholder="Search categories" /></IconField>
        <label class="row small hide-empty"><ToggleSwitch v-model="hideEmpty" /> Hide empty</label>
        <Button label="New category" icon="pi pi-plus" @click="open()" />
      </div>
    </div>
    <div class="card">
      <DataTable :value="listRows" :loading="loading" data-key="id" size="small" :row-class="(r: any) => (r.depth ? 'sub-row' : r.isGroup ? 'group-row' : '')">
        <template #empty><span class="muted">{{ q ? 'No category matches your search.' : 'No categories yet.' }}</span></template>
        <Column header="Name">
          <template #body="{ data }">
            <span class="cname" :style="{ paddingLeft: data.depth * 26 + 'px', '--c': color(data.id) }">
              <i v-if="data.depth" class="pi pi-angle-right muted" />
              <span class="dot" />
              <b v-if="data.isGroup">{{ data.name }}</b><template v-else>{{ data.name }}</template>
              <span v-if="data.nameKm" class="muted small">· {{ data.nameKm }}</span>
              <span v-if="!total(data)" class="empty-tag">empty</span>
            </span>
          </template>
        </Column>
        <Column header="Group"><template #body="{ data }"><span :class="{ muted: !data.parentId }">{{ data.parentId ? nameOf(data.parentId) : data.isGroup ? `${data.kids.length} ${data.kids.length === 1 ? 'category' : 'categories'}` : '—' }}</span></template></Column>
        <Column header="Products" class="right"><template #body="{ data }"><span class="count" :class="{ zero: !total(data) }">{{ total(data) }}</span></template></Column>
        <Column class="right" style="width: 150px">
          <template #body="{ data }">
            <Button v-if="!data.depth" icon="pi pi-plus" text rounded aria-label="Add a category" v-tooltip.top="`Add a category to ${data.name}`" @click="open(undefined, data.id)" />
            <Button icon="pi pi-pencil" text rounded aria-label="Edit" @click="open(data)" />
            <Button icon="pi pi-trash" text rounded severity="danger" aria-label="Delete" @click="remove(data)" />
          </template>
        </Column>
      </DataTable>
    </div>
    <Dialog v-model:visible="dialog" :header="form.id ? 'Edit category' : 'New category'" modal :style="{ width: '420px' }">
      <form class="form" @submit.prevent="save">
        <div class="field"><label>Name</label><InputText v-model="form.name" required autofocus /></div>
        <div class="field"><label>Khmer name <span class="hint">(shown when the screen is in Khmer)</span></label><InputText v-model="form.nameKm" maxlength="100" /></div>
        <div class="field"><label>Parent category</label><Select v-model="form.parentId" :options="parents" option-label="name" option-value="id" show-clear placeholder="None (top level)" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" /></div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.hide-empty { gap: 6px; color: var(--text-2); }
.cname { display: inline-flex; align-items: center; gap: 8px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
.empty-tag { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); border: 1px dashed var(--border); border-radius: 999px; padding: 0 7px; }
.count { font-weight: 700; }
.count.zero { color: var(--text-3); font-weight: 500; }
:deep(.group-row) td { background: color-mix(in srgb, var(--bg) 70%, transparent); }
</style>
