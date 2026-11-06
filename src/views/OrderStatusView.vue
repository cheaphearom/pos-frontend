<script setup lang="ts">
/** Customer's order status: KHQR to pay, then queue number and live progress until "Ready". */
import { localName } from '@/i18n';
import LangSwitch from '@/components/LangSwitch.vue';
import QRCode from 'qrcode';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { pub } from '@/online/publicApi';
import { optionsText } from '@/utils/modifiers';

const route = useRoute();
const token = String(route.params.token);
const order = ref<any>(null);
const error = ref('');
const qrImg = ref('');
const khqr = ref<any>(null);
const now = ref(Date.now());
let poll: ReturnType<typeof setInterval> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
const money = (v: number | string) => '$' + Number(v).toFixed(2);

async function load() {
  try {
    const prev = order.value?.kitchenStatus;
    order.value = await pub(`/orders/${token}`);
    error.value = '';
    if (order.value.status === 'PENDING_PAYMENT' && !khqr.value) {
      khqr.value = await pub(`/orders/${token}/khqr`).catch(() => null);
      if (khqr.value) qrImg.value = await QRCode.toDataURL(khqr.value.qr, { width: 360, margin: 1 });
    }
    if (order.value.kitchenStatus === 'READY' && prev && prev !== 'READY') {
      try { navigator.vibrate?.([300, 150, 300]); } catch { /* not supported */ }
    }
    if (['COMPLETED', 'CANCELLED'].includes(order.value.kitchenStatus) || ['CANCELLED', 'EXPIRED', 'FAILED'].includes(order.value.status)) clearInterval(poll);
  } catch (e) {
    error.value = (e as Error).message;
  }
}

const step = computed(() => {
  const o = order.value;
  if (!o) return 0;
  if (o.status !== 'PAID') return 0;
  return { NEW: 1, PREPARING: 2, READY: 3, COMPLETED: 4 }[o.kitchenStatus as string] ?? 1;
});
const secondsLeft = computed(() => (order.value ? Math.max(0, Math.round((new Date(khqr.value?.expiresAt ?? order.value.expiresAt).getTime() - now.value) / 1000)) : 0));
watch(() => order.value?.status, (s) => { if (s === 'PAID') { khqr.value = null; qrImg.value = ''; } });

onMounted(() => {
  document.title = 'Your order';
  load();
  poll = setInterval(load, 3000);
  tick = setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => { clearInterval(poll); clearInterval(tick); });
</script>

<template>
  <div class="status">
    <div style="display: flex; justify-content: flex-end"><LangSwitch /></div>
    <div v-if="error && !order" class="card center"><h2>Order not found</h2><p class="muted">{{ error }}</p></div>
    <template v-else-if="order">
      <!-- Waiting for KHQR -->
      <section v-if="order.status === 'PENDING_PAYMENT'" class="card center">
        <h2>Pay with KHQR</h2>
        <p class="muted">Scan with any Cambodian banking app. Paying on this phone? Save the picture and open it from your banking app.</p>
        <div v-if="qrImg" class="khqr"><div class="kh">KHQR</div><img :src="qrImg" alt="KHQR payment code" /><div class="amt">{{ money(order.total) }}</div></div>
        <a v-if="qrImg" :href="qrImg" download="khqr.png" class="save"><i class="pi pi-download" /> Save QR picture</a>
        <p class="small muted"><i class="pi pi-spin pi-spinner" /> Waiting for payment · {{ Math.floor(secondsLeft / 60) }}:{{ String(secondsLeft % 60).padStart(2, '0') }}</p>
      </section>

      <section v-else-if="order.status === 'PAY_AT_COUNTER'" class="card center">
        <i class="pi pi-wallet big-ic" />
        <h2>Please pay at the counter</h2>
        <p>Tell the cashier your name: <b>{{ order.customerName }}</b></p>
        <p class="muted small">Your order starts as soon as it is paid.</p>
      </section>

      <section v-else-if="order.status === 'PAID'" class="card center" :class="{ ready: order.kitchenStatus === 'READY' }">
        <div class="small muted">Order number</div>
        <div class="q">{{ order.queueNo }}</div>
        <h2 v-if="order.kitchenStatus === 'READY'">Ready! {{ order.orderType === 'DINE_IN' ? 'We are bringing it to your table.' : 'Please collect at the counter.' }}</h2>
        <h2 v-else-if="order.kitchenStatus === 'COMPLETED'">Enjoy! Thank you</h2>
        <h2 v-else-if="order.kitchenStatus === 'CANCELLED'">This order was cancelled by the café. Please ask at the counter.</h2>
        <h2 v-else>{{ order.kitchenStatus === 'PREPARING' ? 'Being prepared…' : 'Order received' }}</h2>
        <ol class="steps">
          <li :class="{ done: step >= 1 }">Paid</li>
          <li :class="{ done: step >= 2 }">Preparing</li>
          <li :class="{ done: step >= 3 }">Ready</li>
        </ol>
      </section>

      <section v-else class="card center">
        <h2>{{ order.status === 'EXPIRED' ? 'Payment time ran out' : order.status === 'CANCELLED' ? 'Order cancelled' : 'We received your payment' }}</h2>
        <p class="muted">{{ order.status === 'FAILED' ? 'Please show this page at the counter so we can help you.' : 'You have not been charged. Please order again.' }}</p>
      </section>

      <section class="card">
        <div class="row" style="justify-content: space-between"><b>{{ order.customerName }}</b><span class="muted small">{{ order.orderType === 'DINE_IN' ? `Table ${order.tableNo}` : 'Pickup' }}</span></div>
        <div v-for="(l, i) in order.lines" :key="i" class="line">
          <div><b>{{ Number(l.quantity) }}×</b> {{ localName(l) }}<div v-if="l.modifiers?.length" class="small muted">{{ optionsText(l.modifiers) }}</div><div v-if="l.note" class="small note">“{{ l.note }}”</div></div>
          <span>{{ money(l.total) }}</span>
        </div>
        <div v-if="Number(order.totals?.pointsDiscount)" class="line"><span>Points used ({{ order.redeemPoints }})</span><span>−{{ money(order.totals.pointsDiscount) }}</span></div>
        <div class="line total"><span>{{ order.payMethod === 'WALLET' ? 'Paid from wallet' : 'Total' }}</span><span>{{ money(order.total) }}</span></div>
      </section>
      <RouterLink v-if="order.member" to="/m" class="again"><i class="pi pi-user" /> Back to my account</RouterLink>
      <RouterLink v-if="$route.query.store" :to="{ path: `/order/${$route.query.store}`, query: $route.query.table ? { table: $route.query.table } : {} }" class="again">Order more</RouterLink>
    </template>
    <div v-else class="center"><i class="pi pi-spin pi-spinner" style="font-size: 28px" /></div>
  </div>
</template>

<style scoped>
.status { max-width: 520px; margin: 0 auto; padding: 16px; display: grid; gap: 14px; min-height: 100vh; background: var(--bg); align-content: start; }
.center { text-align: center; }
h2 { margin: 6px 0; }
.khqr { width: 270px; margin: 10px auto; border-radius: 16px; overflow: hidden; background: #fff; box-shadow: 0 4px 16px rgba(0, 0, 0, .15); }
.kh { background: #e1232e; color: #fff; font-weight: 900; letter-spacing: .15em; padding: 10px; }
.khqr img { width: 240px; display: block; margin: 12px auto 0; }
.amt { color: #111; font-size: 24px; font-weight: 900; padding: 6px 0 14px; }
.save { display: inline-block; margin: 4px 0 8px; font-weight: 600; }
.q { font-size: 64px; font-weight: 900; line-height: 1.05; color: var(--p-primary-color); }
.ready { background: color-mix(in srgb, var(--good) 14%, var(--surface)); }
.ready .q { color: var(--good); }
.big-ic { font-size: 40px; color: var(--p-primary-color); }
.steps { list-style: none; padding: 0; margin: 14px 0 4px; display: flex; justify-content: space-between; counter-reset: s; }
.steps li { flex: 1; position: relative; color: var(--text-3); font-weight: 600; font-size: 14px; padding-top: 30px; }
.steps li::before { content: ''; position: absolute; top: 4px; left: 50%; transform: translateX(-50%); width: 20px; height: 20px; border-radius: 50%; background: var(--border); }
.steps li.done { color: var(--text); }
.steps li.done::before { background: var(--good); }
.line { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.line.total { font-weight: 800; font-size: 18px; border: 0; }
.note { color: #b45309; }
.again { text-align: center; font-weight: 700; }
</style>
