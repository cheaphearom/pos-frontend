<!-- Copyright (c) 2026 Chea Phearom. All rights reserved. Proprietary and confidential: see the LICENSE file. -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '@/api/client';
import type { Category, Product } from '@/api/types';
import { useNotify } from '@/composables/useNotify';
import { usePagedList } from '@/composables/usePagedList';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';
import { money, qty } from '@/utils/format';
import { categoryColor, initials } from '@/utils/colors';

const auth = useAuth();
const app = useApp();
const notify = useNotify();
const categories = ref<Category[]>([]);
/** "Beverages › Hot Coffee": a category under a group shows its group first */
const catColor = (id?: string | null) => categoryColor(categories.value, id);
const catLabel = (id?: string | null) => catOptions.value.find((c) => c.id === id)?.label ?? '—';
/** Quick filter chips: groups and stand-alone categories */
const topCats = computed(() => categories.value.filter((c) => !c.parentId));
const badImg = reactive(new Set<string>());
const marginClass = (m: number) => (isNaN(m) ? '' : m >= 60 ? 'good' : m >= 30 ? 'ok' : 'low');
const catOptions = computed(() => categories.value
  .map((c) => { const parent = categories.value.find((x) => x.id === c.parentId); return { id: c.id, label: parent ? `${parent.name} › ${c.name}` : c.name }; })
  .sort((a, b) => a.label.localeCompare(b.label)));
const list = usePagedList<Product>('/products', { search: '', categoryId: null, storeId: app.currentStoreId, includeInactive: false, kind: null as string | null, listing: 'listed' as 'listed' | 'unlisted' | 'all' });
const listingOptions = computed(() => [
  { l: `Sold in ${app.currentStore?.code ?? 'this store'}`, v: 'listed' },
  { l: 'Not sold here', v: 'unlisted' },
  { l: 'All', v: 'all' },
]);

// ── Which stores sell the product, and their own price (empty = the normal selling price)
type StoreRow = { storeId: string; code: string; name: string; sells: boolean; price: number | null; was?: { sells: boolean; price: number | null }; sizes?: Record<string, number | null>; wasSizes?: string };
const storeRows = ref<StoreRow[]>([]);
const loadingStores = ref(false);
function initStores(inventory: any[], isNew: boolean) {
  storeRows.value = app.stores.map((s) => {
    const inv = inventory.find((i) => i.storeId === s.id);
    const sells = isNew ? s.id === app.currentStoreId : !!inv?.isListed;
    const price = inv?.priceOverride != null ? Number(inv.priceOverride) : null;
    return { storeId: s.id, code: s.code, name: s.name, sells, price, was: isNew ? undefined : { sells, price } };
  });
}
const storesChanged = (r: StoreRow) => !r.was || r.was.sells !== r.sells || r.was.price !== r.price;

// ── Drinks with sizes: the full price of each size (S / M / L) in each store
const sizes = ref<{ id: string; name: string }[]>([]);
const sized = computed(() => sizes.value.length > 0 && !form.isIngredient);
function initSizes(sp: { sizes: { id: string; name: string }[]; stores: { storeId: string; prices: Record<string, number | null> }[] } | null) {
  sizes.value = sp?.sizes ?? [];
  for (const r of storeRows.value) {
    const own = sp?.stores.find((x) => x.storeId === r.storeId)?.prices;
    r.sizes = Object.fromEntries(sizes.value.map((o) => [o.id, own?.[o.id] ?? null]));
    r.wasSizes = JSON.stringify(r.sizes);
  }
}
const sizesChanged = (r: StoreRow) => r.sells && JSON.stringify(r.sizes) !== r.wasSizes;

/** The store chosen at the top of the admin portal */
const hereRow = computed(() => storeRows.value.find((r) => r.storeId === app.currentStoreId) ?? null);

/** Turn "sold in this store" on or off from the list (super admin, or this store's manager). */
async function toggleListed(p: Product, on: boolean) {
  try {
    await api.put(`/inventory/${app.currentStoreId}/${p.id}`, { isListed: on });
    p.listed = on;
    notify.success(on ? `Now sold in ${app.currentStore?.code}` : `No longer sold in ${app.currentStore?.code}`, p.name);
    if (list.filters.listing !== 'all') list.load();
  } catch (e) {
    notify.error(e);
  }
}

const cur = computed(() => app.currentStore?.currency ?? 'USD');
const empty = () => ({ id: '', sku: '', barcode: '', name: '', nameKm: '', description: '', categoryId: null as string | null, unit: 'pcs', costPrice: 0, sellPrice: 0, taxable: true, trackStock: true, isActive: true, imageUrl: '', modifierGroupIds: [] as string[], isIngredient: false, onlineAvailable: false, madeInHouse: false, batchYield: 1, shelfLifeHours: null as number | null });
const pack = reactive({ size: null as number | null, price: null as number | null });
function applyPack() {
  if (pack.size && pack.price !== null) form.costPrice = Math.round((pack.price / pack.size) * 1e6) / 1e6;
}
watch(() => [pack.size, pack.price], applyPack);
const modifierGroups = ref<any[]>([]);
const dialog = ref(false);
const saving = ref(false);

// ── Bulk price change: tick products, choose the change, preview old → new, apply
const selected = ref<Product[]>([]);
const bulkDlg = ref(false);
const bulk = reactive({ scope: 'ALL' as 'ALL' | 'STORE', type: 'PERCENT' as 'PERCENT' | 'AMOUNT' | 'SET', value: null as number | null, round: null as number | null, busy: false, when: 'NOW' as 'NOW' | 'LATER', runAt: null as Date | null });
const fmtWhen = (d: Date | string | null) => (d ? new Date(d).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const minRunAt = computed(() => new Date(Date.now() + 2 * 60_000));
const bulkPreview = ref<any>(null);
/** The settings the preview was made with: Apply only applies what was previewed */
const bulkKey = computed(() => JSON.stringify([bulk.scope, bulk.type, bulk.value, bulk.round, app.currentStoreId, selected.value.map((p) => p.id)]));
const previewKey = ref('');
const bulkBody = () => ({
  productIds: selected.value.map((p) => p.id), scope: bulk.scope, storeId: bulk.scope === 'STORE' ? app.currentStoreId : undefined,
  change: { type: bulk.type, value: bulk.value }, round: bulk.round ?? undefined,
});
function openBulk() {
  Object.assign(bulk, { value: null, busy: false });
  bulkPreview.value = null;
  previewKey.value = '';
  bulkDlg.value = true;
}
async function previewBulk() {
  if (bulk.value === null) return notify.error(bulk.type === 'SET' ? 'Type the new price' : 'Type how much to change');
  if (bulk.type === 'SET' && bulk.value < 0) return notify.error('A price cannot be below $0');
  bulk.busy = true;
  try {
    bulkPreview.value = await api.post('/products/bulk-price/preview', bulkBody());
    previewKey.value = bulkKey.value;
  } catch (e) { notify.error(e); } finally { bulk.busy = false; }
}
async function applyBulk() {
  if (previewKey.value !== bulkKey.value) return previewBulk();
  if (bulk.when === 'LATER') return scheduleBulk();
  bulk.busy = true;
  try {
    const r = await api.post('/products/bulk-price', bulkBody());
    notify.success('Prices changed', `${r.changed} product(s)${r.skipped ? `, ${r.skipped} skipped` : ''}. Tills update within 5 minutes.`);
    bulkDlg.value = false;
    selected.value = [];
    list.load();
  } catch (e) { notify.error(e); } finally { bulk.busy = false; }
}
async function scheduleBulk() {
  if (!bulk.runAt) return notify.error('Choose the date and time');
  if (bulk.runAt.getTime() < Date.now() + 60_000) return notify.error('Choose a time at least 1 minute from now, or use Now');
  bulk.busy = true;
  try {
    await api.post('/products/bulk-price/schedule', { ...bulkBody(), runAt: bulk.runAt.toISOString() });
    notify.success('Price change scheduled', `${fmtWhen(bulk.runAt)}: ${bulkPreview.value?.changed ?? ''} product(s). See "Scheduled prices".`);
    bulkDlg.value = false;
    selected.value = [];
    loadSchedules();
  } catch (e) { notify.error(e); } finally { bulk.busy = false; }
}

// ── Scheduled price changes: list, cancel
const schedDlg = ref(false);
const schedules = ref<any[]>([]);
const pendingSchedules = computed(() => schedules.value.filter((x) => x.status === 'PENDING' || x.status === 'RUNNING').length);
async function loadSchedules() {
  if (!auth.isAdmin) return;
  try { schedules.value = await api.get('/products/price-schedules'); } catch { /* the list stays as it was */ }
}
async function cancelSchedule(x: any) {
  if (!confirm(`Cancel the price change "${x.label}" planned for ${fmtWhen(x.runAt)}?`)) return;
  try { await api.post(`/products/price-schedules/${x.id}/cancel`); notify.success('Scheduled price change cancelled'); loadSchedules(); } catch (e) { notify.error(e); }
}
const SCHED_STATUS: Record<string, { label: string; sev: string }> = {
  PENDING: { label: 'Waiting', sev: 'info' }, RUNNING: { label: 'Applying…', sev: 'warn' }, DONE: { label: 'Applied', sev: 'success' },
  FAILED: { label: 'Failed', sev: 'danger' }, CANCELLED: { label: 'Cancelled', sev: 'secondary' },
};
const changeHint = computed(() => (bulk.type === 'PERCENT' ? '10 = 10% more · -5 = 5% less' : bulk.type === 'AMOUNT' ? '0.25 = $0.25 more · -0.10 = $0.10 less' : 'The new price. Drinks with sizes: the smallest size gets this price, the others keep their difference.'));
const priceText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : money(v, cur.value));
/** A row click opens the product, but not when the tick box was clicked */
function onRowClick(e: any) {
  if (!auth.isAdmin || (e.originalEvent?.target as HTMLElement)?.closest('.p-checkbox, .p-datatable-selection-column, td:first-child input')) return;
  edit(e.data);
}
const form = reactive(empty());

// ── Photo: uploaded to this server (resized here first), or a web link
const photo = reactive({ file: null as Blob | null, preview: '', remove: false, link: false, busy: false, original: '' });
const fileInput = ref<HTMLInputElement | null>(null);
/** An uploaded photo (kept on this server), as opposed to a link to another website */
const ownPhoto = (url?: string | null) => !!url && /^\/api\/v1\/products\/[0-9a-f-]{36}\/image/i.test(url);
const photoShown = computed(() => (photo.remove ? '' : photo.preview || form.imageUrl));
function resetPhoto(original = '') {
  if (photo.preview.startsWith('blob:')) URL.revokeObjectURL(photo.preview);
  Object.assign(photo, { file: null, preview: '', remove: false, link: false, busy: false, original });
}
/** Longest side 800 px, WebP (JPEG where WebP is not available): a few dozen KB instead of a phone's 3-5 MB. */
async function resizeImage(file: Blob, max = 800): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
  const webp = await toBlob('image/webp', 0.85);
  if (webp && webp.type === 'image/webp') return webp;
  ctx.globalCompositeOperation = 'destination-over'; // JPEG has no transparency: white behind
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  const jpg = await toBlob('image/jpeg', 0.85);
  if (!jpg) throw new Error('resize failed');
  return jpg;
}
async function choosePhoto(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  if (!f.type.startsWith('image/')) return notify.error('Choose a picture (JPG, PNG or WebP)');
  photo.busy = true;
  try {
    const small = await resizeImage(f);
    if (small.size > 2 * 1024 * 1024) return notify.error('This photo is still larger than 2 MB after resizing; choose a smaller one');
    if (photo.preview.startsWith('blob:')) URL.revokeObjectURL(photo.preview);
    Object.assign(photo, { file: small, preview: URL.createObjectURL(small), remove: false, link: false });
  } catch {
    notify.error('This picture could not be read. Use a JPG, PNG or WebP photo.');
  } finally {
    photo.busy = false;
  }
}
function removePhoto() {
  if (photo.preview.startsWith('blob:')) URL.revokeObjectURL(photo.preview);
  Object.assign(photo, { file: null, preview: '', remove: true });
  form.imageUrl = '';
}
function typedLink() {
  if (photo.preview.startsWith('blob:')) URL.revokeObjectURL(photo.preview);
  Object.assign(photo, { file: null, preview: '', remove: false });
}

// ── Duplicate: a new product filled from the one being edited
const dupFrom = ref('');
async function duplicate() {
  if (loadingStores.value) return notify.error('Still loading the stores of this product; try again in a moment');
  const src = { ...form };
  let file = photo.file;
  if (!file && !photo.remove && ownPhoto(src.imageUrl)) {
    try { const r = await fetch(src.imageUrl); if (r.ok) file = await r.blob(); } catch { /* copy without the photo */ }
  }
  Object.assign(form, {
    ...src, id: '', isActive: true, barcode: '',
    sku: `${src.sku}-COPY`.slice(0, 50), name: `${src.name} (copy)`.slice(0, 200), nameKm: src.nameKm,
    imageUrl: ownPhoto(src.imageUrl) ? '' : src.imageUrl,
  });
  // every store row counts as new, so its sells / price / size prices are saved for the copy
  storeRows.value = storeRows.value.map((r) => ({ ...r, was: undefined, wasSizes: undefined }));
  resetPhoto();
  if (file) Object.assign(photo, { file, preview: URL.createObjectURL(file) });
  dupFrom.value = src.name;
}
async function duplicateRow(p: Product) {
  await edit(p);
  await duplicate();
}

function openNew(ingredient = false) {
  Object.assign(form, empty(), ingredient ? { isIngredient: true, unit: 'g', taxable: false } : {});
  Object.assign(pack, { size: null, price: null });
  initStores([], true);
  sizes.value = [];
  resetPhoto();
  dupFrom.value = '';
  dialog.value = true;
}
async function edit(p: Product) {
  storeRows.value = [];
  sizes.value = [];
  loadingStores.value = true;
  resetPhoto((p as any).imageUrl ?? '');
  dupFrom.value = '';
  const loaded = Promise.all([api.get<any>(`/products/${p.id}`), api.get<any>(`/products/${p.id}/size-prices`).catch(() => null)])
    .then(([d, sp]) => { initStores(d.inventory ?? [], false); initSizes(sp); })
    .catch((e) => notify.error(e))
    .finally(() => (loadingStores.value = false));
  Object.assign(form, {
    ...empty(), ...p, barcode: p.barcode ?? '', nameKm: (p as any).nameKm ?? '', description: p.description ?? '', costPrice: Number(p.costPrice), sellPrice: Number(p.sellPrice),
    imageUrl: (p as any).imageUrl ?? '', modifierGroupIds: ((p as any).modifierGroups ?? []).map((m: any) => m.groupId),
    isIngredient: !!(p as any).isIngredient,
    onlineAvailable: !!(p as any).onlineAvailable,
    madeInHouse: !!(p as any).madeInHouse, batchYield: Number((p as any).batchYield ?? 1), shelfLifeHours: (p as any).shelfLifeHours ?? null,
  });
  Object.assign(pack, { size: null, price: null });
  dialog.value = true;
  return loaded;
}

async function save() {
  if (!form.id && !storeRows.value.some((r) => r.sells)) return notify.error('Choose at least one store that sells this product');
  if (form.id && loadingStores.value) return;
  if (sized.value) {
    const missing = storeRows.value.find((r) => sizesChanged(r) && sizes.value.every((o) => r.sizes?.[o.id] == null));
    if (missing) return notify.error(`Enter the size prices for ${missing.code}`);
  }
  saving.value = true;
  try {
    // Only the form's own fields: the edited product also carries createdAt, category, price, stock...
    const { id, ...body } = Object.fromEntries(Object.keys(empty()).map((k) => [k, (form as any)[k]])) as ReturnType<typeof empty>;
    const payload = { ...body, barcode: body.barcode || undefined, description: body.description || undefined, nameKm: body.nameKm.trim() || null, categoryId: body.categoryId || undefined, imageUrl: photo.file ? undefined : body.imageUrl || null };
    let pid = id;
    if (id) {
      await api.patch(`/products/${id}`, payload);
      for (const r of storeRows.value.filter(storesChanged)) {
        // with sizes, the store's price comes from its size prices (saved below)
        await api.put(`/inventory/${r.storeId}/${id}`, sized.value ? { isListed: r.sells } : { isListed: r.sells, priceOverride: r.price });
      }
      const changed = sized.value ? storeRows.value.filter(sizesChanged) : [];
      if (changed.length) {
        await api.put(`/products/${id}/size-prices`, { stores: changed.map((r) => ({ storeId: r.storeId, prices: sizes.value.map((o) => ({ optionId: o.id, price: r.sizes![o.id] })) })) });
      }
    } else {
      const created = await api.post<{ id: string }>('/products', { ...payload, isActive: undefined, stores: storeRows.value.filter((r) => r.sells).map((r) => ({ storeId: r.storeId, price: r.price })) });
      pid = created.id;
      // a copy of a drink with sizes: its size prices too
      const withSizes = sized.value ? storeRows.value.filter((r) => r.sells && sizes.value.some((o) => r.sizes?.[o.id] != null)) : [];
      if (withSizes.length) {
        await api.put(`/products/${pid}/size-prices`, { stores: withSizes.map((r) => ({ storeId: r.storeId, prices: sizes.value.map((o) => ({ optionId: o.id, price: r.sizes![o.id] ?? null })) })) });
      }
    }
    // the photo: upload the new one, or remove the uploaded one
    if (photo.file) await api.upload(`/products/${pid}/image`, photo.file);
    else if (photo.remove && id && ownPhoto(photo.original)) await api.del(`/products/${id}/image`);
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
  loadSchedules();
  [categories.value, modifierGroups.value] = await Promise.all([api.get('/categories'), api.get('/modifiers').then((g) => g.filter((x: any) => x.isActive))]);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Products</h1>
        <div class="sub"><b>{{ list.total.value }}</b> products · each store sells its own products at its own price · showing <b>{{ app.currentStore?.code }}</b></div>
      </div>
      <div class="actions">
        <Button v-if="auth.isAdmin" label="New ingredient" icon="pi pi-plus" severity="secondary" @click="openNew(true)" />
        <Button v-if="auth.isAdmin && schedules.length" :label="pendingSchedules ? `Scheduled prices (${pendingSchedules})` : 'Scheduled prices'" icon="pi pi-calendar-clock" severity="secondary" text data-test="sched-open" @click="loadSchedules(); schedDlg = true" />
        <Button v-if="auth.isAdmin && selected.length" :label="`Change prices (${selected.length})`" icon="pi pi-percentage" severity="secondary" data-test="bulk-open" @click="openBulk" />
        <Button v-if="auth.isAdmin" label="New product" icon="pi pi-plus" @click="openNew()" />
      </div>
    </div>

    <div class="card">
      <div class="toolbar">
        <IconField>
          <InputIcon class="pi pi-search" />
          <InputText v-model="list.filters.search" placeholder="Name, SKU or barcode" />
        </IconField>
        <Select v-model="list.filters.categoryId" :options="catOptions" option-label="label" filter option-value="id" placeholder="All categories" show-clear />
        <SelectButton v-model="list.filters.listing" :options="listingOptions" option-label="l" option-value="v" :allow-empty="false" />
        <SelectButton v-model="list.filters.kind" :options="[{ l: 'For sale', v: 'sellable' }, { l: 'Ingredients', v: 'ingredient' }]" option-label="l" option-value="v" />
        <label class="row small"><ToggleSwitch v-model="list.filters.includeInactive" /> Show inactive</label>
      </div>
      <div v-if="topCats.length" class="cat-chips">
        <button type="button" class="cchip" :class="{ on: !list.filters.categoryId }" @click="list.filters.categoryId = null">All</button>
        <button v-for="c in topCats" :key="c.id" type="button" class="cchip" :class="{ on: list.filters.categoryId === c.id }" :style="{ '--c': catColor(c.id) }" @click="list.filters.categoryId = list.filters.categoryId === c.id ? null : c.id"><span class="dot" />{{ c.name }}</button>
      </div>

      <DataTable :value="list.rows.value" lazy paginator :rows="list.page.rows" :first="list.page.first" :total-records="list.total.value"
        :rows-per-page-options="[25, 50, 100]" :loading="list.loading.value" data-key="id" size="small" striped-rows
        v-model:selection="selected" @page="list.onPage" @row-click="onRowClick" :row-class="() => (auth.isAdmin ? 'clickable' : '')">
        <Column v-if="auth.isAdmin" selection-mode="multiple" header-style="width: 2.5rem" />
        <template #empty><span class="muted">No products found</span></template>
        <Column field="name" header="Product">
          <template #body="{ data }">
            <div class="prod" :class="{ off: !data.isActive }">
              <img v-if="data.imageUrl && !badImg.has(data.imageUrl)" :src="data.imageUrl" alt="" class="thumb" loading="lazy" @error="badImg.add(data.imageUrl)" />
              <span v-else class="thumb ini" :style="{ '--c': catColor(data.categoryId) }">{{ initials(data.name) }}</span>
              <div class="pname">
                <div class="nm">{{ data.name }}
                  <Tag v-if="!data.isActive" value="inactive" severity="secondary" />
                  <Tag v-if="data.isIngredient" value="ingredient" severity="warn" />
                  <Tag v-if="data.madeInHouse" value="bakery" severity="info" />
                  <Tag v-if="data.modifierGroups?.length" :value="`${data.modifierGroups.length} options`" severity="info" />
                </div>
                <div class="small muted"><span class="mono">{{ data.sku }}</span><template v-if="data.barcode"> · <span class="mono">{{ data.barcode }}</span></template><template v-if="data.nameKm"> · {{ data.nameKm }}</template></div>
              </div>
            </div>
          </template>
        </Column>
        <Column header="Category"><template #body="{ data }"><span v-if="data.categoryId" class="pcat" :style="{ '--c': catColor(data.categoryId) }"><span class="dot" />{{ catLabel(data.categoryId) }}</span><span v-else class="muted">—</span></template></Column>
        <Column header="Cost" class="right"><template #body="{ data }">{{ data.isIngredient ? '$' + Number(data.costPrice).toFixed(4) + ' / ' + data.unit : money(data.costPrice, cur) }}</template></Column>
        <Column header="Price" class="right">
          <template #body="{ data }">
            <b class="price">{{ money(data.price ?? data.sellPrice, cur) }}</b>
            <i v-if="data.price && data.price !== data.sellPrice" class="pi pi-tag small muted" v-tooltip="`Store price. Default ${money(data.sellPrice, cur)}`" />
          </template>
        </Column>
        <Column header="Margin" class="right"><template #body="{ data }"><span v-if="!isNaN(margin(data))" class="mpill" :class="marginClass(margin(data))">{{ margin(data).toFixed(0) }}%</span><span v-else class="muted">—</span></template></Column>
        <Column header="Stock" class="right">
          <template #body="{ data }">
            <span v-if="!data.trackStock" class="muted small">not tracked</span>
            <span v-else class="spill" :class="{ out: Number(data.stock) <= 0 }">{{ qty(data.stock) }} {{ data.unit }}</span>
          </template>
        </Column>
        <Column header="Tax" class="right"><template #body="{ data }"><i :class="data.taxable ? 'pi pi-check' : 'pi pi-minus muted'" /></template></Column>
        <Column v-if="auth.isAdmin" header="" class="right" style="width: 1%">
          <template #body="{ data }">
            <Button icon="pi pi-copy" text rounded size="small" severity="secondary" aria-label="Duplicate" v-tooltip.left="'Duplicate'" data-test="dup-row" @click.stop="duplicateRow(data)" />
          </template>
        </Column>
        <Column :header="`Sold in ${app.currentStore?.code ?? ''}`" class="right">
          <template #body="{ data }">
            <span @click.stop>
              <ToggleSwitch v-if="auth.isManager" :model-value="!!data.listed" @update:model-value="toggleListed(data, $event)" v-tooltip.left="data.listed ? 'Stop selling in this store' : 'Sell in this store'" />
              <i v-else :class="data.listed ? 'pi pi-check' : 'pi pi-minus muted'" />
            </span>
          </template>
        </Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="schedDlg" header="Scheduled price changes" modal :style="{ width: '760px' }" :breakpoints="{ '820px': '96vw' }">
      <p class="muted" style="margin-top: 0">Planned with Change prices → When: Later. The server applies each one at its time; tills get the new prices within 5 minutes after that.</p>
      <div v-if="!schedules.length" class="muted c" style="padding: 20px">Nothing scheduled.</div>
      <div v-for="x in schedules" :key="x.id" class="sched" :class="x.status.toLowerCase()" data-test="sched-row">
        <div class="sched-h">
          <div><b>{{ fmtWhen(x.runAt) }}</b> <Tag :value="SCHED_STATUS[x.status]?.label ?? x.status" :severity="SCHED_STATUS[x.status]?.sev ?? 'secondary'" /></div>
          <Button v-if="x.status === 'PENDING'" label="Cancel" icon="pi pi-times" text severity="danger" size="small" @click="cancelSchedule(x)" />
        </div>
        <div><b>{{ x.label }}</b> · {{ x.productCount }} product(s)</div>
        <div class="small muted">{{ x.products.join(', ') }}<span v-if="x.moreProducts"> and {{ x.moreProducts }} more</span></div>
        <div class="small muted">Planned by {{ x.createdByName }} on {{ fmtWhen(x.createdAt) }}
          <span v-if="x.status === 'DONE'"> · applied {{ fmtWhen(x.appliedAt) }}: {{ x.result?.changed }} changed<span v-if="x.result?.skipped">, {{ x.result.skipped }} skipped</span></span>
          <span v-if="x.status === 'CANCELLED'"> · cancelled by {{ x.cancelledBy }}</span>
        </div>
        <div v-if="x.status === 'FAILED'" class="small neg">Could not be applied: {{ x.error }}</div>
      </div>
    </Dialog>

    <Dialog v-model:visible="bulkDlg" header="Change prices" modal :style="{ width: '820px' }" :breakpoints="{ '880px': '96vw' }">
      <div class="form">
        <p class="muted" style="margin: 0">{{ selected.length }} product(s) ticked. Check the preview, then Apply. Tills get the new prices within 5 minutes.</p>
        <div class="field"><label>Where</label>
          <SelectButton v-model="bulk.scope" :options="[{ l: 'All stores', v: 'ALL' }, { l: `Only ${app.currentStore?.code ?? 'this store'}`, v: 'STORE' }]" option-label="l" option-value="v" :allow-empty="false" />
          <span class="hint">{{ bulk.scope === 'ALL' ? 'The normal price, every store\'s own price and size prices.' : `Only ${app.currentStore?.name}'s prices (its own price and size prices). Other stores keep theirs.` }}</span>
        </div>
        <div class="form-2">
          <div class="field"><label>Change</label>
            <SelectButton v-model="bulk.type" :options="[{ l: '+/- %', v: 'PERCENT' }, { l: '+/- $', v: 'AMOUNT' }, { l: 'Set to', v: 'SET' }]" option-label="l" option-value="v" :allow-empty="false" />
          </div>
          <div class="field"><label>{{ bulk.type === 'PERCENT' ? 'Percent' : bulk.type === 'AMOUNT' ? 'Amount ($)' : 'New price ($)' }}</label>
            <InputNumber v-model="bulk.value" :min-fraction-digits="bulk.type === 'PERCENT' ? 0 : 2" :max-fraction-digits="2" :suffix="bulk.type === 'PERCENT' ? ' %' : ''" fluid data-test="bulk-value" @input="(e: any) => (bulk.value = e.value ?? null)" />
            <span class="hint">{{ changeHint }}</span>
          </div>
        </div>
        <div class="field"><label>Round the new prices</label>
          <SelectButton v-model="bulk.round" :options="[{ l: 'No', v: null }, { l: '$0.05', v: 0.05 }, { l: '$0.10', v: 0.1 }, { l: '$0.25', v: 0.25 }]" option-label="l" option-value="v" :allow-empty="false" />
        </div>
        <div class="field"><label>When</label>
          <div class="row" style="gap: 10px; flex-wrap: wrap">
            <SelectButton v-model="bulk.when" :options="[{ l: 'Now', v: 'NOW' }, { l: 'Later', v: 'LATER' }]" option-label="l" option-value="v" :allow-empty="false" data-test="bulk-when" />
            <DatePicker v-if="bulk.when === 'LATER'" v-model="bulk.runAt" show-time hour-format="24" :min-date="minRunAt" :step-minute="5" show-icon placeholder="Date and time" data-test="bulk-runat" />
          </div>
          <span v-if="bulk.when === 'LATER'" class="hint">The server applies it at that time by itself. % and $ changes are worked out from the prices at that moment. You can cancel it until then under "Scheduled prices".</span>
        </div>
        <div class="row" style="justify-content: flex-end"><Button label="Preview" icon="pi pi-eye" severity="secondary" :loading="bulk.busy && !bulkPreview" data-test="bulk-preview" @click="previewBulk" /></div>

        <div v-if="bulkPreview" class="bulk-prev" data-test="bulk-table">
          <div class="small"><b>{{ bulkPreview.changed }}</b> product(s) will change<span v-if="bulkPreview.skipped"> · {{ bulkPreview.skipped }} skipped</span><span v-if="previewKey !== bulkKey" class="neg"> · settings changed: preview again</span></div>
          <table>
            <thead><tr><th>Product</th><th>Store</th><th class="r">Now</th><th class="r">New</th></tr></thead>
            <tbody>
              <template v-for="r in bulkPreview.rows" :key="r.productId">
                <tr v-if="r.skipped" class="skip"><td><b>{{ r.name }}</b> <span class="mono small muted">{{ r.sku }}</span></td><td colspan="3" class="muted small">Skipped: {{ r.skipped }}</td></tr>
                <template v-else>
                  <tr v-if="r.normal" class="first"><td :rowspan="r.stores.length + 1"><b>{{ r.name }}</b><div class="mono small muted">{{ r.sku }}</div></td><td class="muted small">Normal price</td><td class="r">{{ priceText(r.normal.before) }}</td><td class="r new">{{ priceText(r.normal.after) }}</td></tr>
                  <tr v-for="(st, j) in r.stores" :key="st.storeId" :class="{ first: !r.normal && j === 0 }">
                    <td v-if="!r.normal && j === 0" :rowspan="r.stores.length"><b>{{ r.name }}</b><div class="mono small muted">{{ r.sku }}</div></td>
                    <td class="small">{{ st.code }}</td>
                    <td class="r"><template v-if="st.sizes"><div v-for="z in st.sizes.filter((x: any) => x.before !== null)" :key="z.optionId" class="small">{{ z.name }} {{ priceText(z.before) }}</div></template><template v-else>{{ priceText(st.before) }}</template></td>
                    <td class="r new"><template v-if="st.sizes"><div v-for="z in st.sizes.filter((x: any) => x.before !== null)" :key="z.optionId" class="small">{{ z.name }} <b>{{ priceText(z.after) }}</b></div></template><template v-else>{{ priceText(st.after) }}</template></td>
                  </tr>
                </template>
              </template>
            </tbody>
          </table>
        </div>
        <div class="row" style="justify-content: flex-end">
          <Button label="Cancel" text severity="secondary" @click="bulkDlg = false" />
          <Button :label="bulk.when === 'LATER' ? (bulk.runAt ? `Schedule for ${fmtWhen(bulk.runAt)}` : 'Schedule') : 'Apply new prices'" :icon="bulk.when === 'LATER' ? 'pi pi-calendar-plus' : 'pi pi-check'" :disabled="!bulkPreview || !bulkPreview.changed || previewKey !== bulkKey || (bulk.when === 'LATER' && !bulk.runAt)" :loading="bulk.busy && !!bulkPreview" data-test="bulk-apply" @click="applyBulk" />
        </div>
      </div>
    </Dialog>

    <Dialog v-model:visible="dialog" :header="form.id ? 'Edit product' : dupFrom ? `New product: copy of ${dupFrom}` : 'New product'" modal :style="{ width: '640px' }" :breakpoints="{ '720px': '95vw' }">
      <form class="form" @submit.prevent="save">
        <Message v-if="dupFrom && !form.id" severity="info" :closable="false" size="small">
          Copied from <b>{{ dupFrom }}</b>: check the name, SKU and barcode, then Save. Stores, prices, size prices, options and photo are copied; the recipe is not.
        </Message>
        <div class="form-2">
          <div class="field"><label>SKU *</label><InputText v-model="form.sku" required /></div>
          <div class="field"><label>Barcode</label><InputText v-model="form.barcode" placeholder="Scan or type" /></div>
        </div>
        <div class="field"><label>Name *</label><InputText v-model="form.name" required /></div>
        <div class="field"><label>Khmer name <span class="hint">(shown on the POS, menu and receipt in Khmer)</span></label><InputText v-model="form.nameKm" maxlength="200" placeholder="ឧ. កាហ្វេទឹកដោះគោទឹកកក" /></div>
        <div class="form-2">
          <div class="field"><label>Category</label><Select v-model="form.categoryId" :options="catOptions" option-label="label" filter option-value="id" show-clear placeholder="None" /></div>
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
        <!-- Drinks with sizes: the full price of each size in the store chosen at the top -->
        <div v-if="sized && hereRow" class="field">
          <label>Size prices in {{ app.currentStore?.code }} {{ app.currentStore?.name }} <span class="hint">(full price; empty = not offered)</span></label>
          <div class="size-fields">
            <div v-for="o in sizes" :key="o.id" class="size-f">
              <span class="size-h">{{ o.name }}</span>
              <InputNumber v-model="hereRow.sizes![o.id]" placeholder="—" mode="decimal" :min-fraction-digits="2" :max-fraction-digits="2" :min="0" fluid />
            </div>
          </div>
        </div>
        <!-- No sizes: the Selling price above is the price; a store's own price (e.g. from BROWN) can be removed -->
        <p v-if="!sized && !form.isIngredient && hereRow && hereRow.price !== null" class="own-price">
          {{ app.currentStore?.code }} sells it at its own price <b>{{ money(hereRow.price, cur) }}</b>.
          <Button label="Use the selling price" size="small" text @click="hereRow.price = null" />
        </p>
        <div class="field"><label>Description</label><Textarea v-model="form.description" rows="2" auto-resize /></div>
        <div v-if="!form.isIngredient" class="field">
          <label>Drink options <span class="hint">(customer chooses at the POS, in this order)</span></label>
          <MultiSelect v-model="form.modifierGroupIds" :options="modifierGroups" option-label="name" option-value="id" display="chip" placeholder="None" />
        </div>
        <div v-if="!form.isIngredient" class="field">
          <label>Photo <span class="hint">(POS tile and online menu)</span></label>
          <div class="photo-row">
            <div class="photo-box">
              <img v-if="photoShown && !badImg.has(photoShown)" :src="photoShown" alt="" @error="badImg.add(photoShown)" />
              <span v-else class="ini" :style="{ '--c': catColor(form.categoryId) }">{{ initials(form.name || '?') }}</span>
            </div>
            <div class="photo-act">
              <input ref="fileInput" type="file" accept="image/*" hidden data-test="photo-file" @change="choosePhoto" />
              <div class="row" style="gap: 6px; flex-wrap: wrap">
                <Button :label="photoShown ? 'Change photo' : 'Upload photo'" icon="pi pi-upload" size="small" severity="secondary" :loading="photo.busy" @click="fileInput?.click()" />
                <Button v-if="photoShown" label="Remove" icon="pi pi-trash" size="small" text severity="danger" @click="removePhoto" />
                <Button :label="photo.link ? 'Hide link' : 'Use a link instead'" size="small" text severity="secondary" @click="photo.link = !photo.link" />
              </div>
              <span class="hint">JPG, PNG or WebP, from the computer or the phone's camera. Made smaller (800 px) before upload.
                <b v-if="photo.file"> New photo ready ({{ Math.max(1, Math.round(photo.file.size / 1024)) }} KB): saved with Save.</b>
                <b v-else-if="photo.remove && photo.original"> Photo removed when you Save.</b></span>
              <InputText v-if="photo.link" v-model="form.imageUrl" placeholder="https://…/latte.jpg" @input="typedLink" />
            </div>
          </div>
        </div>
        <div class="row" style="gap: 24px; flex-wrap: wrap">
          <label class="row"><ToggleSwitch v-model="form.isIngredient" /> Ingredient (used in recipes, not sold)</label>
          <label class="row"><ToggleSwitch v-model="form.taxable" /> Taxable</label>
          <label class="row"><ToggleSwitch v-model="form.trackStock" /> Track stock</label>
          <label v-if="!form.isIngredient" class="row"><ToggleSwitch v-model="form.onlineAvailable" /> Sell online</label>
          <label v-if="!form.isIngredient" class="row"><ToggleSwitch v-model="form.madeInHouse" /> Made here (bakery)</label>
          <label v-if="form.id" class="row"><ToggleSwitch v-model="form.isActive" /> Active (for sale)</label>
        </div>
        <div v-if="form.madeInHouse && !form.isIngredient" class="grid2 bake">
          <div class="field"><label>Pieces per batch <span class="hint">(the recipe is for one batch)</span></label><InputNumber v-model="form.batchYield" :min="0.001" :max-fraction-digits="3" fluid /></div>
          <div class="field"><label>Fresh for (hours) <span class="hint">(empty = keeps)</span></label><InputNumber v-model="form.shelfLifeHours" :min="1" :max="8760" fluid /></div>
          <p class="hint" style="grid-column: 1 / -1; margin: 0">Baking a batch (Production page) uses the ingredients and adds the pieces to stock; selling takes pieces from stock.</p>
        </div>
        <div class="row" style="justify-content: flex-end">
          <Button v-if="form.id" label="Duplicate" icon="pi pi-copy" severity="secondary" outlined style="margin-right: auto" v-tooltip.top="'New product filled from this one'" data-test="duplicate" @click="duplicate" />
          <Button label="Cancel" severity="secondary" text @click="dialog = false" />
          <Button type="submit" label="Save" icon="pi pi-check" :loading="saving" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.sched { border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px; margin-bottom: 10px; display: grid; gap: 3px; }
.sched.cancelled, .sched.done { opacity: .75; }
.sched.failed { border-color: color-mix(in srgb, var(--bad) 45%, var(--border)); }
.sched-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.bulk-prev { border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; max-height: 46vh; overflow: auto; }
.bulk-prev table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 14px; }
.bulk-prev th { text-align: left; font-size: 12px; color: var(--text-2); font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: var(--surface); }
.bulk-prev td { padding: 5px 6px; vertical-align: top; }
.bulk-prev tr.first td { border-top: 1px solid var(--border); }
.bulk-prev .r { text-align: right; white-space: nowrap; }
.bulk-prev .new { color: var(--p-primary-color); font-weight: 700; }
.bulk-prev tr.skip td { border-top: 1px solid var(--border); }
.cat-chips { display: flex; gap: 6px; overflow-x: auto; padding: 2px 0 12px; scrollbar-width: thin; }
.cchip { --c: var(--text-2); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; padding: 5px 12px; font: inherit; font-size: .85rem; font-weight: 600; cursor: pointer; transition: background .15s, border-color .15s; }
.cchip:hover { border-color: var(--c); }
.cchip.on { background: var(--c); border-color: var(--c); color: #fff; }
.cchip.on .dot { background: #fff; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
.prod { display: flex; align-items: center; gap: 12px; min-width: 220px; }
.prod.off { opacity: .6; }
.thumb { width: 42px; height: 42px; border-radius: 10px; object-fit: cover; flex-shrink: 0; background: var(--bg); }
.thumb.ini { display: grid; place-items: center; color: #fff; font-weight: 800; font-size: .85rem; background: var(--c); }
.photo-row { display: flex; gap: 14px; align-items: flex-start; }
.photo-box { width: 96px; height: 96px; border-radius: 14px; overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); background: var(--bg); }
.photo-box img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo-box .ini { width: 100%; height: 100%; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 1.6rem; background: var(--c); }
.photo-act { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.pname { min-width: 0; }
.nm { font-weight: 650; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pcat { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.price { font-weight: 750; }
.mpill, .spill { display: inline-block; padding: 1px 9px; border-radius: 999px; font-size: .8rem; font-weight: 700; background: var(--bg); color: var(--text-2); white-space: nowrap; }
.mpill.good { background: color-mix(in srgb, var(--good) 14%, transparent); color: var(--good); }
.mpill.ok { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); }
.mpill.low, .spill.out { background: color-mix(in srgb, var(--bad) 14%, transparent); color: var(--bad); }
.bake { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; border-radius: 10px; background: var(--bg); }
.size-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
.size-f { display: flex; flex-direction: column; gap: 4px; }
.size-f .size-h { font-size: .8rem; font-weight: 700; }
.own-price { margin: 0; padding: 8px 12px; border-radius: 10px; background: var(--bg); font-size: .9rem; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
</style>
