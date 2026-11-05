<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useConfirm } from 'primevue/useconfirm';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { useApp } from '@/stores/app';
import { dateTime } from '@/utils/format';

const app = useApp();
const notify = useNotify();
const confirm = useConfirm();
const tab = ref<'keys' | 'hooks'>('keys');

// ── API keys
const keys = ref<any[]>([]);
const scopes = ref<string[]>([]);
const keyDlg = ref(false);
const keyForm = reactive({ name: '', scopes: [] as string[], storeId: null as string | null, expiresAt: null as Date | null });
const newKey = ref<any>(null);

async function loadKeys() {
  try { keys.value = await api.get('/api-keys'); } catch (e) { notify.error(e); }
}
function openKey() {
  Object.assign(keyForm, { name: '', scopes: [], storeId: null, expiresAt: null });
  newKey.value = null;
  keyDlg.value = true;
}
async function createKey() {
  try {
    newKey.value = await api.post('/api-keys', {
      name: keyForm.name, scopes: keyForm.scopes, storeId: keyForm.storeId ?? undefined,
      expiresAt: keyForm.expiresAt ? keyForm.expiresAt.toISOString() : undefined,
    });
    loadKeys();
  } catch (e) { notify.error(e); }
}
function revoke(k: any) {
  confirm.require({
    header: 'Revoke API key',
    message: `"${k.name}" will stop working immediately. Continue?`,
    acceptProps: { label: 'Revoke', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', text: true },
    accept: async () => {
      try { await api.del(`/api-keys/${k.id}`); loadKeys(); } catch (e) { notify.error(e); }
    },
  });
}

// ── Webhooks
const hooks = ref<any[]>([]);
const events = ref<string[]>([]);
const hookDlg = ref(false);
const hookForm = reactive({ id: '', url: '', events: [] as string[], isActive: true });
const newSecret = ref<string | null>(null);
const deliveries = ref<any[]>([]);
const showDeliveries = ref(false);
const deliveriesFor = ref<any>(null);

async function loadHooks() {
  try { hooks.value = await api.get('/webhooks'); } catch (e) { notify.error(e); }
}
function openHook(h?: any) {
  Object.assign(hookForm, h ? { id: h.id, url: h.url, events: [...h.events], isActive: h.isActive } : { id: '', url: '', events: ['sale.created'], isActive: true });
  newSecret.value = null;
  hookDlg.value = true;
}
async function saveHook() {
  try {
    if (hookForm.id) {
      await api.patch(`/webhooks/${hookForm.id}`, { url: hookForm.url, events: hookForm.events, isActive: hookForm.isActive });
      hookDlg.value = false;
    } else {
      const h = await api.post('/webhooks', { url: hookForm.url, events: hookForm.events });
      newSecret.value = h.secret;
    }
    loadHooks();
  } catch (e) { notify.error(e); }
}
function removeHook(h: any) {
  confirm.require({
    header: 'Delete webhook', message: `Stop sending events to ${h.url}?`,
    acceptProps: { label: 'Delete', severity: 'danger' }, rejectProps: { label: 'Cancel', severity: 'secondary', text: true },
    accept: async () => { try { await api.del(`/webhooks/${h.id}`); loadHooks(); } catch (e) { notify.error(e); } },
  });
}
async function ping(h: any) {
  try { await api.post(`/webhooks/${h.id}/ping`); notify.success('Test event queued', 'Check the delivery log in a few seconds'); } catch (e) { notify.error(e); }
}
async function openDeliveries(h: any) {
  deliveriesFor.value = h;
  try {
    deliveries.value = (await api.get(`/webhooks/${h.id}/deliveries`, { limit: 50 })).data;
    showDeliveries.value = true;
  } catch (e) { notify.error(e); }
}
async function retry(d: any) {
  try { await api.post(`/webhooks/deliveries/${d.id}/retry`); notify.success('Retry queued'); setTimeout(() => openDeliveries(deliveriesFor.value), 1500); } catch (e) { notify.error(e); }
}

const copy = async (text: string) => {
  try { await navigator.clipboard.writeText(text); notify.success('Copied'); } catch { /* clipboard blocked */ }
};
const deliverySeverity: Record<string, string> = { SUCCESS: 'success', FAILED: 'danger', PENDING: 'warn' };

onMounted(async () => {
  loadKeys();
  loadHooks();
  [scopes.value, events.value] = await Promise.all([api.get('/api-keys/scopes'), api.get('/webhooks/events')]);
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Integrations</h1><div class="sub">Connect accounting, e-commerce or ERP systems · API docs at <a href="/docs" target="_blank">/docs</a> on the API server</div></div>
    </div>
    <SelectButton v-model="tab" :options="[{ l: 'API keys', v: 'keys' }, { l: 'Webhooks', v: 'hooks' }]" option-label="l" option-value="v" :allow-empty="false" style="margin-bottom: 14px" />

    <div v-if="tab === 'keys'" class="card">
      <div class="row" style="justify-content: space-between; margin-bottom: 12px">
        <span class="muted">Other systems send the key in the <span class="mono">X-API-Key</span> header.</span>
        <Button label="New API key" icon="pi pi-key" @click="openKey" />
      </div>
      <DataTable :value="keys" size="small">
        <template #empty><span class="muted">No API keys yet</span></template>
        <Column header="Name"><template #body="{ data }">{{ data.name }}<div class="mono small muted">{{ data.prefix }}…</div></template></Column>
        <Column header="Scopes"><template #body="{ data }"><Tag v-for="s in data.scopes" :key="s" :value="s" severity="secondary" style="margin: 2px" /></template></Column>
        <Column header="Store"><template #body="{ data }">{{ data.store?.code ?? 'All' }}</template></Column>
        <Column header="Last used"><template #body="{ data }">{{ dateTime(data.lastUsedAt) || 'never' }}</template></Column>
        <Column header="Status">
          <template #body="{ data }">
            <Tag v-if="data.revokedAt" value="revoked" severity="danger" />
            <Tag v-else-if="data.expiresAt && new Date(data.expiresAt) < new Date()" value="expired" severity="warn" />
            <Tag v-else value="active" severity="success" />
          </template>
        </Column>
        <Column class="right"><template #body="{ data }"><Button v-if="!data.revokedAt" label="Revoke" size="small" text severity="danger" @click="revoke(data)" /></template></Column>
      </DataTable>
    </div>

    <div v-else class="card">
      <div class="row" style="justify-content: space-between; margin-bottom: 12px">
        <span class="muted">We POST signed JSON to these URLs when events happen.</span>
        <Button label="New webhook" icon="pi pi-plus" @click="openHook()" />
      </div>
      <DataTable :value="hooks" size="small">
        <template #empty><span class="muted">No webhooks yet</span></template>
        <Column header="URL"><template #body="{ data }"><span class="mono small">{{ data.url }}</span></template></Column>
        <Column header="Events"><template #body="{ data }"><Tag v-for="e in data.events" :key="e" :value="e" severity="secondary" style="margin: 2px" /></template></Column>
        <Column header="Status"><template #body="{ data }"><Tag :value="data.isActive ? 'active' : 'paused'" :severity="data.isActive ? 'success' : 'secondary'" /></template></Column>
        <Column class="right" style="width: 220px">
          <template #body="{ data }">
            <Button icon="pi pi-send" text rounded v-tooltip="'Send test event'" aria-label="Test" @click="ping(data)" />
            <Button icon="pi pi-list" text rounded v-tooltip="'Delivery log'" aria-label="Deliveries" @click="openDeliveries(data)" />
            <Button icon="pi pi-pencil" text rounded aria-label="Edit" @click="openHook(data)" />
            <Button icon="pi pi-trash" text rounded severity="danger" aria-label="Delete" @click="removeHook(data)" />
          </template>
        </Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="keyDlg" header="New API key" modal :style="{ width: '560px' }" :breakpoints="{ '720px': '95vw' }">
      <form v-if="!newKey" class="form" @submit.prevent="createKey">
        <div class="field"><label>Name *</label><InputText v-model="keyForm.name" required placeholder="e.g. Online shop, Accounting" /></div>
        <div class="field"><label>Permissions *</label><MultiSelect v-model="keyForm.scopes" :options="scopes" placeholder="Select scopes" display="chip" /></div>
        <div class="form-2">
          <div class="field"><label>Limit to store</label><Select v-model="keyForm.storeId" :options="app.stores" option-label="name" option-value="id" show-clear placeholder="All stores" /></div>
          <div class="field"><label>Expires</label><DatePicker v-model="keyForm.expiresAt" placeholder="Never" show-button-bar /></div>
        </div>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Create key" :disabled="!keyForm.scopes.length" /></div>
      </form>
      <div v-else class="form">
        <Message severity="warn" :closable="false">Copy this key now. For security it will not be shown again.</Message>
        <div class="secret mono">{{ newKey.key }}</div>
        <div class="row" style="justify-content: flex-end">
          <Button label="Copy" icon="pi pi-copy" severity="secondary" @click="copy(newKey.key)" />
          <Button label="Done" @click="keyDlg = false" />
        </div>
      </div>
    </Dialog>

    <Dialog v-model:visible="hookDlg" :header="hookForm.id ? 'Edit webhook' : 'New webhook'" modal :style="{ width: '560px' }" :breakpoints="{ '720px': '95vw' }">
      <form v-if="!newSecret" class="form" @submit.prevent="saveHook">
        <div class="field"><label>URL *</label><InputText v-model="hookForm.url" required placeholder="https://example.com/pos-events" /></div>
        <div class="field"><label>Events *</label><MultiSelect v-model="hookForm.events" :options="['*', ...events]" display="chip" /><span class="hint">* = all events</span></div>
        <label v-if="hookForm.id" class="row"><ToggleSwitch v-model="hookForm.isActive" /> Active</label>
        <div class="row" style="justify-content: flex-end"><Button type="submit" label="Save" :disabled="!hookForm.events.length" /></div>
      </form>
      <div v-else class="form">
        <Message severity="warn" :closable="false">Signing secret. The receiver uses it to check the <span class="mono">X-POS-Signature</span> header. It is shown only once.</Message>
        <div class="secret mono">{{ newSecret }}</div>
        <div class="row" style="justify-content: flex-end">
          <Button label="Copy" icon="pi pi-copy" severity="secondary" @click="copy(newSecret!)" />
          <Button label="Done" @click="hookDlg = false" />
        </div>
      </div>
    </Dialog>

    <Drawer v-model:visible="showDeliveries" position="right" header="Delivery log" style="width: min(640px, 100vw)">
      <div class="mono small muted" style="margin-bottom: 10px">{{ deliveriesFor?.url }}</div>
      <DataTable :value="deliveries" size="small">
        <template #empty><span class="muted">Nothing sent yet</span></template>
        <Column header="Time"><template #body="{ data }">{{ dateTime(data.createdAt) }}</template></Column>
        <Column field="event" header="Event" />
        <Column header="Result"><template #body="{ data }"><Tag :value="data.status" :severity="deliverySeverity[data.status]" /><div class="small muted">{{ data.responseCode ?? '' }} {{ data.lastError ?? '' }}</div></template></Column>
        <Column field="attempts" header="Tries" class="right" />
        <Column class="right"><template #body="{ data }"><Button v-if="data.status === 'FAILED'" label="Retry" size="small" text @click="retry(data)" /></template></Column>
      </DataTable>
    </Drawer>
  </div>
</template>
