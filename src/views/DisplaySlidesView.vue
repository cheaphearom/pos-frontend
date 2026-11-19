<!-- Copyright (c) 2026 Chea Phearom. All rights reserved. Proprietary and confidential: see the LICENSE file. -->
<script setup lang="ts">
/**
 * Pictures for the customer display: shown on the right of the customer screen during a sale (a slideshow, 8 s each).
 * Upload JPG, PNG or WebP (at most 5 MB), for every store or one store, with optional dates. The tills pick up
 * changes within 5 minutes, or at once when the POS page is reloaded.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { useApp } from '@/stores/app';

interface Slide {
  id: string; title: string; storeId: string | null; store: { code: string; name: string } | null;
  isActive: boolean; startsAt: string | null; endsAt: string | null; sizeBytes: number; imageUrl: string;
}
const MAX = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const notify = useNotify();
const app = useApp();
const rows = ref<Slide[]>([]);
const loading = ref(false);
const storeOptions = computed(() => [{ id: null as string | null, label: 'Every store' }, ...app.stores.map((s) => ({ id: s.id as string | null, label: `${s.code} · ${s.name}` }))]);

async function load() {
  loading.value = true;
  try { rows.value = await api.get('/display-slides'); } catch (e) { notify.error(e); } finally { loading.value = false; }
}
onMounted(load);

/** Showing now, waiting for its start, ended, or switched off */
function status(s: Slide) {
  const now = Date.now();
  if (!s.isActive) return { label: 'Off', sev: 'secondary' };
  if (s.startsAt && new Date(s.startsAt).getTime() > now) return { label: 'Starts ' + new Date(s.startsAt).toLocaleDateString(), sev: 'info' };
  if (s.endsAt && new Date(s.endsAt).getTime() <= now) return { label: 'Ended', sev: 'warn' };
  return { label: 'Showing', sev: 'success' };
}
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

// ── New picture
const upDlg = ref(false);
const up = reactive({ file: null as File | null, preview: '', title: '', storeId: null as string | null, error: '', busy: false });
function pick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null;
  up.error = '';
  if (up.preview) URL.revokeObjectURL(up.preview);
  up.file = null; up.preview = '';
  if (!f) return;
  if (!TYPES.includes(f.type)) { up.error = 'Choose a JPG, PNG or WebP picture.'; return; }
  if (f.size > MAX) { up.error = `This picture is ${kb(f.size)}: the limit is 5 MB. Make it smaller and try again.`; return; }
  up.file = f;
  up.preview = URL.createObjectURL(f);
  if (!up.title) up.title = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 120);
}
function openUpload() {
  Object.assign(up, { file: null, preview: '', title: '', storeId: null, error: '', busy: false });
  upDlg.value = true;
}
async function upload() {
  if (!up.file) { up.error = 'Choose a picture first.'; return; }
  up.busy = true;
  try {
    await api.upload('/display-slides', up.file, { title: up.title.trim(), storeId: up.storeId ?? undefined });
    notify.success('Picture added', 'Tills show it within 5 minutes, or at once after a reload');
    upDlg.value = false;
    load();
  } catch (e) { notify.error(e); } finally { up.busy = false; }
}

// ── Edit a picture
const edDlg = ref(false);
const ed = reactive({ id: '', title: '', storeId: null as string | null, isActive: true, startsAt: null as Date | null, endsAt: null as Date | null, imageUrl: '', busy: false });
function openEdit(s: Slide) {
  Object.assign(ed, { id: s.id, title: s.title, storeId: s.storeId, isActive: s.isActive, startsAt: s.startsAt ? new Date(s.startsAt) : null, endsAt: s.endsAt ? new Date(s.endsAt) : null, imageUrl: s.imageUrl, busy: false });
  edDlg.value = true;
}
async function saveEdit() {
  ed.busy = true;
  try {
    await api.patch(`/display-slides/${ed.id}`, {
      title: ed.title.trim(), storeId: ed.storeId, isActive: ed.isActive,
      startsAt: ed.startsAt ? ed.startsAt.toISOString() : null, endsAt: ed.endsAt ? ed.endsAt.toISOString() : null,
    });
    notify.success('Picture saved', ed.title);
    edDlg.value = false;
    load();
  } catch (e) { notify.error(e); } finally { ed.busy = false; }
}
async function toggle(s: Slide) {
  try { await api.patch(`/display-slides/${s.id}`, { isActive: !s.isActive }); load(); } catch (e) { notify.error(e); }
}
async function move(s: Slide, dir: 'up' | 'down') {
  try { await api.post(`/display-slides/${s.id}/move`, { move: dir }); load(); } catch (e) { notify.error(e); }
}
const confirmDel = ref('');
async function remove(s: Slide) {
  if (confirmDel.value !== s.id) { confirmDel.value = s.id; setTimeout(() => (confirmDel.value = confirmDel.value === s.id ? '' : confirmDel.value), 4000); return; }
  try { await api.del(`/display-slides/${s.id}`); notify.success('Picture deleted', s.title); confirmDel.value = ''; edDlg.value = false; load(); } catch (e) { notify.error(e); }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Customer display</h1>
        <div class="sub">Pictures shown on the right of the customer screen during a sale, 8 seconds each, in this order. With no picture, the screen shows today's promotions.</div>
      </div>
      <div class="actions"><Button label="Add picture" icon="pi pi-upload" @click="openUpload" /></div>
    </div>

    <div class="card tip">
      <i class="pi pi-info-circle" />
      <span>Best size: <b>portrait, 1080 × 1440 px</b> (3 : 4). Other shapes fit too, with a soft blurred border. JPG, PNG or WebP, at most 5 MB. Tills pick up changes within 5 minutes, or at once after a reload.</span>
    </div>

    <div v-if="!rows.length && !loading" class="card empty">
      <i class="pi pi-images" />
      <b>No pictures yet</b>
      <span class="muted">Add a picture of a new drink, a promotion or your brand. Until then, the customer screen shows today's promotions.</span>
      <Button label="Add picture" icon="pi pi-upload" @click="openUpload" />
    </div>

    <div v-else class="grid">
      <div v-for="(s, i) in rows" :key="s.id" class="slide-card" :class="{ off: status(s).label !== 'Showing' }">
        <button type="button" class="thumb" :aria-label="`Edit ${s.title}`" @click="openEdit(s)">
          <img :src="s.imageUrl" :alt="s.title" loading="lazy" />
          <span class="num">{{ i + 1 }}</span>
        </button>
        <div class="body">
          <div class="title-row"><b class="ell">{{ s.title }}</b><Tag :value="status(s).label" :severity="status(s).sev" /></div>
          <div class="small muted">
            {{ s.store ? `${s.store.code} · ${s.store.name}` : 'Every store' }} · {{ kb(s.sizeBytes) }}
            <template v-if="s.startsAt || s.endsAt"><br />{{ s.startsAt ? new Date(s.startsAt).toLocaleDateString() : '…' }} → {{ s.endsAt ? new Date(s.endsAt).toLocaleDateString() : '…' }}</template>
          </div>
          <div class="row tools">
            <ToggleSwitch :model-value="s.isActive" :aria-label="s.isActive ? 'Switch off' : 'Switch on'" @update:model-value="toggle(s)" />
            <span class="spacer" />
            <Button icon="pi pi-arrow-up" text rounded size="small" aria-label="Earlier" :disabled="i === 0" @click="move(s, 'up')" />
            <Button icon="pi pi-arrow-down" text rounded size="small" aria-label="Later" :disabled="i === rows.length - 1" @click="move(s, 'down')" />
            <Button icon="pi pi-pencil" text rounded size="small" aria-label="Edit" @click="openEdit(s)" />
            <Button :icon="confirmDel === s.id ? 'pi pi-check' : 'pi pi-trash'" text rounded size="small" severity="danger" :aria-label="confirmDel === s.id ? 'Click again to delete' : 'Delete'" v-tooltip.top="confirmDel === s.id ? 'Click again to delete' : ''" @click="remove(s)" />
          </div>
        </div>
      </div>
    </div>

    <Dialog v-model:visible="upDlg" header="Add picture" modal :style="{ width: '520px' }" :breakpoints="{ '600px': '95vw' }">
      <form class="form" @submit.prevent="upload">
        <label class="drop" :class="{ has: up.preview }">
          <input id="slide-file" type="file" accept="image/jpeg,image/png,image/webp" @change="pick" />
          <img v-if="up.preview" :src="up.preview" alt="Preview" />
          <span v-else><i class="pi pi-image" /><b>Choose a picture</b><span class="small muted">JPG, PNG or WebP · at most 5 MB · best 1080 × 1440 px</span></span>
        </label>
        <Message v-if="up.error" severity="error" :closable="false">{{ up.error }}</Message>
        <div class="field"><label for="slide-title">Title *</label><InputText id="slide-title" v-model="up.title" required maxlength="120" placeholder="e.g. New Iced Caramel" /><span class="hint">For you only; read aloud to screen readers.</span></div>
        <div class="field"><label for="slide-store">Show in</label><Select input-id="slide-store" v-model="up.storeId" :options="storeOptions" option-label="label" option-value="id" /></div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Upload" icon="pi pi-upload" :loading="up.busy" :disabled="!up.file" /></div>
      </form>
    </Dialog>

    <Dialog v-model:visible="edDlg" header="Edit picture" modal :style="{ width: '520px' }" :breakpoints="{ '600px': '95vw' }">
      <form class="form" @submit.prevent="saveEdit">
        <img :src="ed.imageUrl" :alt="ed.title" class="ed-img" />
        <div class="field"><label for="ed-title">Title *</label><InputText id="ed-title" v-model="ed.title" required maxlength="120" /></div>
        <div class="field"><label for="ed-store">Show in</label><Select input-id="ed-store" v-model="ed.storeId" :options="storeOptions" option-label="label" option-value="id" /></div>
        <div class="form-2">
          <div class="field"><label for="ed-from">From</label><DatePicker input-id="ed-from" v-model="ed.startsAt" show-button-bar placeholder="Now" /></div>
          <div class="field"><label for="ed-to">Until</label><DatePicker input-id="ed-to" v-model="ed.endsAt" show-button-bar placeholder="No end" /></div>
        </div>
        <label class="row"><ToggleSwitch v-model="ed.isActive" /> Show this picture</label>
        <div class="row" style="justify-content: space-between">
          <Button :label="confirmDel === ed.id ? 'Click again to delete' : 'Delete'" icon="pi pi-trash" severity="danger" text @click="remove(rows.find((r) => r.id === ed.id)!)" />
          <Button type="submit" label="Save" icon="pi pi-check" :loading="ed.busy" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.tip { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; color: var(--text-2); margin-bottom: 16px; }
.tip i { margin-top: 3px; color: var(--p-primary-color); }
.empty { display: grid; justify-items: center; gap: 10px; text-align: center; padding: 48px 20px; }
.empty > i { font-size: 34px; color: var(--p-primary-color); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 16px; }
.slide-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; }
.slide-card.off .thumb img { opacity: .5; filter: grayscale(.6); }
.thumb { position: relative; display: block; width: 100%; aspect-ratio: 3 / 4; padding: 0; border: 0; background: var(--bg); cursor: pointer; }
.thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb .num { position: absolute; top: 8px; left: 8px; min-width: 26px; height: 26px; border-radius: 999px; display: grid; place-items: center; font-size: 13px; font-weight: 700; background: rgba(0, 0, 0, .6); color: #fff; padding: 0 6px; }
.body { padding: 10px 12px 8px; display: grid; gap: 4px; min-width: 0; }
.title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.tools { align-items: center; gap: 2px; margin-top: 4px; }
.spacer { flex: 1; }
.drop { position: relative; display: grid; place-items: center; min-height: 220px; border: 2px dashed var(--border); border-radius: 14px; background: var(--bg); cursor: pointer; overflow: hidden; text-align: center; }
.drop:hover, .drop:focus-within { border-color: var(--p-primary-color); }
.drop input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.drop > span { display: grid; gap: 6px; justify-items: center; padding: 20px; }
.drop > span i { font-size: 30px; color: var(--p-primary-color); }
.drop.has { border-style: solid; }
.drop img { max-height: 320px; max-width: 100%; object-fit: contain; }
.ed-img { width: 100%; max-height: 280px; object-fit: contain; border-radius: 12px; background: var(--bg); }
</style>
