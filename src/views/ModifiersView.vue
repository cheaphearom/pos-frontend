<!-- Copyright (c) 2026 Chea Phearom. All rights reserved. Proprietary and confidential: see the LICENSE file. -->
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { useAuth } from '@/stores/auth';
import { money } from '@/utils/format';
import { initials, nameColor } from '@/utils/colors';

const auth = useAuth();
const notify = useNotify();
const confirm = useConfirm();
const groups = ref<any[]>([]);
const loading = ref(false);
async function load() {
  loading.value = true;
  try { groups.value = (await api.get('/modifiers')).filter((g: any) => g.isActive); } catch (e) { notify.error(e); } finally { loading.value = false; }
}

const q = ref('');
const shown = computed(() => {
  const s = q.value.trim().toLowerCase();
  return s ? groups.value.filter((g) => g.name.toLowerCase().includes(s) || g.options.some((o: any) => o.name.toLowerCase().includes(s))) : groups.value;
});
const totalOptions = computed(() => groups.value.reduce((n, g) => n + g.options.length, 0));

const dlg = ref(false);
const saving = ref(false);
const form = reactive({ id: '', name: '', required: true, multiple: false, maxSelect: 1, options: [] as { id?: string; name: string; priceDelta: number; isDefault: boolean }[] });
function open(g?: any) {
  if (g) Object.assign(form, { id: g.id, name: g.name, required: g.minSelect > 0, multiple: g.maxSelect > 1, maxSelect: g.maxSelect, options: g.options.map((o: any) => ({ id: o.id, name: o.name, priceDelta: Number(o.priceDelta), isDefault: o.isDefault })) });
  else Object.assign(form, { id: '', name: '', required: true, multiple: false, maxSelect: 1, options: [{ name: '', priceDelta: 0, isDefault: true }] });
  dlg.value = true;
}
function setDefault(i: number) {
  if (!form.multiple) form.options.forEach((o, j) => (o.isDefault = j === i ? !o.isDefault : false));
  else form.options[i].isDefault = !form.options[i].isDefault;
}
async function save() {
  saving.value = true;
  try {
    const body = {
      name: form.name, minSelect: form.required ? 1 : 0, maxSelect: form.multiple ? Math.max(2, form.maxSelect) : 1,
      sortOrder: groups.value.findIndex((g) => g.id === form.id) >= 0 ? undefined : groups.value.length + 1,
      options: form.options.filter((o) => o.name.trim()).map((o) => ({ ...o, name: o.name.trim() })),
    };
    if (form.id) await api.put(`/modifiers/${form.id}`, body);
    else await api.post('/modifiers', body);
    notify.success('Saved', form.name);
    dlg.value = false;
    load();
  } catch (e) { notify.error(e); } finally { saving.value = false; }
}
function remove(g: any) {
  confirm.require({
    header: 'Delete option group', message: `Remove "${g.name}" from all ${g._count.products} drinks?`,
    acceptProps: { label: 'Delete', severity: 'danger' }, rejectProps: { label: 'Cancel', text: true, severity: 'secondary' },
    accept: async () => { try { await api.del(`/modifiers/${g.id}`); load(); } catch (e) { notify.error(e); } },
  });
}
onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Drink options</h1><div class="sub"><b>{{ groups.length }}</b> option groups · <b>{{ totalOptions }}</b> options · attach them to drinks on the Products page</div></div>
      <div class="actions">
        <IconField><InputIcon class="pi pi-search" /><InputText v-model="q" placeholder="Search options" /></IconField>
        <Button v-if="auth.has('catalogue')" label="New option group" icon="pi pi-plus" @click="open()" />
      </div>
    </div>
    <div v-if="loading && !groups.length" class="muted">Loading…</div>
    <div v-else-if="!shown.length" class="card muted">{{ q ? 'Nothing matches your search.' : 'No option groups yet.' }}</div>
    <div class="og-grid">
      <article v-for="g in shown" :key="g.id" class="og-card" :style="{ '--c': nameColor(g.name) }">
        <header>
          <span class="ico">{{ initials(g.name) }}</span>
          <div class="t">
            <h3>{{ g.name }}</h3>
            <div class="badges">
              <span class="b" :class="{ req: g.minSelect }">{{ g.minSelect ? 'Required' : 'Optional' }}</span>
              <span class="b">{{ g.maxSelect > 1 ? `up to ${g.maxSelect}` : 'choose one' }}</span>
            </div>
          </div>
          <div v-if="auth.has('catalogue')" class="acts">
            <Button icon="pi pi-pencil" text rounded size="small" aria-label="Edit" @click="open(g)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label="Delete" @click="remove(g)" />
          </div>
        </header>
        <div class="big"><b>{{ g._count.products }}</b> {{ g._count.products === 1 ? 'drink' : 'drinks' }} · {{ g.options.length }} {{ g.options.length === 1 ? 'option' : 'options' }}</div>
        <div class="chips">
          <span v-for="o in g.options" :key="o.id" class="chip" :class="{ def: o.isDefault }" v-tooltip.top="o.isDefault ? 'Chosen by default' : undefined">
            {{ o.name }}<b v-if="Number(o.priceDelta)" class="pd">{{ Number(o.priceDelta) > 0 ? '+' : '' }}{{ money(o.priceDelta) }}</b>
          </span>
        </div>
      </article>
    </div>
    <Dialog v-model:visible="dlg" :header="form.id ? 'Edit option group' : 'New option group'" modal :style="{ width: '560px' }" :breakpoints="{ '600px': '98vw' }">
      <form class="form" @submit.prevent="save">
        <div class="field"><label>Name *</label><InputText v-model="form.name" required maxlength="60" placeholder="e.g. Size, Sugar, Toppings" /></div>
        <div class="row" style="gap: 24px; flex-wrap: wrap">
          <label class="row"><ToggleSwitch v-model="form.required" /> Customer must choose</label>
          <label class="row"><ToggleSwitch v-model="form.multiple" /> Can choose several</label>
          <span v-if="form.multiple" class="row small">up to <InputNumber v-model="form.maxSelect" :min="2" :max="20" :input-style="{ width: '60px' }" /></span>
        </div>
        <div class="field">
          <label>Options <span class="hint">(★ = selected by default)</span></label>
          <div v-for="(o, i) in form.options" :key="i" class="row" style="gap: 8px">
            <Button :icon="o.isDefault ? 'pi pi-star-fill' : 'pi pi-star'" text rounded size="small" :aria-label="'Default'" @click="setDefault(i)" />
            <InputText v-model="o.name" placeholder="Option name" style="flex: 1" />
            <InputNumber v-model="o.priceDelta" :min-fraction-digits="2" :max-fraction-digits="2" prefix="+ " :input-style="{ width: '90px' }" />
            <Button icon="pi pi-times" text rounded severity="secondary" size="small" aria-label="Remove" @click="form.options.splice(i, 1)" />
          </div>
          <Button label="Add option" icon="pi pi-plus" text size="small" style="justify-self: start" @click="form.options.push({ name: '', priceDelta: 0, isDefault: false })" />
        </div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" icon="pi pi-check" :loading="saving" /></div>
      </form>
    </Dialog>
  </div>
</template>

<style scoped>
.og-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; align-items: start; }
.og-card { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 16px; overflow: hidden; transition: transform .15s ease, box-shadow .15s ease; }
.og-card::before { content: ''; position: absolute; inset: 0 0 auto; height: 4px; background: var(--c); }
.og-card:hover { transform: translateY(-2px); box-shadow: 0 6px 22px rgba(15, 23, 42, .12); }
.og-card header { display: flex; align-items: center; gap: 12px; }
.ico { flex-shrink: 0; width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-weight: 800; color: #fff; background: var(--c); box-shadow: 0 4px 12px color-mix(in srgb, var(--c) 35%, transparent); }
.t { min-width: 0; flex: 1; }
.t h3 { margin: 0 0 4px; font-size: 1.05rem; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badges { display: flex; gap: 4px; flex-wrap: wrap; }
.b { font-size: .72rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--bg); color: var(--text-2); }
.b.req { background: color-mix(in srgb, var(--c) 15%, transparent); color: var(--c); }
.acts { display: flex; opacity: 0; transition: opacity .15s; }
.og-card:hover .acts, .acts:focus-within { opacity: 1; }
.big { margin: 12px 0 10px; color: var(--text-2); font-size: .9rem; }
.big b { font-size: 1.5rem; font-weight: 800; color: var(--text); margin-right: 2px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; align-content: flex-start; padding-top: 10px; border-top: 1px solid var(--border); }
.chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; font-size: 13px; background: var(--surface); }
.chip.def { background: var(--c); border-color: var(--c); color: #fff; }
.pd { font-size: 11.5px; font-weight: 800; padding: 0 6px; border-radius: 999px; background: color-mix(in srgb, var(--c) 14%, transparent); color: var(--c); }
.chip.def .pd { background: rgba(255, 255, 255, .25); color: #fff; }
@media (hover: none) { .acts { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .og-card, .og-card:hover { transition: none; transform: none; } }
</style>
