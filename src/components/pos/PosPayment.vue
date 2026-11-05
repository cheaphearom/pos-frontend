<script setup lang="ts">
/** Take payment: one or more methods (split), quick cash buttons, change. */
import { computed, nextTick, ref, watch } from 'vue';
import { humanize, money } from '@/utils/format';

const props = defineProps<{ amountDue: number; currency: string; busy: boolean }>();
const emit = defineEmits<{ pay: [{ method: string; amount: number; reference?: string }[]] }>();
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

      <template v-if="!done">
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
</style>
