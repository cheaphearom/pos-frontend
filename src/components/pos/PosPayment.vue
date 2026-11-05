<script setup lang="ts">
/** Take payment: one or more methods (split), quick cash buttons, change. */
import QRCode from 'qrcode';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import type { PaymentProgress } from '@/pos/display';
import { online } from '@/pos/network';
import { humanize, money } from '@/utils/format';

const props = defineProps<{ amountDue: number; currency: string; busy: boolean; storeId: string; khqrEnabled: boolean }>();
const notify = useNotify();
const emit = defineEmits<{ pay: [{ method: string; amount: number; reference?: string }[]]; progress: [PaymentProgress | null] }>();
const visible = defineModel<boolean>('visible', { default: false });

const METHODS = [
  { v: 'CASH', icon: 'pi pi-money-bill' },
  { v: 'KHQR', icon: 'pi pi-qrcode' },
  { v: 'CARD', icon: 'pi pi-credit-card' },
  { v: 'BANK_TRANSFER', icon: 'pi pi-building-columns' },
  { v: 'E_WALLET', icon: 'pi pi-mobile' },
];
const method = ref('CASH');
const amount = ref<number | null>(0);
const reference = ref('');
const payments = ref<{ method: string; amount: number; reference?: string }[]>([]);
const input = ref<any>(null);

const r2 = (n: number) => Math.round(n * 100) / 100;
const paid = computed(() => r2(payments.value.reduce((s, p) => s + p.amount, 0)));
const remaining = computed(() => r2(Math.max(0, props.amountDue - paid.value)));
const nonCash = computed(() => payments.value.filter((p) => p.method !== 'CASH').reduce((s, p) => s + p.amount, 0));
const change = computed(() => r2(Math.max(0, paid.value - props.amountDue)));
const done = computed(() => paid.value >= props.amountDue - 1e-9);

/** Banknote shortcuts above the amount due. */
const quick = computed(() => {
  const due = remaining.value;
  const notes = [1, 2, 5, 10, 20, 50, 100];
  const set = new Set<number>([due]);
  for (const n of notes) {
    const up = Math.ceil(due / n) * n;
    if (up > due) set.add(up);
    if (set.size >= 6) break;
  }
  return [...set].filter((v) => v > 0).sort((a, b) => a - b);
});

// ───── KHQR: show a Bakong QR for the exact amount and wait for the payment ─────
const khqr = ref<{ md5: string; qr: string; amount: number; expiresAt: string; status: string; mode: string } | null>(null);
const khqrImg = ref('');
const khqrBusy = ref(false);
const secondsLeft = ref(0);
let poll: ReturnType<typeof setInterval> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
const useKhqr = computed(() => method.value === 'KHQR' && props.khqrEnabled && online.value);

function stopKhqr() {
  clearInterval(poll);
  clearInterval(tick);
  khqr.value = null;
  khqrImg.value = '';
}
async function startKhqr() {
  stopKhqr();
  khqrBusy.value = true;
  try {
    const amount = remaining.value;
    const res = await api.post('/payments/khqr', { storeId: props.storeId, amount });
    khqr.value = { ...res, amount };
    khqrImg.value = await QRCode.toDataURL(res.qr, { width: 300, margin: 1, errorCorrectionLevel: 'M' });
    tick = setInterval(() => {
      secondsLeft.value = Math.max(0, Math.round((new Date(khqr.value!.expiresAt).getTime() - Date.now()) / 1000));
    }, 500);
    poll = setInterval(checkKhqr, 2500);
  } catch (e) {
    notify.error(e);
  } finally {
    khqrBusy.value = false;
  }
}
async function checkKhqr() {
  if (!khqr.value) return;
  try {
    const st = await api.get(`/payments/khqr/${khqr.value.md5}`);
    khqr.value.status = st.status;
    if (st.status === 'PAID') khqrPaid();
    else if (st.status === 'EXPIRED') clearInterval(poll);
  } catch { /* network blip: keep polling */ }
}
async function confirmKhqr() {
  if (!khqr.value) return;
  khqrBusy.value = true;
  try {
    const st = await api.post(`/payments/khqr/${khqr.value.md5}/confirm`);
    if (st.status === 'PAID') khqrPaid();
  } catch (e) { notify.error(e); } finally { khqrBusy.value = false; }
}
function khqrPaid() {
  const k = khqr.value!;
  stopKhqr();
  payments.value.push({ method: 'KHQR', amount: k.amount, reference: k.md5 });
  notify.success('KHQR payment received', money(k.amount, props.currency));
  if (done.value) finish();
  else amount.value = remaining.value;
}
watch(method, (m) => m !== 'KHQR' && stopKhqr());
watch(visible, (v) => !v && stopKhqr());
onBeforeUnmount(stopKhqr);

watch(visible, (v) => {
  if (!v) return;
  payments.value = [];
  method.value = 'CASH';
  reference.value = '';
  amount.value = props.amountDue;
  focus();
});
watch(method, () => {
  amount.value = remaining.value;
  focus();
});

function focus() {
  nextTick(() => input.value?.$el?.querySelector('input')?.select());
}

function add(value?: number) {
  const a = r2(value ?? amount.value ?? 0);
  if (a <= 0) return;
  if (method.value !== 'CASH' && nonCash.value + a > props.amountDue + 1e-9) return;
  payments.value.push({ method: method.value, amount: a, reference: reference.value || undefined });
  reference.value = '';
  amount.value = remaining.value;
  if (done.value && method.value === 'CASH' && payments.value.length === 1) {
    // Single cash payment: finish straight away, like a real till.
    finish();
  } else focus();
}

const nonCashError = computed(
  () => method.value !== 'CASH' && (amount.value ?? 0) + nonCash.value > props.amountDue + 1e-9 ? 'Card / QR / transfer cannot be more than the amount due' : '',
);

function finish() {
  if (done.value && !props.busy) emit('pay', payments.value);
}

// Tell the POS (and so the customer display) what is happening in this dialog.
watch(
  () => [visible.value, paid.value, remaining.value, change.value, khqr.value?.md5, khqr.value?.status],
  () => {
    if (!visible.value) return emit('progress', null);
    const k = khqr.value;
    emit('progress', {
      paid: paid.value, remaining: remaining.value, change: change.value,
      khqr: k ? { qr: k.qr, amount: k.amount, expiresAt: k.expiresAt, status: k.status } : null,
    });
  },
  { immediate: true },
);
</script>

<template>
  <Dialog v-model:visible="visible" header="Payment" modal :style="{ width: '560px' }" :breakpoints="{ '640px': '100vw' }" :closable="!busy">
    <div class="pay">
      <div class="due">
        <div class="muted">Amount due</div>
        <div class="big">{{ money(amountDue, currency) }}</div>
      </div>

      <div class="methods">
        <button v-for="mt in METHODS" :key="mt.v" type="button" class="method" :class="{ on: method === mt.v }" @click="method = mt.v">
          <i :class="mt.icon" /> {{ humanize(mt.v) }}
        </button>
      </div>

      <div v-if="!done && useKhqr" class="khqr">
        <template v-if="!khqr">
          <Button :label="`Show KHQR for ${money(remaining, currency)}`" icon="pi pi-qrcode" size="large" :loading="khqrBusy" @click="startKhqr" />
          <span class="small muted">The customer scans with any Cambodian banking app.</span>
        </template>
        <template v-else>
          <div class="khqr-card">
            <div class="khqr-head">KHQR</div>
            <img v-if="khqrImg" :src="khqrImg" alt="KHQR code" width="240" height="240" />
            <div class="khqr-amount">{{ money(khqr.amount, currency) }}</div>
          </div>
          <div v-if="khqr.status === 'EXPIRED' || secondsLeft === 0" class="neg">This QR has expired.</div>
          <div v-else class="small muted">
            <i class="pi pi-spin pi-spinner" /> Waiting for payment… {{ Math.floor(secondsLeft / 60) }}:{{ String(secondsLeft % 60).padStart(2, '0') }}
          </div>
          <div class="row">
            <Button v-if="khqr.status === 'EXPIRED' || secondsLeft === 0" label="New QR" icon="pi pi-refresh" @click="startKhqr" />
            <Button v-else-if="khqr.mode === 'manual'" label="Customer has paid" icon="pi pi-check" :loading="khqrBusy" @click="confirmKhqr" />
            <Button label="Cancel" text severity="secondary" @click="stopKhqr" />
          </div>
          <small v-if="khqr.mode === 'manual'" class="muted">Check the payment arrived in your bank app before confirming.</small>
        </template>
      </div>

      <template v-if="!done && !useKhqr">
        <div class="row" style="gap: 10px; align-items: flex-end">
          <div class="field" style="flex: 1">
            <label>{{ humanize(method) }} amount</label>
            <InputNumber ref="input" v-model="amount" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" fluid input-class="amount-input" @keydown.enter.prevent="add()" />
          </div>
          <Button :label="payments.length ? 'Add' : 'Pay'" icon="pi pi-check" size="large" :disabled="!!nonCashError || !amount" @click="add()" />
        </div>
        <div v-if="method === 'CASH'" class="quick">
          <Button v-for="q in quick" :key="q" :label="money(q, currency)" severity="secondary" outlined @click="add(q)" />
        </div>
        <div v-else class="field">
          <label>Reference (approval code, transaction id)</label>
          <InputText v-model="reference" @keydown.enter.prevent="add()" />
        </div>
        <small v-if="nonCashError" class="neg">{{ nonCashError }}</small>
        <small v-if="method === 'KHQR' && !online" class="muted">Offline: KHQR codes cannot be checked. Enter the bank reference after checking the payment.</small>
      </template>

      <div v-if="payments.length" class="paid">
        <div v-for="(p, i) in payments" :key="i" class="row" style="justify-content: space-between">
          <span>{{ humanize(p.method) }} <span v-if="p.reference" class="muted small mono">{{ p.reference }}</span></span>
          <span class="row num">{{ money(p.amount, currency) }}
            <Button v-if="!busy" icon="pi pi-times" text rounded size="small" severity="secondary" aria-label="Remove payment" @click="payments.splice(i, 1)" />
          </span>
        </div>
        <div v-if="!done" class="row" style="justify-content: space-between"><b>Still to pay</b><b class="num">{{ money(remaining, currency) }}</b></div>
      </div>

      <div v-if="done" class="change">
        <div>
          <div class="muted">Change</div>
          <div class="big num">{{ money(change, currency) }}</div>
        </div>
        <Button label="Complete sale" icon="pi pi-check-circle" size="large" :loading="busy" autofocus @click="finish" />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.pay { display: grid; gap: 16px; }
.due { text-align: center; }
.big { font-size: 34px; font-weight: 750; }
.methods { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; }
.method { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 10px; padding: 12px 6px; font: inherit; font-weight: 600; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.method i { font-size: 20px; }
.method.on { border-color: var(--p-primary-color); background: color-mix(in srgb, var(--p-primary-color) 12%, var(--surface)); color: var(--p-primary-color); }
.quick { display: flex; flex-wrap: wrap; gap: 8px; }
.paid { display: grid; gap: 4px; border-top: 1px solid var(--border); padding-top: 10px; }
.change { display: flex; justify-content: space-between; align-items: center; background: color-mix(in srgb, var(--good) 12%, var(--surface)); border-radius: 10px; padding: 14px 16px; }
:deep(.amount-input) { font-size: 22px; font-weight: 650; }
.khqr { display: grid; justify-items: center; gap: 10px; text-align: center; }
.khqr-card { width: 270px; border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, .12); }
.khqr-head { background: #e1232e; color: #fff; font-weight: 800; letter-spacing: .1em; padding: 10px; }
.khqr-card img { display: block; margin: 14px auto 4px; }
.khqr-amount { color: #111; font-size: 22px; font-weight: 800; padding: 4px 0 14px; }
</style>
