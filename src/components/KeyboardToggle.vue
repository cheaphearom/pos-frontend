<script setup lang="ts">
/**
 * "Keyboard" button: the cashier chooses whether to use the on-screen keyboard / number pad on this till.
 * One setting for the till (remembered), so turning it on in one place turns it on everywhere.
 */
import { useTouchKeyboard } from '@/composables/useTouchKeyboard';

withDefaults(defineProps<{ label?: string }>(), { label: 'Keyboard' });
const emit = defineEmits<{ changed: [boolean] }>();
const on = useTouchKeyboard();
function toggle() {
  on.value = !on.value;
  emit('changed', on.value);
}
</script>

<template>
  <button type="button" class="kt" :class="{ on }" :aria-pressed="on" :title="on ? `Hide the on-screen ${label.toLowerCase()}` : `Use the on-screen ${label.toLowerCase()}`"
    @mousedown.prevent @click="toggle">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 13h.01M18 13h.01M8 14.5h8" />
    </svg>
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
.kt { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text-2); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; white-space: nowrap; flex: none; }
.kt:hover { color: var(--text); border-color: color-mix(in srgb, var(--p-primary-color) 45%, var(--border)); }
.kt.on { background: var(--p-primary-color); border-color: transparent; color: #fff; }
</style>
