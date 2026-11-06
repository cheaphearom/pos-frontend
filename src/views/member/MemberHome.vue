<script setup lang="ts">
/** Member home: points, member QR, wallet cards and orders in progress. */
import LangSwitch from '@/components/LangSwitch.vue';
import QRCode from 'qrcode';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { cardShort, mem, memberSession, money } from '@/online/memberApi';

const me = ref<any>(null);
const active = ref<any[]>([]);
const error = ref('');
const memberQr = ref('');

// Big QR sheet: member number (points) or a wallet card (pay)
const qrSheet = ref(false);
const qrTitle = ref('');
const qrHint = ref('');
const qrImg = ref('');
const qrText = ref('');

const txSheet = ref(false);
const txCard = ref<any>(null);
const txRows = ref<any[]>([]);

const STATUS: Record<string, string> = { NEW: 'Order received', PREPARING: 'Being prepared', READY: 'Ready to collect', COMPLETED: 'Collected', CANCELLED: 'Cancelled' };
const PAY: Record<string, string> = { PENDING_PAYMENT: 'Waiting for payment', PAY_AT_COUNTER: 'Pay at the counter', EXPIRED: 'Payment time ran out', CANCELLED: 'Cancelled', FAILED: 'Please ask at the counter' };
const label = (o: any) => (o.status === 'PAID' ? STATUS[o.kitchenStatus] ?? 'Paid' : PAY[o.status] ?? o.status);
const inProgress = computed(() => active.value.filter((o) => (o.status === 'PAID' && ['NEW', 'PREPARING', 'READY'].includes(o.kitchenStatus)) || ['PENDING_PAYMENT', 'PAY_AT_COUNTER'].includes(o.status)));

const hello = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
});

async function load() {
  try {
    const [m, o] = await Promise.all([mem('/member/me'), mem('/member/online-orders')]);
    me.value = m;
    active.value = o;
    error.value = '';
    if (!memberQr.value) memberQr.value = await QRCode.toDataURL(m.code, { width: 240, margin: 1 });
  } catch (e) { error.value = (e as Error).message; }
}

async function showQr(kind: 'member' | 'card', card?: any) {
  qrText.value = kind === 'member' ? me.value.code : card.cardNumber;
  qrTitle.value = kind === 'member' ? 'Member QR' : `Wallet ${cardShort(card.cardNumber)}`;
  qrHint.value = kind === 'member'
    ? 'Show this at the counter to earn and use points.'
    : `Balance ${money(card.balance)}. Show this to pay at the counter${card.hasPin ? '; the cashier will ask for your PIN' : ''}.`;
  qrImg.value = await QRCode.toDataURL(qrText.value, { width: 320, margin: 1 });
  qrSheet.value = true;
}

async function showTx(card: any) {
  txCard.value = card;
  txRows.value = [];
  txSheet.value = true;
  txRows.value = (await mem(`/member/cards/${card.id}/transactions?limit=50`)).data;
}
const TX: Record<string, string> = { TOPUP: 'Top up', PAYMENT: 'Payment', REFUND: 'Refund', ADJUST: 'Adjustment', TRANSFER_IN: 'Moved in', TRANSFER_OUT: 'Moved out' };

let poll: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  document.title = 'My account';
  load();
  poll = setInterval(() => { if (inProgress.value.length) load(); }, 10_000);
});
onBeforeUnmount(() => clearInterval(poll));
</script>

<template>
  <div class="home">
    <header class="mhead">
      <LangSwitch class="mlang" />
      <div class="muted">{{ hello }},</div>
      <h2>{{ me?.name ?? memberSession.s?.name }}</h2>
    </header>
    <Message v-if="error" severity="error" :closable="false" size="small">{{ error }}</Message>

    <template v-if="me">
      <section class="points" data-test="points">
        <div>
          <div class="plabel">My points</div>
          <div class="pnum">{{ me.points.toLocaleString() }}</div>
          <div class="pworth">worth {{ money(me.pointsWorth) }} · earn {{ me.earnRate }} point{{ me.earnRate === 1 ? '' : 's' }} per $1</div>
          <RouterLink to="/m/points" class="plink">Points history <i class="pi pi-angle-right" /></RouterLink>
        </div>
        <button class="qr" aria-label="Show member QR" @click="showQr('member')">
          <img v-if="memberQr" :src="memberQr" alt="" />
          <span>{{ me.code }}</span>
        </button>
      </section>

      <section v-if="inProgress.length" class="card">
        <h3>Your orders now</h3>
        <RouterLink v-for="o in inProgress" :key="o.token" :to="`/order/status/${o.token}`" class="aorder" :class="{ ready: o.kitchenStatus === 'READY' }">
          <span class="qno">{{ o.queueNo ?? '…' }}</span>
          <span class="ainfo"><b>{{ label(o) }}</b><span class="small muted">{{ o.store?.name }} · {{ money(o.total) }}</span></span>
          <i class="pi pi-angle-right" />
        </RouterLink>
      </section>

      <RouterLink to="/m/order" class="cta"><i class="pi pi-shopping-bag" /> Order ahead <span class="small">skip the queue</span></RouterLink>

      <section class="card">
        <h3>Wallet</h3>
        <div v-if="!me.cards.length" class="muted small">No wallet card yet. Ask at the counter for a card and top up to pay faster.</div>
        <div v-for="c in me.cards" :key="c.id" class="wcard" :class="{ blocked: c.status !== 'ACTIVE' }">
          <div class="wtop"><span>{{ cardShort(c.cardNumber) }}</span><span v-if="c.status !== 'ACTIVE'" class="tag">{{ c.status }}</span></div>
          <div class="wbal">{{ money(c.balance) }}</div>
          <div class="wact">
            <Button v-if="c.status === 'ACTIVE'" label="Pay" icon="pi pi-qrcode" size="small" severity="contrast" @click="showQr('card', c)" />
            <Button label="History" icon="pi pi-list" size="small" text class="light" @click="showTx(c)" />
          </div>
        </div>
      </section>
    </template>
    <div v-else-if="!error" class="center"><i class="pi pi-spin pi-spinner" /></div>

    <Dialog v-model:visible="qrSheet" modal :header="qrTitle" :style="{ width: 'min(380px, 94vw)' }">
      <div class="bigqr">
        <img :src="qrImg" alt="QR code" />
        <div class="code">{{ qrText }}</div>
        <p class="muted small">{{ qrHint }}</p>
      </div>
    </Dialog>

    <Drawer v-model:visible="txSheet" position="bottom" :header="txCard ? `Wallet ${cardShort(txCard.cardNumber)}` : ''" style="height: 75vh">
      <div v-for="t in txRows" :key="t.id" class="tx">
        <div><b>{{ TX[t.type] ?? t.type }}</b><div class="small muted">{{ new Date(t.createdAt).toLocaleString() }}{{ t.reference ? ' · ' + t.reference : '' }}</div></div>
        <div class="right"><b :class="Number(t.amount) < 0 ? 'out' : 'in'">{{ Number(t.amount) < 0 ? '−' : '+' }}{{ money(Math.abs(Number(t.amount))) }}</b><div class="small muted">{{ money(t.balanceAfter) }}</div></div>
      </div>
      <div v-if="!txRows.length" class="center muted">No transactions yet</div>
    </Drawer>
  </div>
</template>

<style scoped>
.home { display: grid; gap: 14px; }
header h2 { margin: 2px 0 0; font-size: 24px; }
.mhead { position: relative; }
.mlang { position: absolute; right: 0; top: 0; }
.points { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 18px; border-radius: 18px; color: #fff; background: linear-gradient(135deg, #5b3a29, #a0673f); }
.plabel { font-size: 13px; opacity: .85; }
.pnum { font-size: 40px; font-weight: 900; line-height: 1.1; }
.pworth { font-size: 13px; opacity: .9; }
.plink { color: #fff; font-size: 13px; font-weight: 700; display: inline-block; margin-top: 8px; text-decoration: none; }
.qr { background: #fff; border: 0; border-radius: 12px; padding: 8px; display: grid; justify-items: center; gap: 4px; font: inherit; }
.qr img { width: 96px; height: 96px; }
.qr span { font-size: 11px; color: #333; font-weight: 700; }
.aorder { display: grid; grid-template-columns: 64px 1fr auto; gap: 10px; align-items: center; padding: 10px 0; border-top: 1px solid var(--border); color: var(--text); text-decoration: none; }
.aorder:first-of-type { border-top: 0; }
.qno { font-size: 22px; font-weight: 900; color: var(--p-primary-color); }
.aorder.ready .qno, .aorder.ready b { color: var(--good); }
.ainfo { display: grid; }
.cta { display: flex; align-items: center; gap: 10px; justify-content: center; padding: 16px; border-radius: 14px; background: var(--p-primary-color); color: #fff; font-weight: 800; font-size: 17px; text-decoration: none; }
.cta .small { font-weight: 500; opacity: .85; }
.wcard { border-radius: 14px; padding: 14px; color: #fff; background: linear-gradient(135deg, #2b1d14, #5c3b22); margin-top: 10px; }
.wcard.blocked { filter: grayscale(.8); }
.wtop { display: flex; justify-content: space-between; font-size: 14px; letter-spacing: .08em; opacity: .9; }
.tag { background: rgba(255, 255, 255, .2); border-radius: 6px; padding: 0 6px; font-size: 11px; }
.wbal { font-size: 28px; font-weight: 900; margin: 6px 0 10px; }
.wact { display: flex; gap: 8px; }
.light { color: #fff !important; }
.bigqr { text-align: center; }
.bigqr img { width: 260px; max-width: 100%; }
.code { font-family: ui-monospace, monospace; font-size: 18px; font-weight: 700; letter-spacing: .08em; margin-top: 6px; }
.tx { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.right { text-align: right; }
.in { color: var(--good); }
.out { color: var(--text); }
.center { text-align: center; padding: 30px; }
</style>
