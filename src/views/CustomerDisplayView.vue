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

const route = useRoute();
const storeId = String(route.query.store ?? '');
const channel = displayChannel(storeId);
const state = ref<DisplayState | null>(null);
const connected = ref(false);

const readJson = <T,>(k: string, d: T): T => {
  try { return JSON.parse(localStorage.getItem(k) ?? '') ?? d; } catch { return d; }
};
const savedStore = readJson<any[]>('pos.stores', []).find((s) => s.id === storeId);
const storeName = computed(() => state.value?.store.name || savedStore?.name || 'Welcome');
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
  <div class="cd" :class="'m-' + mode">
    <button v-if="!isFullscreen" class="fs" @click="fullscreen"><i class="pi pi-window-maximize" /> Full screen</button>
    <div v-if="!channel.supported" class="warn">This browser cannot connect to the POS. Use Chrome or Edge.</div>

    <!-- Welcome -->
    <section v-if="mode === 'idle'" class="idle">
      <div class="welcome">
        <div class="kh">សូមស្វាគមន៍</div>
        <h1>Welcome to {{ storeName }}</h1>
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
      <div v-if="state.done.change > 0" class="change">
        <div>Your change</div>
        <b>{{ money(state.done.change) }}</b>
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
          <b>{{ storeName }}</b>
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
          </div>
          <div v-if="saved > 0" class="saved">You save {{ money(saved) }} today 🎉</div>
          <div v-if="mode === 'pay' && state?.payment" class="paying">
            <div class="r"><span>Paid</span><span>{{ money(state.payment.paid) }}</span></div>
            <div v-if="state.payment.remaining > 0" class="r big"><span>Still to pay</span><span>{{ money(state.payment.remaining) }}</span></div>
            <div v-if="state.payment.change > 0" class="r big"><span>Change</span><span>{{ money(state.payment.change) }}</span></div>
          </div>
        </template>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.cd {
  --bg: #0d1b33; --panel: #13254a; --text: #f3f6fb; --muted: #a9b6cc; --accent: #4f9bf0; --save: #4ade80;
  height: 100vh; overflow: hidden; background: radial-gradient(circle at 15% 0%, #1d3b70 0, var(--bg) 60%); color: var(--text);
  font-size: clamp(16px, 1.6vw, 26px); position: relative; user-select: none;
}
.fs { position: absolute; top: 14px; right: 14px; z-index: 5; background: rgba(255,255,255,.1); color: var(--text); border: 1px solid rgba(255,255,255,.2); border-radius: 8px; padding: 8px 12px; font: inherit; font-size: 14px; cursor: pointer; opacity: .35; }
.fs:hover { opacity: 1; }
.warn { position: absolute; top: 0; inset-inline: 0; background: #b91c1c; padding: 10px; text-align: center; font-size: 16px; }
.kh { font-size: 1.6em; color: var(--accent); font-weight: 700; font-family: 'Khmer UI', 'Noto Sans Khmer', 'Leelawadee UI', 'Khmer OS', 'Kantumruy Pro', sans-serif; }
h1 { margin: .1em 0; font-size: 2.6em; line-height: 1.1; }

/* idle */
.idle { height: 100%; display: grid; grid-template-rows: 1fr auto auto auto; justify-items: center; align-items: center; text-align: center; padding: 4vh 4vw; gap: 3vh; }
.clock { font-size: 4.5em; font-weight: 300; font-variant-numeric: tabular-nums; margin-top: .3em; }
.date { color: var(--muted); }
.promo-card { background: linear-gradient(135deg, #2a78d6, #6250d6); border-radius: 24px; padding: 3vh 4vw; min-width: min(80vw, 900px); box-shadow: 0 20px 60px rgba(0,0,0,.35); }
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
.items-head { display: flex; justify-content: space-between; align-items: center; gap: 1em; padding-bottom: 1.5vh; border-bottom: 1px solid rgba(255,255,255,.12); }
.member { color: #fcd34d; font-size: .85em; }
.list { flex: 1; overflow-y: auto; scrollbar-width: none; }
.line { display: flex; justify-content: space-between; gap: 1em; padding: 1.6vh .5em; border-bottom: 1px solid rgba(255,255,255,.07); }
.line.last { background: rgba(79,155,240,.14); border-radius: 12px; }
.ln-name { font-weight: 600; }
.ln-sub { color: var(--muted); font-weight: 400; font-size: .8em; }
.ln-promo { color: var(--save); font-size: .8em; font-weight: 600; }
.ln-total { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.side { background: var(--panel); display: flex; flex-direction: column; justify-content: center; gap: 3vh; padding: 4vh 3vw; }
.rows { display: grid; gap: 1.2vh; }
.r { display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; }
.r.save, .saved { color: var(--save); }
.total { border-top: 2px solid rgba(255,255,255,.2); padding-top: 2vh; }
.total div { color: var(--muted); }
.total b { display: block; font-size: 3.4em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.saved { font-weight: 700; font-size: 1.1em; }
.paying { display: grid; gap: 1vh; background: rgba(255,255,255,.06); border-radius: 14px; padding: 2vh 1.5vw; }
.paying .big { font-size: 1.4em; font-weight: 800; }
.scan { text-align: center; font-size: 1.6em; font-weight: 800; }
.khqr-card { background: #fff; border-radius: 22px; overflow: hidden; width: min(100%, 52vh); margin: 0 auto; box-shadow: 0 16px 50px rgba(0,0,0,.4); }
.khqr-head { background: #e1232e; color: #fff; text-align: center; font-weight: 900; letter-spacing: .15em; padding: 1.4vh; }
.khqr-card img { display: block; width: 86%; margin: 2.4vh auto .6vh; }
.khqr-amount { text-align: center; color: #111; font-size: 1.8em; font-weight: 900; padding-bottom: 2vh; }
.small-muted { text-align: center; color: var(--muted); font-size: .8em; }

/* done */
.done { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 1.5vh; }
.check { width: 14vh; height: 14vh; border-radius: 50%; background: var(--save); color: #0d1b33; display: grid; place-items: center; font-size: 7vh; animation: pop .4s ease-out; }
.check i { font-size: 7vh; font-weight: 900; }
.change { background: var(--panel); border-radius: 20px; padding: 2vh 4vw; margin-top: 2vh; }
.change div { color: var(--muted); }
.change b { font-size: 3.6em; font-variant-numeric: tabular-nums; }
.done-meta { color: var(--muted); }
.done-meta .small { font-size: .7em; margin-top: .4em; }
.come-again { margin-top: 2vh; font-size: 1.2em; }

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
