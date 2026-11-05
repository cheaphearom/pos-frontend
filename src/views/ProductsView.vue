<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import type { Category, Product } from '@/api/types';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { money, qty } from '@/utils/format';

const auth = useAuth();
const app = useApp();
const notify = useNotify();
const categories = ref<Category[]>([]);
const list = usePagedList<Product>('/products', { search: '', categoryId: null, storeId: app.currentStoreId, includeInactive: false, kind: null as string | null });

const cur = computed(() => app.currentStore?.currency ?? 'USD');
const empty = () => ({ id: '', sku: '', barcode: '', name: '', description: '', categoryId: null as string | null, unit: 'pcs', costPrice: 0, sellPrice: 0, taxable: true, trackStock: true, isActive: true, imageUrl: '', modifierGroupIds: [] as string[], isIngredient: false, onlineAvailable: false });
const pack = reactive({ size: null as number | null, price: null as number | null });
function applyPack() {
  if (pack.size && pack.price !== null) form.costPrice = Math.round((pack.price / pack.size) * 1e6) / 1e6;
}
watch(() => [pack.size, pack.price], applyPack);
const modifierGroups = ref<any[]>([]);
const dialog = ref(false);
const saving = ref(false);
const form = reactive(empty());

function openNew(ingredient = false) {
  Object.assign(form, empty(), ingredient ? { isIngredient: true, unit: 'g', taxable: false } : {});
  Object.assign(pack, { size: null, price: null });
  dialog.value = true;
}
function edit(p: Product) {
  Object.assign(form, {
    ...empty(), ...p, barcode: p.barcode ?? '', description: p.description ?? '', costPrice: Number(p.costPrice), sellPrice: Number(p.sellPrice),
    imageUrl: (p as any).imageUrl ?? '', modifierGroupIds: ((p as any).modifierGroups ?? []).map((m: any) => m.groupId),
    isIngredient: !!(p as any).isIngredient,
    onlineAvailable: !!(p as any).onlineAvailable,
  });
  Object.assign(pack, { size: null, price: null });
  dialog.value = true;
}

async function save() {
  saving.value = true;
  try {
    const { id, ...body } = form;
    const payload = { ...body, barcode: body.barcode || undefined, description: body.description || undefined, categoryId: body.categoryId || undefined, imageUrl: body.imageUrl || null };
    if (id) await api.patch(`/products/${id}`, payload);
    else await api.post('/products', { ...payload, isActive: undefined });
    notify.success(id ? 'Product updated' : 'Product created', form.name);
    dialog.value = false;
    list.load();
  } catch (e) {
    notify.error(e);
  } finally {
    saving.value = false;
  }
}

const margin = (p: Product) => {
  if ((p as any).isIngredient) return NaN;
  const price = Number(p.price ?? p.sellPrice);
  return price ? ((price - Number(p.costPrice)) / price) * 100 : 0;
};

onMounted(async () => {
  list.load();
  [categories.value, modifierGroups.value] = await Promise.all([api.get('/categories'), api.get('/modifiers').then((g) => g.filter((x: any) => x.isActive))]);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Products</h1>
        <div class="sub">Shared catalogue for all stores · price and stock shown for {{ app.currentStore?.code }}</div>
      </div>
      <div class="actions">
        <Button v-if="auth.isAdmin" label="New ingredient" icon="pi pi-plus" severity="secondary" @click="openNew(true)" />
        <Button v-if="auth.isAdmin" label="New product" icon="pi pi-plus" @click="openNew()" />
      </div>
    </div>

    <div class="card">
      <div class="toolbar">
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText v-model="list.filters.search" placeholder="Name, SKU or barcode" />
        </IconField>
        <Select v-model="list.filters.categoryId" :options="categories" option-label="name" option-value="id" placeholder="All categories" show-clear />
        <SelectButton v-model="list.filters.kind" :options="[{ l: 'For sale', v: 'sellable' }, { l: 'Ingredients', v: 'ingredient' }]" option-label="l" option-value="v" />
        <label class="row small"><ToggleSwitch v-model="list.filters.includeInactive" /> Show inactive</label>
      </div>

      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :rows-per-page-options="[25, 50, 100]" :loading="list.loading.value" data-key="id" size="small" striped-rows
        @page="list.onPage" @row-click="auth.isAdmin && edit($event.data)" :row-class="() => (auth.isAdmin ? 'clickable' : '')">
        <template #empty><span class="muted">No products found</span></template>
        <Column field="sku" header="SKU"><template #body="{ data }"><span class="mono">{{ data.sku }}</span></template></Column>
        <Column field="name" header="Name">
          <template #body="{ data }">
            {{ data.name }} <Tag v-if="!data.isActive" value="inactive" severity="secondary" />
            <Tag v-if="data.isIngredient" value="ingredient" severity="warn" style="margin-left: 4px" />
            <Tag v-if="data.modifierGroups?.length" :value="`${data.modifierGroups.length} options`" severity="info" style="margin-left: 4px" />
            <div class="small muted mono">{{ data.barcode }}</div>
          </template>
        </Column>
        <Column header="Category"><template #body="{ data }">{{ data.category?.name ?? '—' }}</template></Column>
        <Column header="Cost" class="right"><template #body="{ data }">{{ data.isIngredient ? '$' + Number(data.costPrice).toFixed(4) + ' / ' + data.unit : money(data.costPrice, cur) }}</template></Column>
        <Column header="Price" class="right">
          <template #body="{ data }">
            {{ money(data.price ?? data.sellPrice, cur) }}
            <i v-if="data.price && data.price !== data.sellPrice" class="pi pi-tag small muted" v-tooltip="`Store price. Default ${money(data.sellPrice, cur)}`" />
          </template>
        </Column>
        <Column header="Margin" class="right"><template #body="{ data }">{{ isNaN(margin(data)) ? '—' : margin(data).toFixed(0) + '%' }}</template></Column>
        <Column header="Stock" class="right">
          <template #body="{ data }">
            <span v-if="!data.trackStock" class="muted">service</span>
            <span v-else :class="{ neg: Number(data.stock) <= 0 }">{{ qty(data.stock) }} {{ data.unit }}</span>
          </template>
        </Column>
        <Column header="Tax" class="right"><template #body="{ data }"><i :class="data.taxable ? 'pi pi-check' : 'pi pi-minus muted'" /></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="dialog" :header="form.id ? 'Edit product' : 'New product'" modal :style="{ width: '640px' }" :breakpoints="{ '720px': '95vw' }">
      <form class="form" @submit.prevent="save">
        <div class="form-2">
          <div class="field"><label>SKU *</label><InputText v-model="form.sku" required /></div>
          <div class="field"><label>Barcode</label><InputText v-model="form.barcode" placeholder="Scan or type" /></div>
        </div>
        <div class="field"><label>Name *</label><InputText v-model="form.name" required /></div>
        <div class="form-2">
          <div class="field"><label>Category</label><Select v-model="form.categoryId" :options="categories" option-label="name" option-value="id" show-clear placeholder="None" /></div>
          <div class="field"><label>Unit</label><InputText v-model="form.unit" placeholder="pcs, kg, box…" /></div>
        </div>
        <div class="form-2">
          <div class="field"><label>Cost per {{ form.unit || 'unit' }}</label><InputNumber v-model="form.costPrice" mode="decimal" :min-fraction-digits="2" :max-fraction-digits="6" :min="0" fluid /></div>
          <div v-if="!form.isIngredient" class="field"><label>Selling price * <span class="hint">(before tax)</span></label><InputNumber v-model="form.sellPrice" mode="decimal" :min-fraction-digits="2" :max-fraction-digits="2" :min="0" fluid /></div>
          <div v-else class="field">
            <label>Or from a pack <span class="hint">(e.g. 1000 {{ form.unit }} for $1.60)</span></label>
            <div class="row"><InputNumber v-model="pack.size" placeholder="Pack size" :min="0" fluid /><InputNumber v-model="pack.price" placeholder="Pack price" :min="0" :min-fraction-digits="2" fluid /></div>
          </div>
        </div>
        <div class="field"><label>Description</label><Textarea v-model="form.description" rows="2" auto-resize /></div>
        <div v-if="!form.isIngredient" class="field">
          <label>Drink options <span class="hint">(customer chooses at the POS, in this order)</span></label>
          <MultiSelect v-model="form.modifierGroupIds" :options="modifierGroups" option-label="name" option-value="id" display="chip" placeholder="None" />
        </div>
        <div v-if="!form.isIngredient" class="field"><label>Photo URL <span class="hint">(shown on the POS tile)</span></label><InputText v-model="form.imageUrl" placeholder="https://…/latte.jpg" /></div>
        <div class="row" style="gap: 24px; flex-wrap: wrap">
          <label class="row"><ToggleSwitch v-model="form.isIngredient" /> Ingredient (used in recipes, not sold)</label>
          <label class="row"><ToggleSwitch v-model="form.taxable" /> Taxable</label>
          <label class="row"><ToggleSwitch v-model="form.trackStock" /> Track stock</label>
          <label v-if="!form.isIngredient" class="row"><ToggleSwitch v-model="form.onlineAvailable" /> Sell online</label>
          <label v-if="form.id" class="row"><ToggleSwitch v-model="form.isActive" /> Active (for sale)</label>
        </div>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" severity="secondary" text @click="dialog = false" />
          <Button type="submit" label="Save" icon="pi pi-check" :loading="saving" />
        </div>
      </form>
    </Dialog>
  </div>
</template>
