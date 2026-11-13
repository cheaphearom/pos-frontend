<script setup lang="ts">
/**
 * Customer-facing screen. Opened from the POS ("Customer display") on a second monitor.
 * It only listens to the POS window (BroadcastChannel), so it needs no login and works offline.
 */
import QRCode from 'qrcode';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { describePromotion, isPromoActive, type PromoRule } from '@shared/promotions';
import { displayChannel, type DisplayState } from '@/pos/display';
import { qty } from '@/utils/format';
import { formatKhr, usdToKhrUp } from '@shared/cash';
import { useDark } from '@/composables/useDark';

const route = useRoute();
/** Follows the POS's dark mode switch (same computer), even while open */
const dark = useDark();
const storeId = String(route.query.store ?? '');
const channel = displayChannel(storeId);
const state = ref<DisplayState | null>(null);
const connected = ref(false);

const readJson = <T,>(k: string, d: T): T => {
  try { return JSON.parse(localStorage.getItem(k) ?? '') ?? d; } catch { return d; }
};
const savedStore = readJson<any[]>('pos.stores', []).find((s) => s.id === storeId);
const storeName = computed(() => state.value?.store.name || savedStore?.name || '');
const currency = computed(() => state.value?.store.currency || savedStore?.currency || 'USD');
const money = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.value }).format(v || 0);

// ── Promotions for the welcome screen (saved by the POS, works offline)
const promoData = ref(readJson<{ timeZone: string; promotions: PromoRule[] }>(`pos.promos:${storeId}`, { timeZone: 'UTC', promotions: [] }));
const now = ref(new Date());
const runningPromos = computed(() => promoData.value.promotions.filter((p) => isPromoActive(p, storeId, now.value, promoData.value.timeZone)));
const promoIndex = ref(0);
const currentPromo = computed(() => runningPromos.value[promoIndex.value % Math.max(1, runningPromos.value.length)]);
function onStorage(e: StorageEvent) {
  if (e.key === `pos.promos:${storeId}`) promoData.value = readJson(e.key, promoData.value);
}

// ── Messages from the POS
channel.onMessage((msg) => {
  if (msg.type === 'state') {
    state.value = msg.state;
    connected.value = true;
  } else if (msg.type === 'hello') channel.send({ type: 'hello' });
});

const mode = computed(() => state.value?.mode ?? 'idle');
const lines = computed(() => state.value?.lines ?? []);
/** "$7 + ៛900" when change is given in two currencies */
function changeText(change: number, usd?: number, khr?: number) {
  if (!khr) return money(usd ?? change);
  return [usd ? money(usd) : '', formatKhr(khr)].filter(Boolean).join(' + ');
}
const t = computed(() => state.value?.totals);
const saved = computed(() => (t.value?.discount ?? 0) + (t.value?.points ?? 0));

// Keep the newest item visible
const listEl = ref<HTMLElement | null>(null);
watch(() => lines.value.length, () => nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })));

// ── KHQR image
const khqr = computed(() => state.value?.payment?.khqr ?? null);
const khqrImg = ref('');
watch(() => khqr.value?.qr, async (qr) => {
  khqrImg.value = qr ? await QRCode.toDataURL(qr, { width: 420, margin: 1, errorCorrectionLevel: 'M' }) : '';
}, { immediate: true });
const secondsLeft = computed(() => (khqr.value ? Math.max(0, Math.round((new Date(khqr.value.expiresAt).getTime() - now.value.getTime()) / 1000)) : 0));

// ── Clock, fullscreen, hide cursor
const clockText = computed(() => now.value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const dateText = computed(() => now.value.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
let tick: ReturnType<typeof setInterval> | undefined;
let rotate: ReturnType<typeof setInterval> | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
const isFullscreen = ref(false);
async function fullscreen() {
  try {
    await document.documentElement.requestFullscreen();
  } catch { /* not allowed */ }
}
const onFs = () => (isFullscreen.value = !!document.fullscreenElement);
const bye = () => channel.send({ type: 'bye' });

onMounted(() => {
  document.title = 'Customer display';
  channel.send({ type: 'hello' });
  tick = setInterval(() => (now.value = new Date()), 1000);
  rotate = setInterval(() => promoIndex.value++, 6000);
  heartbeat = setInterval(() => channel.send({ type: 'ping' }), 4000); // lets the POS know this screen is still open
  window.addEventListener('storage', onStorage);
  window.addEventListener('pagehide', bye);
  document.addEventListener('fullscreenchange', onFs);
});
onBeforeUnmount(() => {
  bye();
  channel.close();
  clearInterval(tick);
  clearInterval(rotate);
  clearInterval(heartbeat);
  window.removeEventListener('storage', onStorage);
  window.removeEventListener('pagehide', bye);
  document.removeEventListener('fullscreenchange', onFs);
});
</script>

<template>
  <div class="cd" :class="['m-' + mode, { night: dark }]">
    <button v-if="!isFullscreen" class="fs" @click="fullscreen"><i class="pi pi-window-maximize" /> Full screen</button>
    <div v-if="!channel.supported" class="warn">This browser cannot connect to the POS. Use Chrome or Edge.</div>

    <!-- Welcome -->
    <section v-if="mode === 'idle'" class="idle">
      <div class="welcome">
        <div class="kh">សូមស្វាគមន៍</div>
        <h1>{{ storeName ? `Welcome to ${storeName}` : 'Welcome' }}</h1>
        <div class="clock">{{ clockText }}</div>
        <div class="date">{{ dateText }}</div>
      </div>
      <Transition name="fade" mode="out-in">
        <div v-if="currentPromo" :key="currentPromo.id" class="promo-card">
          <div class="promo-tag"><i class="pi pi-tag" /> Today's deal</div>
          <div class="promo-name">{{ currentPromo.name }}</div>
          <div class="promo-deal">{{ describePromotion(currentPromo) }}</div>
          <div v-if="runningPromos.length > 1" class="dots"><span v-for="(p, i) in runningPromos" :key="p.id" :class="{ on: i === promoIndex % runningPromos.length }" /></div>
        </div>
      </Transition>
      <div class="pay-with">We accept <b>KHQR</b> · cash · cards</div>
      <div v-if="!connected" class="hint">Waiting for the POS…</div>
    </section>

    <!-- Thank you -->
    <section v-else-if="mode === 'done' && state?.done" class="done">
      <div class="check"><i class="pi pi-check" /></div>
      <div class="kh">អរគុណ</div>
      <h1>Thank you!</h1>
      <div v-if="state.done.queueNo" class="order-no"><div>Your order number</div><b>{{ state.done.queueNo }}</b></div>
      <div v-if="state.done.change > 0" class="change">
        <div>Your change</div>
        <b>{{ changeText(state.done.change, state.done.changeUsd, state.done.changeKhr) }}</b>
      </div>
      <div class="done-meta">
        Paid {{ money(state.done.paid) }}<template v-if="state.done.pointsEarned"> · +{{ state.done.pointsEarned }} points</template>
        <div class="small">Receipt {{ state.done.receiptNo }}</div>
      </div>
      <div class="come-again">Please come again</div>
    </section>

    <!-- Cart & payment -->
    <section v-else class="sale">
      <div class="items">
        <div class="items-head">
          <b>{{ storeName || 'Welcome' }}</b>
          <span v-if="state?.customer" class="member"><i class="pi pi-star-fill" /> {{ state.customer.name }} · {{ state.customer.points }} points</span>
        </div>
        <div ref="listEl" class="list">
          <TransitionGroup name="item">
            <div v-for="(l, i) in lines" :key="i + l.name" class="line" :class="{ last: i === lines.length - 1 }">
              <div class="ln-name">
                {{ l.name }}
                <div class="ln-sub">{{ qty(l.quantity) }} {{ l.unit }} × {{ money(l.price) }}</div>
                <div v-if="l.promo" class="ln-promo"><i class="pi pi-tag" /> {{ l.promo }}</div>
              </div>
              <div class="ln-total">{{ money(l.total) }}</div>
            </div>
          </TransitionGroup>
        </div>
      </div>

      <aside class="side">
        <template v-if="mode === 'pay' && khqr && khqr.status !== 'PAID'">
          <div class="scan">Scan to pay</div>
          <div class="khqr-card">
            <div class="khqr-head">KHQR</div>
            <img v-if="khqrImg" :src="khqrImg" alt="KHQR payment code" />
            <div class="khqr-amount">{{ money(khqr.amount) }}</div>
          </div>
          <div class="small-muted">Use any Cambodian banking app · {{ Math.floor(secondsLeft / 60) }}:{{ String(secondsLeft % 60).padStart(2, '0') }}</div>
        </template>
        <template v-else>
          <div class="rows">
            <div class="r"><span>Items</span><span>{{ qty(t?.items) }}</span></div>
            <div class="r"><span>Subtotal</span><span>{{ money(t?.subtotal ?? 0) }}</span></div>
            <div v-if="t?.discount" class="r save"><span>Discount</span><span>−{{ money(t.discount) }}</span></div>
            <div class="r"><span>Tax</span><span>{{ money(t?.tax ?? 0) }}</span></div>
            <div v-if="t?.points" class="r save"><span>Points</span><span>−{{ money(t.points) }}</span></div>
          </div>
          <div class="total">
            <div>Total</div>
            <b>{{ money(t?.total ?? 0) }}</b>
            <span v-if="state?.store.khrRate && t?.total" class="khr">{{ formatKhr(usdToKhrUp(t.total, state.store.khrRate)) }}</span>
          </div>
          <div v-if="saved > 0" class="saved"><i class="pi pi-tag" /><span>You save <b>{{ money(saved) }}</b> today</span></div>
          <div v-if="mode === 'pay' && state?.payment" class="paying">
            <div class="r"><span>Paid</span><span>{{ money(state.payment.paid) }}</span></div>
            <div v-if="state.payment.remaining > 0" class="r big"><span>Still to pay</span><span>{{ money(state.payment.remaining) }}</span></div>
            <div v-if="state.payment.change > 0" class="r big"><span>Change</span><span>{{ changeText(state.payment.change, state.payment.changeUsd, state.payment.changeKhr) }}</span></div>
          </div>
        </template>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.cd {
  /* Light café: cream background, white cards, espresso text, coffee and caramel accents */
  --bg: #f6f1ea; --panel: #fffdf9; --text: #2b211b; --muted: #7d6d60; --accent: #8b5a33; --caramel: #c8893f;
  --save: #2f7d32; --line: #e8dfd4; --shadow: 0 2px 6px rgba(60, 35, 15, .06), 0 12px 32px rgba(60, 35, 15, .08);
  --top: #fbf7f1; --hl: #fbf0dd; --badge: #9a6416; --side-shadow: -8px 0 30px rgba(60, 35, 15, .05);
  height: 100vh; overflow: hidden; background: linear-gradient(180deg, var(--top) 0%, var(--bg) 100%); color: var(--text);
  font-size: clamp(16px, 1.6vw, 26px); position: relative; user-select: none;
}
.fs { position: absolute; top: 14px; right: 14px; z-index: 5; background: var(--panel); color: var(--muted); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; font: inherit; font-size: 14px; cursor: pointer; opacity: .35; }
.fs:hover { opacity: 1; }
/* Night: deep espresso, warm caramel accents (when the POS is in dark mode) */
.cd.night {
  --bg: #15100c; --panel: #201813; --text: #f5ede4; --muted: #b9a999; --accent: #e3ad72; --caramel: #e3ad72;
  --save: #6cc070; --line: #352a22; --shadow: 0 14px 40px rgba(0, 0, 0, .45);
  --top: #1d1611; --hl: rgba(227, 173, 114, .14); --badge: #f2c58a; --side-shadow: none;
}
.cd.night .khqr-card { border-color: transparent; }
.cd.night .check { color: #15100c; }
.warn { position: absolute; top: 0; inset-inline: 0; background: #c0392b; color: #fff; padding: 10px; text-align: center; font-size: 16px; }
.kh { font-size: 1.6em; color: var(--accent); font-weight: 700; font-family: 'Khmer UI', 'Noto Sans Khmer', 'Leelawadee UI', 'Khmer OS', 'Kantumruy Pro', sans-serif; }
h1 { margin: .1em 0; font-size: 2.6em; line-height: 1.1; color: var(--text); }

/* idle */
.idle { height: 100%; display: grid; grid-template-rows: 1fr auto auto auto; justify-items: center; align-items: center; text-align: center; padding: 4vh 4vw; gap: 3vh; }
.clock { font-size: 4.5em; font-weight: 300; font-variant-numeric: tabular-nums; margin-top: .3em; color: var(--accent); }
.date { color: var(--muted); }
.promo-card { background: linear-gradient(135deg, #8b5a33, #c8893f); color: #fffaf3; border-radius: 24px; padding: 3vh 4vw; min-width: min(80vw, 900px); box-shadow: 0 18px 40px rgba(139, 90, 51, .28); }
.promo-tag { text-transform: uppercase; letter-spacing: .12em; font-size: .7em; opacity: .85; }
.promo-name { font-size: 2em; font-weight: 800; margin: .2em 0; }
.promo-deal { font-size: 1.3em; }
.dots { display: flex; gap: 8px; justify-content: center; margin-top: 1em; }
.dots span { width: 9px; height: 9px; border-radius: 50%; background: rgba(255,255,255,.4); }
.dots span.on { background: #fff; }
.pay-with { color: var(--muted); }
.hint { color: var(--muted); font-size: .7em; }

/* sale */
.sale { height: 100%; display: grid; grid-template-columns: 1.4fr 1fr; }
.items { display: flex; flex-direction: column; min-height: 0; padding: 3vh 2.5vw; }
.items-head { display: flex; justify-content: space-between; align-items: center; gap: 1em; padding-bottom: 1.5vh; border-bottom: 2px solid var(--line); }
.items-head b { color: var(--accent); }
.member { color: var(--badge); background: var(--hl); border-radius: 999px; padding: .25em .8em; font-size: .8em; font-weight: 600; }
.member i { color: var(--caramel); }
.list { flex: 1; overflow-y: auto; scrollbar-width: none; }
.line { display: flex; justify-content: space-between; gap: 1em; padding: 1.6vh .7em; border-bottom: 1px solid var(--line); }
.line.last { background: var(--hl); border-radius: 12px; border-bottom-color: transparent; box-shadow: inset 4px 0 0 var(--caramel); }
.ln-name { font-weight: 600; }
.ln-sub { color: var(--muted); font-weight: 400; font-size: .8em; }
.ln-promo { color: var(--save); font-size: .8em; font-weight: 600; }
.ln-total { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.side { background: var(--panel); border-left: 1px solid var(--line); box-shadow: var(--side-shadow); display: flex; flex-direction: column; justify-content: center; gap: 3vh; padding: 4vh 3vw; }
.rows { display: grid; gap: 1.2vh; }
.r { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
.r.save, .saved { color: var(--save); }
.total { border-top: 2px solid var(--line); padding-top: 2vh; }
.total div { color: var(--muted); }
.total b { display: block; font-size: 3.4em; line-height: 1.1; font-variant-numeric: tabular-nums; color: var(--accent); }
.saved { display: inline-flex; align-items: center; gap: .5em; align-self: flex-start; font-weight: 600; font-size: 1em;
  background: color-mix(in srgb, var(--save) 12%, transparent); border: 1px solid color-mix(in srgb, var(--save) 30%, transparent);
  border-radius: 999px; padding: .45em 1em; }
.saved i { font-size: .9em; }
.saved b { font-weight: 800; }
.paying { display: grid; gap: 1vh; background: var(--bg); border: 1px solid var(--line); border-radius: 14px; padding: 2vh 1.5vw; }
.paying .big { font-size: 1.4em; font-weight: 800; }
.scan { text-align: center; font-size: 1.6em; font-weight: 800; }
.khqr-card { background: #fff; border-radius: 22px; overflow: hidden; width: min(100%, 52vh); margin: 0 auto; border: 1px solid var(--line); box-shadow: var(--shadow); }
.khqr-head { background: #e1232e; color: #fff; text-align: center; font-weight: 900; letter-spacing: .15em; padding: 1.4vh; }
.khqr-card img { display: block; width: 86%; margin: 2.4vh auto .6vh; }
.khqr-amount { text-align: center; color: #111; font-size: 1.8em; font-weight: 900; padding-bottom: 2vh; }
.small-muted { text-align: center; color: var(--muted); font-size: .8em; }

/* done */
.done { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 1.5vh; }
.check { width: 14vh; height: 14vh; border-radius: 50%; background: var(--save); color: #fff; box-shadow: 0 12px 30px rgba(47, 125, 50, .3); display: grid; place-items: center; font-size: 7vh; animation: pop .4s ease-out; }
.check i { font-size: 7vh; font-weight: 900; }
.order-no { text-align: center; }
.order-no div { color: var(--muted); }
.order-no b { font-size: 4.2em; line-height: 1; color: var(--accent); }
.khr { display: block; font-size: 1.6em; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
.change { background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow); border-radius: 20px; padding: 2vh 4vw; margin-top: 2vh; }
.change b { color: var(--accent); }
.change div { color: var(--muted); }
.change b { font-size: 3.6em; font-variant-numeric: tabular-nums; }
.done-meta { color: var(--muted); }
.done-meta .small { font-size: .7em; margin-top: .4em; }
.come-again { margin-top: 2vh; font-size: 1.2em; color: var(--accent); font-weight: 600; }

.fade-enter-active, .fade-leave-active { transition: opacity .5s, transform .5s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(12px); }
.item-enter-active { transition: all .35s ease-out; }
.item-enter-from { opacity: 0; transform: translateX(-20px); }
@keyframes pop { from { transform: scale(.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }

@media (max-width: 800px) {
  /* Portrait screens: items fill the top, totals stay at the bottom */
  .sale { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
  .side { padding: 3vh 6vw; gap: 2vh; }
  .cd { font-size: 18px; }
}
</style>
