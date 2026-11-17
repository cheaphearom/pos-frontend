<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '@/api/client';
import type { Category } from '@/api/types';
import { useNotify } from '@/composables/useNotify';
import { categoryColor, initials } from '@/utils/colors';

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

// ── Cards: one per group (or stand-alone category), with its categories inside
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
    <div v-if="loading && !rows.length" class="muted">Loading…</div>
    <div v-else-if="!cards.length" class="card muted">{{ q ? 'No category matches your search.' : 'No categories yet.' }}</div>
    <div class="cat-grid">
      <article v-for="g in cards" :key="g.id" class="cat-card" :class="{ empty: !total(g) }" :style="{ '--c': color(g.id) }">
        <header>
          <span class="ico">{{ initials(g.name) }}</span>
          <div class="t">
            <h3>{{ g.name }}</h3>
            <span v-if="(g as any).nameKm" class="km">{{ (g as any).nameKm }}</span>
          </div>
          <div class="acts">
            <Button icon="pi pi-pencil" text rounded size="small" aria-label="Edit" @click="open(g)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label="Delete" @click="remove(g)" />
          </div>
        </header>
        <div class="big"><b>{{ total(g) }}</b> {{ total(g) === 1 ? 'product' : 'products' }}<span v-if="g.kids.length"> · {{ g.kids.length }} {{ g.kids.length === 1 ? 'category' : 'categories' }}</span><span v-if="!total(g)" class="tag">empty</span></div>
        <ul v-if="g.kids.length" class="kids">
          <li v-for="k in g.kids" :key="k.id" :class="{ empty: !total(k) }" :style="{ '--c': color(k.id) }">
            <span class="dot" />
            <span class="n">{{ k.name }} <small v-if="(k as any).nameKm" class="muted">{{ (k as any).nameKm }}</small></span>
            <span class="pill">{{ total(k) }}</span>
            <span class="kacts">
              <Button icon="pi pi-pencil" text rounded size="small" aria-label="Edit" @click="open(k)" />
              <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label="Delete" @click="remove(k)" />
            </span>
          </li>
        </ul>
        <button type="button" class="add-sub" :aria-label="`Add a category to ${g.name}`" @click="open(undefined, g.id)"><i class="pi pi-plus" /> Add a category</button>
      </article>
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
.cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 16px; align-items: start; }
.cat-card { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 16px 16px 12px; overflow: hidden; transition: transform .15s ease, box-shadow .15s ease; }
.cat-card::before { content: ''; position: absolute; inset: 0 0 auto; height: 4px; background: var(--c); }
.cat-card:hover { transform: translateY(-2px); box-shadow: 0 6px 22px rgba(60, 35, 15, .12); }
.cat-card.empty { opacity: .7; }
.cat-card header { display: flex; align-items: center; gap: 12px; }
.ico { flex-shrink: 0; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-weight: 800; color: #fff; background: var(--c); box-shadow: 0 4px 12px color-mix(in srgb, var(--c) 35%, transparent); }
.t { min-width: 0; flex: 1; }
.t h3 { margin: 0; font-size: 1.05rem; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.km { display: block; color: var(--text-3); font-size: .85rem; }
.acts, .kacts { display: flex; opacity: 0; transition: opacity .15s; }
.cat-card:hover .acts, .kids li:hover .kacts, .acts:focus-within, .kacts:focus-within { opacity: 1; }
.big { margin: 12px 0 4px; color: var(--text-2); font-size: .9rem; display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; }
.big b { font-size: 1.6rem; font-weight: 800; color: var(--text); margin-right: 2px; }
.tag { margin-left: auto; font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); border: 1px dashed var(--border); border-radius: 999px; padding: 1px 8px; }
.kids { list-style: none; margin: 8px 0 4px; padding: 0; border-top: 1px solid var(--border); }
.kids li { display: flex; align-items: center; gap: 8px; padding: 4px 0 4px 2px; border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent); min-height: 38px; }
.kids li.empty .n { color: var(--text-3); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
.n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill { font-size: .78rem; font-weight: 700; padding: 1px 9px; border-radius: 999px; background: color-mix(in srgb, var(--c) 14%, transparent); color: var(--c); }
.add-sub { margin-top: 8px; width: 100%; border: 1px dashed var(--border); background: transparent; color: var(--text-2); border-radius: 10px; padding: 7px; font: inherit; font-size: .85rem; cursor: pointer; transition: border-color .15s, color .15s, background .15s; }
.add-sub:hover { border-color: var(--c); color: var(--c); background: color-mix(in srgb, var(--c) 6%, transparent); }
@media (hover: none) { .acts, .kacts { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .cat-card, .cat-card:hover { transition: none; transform: none; } }
</style>
