<script setup lang="ts">
/** X report (one shift so far) or Z report (a store's business day), laid out for an 80 mm receipt printer. */
import { computed } from 'vue';
import { formatKhr } from '@shared/cash';
import { dateTime, humanize, money } from '@/utils/format';

const props = defineProps<{ report: any }>();
const r = computed(() => props.report);
const m = (v: number | string | null | undefined) => money(Number(v ?? 0), r.value?.store?.currency ?? 'USD');
const isZ = computed(() => r.value.kind === 'Z');
const title = computed(() => (isZ.value ? (r.value.zNo ? `Z REPORT ${r.value.store.code}-Z${String(r.value.zNo).padStart(4, '0')}` : 'Z REPORT (preview)') : 'X REPORT'));
const signed = (v: number | null | undefined, khr = false) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${khr ? formatKhr(v) : m(v)}`);
const payLabel = (p: any) => (p.currency === 'KHR' ? `Cash ${formatKhr(p.tendered)}` : humanize(p.method));
</script>

<template>
  <div class="reg-report" data-test="reg-report">
    <div class="c b big">{{ r.store.name }}</div>
    <div class="c b">{{ title }}</div>
    <div class="c small">{{ isZ ? `Business day ${r.businessDay}` : 'Shift so far — the shift is not closed by this report' }}</div>
    <div class="c small">Printed {{ dateTime(r.printedAt ?? r.createdAt ?? new Date().toISOString()) }}</div>
    <template v-if="!isZ">
      <div class="row2"><span>Cashier</span><span>{{ r.cashier }}</span></div>
      <div class="row2"><span>Shift opened</span><span>{{ dateTime(r.shift.openedAt) }}</span></div>
      <div v-if="r.shift.closedAt" class="row2"><span>Shift closed</span><span>{{ dateTime(r.shift.closedAt) }}</span></div>
    </template>

    <div class="sep" />
    <div class="h">Sales</div>
    <div class="row2"><span>Sales</span><span>{{ r.sales.count }}</span></div>
    <div class="row2"><span>Gross sales</span><span>{{ m(r.sales.gross) }}</span></div>
    <div v-if="r.sales.promotions" class="row2"><span>Promotions</span><span>−{{ m(r.sales.promotions) }}</span></div>
    <div v-if="r.sales.coupons" class="row2"><span>Coupons</span><span>−{{ m(r.sales.coupons) }}</span></div>
    <div v-if="r.sales.manualDiscounts" class="row2"><span>Manual discounts</span><span>−{{ m(r.sales.manualDiscounts) }}</span></div>
    <div class="row2"><span>Tax</span><span>{{ m(r.sales.tax) }}</span></div>
    <div v-if="r.sales.points" class="row2"><span>Paid with points</span><span>−{{ m(r.sales.points) }}</span></div>
    <div class="row2 b"><span>Net sales</span><span>{{ m(r.sales.net) }}</span></div>
    <div v-if="r.refunds.count" class="row2"><span>Refunds ({{ r.refunds.count }})</span><span>−{{ m(r.refunds.amount) }}</span></div>
    <div v-if="r.voids.count" class="row2"><span>Voids ({{ r.voids.count }})</span><span>−{{ m(r.voids.amount) }}</span></div>
    <div class="row2 b total"><span>NET AFTER REFUNDS</span><span>{{ m(r.netAfterRefunds) }}</span></div>
    <div class="row2 small"><span>Average sale</span><span>{{ m(r.sales.average) }}</span></div>

    <div class="sep" />
    <div class="h">Payments</div>
    <div v-for="(p, i) in r.payments" :key="i" class="row2"><span>{{ payLabel(p) }} ({{ p.count }})</span><span>{{ m(p.amount) }}</span></div>
    <div v-if="!r.payments.length" class="small">No payments</div>
    <template v-for="(v, k) in r.refunds.byMethod" :key="'r' + k"><div class="row2 small"><span>Refunds · {{ humanize(String(k)) }}</span><span>−{{ m(v) }}</span></div></template>
    <div v-for="t in r.walletTopups" :key="'t' + t.method" class="row2 small"><span>Wallet top-ups · {{ humanize(t.method) }} ({{ t.count }})</span><span>{{ m(t.amount) }}</span></div>
    <div v-for="v in r.voucherSales" :key="'v' + v.method" class="row2 small"><span>Vouchers sold · {{ humanize(v.method) }} ({{ v.count }})</span><span>{{ m(v.amount) }}</span></div>

    <template v-if="r.cash.movements.length">
      <div class="sep" />
      <div class="h">Cash in / out</div>
      <div v-for="c in r.cash.movements" :key="c.id" class="row2 small">
        <span>{{ c.type === 'PAY_IN' ? 'In' : 'Out' }} · {{ c.reason }}<template v-if="c.approvedBy"> ({{ c.approvedBy }})</template></span>
        <span>{{ c.type === 'PAY_IN' ? '+' : '−' }}{{ c.currency === 'KHR' ? formatKhr(c.amount) : m(c.amount) }}</span>
      </div>
    </template>

    <template v-if="r.drawer">
      <div class="sep" />
      <div class="h">Dollar drawer</div>
      <div class="row2"><span>Opening</span><span>{{ m(r.drawer.openingCash) }}</span></div>
      <div class="row2"><span>Cash sales</span><span>+{{ m(r.drawer.cashSales) }}</span></div>
      <div v-if="r.drawer.changeGiven" class="row2"><span>Change given</span><span>−{{ m(r.drawer.changeGiven) }}</span></div>
      <div v-if="r.drawer.cashRefunds" class="row2"><span>Cash refunds</span><span>−{{ m(r.drawer.cashRefunds) }}</span></div>
      <div v-if="r.drawer.walletTopups" class="row2"><span>Wallet top-ups</span><span>+{{ m(r.drawer.walletTopups) }}</span></div>
      <div v-if="r.drawer.voucherSales" class="row2"><span>Vouchers sold</span><span>+{{ m(r.drawer.voucherSales) }}</span></div>
      <div v-if="r.drawer.cashIn" class="row2"><span>Cash in</span><span>+{{ m(r.drawer.cashIn) }}</span></div>
      <div v-if="r.drawer.cashOut" class="row2"><span>Cash out</span><span>−{{ m(r.drawer.cashOut) }}</span></div>
      <div class="row2 b"><span>Expected</span><span data-test="x-expected">{{ m(r.drawer.expected) }}</span></div>
      <template v-if="r.drawer.counted !== null"><div class="row2"><span>Counted</span><span>{{ m(r.drawer.counted) }}</span></div><div class="row2 b"><span>Difference</span><span>{{ signed(r.drawer.difference) }}</span></div></template>
      <template v-if="r.store.khrRate || r.drawer.khr.received || r.drawer.khr.opening">
        <div class="h">Riel drawer</div>
        <div class="row2"><span>Opening</span><span>{{ formatKhr(r.drawer.khr.opening) }}</span></div>
        <div class="row2"><span>Riel received</span><span>+{{ formatKhr(r.drawer.khr.received) }}</span></div>
        <div v-if="r.drawer.khr.change" class="row2"><span>Riel change</span><span>−{{ formatKhr(r.drawer.khr.change) }}</span></div>
        <div v-if="r.drawer.khr.payIn" class="row2"><span>Cash in</span><span>+{{ formatKhr(r.drawer.khr.payIn) }}</span></div>
        <div v-if="r.drawer.khr.payOut" class="row2"><span>Cash out</span><span>−{{ formatKhr(r.drawer.khr.payOut) }}</span></div>
        <div class="row2 b"><span>Expected</span><span data-test="x-expected-khr">{{ formatKhr(r.drawer.khr.expected) }}</span></div>
        <template v-if="r.drawer.khr.counted !== null && r.drawer.khr.counted !== undefined"><div class="row2"><span>Counted</span><span>{{ formatKhr(r.drawer.khr.counted) }}</span></div><div class="row2 b"><span>Difference</span><span>{{ signed(r.drawer.khr.difference, true) }}</span></div></template>
      </template>
    </template>

    <template v-if="isZ">
      <div class="sep" />
      <div class="h">Shifts ({{ r.shifts.length }})</div>
      <div v-for="(s, i) in r.shifts" :key="i" class="shift">
        <div class="row2 b"><span>{{ s.cashier }}</span><span>{{ s.status === 'OPEN' ? 'OPEN' : signed(s.difference) }}</span></div>
        <div class="row2 small"><span>Expected {{ m(s.expected) }}</span><span>Counted {{ s.counted === null ? '—' : m(s.counted) }}</span></div>
        <div v-if="s.khr.received || s.khr.opening || s.khr.counted" class="row2 small"><span>Riel expected {{ formatKhr(s.khr.expected) }}</span><span>{{ s.khr.difference === null ? '' : signed(s.khr.difference, true) }}</span></div>
      </div>
      <template v-if="r.cashiers.length">
        <div class="h">By cashier</div>
        <div v-for="c in r.cashiers" :key="c.name" class="row2 small"><span>{{ c.name }} ({{ c.count }})</span><span>{{ m(c.amount) }}</span></div>
      </template>
    </template>

    <template v-if="r.items.length">
      <div class="sep" />
      <div class="h">Top items</div>
      <div v-for="i in r.items" :key="i.name" class="row2 small"><span>{{ Number(i.quantity) }} × {{ i.name }}</span><span>{{ m(i.amount) }}</span></div>
    </template>
    <template v-if="r.hours.length">
      <div class="sep" />
      <div class="h">By hour</div>
      <div v-for="h in r.hours" :key="h.hour" class="row2 small"><span>{{ String(h.hour).padStart(2, '0') }}:00 ({{ h.count }})</span><span>{{ m(h.amount) }}</span></div>
    </template>
    <div class="sep" />
    <div class="c small">{{ isZ ? 'End of day — figures saved and cannot change' : 'X report — for checking only' }}</div>
  </div>
</template>

<style scoped>
.reg-report { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Kantumruy Pro', monospace; font-size: 12.5px; background: var(--bg); border-radius: 8px; padding: 14px; max-width: 380px; margin: 0 auto; }
.c { text-align: center; }
.b { font-weight: 700; }
.big { font-size: 15px; }
.small { font-size: 11.5px; }
.h { font-weight: 700; margin: 6px 0 2px; text-transform: uppercase; letter-spacing: .04em; font-size: 11.5px; }
.row2 { display: flex; justify-content: space-between; gap: 8px; }
.row2 span:last-child { white-space: nowrap; font-variant-numeric: tabular-nums; }
.sep { border-top: 1px dashed currentColor; opacity: .5; margin: 8px 0; }
.total { font-size: 14px; }
.shift { margin-bottom: 4px; }
</style>
