<!-- Copyright (c) 2026 Chea Phearom. All rights reserved. Proprietary and confidential: see the LICENSE file. -->
<script setup lang="ts">
/** Kitchen ticket for 80 mm printers: order number, takeaway / dine-in and table, items with options and notes. No prices. */
import { localName } from '@/i18n';
import { dateTime, qty } from '@/utils/format';
import { optionsText } from '@/utils/modifiers';

defineProps<{ sale: any; station?: string | null }>();
const type = (s: any) => (s.orderType === 'DINE_IN' ? 'DINE-IN' : s.orderType === 'PICKUP' ? 'PICKUP' : 'TAKEAWAY');
</script>

<template>
  <div class="kt">
    <div class="head">{{ station ? station.toUpperCase() : 'KITCHEN' }} · {{ sale.store?.name }}</div>
    <div class="no">{{ sale.queueNo || sale.receiptNo }}</div>
    <div class="type">{{ type(sale) }}<template v-if="sale.orderType === 'DINE_IN' && sale.tableNo"> · TABLE {{ sale.tableNo }}</template></div>
    <div class="meta">{{ dateTime(sale.createdAt) }} · {{ sale.cashier?.fullName }}</div>
    <div class="sep" />
    <div v-for="(i, n) in sale.items" :key="n" class="kt-item">
      <div class="kt-line"><b class="q">{{ qty(i.quantity) }} ×</b><b>{{ localName(i) }}</b></div>
      <div v-if="i.modifiers?.length" class="kt-opt">{{ optionsText(i.modifiers, true) }}</div>
      <div v-if="i.note" class="kt-note">NOTE: {{ i.note }}</div>
    </div>
    <div class="sep" />
    <div v-if="sale.note" class="kt-note">{{ sale.note }}</div>
    <div class="foot">{{ sale.receiptNo }}<template v-if="sale.offline"> · offline</template></div>
  </div>
</template>

<style scoped>
.kt { font-family: ui-monospace, Menlo, Consolas, monospace; color: #000; background: #fff; width: 72mm; padding: 2mm 0; font-size: 13px; line-height: 1.35; }
.head { text-align: center; font-size: 12px; letter-spacing: .08em; }
.no { text-align: center; font-size: 40px; font-weight: 900; line-height: 1.1; margin: 2mm 0 1mm; }
.type { text-align: center; font-size: 18px; font-weight: 900; border: 2px solid #000; padding: 1mm 0; margin: 0 4mm; }
.meta { text-align: center; font-size: 11px; margin-top: 1mm; }
.sep { border-top: 1px dashed #000; margin: 2mm 0; }
.kt-item { margin: 0 0 2mm; }
.kt-line { display: flex; gap: 2mm; font-size: 16px; }
.q { flex: none; }
.kt-opt { padding-left: 8mm; font-size: 13px; }
.kt-note { padding-left: 8mm; font-size: 13px; font-weight: 800; }
.foot { text-align: center; font-size: 11px; }
</style>
