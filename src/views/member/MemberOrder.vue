<script setup lang="ts">
/** One receipt from the history, with "order again". */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { mem, money } from '@/online/memberApi';
import { optionsText } from '@/utils/modifiers';

const route = useRoute();
const router = useRouter();
const s = ref<any>(null);
const error = ref('');
const PAY: Record<string, string> = { CASH: 'Cash', CARD: 'Card', KHQR: 'KHQR', WALLET: 'Wallet', VOUCHER: 'Gift voucher', BANK_TRANSFER: 'Bank transfer', OTHER: 'Other' };

const stores = ref<string[]>([]);
const canReorder = computed(() => s.value && stores.value.includes(s.value.store.code));

/** Put the same drinks (and options) in the online cart of that store. */
function reorder() {
  const lines = s.value.items
    .filter((i: any) => Number(i.quantity) - Number(i.refundedQty) > 0)
    .map((i: any) => ({
      productId: i.productId, name: i.name, quantity: Math.max(1, Math.round(Number(i.quantity))),
      modifiers: (i.modifiers ?? []).map((m: any) => ({ id: m.id, group: m.group, option: m.option, price: m.price })),
      note: i.note ?? '', unitPrice: Number(i.unitPrice),
    }));
  try { localStorage.setItem(`order.cart:${s.value.store.code}`, JSON.stringify(lines)); } catch { /* ignore */ }
  router.push({ path: `/order/${s.value.store.code}`, query: { cart: '1' } });
}

onMounted(async () => {
  try {
    const [sale, st] = await Promise.all([mem(`/member/orders/${route.params.id}`), mem('/public/stores')]);
    s.value = sale;
    stores.value = st.map((x: any) => x.code);
    document.title = sale.receiptNo;
  } catch (e) { error.value = (e as Error).message; }
});
</script>

<template>
  <div class="receipt">
    <RouterLink to="/m/orders" class="back"><i class="pi pi-angle-left" /> History</RouterLink>
    <Message v-if="error" severity="error" :closable="false" size="small">{{ error }}</Message>
    <section v-if="s" class="card">
      <div class="head">
        <div><b>{{ s.store.name }}</b><div class="small muted">{{ new Date(s.createdAt).toLocaleString() }}</div></div>
        <div class="right"><div class="small muted">{{ s.receiptNo }}</div><div v-if="s.queueNo" class="q">{{ s.queueNo }}</div></div>
      </div>
      <div v-for="(i, n) in s.items" :key="n" class="line">
        <div>
          <b>{{ Number(i.quantity) }}×</b> {{ i.name }}
          <div v-if="i.modifiers?.length" class="small muted">{{ optionsText(i.modifiers) }}</div>
          <div v-if="i.note" class="small note">“{{ i.note }}”</div>
          <div v-if="Number(i.refundedQty)" class="small bad">{{ Number(i.refundedQty) }} refunded</div>
        </div>
        <span>{{ money(i.lineTotal) }}</span>
      </div>
      <div class="sum"><span>Subtotal</span><span>{{ money(s.subtotal) }}</span></div>
      <div v-if="Number(s.discountTotal)" class="sum good"><span>Discount{{ s.couponName ? ` (${s.couponName})` : '' }}</span><span>−{{ money(s.discountTotal) }}</span></div>
      <div class="sum"><span>Tax</span><span>{{ money(s.taxTotal) }}</span></div>
      <div v-if="Number(s.pointsDiscount)" class="sum good"><span>Points used ({{ s.pointsRedeemed }})</span><span>−{{ money(s.pointsDiscount) }}</span></div>
      <div class="sum grand"><span>Paid</span><span>{{ money(s.amountDue) }}</span></div>
      <div class="small muted">{{ s.payments.map((p: any) => `${PAY[p.method] ?? p.method} ${money(p.amount)}`).join(' · ') }}</div>
      <div v-if="s.pointsEarned" class="earned"><i class="pi pi-star-fill" /> You earned {{ s.pointsEarned }} points</div>
    </section>
    <Button v-if="canReorder" label="Order this again" icon="pi pi-refresh" class="again" @click="reorder" />
  </div>
</template>

<style scoped>
.receipt { display: grid; gap: 12px; }
.back { font-weight: 600; text-decoration: none; }
.head { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.right { text-align: right; }
.q { font-size: 22px; font-weight: 900; color: var(--p-primary-color); }
.line { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); }
.sum { display: flex; justify-content: space-between; padding: 3px 0; }
.good { color: var(--good); }
.bad { color: var(--bad); }
.note { color: #b45309; }
.grand { font-weight: 800; font-size: 18px; border-top: 1px solid var(--border); padding-top: 8px; margin-top: 4px; }
.earned { margin-top: 10px; color: #a0673f; font-weight: 700; }
.again { padding: 14px; }
</style>
