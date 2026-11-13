<script setup lang="ts">
/**
 * On-screen number pad for touchscreen tills (money received, amounts). The first key replaces the amount
 * that was filled in for the cashier (e.g. the amount due); the next keys add digits.
 */
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{ modelValue: number | null; decimals?: number; enterLabel?: string; max?: number }>(), { decimals: 2, enterLabel: 'OK', max: 1e9 });
const emit = defineEmits<{ 'update:modelValue': [number | null]; enter: [] }>();

const text = ref('');
const fresh = ref(true);
let own = false;
// A new amount from outside (amount due, quick button): the next key starts a new number
watch(() => props.modelValue, () => {
  if (own) { own = false; return; }
  fresh.value = true;
});

function set(t: string) {
  text.value = t;
  own = true;
  const n = t === '' || t === '.' ? null : Number(t);
  emit('update:modelValue', n);
}
function key(k: string) {
  let t = fresh.value ? '' : text.value;
  fresh.value = false;
  if (k === '.') {
    if (!props.decimals || t.includes('.')) return;
    t = (t || '0') + '.';
  } else {
    const dot = t.indexOf('.');
    if (dot >= 0 && t.length - dot - 1 + k.length > props.decimals) return; // no more than 2 decimals
    t = t === '0' ? k.replace(/^0+(?=\d)/, '') || '0' : t + k;
  }
  if (Number(t) > props.max) return;
  set(t);
}
function back() {
  const t = fresh.value ? '' : text.value.slice(0, -1);
  fresh.value = false;
  set(t);
}
function clear() {
  fresh.value = false;
  set('');
}
</script>

<template>
  <div class="np" role="group" aria-label="Number pad" @mousedown.prevent>
    <button v-for="k in ['7', '8', '9']" :key="k" type="button" class="k" @click="key(k)">{{ k }}</button>
    <button type="button" class="k fn" aria-label="Delete" @click="back"><i class="pi pi-delete-left" /></button>
    <button v-for="k in ['4', '5', '6']" :key="k" type="button" class="k" @click="key(k)">{{ k }}</button>
    <button type="button" class="k fn" @click="clear">C</button>
    <button v-for="k in ['1', '2', '3']" :key="k" type="button" class="k" @click="key(k)">{{ k }}</button>
    <button type="button" class="k enter" @click="emit('enter')">{{ enterLabel }}</button>
    <button type="button" class="k" @click="key('00')">00</button>
    <button type="button" class="k" @click="key('0')">0</button>
    <button type="button" class="k" :disabled="!decimals" @click="key('.')">.</button>
  </div>
</template>

<style scoped>
.np { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; user-select: none; touch-action: manipulation; }
.k { height: 58px; border-radius: 12px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font: inherit; font-size: 24px; font-weight: 650;
  cursor: pointer; display: grid; place-items: center; transition: background .08s, transform .08s; }
.k:active { background: color-mix(in srgb, var(--p-primary-color) 22%, var(--bg)); transform: scale(.96); }
.k:disabled { opacity: .35; cursor: default; }
.k.fn { font-size: 18px; color: var(--text-2); background: var(--surface); }
.k.enter { grid-row: span 2; height: auto; background: var(--p-primary-color); color: #fff; border-color: transparent; font-size: 19px; }
@media (max-height: 760px) { .k { height: 48px; font-size: 21px; } }
</style>
