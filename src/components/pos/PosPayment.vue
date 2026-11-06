<script setup lang="ts">
/** Take payment: one or more methods (split), quick cash buttons, change. */
import QRCode from 'qrcode';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import type { PaymentProgress } from '@/pos/display';
import { online } from '@/pos/network';
import { cardShort, humanize, money } from '@/utils/format';
import { formatKhr, khrToUsd, splitChange, usdToKhrUp, type ChangeMode } from '@shared/cash';

export interface WalletCardInfo { cardNumber: string; balance: string | number; hasPin: boolean; status: string; customer?: { name: string } | null }
const props = defineProps<{ amountDue: number; currency: string; busy: boolean; storeId: string; khqrEnabled: boolean; walletCard?: WalletCardInfo | null; voucher?: { code: string; balance: string } | null; khrRate?: number | null }>();
const notify = useNotify();
export interface PayLine { method: string; amount: number; reference?: string; pin?: string; currency?: 'KHR'; tendered?: number; rate?: number }
const emit = defineEmits<{ pay: [PayLine[], ChangeMode]; progress: [PaymentProgress | null] }>();
const visible = defineModel<boolean>('visible', { default: false });

const ALL_METHODS = [
  { v: 'CASH', icon: 'pi pi-money-bill', l: 'Cash $' },
  { v: 'CASH_KHR', icon: 'pi pi-money-bill', l: 'Cash ៛' },
  { v: 'KHQR', icon: 'pi pi-qrcode' },
  { v: 'CARD', icon: 'pi pi-credit-card' },
  { v: 'WALLET', icon: 'pi pi-wallet' },
  { v: 'VOUCHER', icon: 'pi pi-gift' },
  { v: 'BANK_TRANSFER', icon: 'pi pi-building-columns' },
  { v: 'E_WALLET', icon: 'pi pi-mobile' },
];
/** Riel cash only when the store has a rate */
const METHODS = computed(() => ALL_METHODS.filter((x) => x.v !== 'CASH_KHR' || props.khrRate).map((x) => ({ ...x, l: x.l ?? humanize(x.v) })).map((x) => (x.v === 'CASH' && !props.khrRate ? { ...x, l: 'Cash' } : x)));
const isCash = computed(() => method.value === 'CASH' || method.value === 'CASH_KHR');
const method = ref('CASH');
const amount = ref<number | null>(0);
const reference = ref('');
const payments = ref<PayLine[]>([]);
const input = ref<any>(null);

const r2 = (n: number) => Math.round(n * 100) / 100;
const paid = computed(() => r2(payments.value.reduce((s, p) => s + p.amount, 0)));
const remaining = computed(() => r2(Math.max(0, props.amountDue - paid.value)));
const nonCash = computed(() => payments.value.filter((p) => p.method !== 'CASH').reduce((s, p) => s + p.amount, 0));
const change = computed(() => r2(Math.max(0, paid.value - props.amountDue)));
const done = computed(() => paid.value >= props.amountDue - 1e-9);

// ───── Riel (dual currency) ─────
const rate = computed(() => props.khrRate || 0);
const dueKhr = computed(() => (rate.value ? usdToKhrUp(props.amountDue, rate.value) : 0));
const remainingKhr = computed(() => (rate.value ? usdToKhrUp(remaining.value, rate.value) : 0));
const CHANGE_KEY = 'pos.changeIn';
const changeMode = ref<ChangeMode>(((): ChangeMode => { try { return (localStorage.getItem(CHANGE_KEY) as ChangeMode) || 'MIXED'; } catch { return 'MIXED'; } })());
watch(changeMode, (v) => { try { localStorage.setItem(CHANGE_KEY, v); } catch { /* ignore */ } });
const CHANGE_MODES = [{ v: 'MIXED', l: '$ + ៛' }, { v: 'KHR', l: 'All ៛' }, { v: 'USD', l: 'All $' }];
const changeSplit = computed(() => splitChange(change.value, rate.value || null, changeMode.value));
/** Riel notes above what is still to pay */
const quickKhr = computed(() => {
  const due = remainingKhr.value;
  const set = new Set<number>([due]);
  for (const n of [1000, 5000, 10000, 20000, 50000, 100000]) {
    const up = Math.ceil(due / n) * n;
    if (up > due) set.add(up);
    if (set.size >= 6) break;
  }
  return [...set].filter((v) => v > 0).sort((a, b) => a - b);
});

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

// ───── Wallet card ─────
const wcard = ref<WalletCardInfo | null>(null);
const wCode = ref('');
const wPin = ref('');
const wBusy = ref(false);
const wBalance = computed(() => Number(wcard.value?.balance ?? 0) - payments.value.filter((x) => x.method === 'WALLET').reduce((s, x) => s + x.amount, 0));
async function findWallet() {
  if (!wCode.value.trim()) return;
  wBusy.value = true;
  try {
    wcard.value = await api.get('/wallet/cards/lookup', { code: wCode.value.trim() });
    if (wcard.value!.status !== 'ACTIVE') notify.error(`This card is ${wcard.value!.status.toLowerCase()}`);
    amount.value = Math.min(remaining.value, r2(wBalance.value));
  } catch (e) { notify.error(e); } finally { wBusy.value = false; }
}
function addWallet() {
  const a = r2(amount.value ?? 0);
  if (!wcard.value || a <= 0) return;
  if (a > r2(wBalance.value) + 1e-9) return notify.error(`Card balance is only ${money(wBalance.value, props.currency)}`);
  if (wcard.value.hasPin && !/^\d{4,6}$/.test(wPin.value)) return notify.error('Ask the customer to type the card PIN');
  method.value = 'WALLET';
  reference.value = wcard.value.cardNumber;
  const pin = wPin.value || undefined;
  if (nonCash.value + a > props.amountDue + 1e-9) return;
  payments.value.push({ method: 'WALLET', amount: a, reference: wcard.value.cardNumber, pin });
  reference.value = '';
  wPin.value = '';
  amount.value = remaining.value;
  if (done.value) finish();
}

// ───── Gift voucher ─────
const vinfo = ref<{ code: string; balance: number } | null>(null);
const vCode = ref('');
const vLeft = computed(() => (vinfo.value ? vinfo.value.balance - payments.value.filter((x) => x.method === 'VOUCHER' && x.reference === vinfo.value!.code).reduce((s, x) => s + x.amount, 0) : 0));
async function findVoucher() {
  try {
    const v = await api.get('/vouchers/lookup', { code: vCode.value.trim() });
    if (v.status !== 'ACTIVE' || v.expired) return notify.error(v.expired ? 'This voucher has expired' : v.status === 'INACTIVE' ? 'This voucher was not sold yet' : `Voucher is ${v.status.toLowerCase()}`);
    vinfo.value = { code: v.code, balance: Number(v.balance) };
    amount.value = Math.min(remaining.value, r2(vLeft.value));
  } catch (e) { notify.error(e); }
}
function addVoucher() {
  const a = r2(amount.value ?? 0);
  if (!vinfo.value || a <= 0) return;
  if (a > r2(vLeft.value) + 1e-9) return notify.error(`Voucher has only ${money(vLeft.value, props.currency)}`);
  if (nonCash.value + a > props.amountDue + 1e-9) return notify.error('A voucher cannot pay more than the amount due (no change on vouchers)');
  payments.value.push({ method: 'VOUCHER', amount: a, reference: vinfo.value.code });
  amount.value = remaining.value;
  if (done.value) finish();
}

watch(visible, (v) => {
  if (!v) return;
  vinfo.value = props.voucher ? { code: props.voucher.code, balance: Number(props.voucher.balance) } : null;
  vCode.value = '';
  wcard.value = props.walletCard ?? null;
  wCode.value = '';
  wPin.value = '';
  payments.value = [];
  method.value = 'CASH';
  reference.value = '';
  amount.value = props.amountDue;
  focus();
});
watch(method, (m) => {
  amount.value =
    m === 'WALLET' && wcard.value ? Math.min(remaining.value, r2(wBalance.value)) : m === 'VOUCHER' && vinfo.value ? Math.min(remaining.value, r2(vLeft.value))
      : m === 'CASH_KHR' ? remainingKhr.value : remaining.value;
  focus();
});

function focus() {
  nextTick(() => input.value?.$el?.querySelector('input')?.select());
}

function add(value?: number) {
  if (method.value === 'CASH_KHR') {
    const riel = Math.round((value ?? amount.value ?? 0) / 100) * 100;
    if (riel <= 0) return;
    payments.value.push({ method: 'CASH', amount: khrToUsd(riel, rate.value), currency: 'KHR', tendered: riel, rate: rate.value });
    amount.value = remainingKhr.value;
    if (done.value && payments.value.length === 1) finish();
    else focus();
    return;
  }
  const a = r2(value ?? amount.value ?? 0);
  if (a <= 0) return;
  if (method.value !== 'CASH' && nonCash.value + a > props.amountDue + 1e-9) return;
  payments.value.push({ method: method.value, amount: a, reference: reference.value || undefined });
  reference.value = '';
  amount.value = method.value === 'CASH_KHR' ? remainingKhr.value : remaining.value;
  if (done.value && method.value === 'CASH' && payments.value.length === 1) {
    // Single cash payment: finish straight away, like a real till.
    finish();
  } else focus();
}

const nonCashError = computed(
  () => !isCash.value && (amount.value ?? 0) + nonCash.value > props.amountDue + 1e-9 ? 'Card / QR / transfer cannot be more than the amount due' : '',
);

function finish() {
  if (done.value && !props.busy) emit('pay', payments.value, changeMode.value);
}

// Tell the POS (and so the customer display) what is happening in this dialog.
watch(
  () => [visible.value, paid.value, remaining.value, change.value, khqr.value?.md5, khqr.value?.status, changeMode.value],
  () => {
    if (!visible.value) return emit('progress', null);
    const k = khqr.value;
    emit('progress', {
      paid: paid.value, remaining: remaining.value, change: change.value,
      khqr: k ? { qr: k.qr, amount: k.amount, expiresAt: k.expiresAt, status: k.status } : null,
      changeKhr: rate.value ? changeSplit.value.khr : undefined, changeUsd: rate.value ? changeSplit.value.usd : undefined,
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
        <div v-if="rate" class="khr-due" data-test="due-khr">{{ formatKhr(dueKhr) }} <span class="muted small">· {{ rate.toLocaleString() }} ៛ = $1</span></div>
      </div>

      <div class="methods">
        <button v-for="mt in METHODS" :key="mt.v" type="button" class="method" :class="{ on: method === mt.v }" @click="method = mt.v">
          <i :class="mt.icon" /> {{ mt.l }}
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

      <div v-if="!done && method === 'WALLET'" class="form">
        <Message v-if="!online" severity="warn" :closable="false">Wallet cards need an internet connection.</Message>
        <template v-else-if="!wcard">
          <div class="row" style="gap: 10px; align-items: flex-end">
            <div class="field" style="flex: 1"><label>Scan the wallet card</label><InputText v-model="wCode" autofocus placeholder="Card number" @keydown.enter.prevent="findWallet" /></div>
            <Button label="Find" icon="pi pi-search" :loading="wBusy" @click="findWallet" />
          </div>
        </template>
        <template v-else>
          <div class="wallet-box">
            <div><b>{{ wcard.customer?.name ?? 'Wallet card' }}</b> <span class="mono muted">{{ cardShort(wcard.cardNumber) }}</span></div>
            <div>Balance <b>{{ money(wBalance, currency) }}</b></div>
          </div>
          <div class="row" style="gap: 10px; align-items: flex-end">
            <div class="field" style="flex: 1">
              <label>Amount from card</label>
              <InputNumber v-model="amount" :min="0" :max="Math.min(remaining, wBalance)" :min-fraction-digits="2" :max-fraction-digits="2" fluid input-class="amount-input" @keydown.enter.prevent="addWallet" />
            </div>
            <div v-if="wcard.hasPin" class="field" style="width: 130px">
              <label>Customer PIN</label>
              <Password v-model="wPin" :feedback="false" input-class="pin-input" :input-props="{ inputmode: 'numeric', maxlength: 6, autocomplete: 'off' }" fluid @keydown.enter.prevent="addWallet" />
            </div>
          </div>
          <div class="row">
            <Button label="Pay from card" icon="pi pi-wallet" size="large" :disabled="!amount || wcard.status !== 'ACTIVE'" @click="addWallet" />
            <Button label="Other card" text severity="secondary" @click="wcard = null" />
          </div>
          <small v-if="wBalance < remaining" class="muted">The card covers {{ money(wBalance, currency) }}; pay the rest with another method.</small>
        </template>
      </div>

      <div v-if="!done && method === 'VOUCHER'" class="form">
        <Message v-if="!online" severity="warn" :closable="false">Vouchers need an internet connection.</Message>
        <div v-else-if="!vinfo" class="row" style="gap: 10px; align-items: flex-end">
          <div class="field" style="flex: 1"><label>Scan the voucher</label><InputText v-model="vCode" autofocus placeholder="Voucher code" @keydown.enter.prevent="findVoucher" /></div>
          <Button label="Find" icon="pi pi-search" @click="findVoucher" />
        </div>
        <template v-else>
          <div class="wallet-box"><span class="mono"><b>{{ vinfo.code }}</b></span><span>Left <b>{{ money(vLeft, currency) }}</b></span></div>
          <div class="row" style="gap: 10px; align-items: flex-end">
            <div class="field" style="flex: 1"><label>Amount from voucher</label><InputNumber v-model="amount" :min="0" :max="Math.min(remaining, vLeft)" :min-fraction-digits="2" :max-fraction-digits="2" fluid input-class="amount-input" @keydown.enter.prevent="addVoucher" /></div>
            <Button label="Use voucher" icon="pi pi-gift" size="large" :disabled="!amount" @click="addVoucher" />
          </div>
          <div class="row"><Button label="Other voucher" text severity="secondary" @click="vinfo = null" /></div>
          <small class="muted">What is not spent stays on the voucher. No change is given.</small>
        </template>
      </div>

      <template v-if="!done && !useKhqr && method !== 'WALLET' && method !== 'VOUCHER'">
        <div class="row" style="gap: 10px; align-items: flex-end">
          <div class="field" style="flex: 1">
            <label>{{ method === 'CASH_KHR' ? 'Riel received' : method === 'CASH' && rate ? 'Dollars received' : `${humanize(method)} amount` }}</label>
            <InputNumber v-if="method === 'CASH_KHR'" ref="input" v-model="amount" :min="0" :step="100" :max-fraction-digits="0" prefix="៛" fluid input-class="amount-input" @keydown.enter.prevent="add()" />
            <InputNumber v-else ref="input" v-model="amount" :min="0" :min-fraction-digits="2" :max-fraction-digits="2" fluid input-class="amount-input" @keydown.enter.prevent="add()" />
          </div>
          <Button :label="payments.length ? 'Add' : 'Pay'" icon="pi pi-check" size="large" :disabled="!!nonCashError || !amount" @click="add()" />
        </div>
        <div v-if="method === 'CASH'" class="quick">
          <Button v-for="q in quick" :key="q" :label="money(q, currency)" severity="secondary" outlined @click="add(q)" />
        </div>
        <div v-else-if="method === 'CASH_KHR'" class="quick khr">
          <Button v-for="q in quickKhr" :key="q" :label="formatKhr(q)" severity="secondary" outlined @click="add(q)" />
        </div>
        <div v-if="isCash && rate" class="row change-mode">
          <span class="small muted">Give change as</span>
          <SelectButton v-model="changeMode" :options="CHANGE_MODES" option-label="l" option-value="v" :allow-empty="false" size="small" />
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
          <span>{{ p.currency === 'KHR' ? `Cash ${formatKhr(p.tendered!)}` : humanize(p.method) }} <span v-if="p.reference" class="muted small mono">{{ p.method === 'WALLET' ? cardShort(p.reference) : p.method === 'KHQR' && p.reference.length === 32 ? 'KHQR' : p.reference }}</span></span>
          <span class="row num">{{ money(p.amount, currency) }}
            <Button v-if="!busy" icon="pi pi-times" text rounded size="small" severity="secondary" aria-label="Remove payment" @click="payments.splice(i, 1)" />
          </span>
        </div>
        <div v-if="!done" class="row" style="justify-content: space-between"><b>Still to pay</b><b class="num">{{ money(remaining, currency) }}</b></div>
      </div>

      <div v-if="done" class="change">
        <div>
          <div class="muted">Change</div>
          <template v-if="rate && change > 0">
            <div class="big num" data-test="change-split">{{ [changeSplit.usd ? money(changeSplit.usd, currency) : '', changeSplit.khr ? formatKhr(changeSplit.khr) : ''].filter(Boolean).join(' + ') || money(0, currency) }}</div>
            <div class="small muted">= {{ money(change, currency) }}</div>
          </template>
          <div v-else class="big num">{{ money(change, currency) }}</div>
        </div>
        <Button label="Complete sale" icon="pi pi-check-circle" size="large" :loading="busy" autofocus @click="finish" />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.pay { display: grid; gap: 16px; }
.due { text-align: center; background: linear-gradient(135deg, var(--p-primary-color), color-mix(in srgb, var(--p-primary-color) 70%, #c8893f)); color: #fff; border-radius: 16px; padding: 14px 12px; }
.due .muted { color: rgba(255, 255, 255, .8); }
.due .khr-due { color: rgba(255, 255, 255, .9); }
.due .khr-due .muted { color: rgba(255, 255, 255, .75); }
.big { font-size: 36px; font-weight: 800; line-height: 1.15; }
.methods { display: grid; grid-template-columns: repeat(auto-fit, minmax(98px, 1fr)); gap: 8px; }
.method { border: 1.5px solid var(--border); background: var(--surface); color: var(--text); border-radius: 12px; padding: 12px 6px; min-height: 68px; font: inherit; font-weight: 650; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; transition: border-color .1s, background .1s; }
.method:hover { border-color: var(--p-primary-color); }
.method i { font-size: 20px; }
.method.on { border-color: var(--p-primary-color); background: color-mix(in srgb, var(--p-primary-color) 12%, var(--surface)); color: var(--p-primary-color); box-shadow: inset 0 0 0 1px var(--p-primary-color); }
.quick { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
.quick :deep(.p-button) { padding: 12px 6px; font-size: 16px; font-weight: 700; }
.khr-due { font-size: 18px; font-weight: 700; }
.change-mode { gap: 10px; }
.paid { display: grid; gap: 4px; border-top: 1px solid var(--border); padding-top: 10px; }
.change { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: color-mix(in srgb, var(--good) 13%, var(--surface)); border: 1px solid color-mix(in srgb, var(--good) 30%, transparent); border-radius: 14px; padding: 14px 16px; }
:deep(.amount-input) { font-size: 22px; font-weight: 650; }
.wallet-box { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; background: color-mix(in srgb, var(--p-primary-color) 10%, var(--surface)); border-radius: 10px; padding: 12px 14px; }
.khqr { display: grid; justify-items: center; gap: 10px; text-align: center; }
.khqr-card { width: 270px; border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, .12); }
.khqr-head { background: #e1232e; color: #fff; font-weight: 800; letter-spacing: .1em; padding: 10px; }
.khqr-card img { display: block; margin: 14px auto 4px; }
.khqr-amount { color: #111; font-size: 22px; font-weight: 800; padding: 4px 0 14px; }
</style>
