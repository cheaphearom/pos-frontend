<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ label: string; value: string; current?: number; previous?: number; previousLabel?: string; icon?: string }>();

const change = computed(() => {
  if (props.current === undefined || props.previous === undefined) return null;
  if (!props.previous) return props.current ? null : 0;
  return ((props.current - props.previous) / props.previous) * 100;
});
</script>

<template>
  <div class="card stat">
    <div class="label"><i v-if="icon" :class="icon" /> {{ label }}</div>
    <div class="value num">{{ value }}</div>
    <div v-if="change !== null" class="delta small" :class="change >= 0 ? 'pos' : 'neg'">
      <i :class="change >= 0 ? 'pi pi-arrow-up' : 'pi pi-arrow-down'" style="font-size: 10px" />
      {{ Math.abs(change).toFixed(1) }}% <span class="muted">vs {{ previousLabel ?? 'yesterday' }}</span>
    </div>
    <div v-else-if="previousLabel !== undefined" class="small muted">&nbsp;</div>
  </div>
</template>

<style scoped>
.stat { display: grid; gap: 6px; }
.label { color: var(--text-2); font-weight: 550; display: flex; gap: 8px; align-items: center; }
.value { font-size: 26px; font-weight: 650; }
</style>
