<script setup lang="ts">
/**
 * Manager approval on the cashier's screen: the manager types their PIN (keypad for touch screens).
 * Emits the approval id that the next request (sale with a big discount, refund, void) sends once.
 */
import { ref, watch } from 'vue';
import { api } from '@/api/client';

const props = defineProps<{ storeId: string | null; action: 'DISCOUNT' | 'REFUND' | 'VOID'; percent?: number; saleId?: string; reason?: string; message: string }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ approved: [{ approvalId: string; manager: string; percent?: number }] }>();

const pin = ref('');
const error = ref('');
const busy = ref(false);
watch(visible, (v) => { if (v) { pin.value = ''; error.value = ''; } });

function press(k: string) {
  error.value = '';
  if (k === '⌫') pin.value = pin.value.slice(0, -1);
  else if (k === 'C') pin.value = '';
  else if (pin.value.length < 8) pin.value += k;
}
function onKey(e: KeyboardEvent) {
  if (/^\d$/.test(e.key)) press(e.key);
  else if (e.key === 'Backspace') press('⌫');
  else if (e.key === 'Enter') submit();
}
async function submit() {
  if (pin.value.length < 4 || busy.value) return;
  busy.value = true;
  try {
    const r = await api.post('/approvals', { storeId: props.storeId, action: props.action, pin: pin.value, percent: props.percent, saleId: props.saleId, reason: props.reason || undefined });
    visible.value = false;
    emit('approved', { approvalId: r.approvalId, manager: r.manager, percent: props.percent });
  } catch (e: any) {
    error.value = e?.message ?? String(e);
    pin.value = '';
  } finally { busy.value = false; }
}
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Manager approval" :style="{ width: '340px' }" :breakpoints="{ '400px': '96vw' }">
    <div class="appr" tabindex="0" autofocus @keydown="onKey">
      <p class="msg">{{ message }}</p>
      <p class="small muted">Manager: type your approval PIN</p>
      <div class="dots" aria-live="polite"><span v-for="i in Math.max(4, pin.length)" :key="i" :class="{ on: i <= pin.length }" /></div>
      <Message v-if="error" severity="error" :closable="false" size="small">{{ error }}</Message>
      <div class="pad">
        <button v-for="k in KEYS" :key="k" type="button" :class="{ fn: k === 'C' || k === '⌫' }" :aria-label="k === '⌫' ? 'Delete' : k === 'C' ? 'Clear' : k" @click="press(k)">{{ k }}</button>
      </div>
      <Button label="Approve" icon="pi pi-check" class="go" :loading="busy" :disabled="pin.length < 4" @click="submit" />
    </div>
  </Dialog>
</template>

<style scoped>
.appr { display: grid; gap: 10px; outline: none; }
.msg { margin: 0; font-weight: 600; }
.small { margin: 0; }
.dots { display: flex; gap: 10px; justify-content: center; padding: 6px 0; }
.dots span { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--border); }
.dots span.on { background: var(--p-primary-color); border-color: var(--p-primary-color); }
.pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.pad button { height: 54px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit; font-size: 22px; font-weight: 700; cursor: pointer; }
.pad button:active { background: var(--bg); }
.pad .fn { font-size: 18px; color: var(--text-2); }
.go { padding: 12px; }
</style>
