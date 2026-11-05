<script setup lang="ts">
/** Pickup board for a TV in the café: /board?store=PP01. Public; shows queue numbers only. */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const code = String(route.query.store ?? '').toUpperCase();
const data = ref<{ store: string; preparing: string[]; ready: string[] } | null>(null);
const error = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  try {
    const r = await fetch(`/api/v1/public/stores/${encodeURIComponent(code)}/board`);
    if (!r.ok) throw new Error(r.status === 404 ? 'Store not found or not in café mode' : `Error ${r.status}`);
    data.value = await r.json();
    error.value = '';
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(() => {
  load();
  timer = setInterval(load, 4000);
});
onBeforeUnmount(() => clearInterval(timer));
const fullscreen = () => document.documentElement.requestFullscreen().catch(() => undefined);
</script>

<template>
  <div class="board" @dblclick="fullscreen">
    <header>{{ data?.store ?? 'Orders' }}</header>
    <div v-if="error && !data" class="err">{{ error }}</div>
    <div v-else class="cols">
      <section class="prep">
        <h2>Preparing</h2>
        <div class="nums"><span v-for="q in data?.preparing ?? []" :key="q">{{ q }}</span></div>
      </section>
      <section class="ready">
        <h2>Ready – please collect</h2>
        <TransitionGroup name="pop" tag="div" class="nums"><span v-for="q in data?.ready ?? []" :key="q">{{ q }}</span></TransitionGroup>
      </section>
    </div>
    <footer>Double-click for full screen</footer>
  </div>
</template>

<style scoped>
.board { --bg: #0d1b33; height: 100vh; background: var(--bg); color: #f3f6fb; display: flex; flex-direction: column; font-size: clamp(16px, 1.6vw, 28px); user-select: none; }
header { text-align: center; font-size: 1.6em; font-weight: 800; padding: 2vh; }
.cols { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 2vw; padding: 0 2vw 2vh; min-height: 0; }
section { border-radius: 24px; padding: 2vh 2vw; display: flex; flex-direction: column; min-height: 0; }
.prep { background: #13254a; }
.ready { background: #0f5132; }
h2 { margin: 0 0 2vh; font-size: 1.4em; text-align: center; }
.nums { display: flex; flex-wrap: wrap; gap: 1.6vw; justify-content: center; align-content: flex-start; overflow: hidden; }
.nums span { font-size: 2.6em; font-weight: 800; font-variant-numeric: tabular-nums; background: rgba(255, 255, 255, .08); border-radius: 16px; padding: .1em .5em; }
.ready .nums span { background: #4ade80; color: #052e16; }
.err { text-align: center; padding: 10vh; color: #fca5a5; }
footer { text-align: center; color: #64748b; font-size: .5em; padding: 1vh; }
.pop-enter-active { animation: pop .5s ease-out; }
@keyframes pop { from { transform: scale(.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
</style>
