<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { useAuth } from '@/stores/auth';
import { money } from '@/utils/format';

const auth = useAuth();
const notify = useNotify();
const confirm = useConfirm();
const groups = ref<any[]>([]);
const loading = ref(false);
async function load() {
  loading.value = true;
  try { groups.value = (await api.get('/modifiers')).filter((g: any) => g.isActive); } catch (e) { notify.error(e); } finally { loading.value = false; }
}

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
  <div class="page" style="max-width: 1000px">
    <div class="page-head">
      <div><h1>Drink options</h1><div class="sub">Size, sugar, ice, milk, extras… Attach them to drinks on the Products page.</div></div>
      <div class="actions"><Button v-if="auth.isAdmin" label="New option group" icon="pi pi-plus" @click="open()" /></div>
    </div>
    <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(290px, 1fr))">
      <div v-for="g in groups" :key="g.id" class="card group">
        <div class="row" style="justify-content: space-between">
          <h3 style="margin: 0">{{ g.name }}</h3>
          <div v-if="auth.isAdmin" class="row">
            <Button icon="pi pi-pencil" text rounded size="small" aria-label="Edit" @click="open(g)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" aria-label="Delete" @click="remove(g)" />
          </div>
        </div>
        <div class="small muted">{{ g.minSelect ? 'Required' : 'Optional' }} · {{ g.maxSelect > 1 ? `up to ${g.maxSelect}` : 'choose one' }} · on {{ g._count.products }} item(s)</div>
        <div class="chips">
          <span v-for="o in g.options" :key="o.id" class="chip" :class="{ def: o.isDefault }">
            {{ o.name }}<b v-if="Number(o.priceDelta)"> {{ Number(o.priceDelta) > 0 ? '+' : '' }}{{ money(o.priceDelta) }}</b>
          </span>
        </div>
      </div>
      <div v-if="!groups.length && !loading" class="muted">No option groups yet.</div>
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
.group { display: grid; gap: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; font-size: 13px; }
.chip.def { border-color: var(--p-primary-color); color: var(--p-primary-color); }
</style>
