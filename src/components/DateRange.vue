<script setup lang="ts">
/** Date range picker bound to { from, to } strings (YYYY-MM-DD), with quick presets. */
import { computed } from 'vue';
import { daysAgo, isoDate } from '@/utils/format';

const from = defineModel<string | null>('from');
const to = defineModel<string | null>('to');

const range = computed<Date[] | null>({
  get: () => (from.value ? [new Date(from.value + 'T00:00:00'), ...(to.value ? [new Date(to.value + 'T00:00:00')] : [])] : null),
  set: (v) => {
    from.value = v?.[0] ? isoDate(v[0]) : null;
    to.value = v?.[1] ? isoDate(v[1]) : v?.[0] ? isoDate(v[0]) : null;
  },
});

const presets = [
  { label: 'Today', days: 0 },
  { label: '7 days', days: 6 },
  { label: '30 days', days: 29 },
  { label: '90 days', days: 89 },
];
function preset(days: number) {
  from.value = isoDate(daysAgo(days));
  to.value = isoDate(new Date());
}
</script>

<template>
  <div class="row" style="flex-wrap: wrap">
    <DatePicker v-model="range" selection-mode="range" date-format="dd M yy" show-icon show-button-bar placeholder="Any date" :manual-input="false" style="width: 275px" />
    <Button v-for="p in presets" :key="p.label" :label="p.label" size="small" text @click="preset(p.days)" />
  </div>
</template>
