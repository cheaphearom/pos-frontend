<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { useAuth } from '@/stores/auth';
import { money } from '@/utils/format';
import { nameColor } from '@/utils/colors';

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
        <Button v-if="auth.isAdmin" label="New option group" icon="pi pi-plus" @click="open()" />
      </div>
    </div>
    <div class="card">
      <DataTable :value="shown" :loading="loading" data-key="id" size="small">
        <template #empty><span class="muted">{{ q ? 'Nothing matches your search.' : 'No option groups yet.' }}</span></template>
        <Column header="Option group" style="width: 220px">
          <template #body="{ data }"><span class="gname" :style="{ '--c': nameColor(data.name) }"><span class="dot" /><b>{{ data.name }}</b></span></template>
        </Column>
        <Column header="Rule" style="width: 190px">
          <template #body="{ data }">
            <span class="b" :class="{ req: data.minSelect }" :style="{ '--c': nameColor(data.name) }">{{ data.minSelect ? 'Required' : 'Optional' }}</span>
            <span class="b">{{ data.maxSelect > 1 ? `up to ${data.maxSelect}` : 'choose one' }}</span>
          </template>
        </Column>
        <Column header="Options">
          <template #body="{ data }">
            <div class="chips" :style="{ '--c': nameColor(data.name) }">
              <span v-for="o in data.options" :key="o.id" class="chip" :class="{ def: o.isDefault }" v-tooltip.top="o.isDefault ? 'Chosen by default' : undefined">
                {{ o.name }}<b v-if="Number(o.priceDelta)" class="pd">{{ Number(o.priceDelta) > 0 ? '+' : '' }}{{ money(o.priceDelta) }}</b>
              </span>
            </div>
          </template>
        </Column>
        <Column header="Drinks" class="right" style="width: 90px"><template #body="{ data }"><b>{{ data._count.products }}</b></template></Column>
        <Column v-if="auth.isAdmin" class="right" style="width: 110px">
          <template #body="{ data }">
            <Button icon="pi pi-pencil" text rounded aria-label="Edit" @click="open(data)" />
            <Button icon="pi pi-trash" text rounded severity="danger" aria-label="Delete" @click="remove(data)" />
          </template>
        </Column>
      </DataTable>
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
.gname { display: inline-flex; align-items: center; gap: 8px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
.b { display: inline-block; font-size: .72rem; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--bg); color: var(--text-2); margin-right: 4px; white-space: nowrap; }
.b.req { background: color-mix(in srgb, var(--c) 15%, transparent); color: var(--c); }
.chips { display: flex; flex-wrap: wrap; gap: 5px; align-items: flex-start; }
.chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; font-size: 12.5px; background: var(--surface); white-space: nowrap; }
.chip.def { border-color: var(--c); color: var(--c); font-weight: 650; }
.pd { font-size: 11px; font-weight: 800; color: var(--c); }
</style>
