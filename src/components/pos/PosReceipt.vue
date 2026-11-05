<script setup lang="ts">
/** Receipt layout for screen and 80mm thermal printers. Works for server receipts and offline ones. */
import { dateTime, humanize, money, qty } from '@/utils/format';
import { optionsText } from '@/utils/modifiers';

const props = defineProps<{ sale: any; currency: string }>();
const m = (v: any) => money(v, props.currency);
</script>

<template>
  <div class="pr">
    <div class="c">
      <div class="store">{{ sale.store?.name }}</div>
      <div v-if="sale.store?.address">{{ sale.store.address }}</div>
      <div v-if="sale.store?.phone">Tel {{ sale.store.phone }}</div>
    </div>
    <div class="sep" />
    <div v-if="sale.queueNo" class="queue">
      <div>Order</div><b>{{ sale.queueNo }}</b>
      <div v-if="sale.orderType && sale.orderType !== 'RETAIL'">{{ sale.orderType === 'DINE_IN' ? 'Dine-in' + (sale.tableNo ? ' · Table ' + sale.tableNo : '') : humanize(sale.orderType) }}</div>
    </div>
    <div class="row2"><span>Receipt</span><b>{{ sale.receiptNo }}</b></div>
    <div class="row2"><span>Date</span><span>{{ dateTime(sale.createdAt) }}</span></div>
    <div class="row2"><span>Cashier</span><span>{{ sale.cashier?.fullName }}</span></div>
    <div v-if="sale.customer" class="row2"><span>Member</span><span>{{ sale.customer.name }}</span></div>
    <div class="sep" />
    <div v-for="(i, n) in sale.items" :key="n" class="item">
      <div class="row2"><span>{{ i.name }}</span><span>{{ m(i.lineTotal) }}</span></div>
      <div class="sub">{{ qty(i.quantity) }} × {{ m(i.unitPrice) }}<template v-if="Number(i.discount)"> &nbsp;disc −{{ m(i.discount) }}</template></div>
      <div v-if="i.modifiers?.length" class="sub">{{ optionsText(i.modifiers, true) }}</div>
      <div v-if="i.note" class="sub">“{{ i.note }}”</div>
      <div v-if="i.promotion?.name" class="sub">★ {{ i.promotion.name }}</div>
    </div>
    <div class="sep" />
    <div class="row2"><span>Subtotal</span><span>{{ m(sale.subtotal) }}</span></div>
    <div v-if="Number(sale.discountTotal)" class="row2"><span>Discount</span><span>−{{ m(sale.discountTotal) }}</span></div>
    <div v-if="sale.couponName" class="sub">incl. coupon {{ sale.couponName }} −{{ m(sale.couponDiscount) }}</div>
    <div class="row2"><span>Tax</span><span>{{ m(sale.taxTotal) }}</span></div>
    <div class="row2 total"><span>TOTAL</span><span>{{ m(sale.total) }}</span></div>
    <div v-if="sale.pointsRedeemed" class="row2"><span>Points ({{ sale.pointsRedeemed }})</span><span>−{{ m(sale.pointsDiscount) }}</span></div>
    <div v-for="(p, n) in sale.payments" :key="'p' + n" class="row2"><span>{{ humanize(p.method) }}</span><span>{{ m(p.amount) }}</span></div>
    <div v-if="Number(sale.changeDue)" class="row2"><span>Change</span><span>{{ m(sale.changeDue) }}</span></div>
    <div v-if="sale.pointsEarned" class="row2"><span>Points earned</span><span>+{{ sale.pointsEarned }}</span></div>
    <div class="sep" />
    <div v-if="sale.offline" class="c small">Saved offline · will sync automatically</div>
    <div class="c">Thank you! Please come again.</div>
  </div>
</template>

<style scoped>
.pr { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.45; color: var(--text); max-width: 320px; margin: 0 auto; }
.c { text-align: center; }
.store { font-weight: 700; font-size: 15px; }
.sep { border-top: 1px dashed currentColor; opacity: .5; margin: 6px 0; }
.row2 { display: flex; justify-content: space-between; gap: 10px; }
.row2 > :last-child { text-align: right; white-space: nowrap; }
.sub { opacity: .7; font-size: 11.5px; }
.queue { text-align: center; border: 2px solid currentColor; border-radius: 8px; padding: 4px; margin-bottom: 6px; }
.queue b { font-size: 30px; display: block; line-height: 1.1; }
.total { font-weight: 800; font-size: 15px; margin: 4px 0; }
.small { font-size: 11px; }
</style>
