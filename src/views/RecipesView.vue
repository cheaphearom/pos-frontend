<script setup lang="ts">
/** Recipes: what each drink uses (beans, milk, cups…), how options change it, and the real cost per cup. */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import type { Product } from '@/api/types';
import ProductPicker from '@/components/ProductPicker.vue';
import { useNotify } from '@/composables/useNotify';
import { useAuth } from '@/stores/auth';
import { money } from '@/utils/format';

const auth = useAuth();
const notify = useNotify();
const rows = ref<any[]>([]);
const loading = ref(false);
const search = ref('');
const ingredients = ref<any[]>([]);
const ingName = (id?: string | null) => ingredients.value.find((i) => i.id === id)?.name ?? '?';
const ingUnit = (id?: string | null) => ingredients.value.find((i) => i.id === id)?.unit ?? '';
const shown = computed(() => rows.value.filter((r) => !search.value || r.name.toLowerCase().includes(search.value.toLowerCase())));
const marginClass = (m: number | null) => (m === null ? 'muted' : m < 50 ? 'neg' : m < 65 ? 'warnc' : 'pos');
const c4 = (v: number) => '$' + Number(v).toFixed(4);

async function load() {
  loading.value = true;
  try { rows.value = await api.get('/recipes'); } catch (e) { notify.error(e); } finally { loading.value = false; }
}
async function loadIngredients() {
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const r = await api.get('/products', { kind: 'ingredient', page, limit: 200 });
    all.push(...r.data);
    if (page >= r.meta.totalPages) break;
  }
  ingredients.value = all;
}

// ── Editor
const show = ref(false);
const rec = ref<any>(null);
const items = ref<{ ingredientId: string; quantity: number }[]>([]);
const saving = ref(false);
const baseCost = computed(() => items.value.reduce((s, i) => s + i.quantity * Number(ingredients.value.find((x) => x.id === i.ingredientId)?.costPrice ?? 0), 0));
async function open(r: any) {
  try {
    rec.value = await api.get(`/recipes/${r.id}`);
    items.value = rec.value.recipe.map((x: any) => ({ ingredientId: x.ingredientId, quantity: Number(x.quantity) }));
    for (const g of rec.value.groups) chosen[g.id] = g.options.find((o: any) => o.isDefault)?.id ?? null;
    show.value = true;
    refreshPreview();
  } catch (e) { notify.error(e); }
}
function addIngredient(p: Product) {
  if (!items.value.some((i) => i.ingredientId === p.id)) items.value.push({ ingredientId: p.id, quantity: 1 });
}
async function saveRecipe() {
  saving.value = true;
  try {
    await api.put(`/recipes/${rec.value.id}`, { items: items.value.filter((i) => i.quantity > 0) });
    notify.success('Recipe saved', rec.value.name);
    load();
    refreshPreview();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}

// ── Preview with options
const chosen = reactive<Record<string, string | null>>({});
const preview = ref<any>(null);
async function refreshPreview() {
  if (!rec.value) return;
  const ids = Object.values(chosen).filter(Boolean).join(',');
  preview.value = await api.get(`/recipes/${rec.value.id}/preview`, { options: ids }).catch(() => null);
}
watch(chosen, refreshPreview, { deep: true });
const previewPrice = computed(() => {
  if (!rec.value) return 0;
  const extra = rec.value.groups.reduce((s: number, g: any) => s + Number(g.options.find((o: any) => o.id === chosen[g.id])?.priceDelta ?? 0), 0);
  return Number(rec.value.sellPrice) + extra;
});

// ── Option effects
const effDlg = ref(false);
const effOption = ref<any>(null);
const effects = ref<any[]>([]);
function describeEffect(e: any) {
  if (e.type === 'SCALE') return `${Number(e.percent) > 0 ? '+' : ''}${Number(e.percent)}% ${e.ingredientId ? ingName(e.ingredientId) : 'all (not pieces)'}`;
  if (e.type === 'REPLACE') return `${ingName(e.ingredientId)} → ${ingName(e.replaceWithId)}`;
  return `+${Number(e.quantity)} ${ingUnit(e.ingredientId)} ${ingName(e.ingredientId)}`;
}
function editEffects(o: any) {
  effOption.value = o;
  effects.value = o.effects.map((e: any) => ({ ...e, quantity: e.quantity === null ? null : Number(e.quantity), percent: e.percent === null ? null : Number(e.percent) }));
  effDlg.value = true;
}
async function saveEffects() {
  try {
    const clean = effects.value.map((e) => ({
      type: e.type, ingredientId: e.ingredientId || undefined, replaceWithId: e.type === 'REPLACE' ? e.replaceWithId : undefined,
      quantity: e.type === 'ADD' ? e.quantity : undefined, percent: e.type === 'SCALE' ? e.percent : undefined,
    }));
    effOption.value.effects = await api.put(`/recipes/options/${effOption.value.id}/effects`, { effects: clean });
    effDlg.value = false;
    notify.success('Option saved', 'Applies to every drink with this option');
    load();
    refreshPreview();
  } catch (e) { notify.error(e); }
}
const TYPES = [{ v: 'SCALE', l: 'Scale %' }, { v: 'REPLACE', l: 'Replace' }, { v: 'ADD', l: 'Add' }];

onMounted(() => {
  load();
  loadIngredients();
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Recipes</h1><div class="sub">What each drink uses. Every sale takes the ingredients out of stock and records the real cost per cup.</div></div>
    </div>
    <div class="card">
      <div class="toolbar"><IconField><InputIcon class="pi pi-search" /><InputText v-model="search" placeholder="Drink or dish" /></IconField></div>
      <DataTable :value="shown" :loading="loading" size="small" @row-click="open($event.data)" :row-class="() => 'clickable'">
        <template #empty><span class="muted">No drinks yet</span></template>
        <Column header="Product"><template #body="{ data }"><b>{{ data.name }}</b> <span class="mono small muted">{{ data.sku }}</span></template></Column>
        <Column header="Ingredients" class="right"><template #body="{ data }"><span :class="{ neg: !data.ingredients }">{{ data.ingredients || 'no recipe' }}</span></template></Column>
        <Column header="Price" class="right"><template #body="{ data }">{{ money(data.price) }}</template></Column>
        <Column header="Cost (default options)" class="right"><template #body="{ data }">{{ data.recipeCost === null ? '—' : c4(data.recipeCost) }}</template></Column>
        <Column header="Margin" class="right"><template #body="{ data }"><b :class="marginClass(data.marginPercent)">{{ data.marginPercent === null ? '—' : data.marginPercent + '%' }}</b></template></Column>
      </DataTable>
    </div>

    <Drawer v-model:visible="show" position="right" :header="rec?.name" style="width: min(760px, 100vw)">
      <template v-if="rec">
        <h3>Base recipe <span class="small muted">(one {{ rec.unit }}, default size)</span></h3>
        <ProductPicker v-if="auth.isAdmin" kind="ingredient" placeholder="Add an ingredient…" @select="addIngredient" />
        <DataTable :value="items" size="small" class="mt">
          <template #empty><span class="muted">No ingredients yet. Add beans, milk, cups…</span></template>
          <Column header="Ingredient"><template #body="{ data }">{{ ingName(data.ingredientId) }}</template></Column>
          <Column header="Quantity" style="width: 170px">
            <template #body="{ data }">
              <div class="row"><InputNumber v-model="data.quantity" :min="0" :max-fraction-digits="4" size="small" :input-style="{ width: '90px' }" :disabled="!auth.isAdmin" /><span class="muted small">{{ ingUnit(data.ingredientId) }}</span></div>
            </template>
          </Column>
          <Column header="Cost" class="right"><template #body="{ data }">{{ c4(data.quantity * Number(ingredients.find((x) => x.id === data.ingredientId)?.costPrice ?? 0)) }}</template></Column>
          <Column v-if="auth.isAdmin" style="width: 40px"><template #body="{ index }"><Button icon="pi pi-times" text rounded size="small" severity="secondary" aria-label="Remove" @click="items.splice(index, 1)" /></template></Column>
        </DataTable>
        <div class="row mt" style="justify-content: space-between">
          <span>Base cost <b>{{ c4(baseCost) }}</b> · price {{ money(rec.sellPrice) }}</span>
          <Button v-if="auth.isAdmin" label="Save recipe" icon="pi pi-check" :loading="saving" @click="saveRecipe" />
        </div>

        <h3 class="mt">How options change it</h3>
        <p class="small muted" style="margin-top: 0">Effects belong to the option, so "Large" or "Oat milk" work the same for every drink.</p>
        <div v-for="g in rec.groups" :key="g.id" class="grp">
          <b>{{ g.name }}</b>
          <div v-for="o in g.options" :key="o.id" class="opt row">
            <span class="oname">{{ o.name }}</span>
            <span class="small muted" style="flex: 1">{{ o.effects.length ? o.effects.map(describeEffect).join(' · ') : 'no change' }}</span>
            <Button v-if="auth.isAdmin" label="Edit" text size="small" @click="editEffects(o)" />
          </div>
        </div>

        <h3 class="mt">Try it</h3>
        <div class="row" style="flex-wrap: wrap; gap: 8px">
          <Select v-for="g in rec.groups" :key="g.id" v-model="chosen[g.id]" :options="g.options" option-label="name" option-value="id" :placeholder="g.name" show-clear size="small" />
        </div>
        <div v-if="preview" class="card mt">
          <DataTable :value="preview.usage" size="small">
            <Column field="name" header="Uses" />
            <Column header="Quantity" class="right"><template #body="{ data }">{{ data.quantity }} {{ data.unit }}</template></Column>
            <Column header="Cost" class="right"><template #body="{ data }">{{ c4(data.cost) }}</template></Column>
          </DataTable>
          <div class="row mt" style="justify-content: space-between">
            <span>Cost <b>{{ c4(preview.unitCost ?? 0) }}</b> · price {{ money(previewPrice) }}</span>
            <b :class="marginClass(previewPrice ? ((previewPrice - (preview.unitCost ?? 0)) / previewPrice) * 100 : null)">margin {{ previewPrice ? (((previewPrice - (preview.unitCost ?? 0)) / previewPrice) * 100).toFixed(1) : 0 }}%</b>
          </div>
        </div>
      </template>
    </Drawer>

    <Dialog v-model:visible="effDlg" :header="`Option: ${effOption?.name}`" modal :style="{ width: '680px' }" :breakpoints="{ '720px': '98vw' }">
      <div class="form">
        <div v-for="(e, i) in effects" :key="i" class="row" style="gap: 8px; flex-wrap: wrap">
          <Select v-model="e.type" :options="TYPES" option-label="l" option-value="v" style="width: 120px" />
          <template v-if="e.type === 'SCALE'">
            <InputNumber v-model="e.percent" suffix=" %" :min="-100" :input-style="{ width: '80px' }" />
            <Select v-model="e.ingredientId" :options="ingredients" option-label="name" option-value="id" placeholder="All except pieces" show-clear filter style="flex: 1" />
          </template>
          <template v-else-if="e.type === 'REPLACE'">
            <Select v-model="e.ingredientId" :options="ingredients" option-label="name" option-value="id" placeholder="Replace" filter style="flex: 1" />
            <span>→</span>
            <Select v-model="e.replaceWithId" :options="ingredients" option-label="name" option-value="id" placeholder="With" filter style="flex: 1" />
          </template>
          <template v-else>
            <InputNumber v-model="e.quantity" :min="0" :max-fraction-digits="4" :input-style="{ width: '80px' }" />
            <span class="muted small">{{ ingUnit(e.ingredientId) }}</span>
            <Select v-model="e.ingredientId" :options="ingredients" option-label="name" option-value="id" placeholder="Ingredient" filter style="flex: 1" />
          </template>
          <Button icon="pi pi-times" text rounded severity="secondary" aria-label="Remove" @click="effects.splice(i, 1)" />
        </div>
        <Button label="Add effect" icon="pi pi-plus" text size="small" style="justify-self: start" @click="effects.push({ type: 'ADD', ingredientId: null, quantity: 1, percent: null })" />
        <Message severity="secondary" :closable="false" size="small">Order: base recipe → scale → replace → add. Example: Large = scale +30% and replace Cup 12oz → Cup 16oz.</Message>
        <div class="row" style="justify-content: flex-end"><Button label="Save" icon="pi pi-check" @click="saveEffects" /></div>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.grp { display: grid; gap: 2px; margin-bottom: 10px; }
.opt { padding: 2px 0 2px 12px; border-left: 2px solid var(--border); }
.oname { width: 120px; }
.warnc { color: #b45309; }
</style>
