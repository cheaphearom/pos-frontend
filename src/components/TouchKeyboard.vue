<script setup lang="ts">
/**
 * On-screen keyboard for touchscreen tills: types into a v-model string. Keys keep the focus on the input
 * (mousedown is cancelled), so the cursor stays where the cashier is typing.
 */
import { computed, ref } from 'vue';

const props = withDefaults(defineProps<{ modelValue: string; enterLabel?: string; maxLength?: number }>(), { enterLabel: 'Enter', maxLength: 200 });
const emit = defineEmits<{ 'update:modelValue': [string]; enter: []; close: [] }>();

const shift = ref(false);
const numbers = ref(false);
const letterRows = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];
// The number row is always shown above, so ?123 adds symbols only
const symbolRows = [
  ['@', '.', '-', '_', '#', '&', '+', '/', '*', '='],
  ['(', ')', ',', ':', ';', '!', '?', '%', '$'],
  ["'", '"', '~', '<', '>', '|', '\\'],
];
const rows = computed(() => (numbers.value ? symbolRows : letterRows.map((r) => r.map((k) => (shift.value ? k.toUpperCase() : k)))));

function type(k: string) {
  if (props.modelValue.length >= props.maxLength) return;
  emit('update:modelValue', props.modelValue + k);
  shift.value = false;
}
const back = () => emit('update:modelValue', props.modelValue.slice(0, -1));
const clear = () => emit('update:modelValue', '');
</script>

<template>
  <div class="tk" role="group" aria-label="On-screen keyboard" @mousedown.prevent>
    <div class="row digits">
      <button v-for="d in ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']" :key="'d' + d" type="button" class="k" @click="type(d)">{{ d }}</button>
    </div>
    <div v-for="(r, i) in rows" :key="i" class="row">
      <button v-if="i === 2" type="button" class="k wide" :class="{ on: shift }" aria-label="Shift" @click="shift = !shift"><i class="pi pi-arrow-up" /></button>
      <button v-for="k in r" :key="k" type="button" class="k" @click="type(k)">{{ k }}</button>
      <button v-if="i === 2" type="button" class="k wide" aria-label="Delete" @click="back"><i class="pi pi-delete-left" /></button>
    </div>
    <div class="row">
      <button type="button" class="k wide" @click="numbers = !numbers">{{ numbers ? 'ABC' : '?123' }}</button>
      <button type="button" class="k" @click="type('@')">@</button>
      <button type="button" class="k space" aria-label="Space" @click="type(' ')">space</button>
      <button type="button" class="k" @click="type('.')">.</button>
      <button type="button" class="k wide" @click="clear">Clear</button>
      <button type="button" class="k wide enter" @click="emit('enter')">{{ enterLabel }}</button>
      <button type="button" class="k" aria-label="Hide keyboard" @click="emit('close')"><i class="pi pi-chevron-down" /></button>
    </div>
  </div>
</template>

<style scoped>
.tk { display: grid; gap: 6px; padding: 10px; border-radius: 16px; background: var(--surface); border: 1px solid var(--border);
  box-shadow: 0 8px 30px rgba(60, 35, 15, .14); user-select: none; touch-action: manipulation; }
.row { display: flex; gap: 6px; justify-content: center; }
.k { flex: 1 1 0; min-width: 0; max-width: 64px; height: 50px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg); color: var(--text);
  font: inherit; font-size: 19px; font-weight: 600; cursor: pointer; display: grid; place-items: center; transition: background .08s, transform .08s; }
.k:active { background: color-mix(in srgb, var(--p-primary-color) 22%, var(--bg)); transform: scale(.96); }
.k.wide { max-width: 96px; flex-grow: 1.5; font-size: 15px; }
.k.space { max-width: none; flex-grow: 4; font-size: 15px; color: var(--text-3); }
.k.on { background: var(--p-primary-color); color: #fff; border-color: transparent; }
.k.enter { background: var(--p-primary-color); color: #fff; border-color: transparent; }
.digits .k { height: 44px; background: var(--surface); }
@media (max-width: 520px) { .k { height: 44px; font-size: 16px; } .tk { padding: 6px; gap: 5px; } .row { gap: 4px; } }
</style>
