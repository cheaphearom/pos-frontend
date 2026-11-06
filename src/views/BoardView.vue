<script setup lang="ts">
/** Pickup board for a TV in the café: /board?store=PP01. Public; shows queue numbers only. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const code = String(route.query.store ?? '').toUpperCase();
const data = ref<{ store: string; preparing: string[]; ready: string[] } | null>(null);
const error = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
const now = ref(Date.now());
const clock = computed(() => new Date(now.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

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
  timer = setInterval(() => { load(); now.value = Date.now(); }, 4000);
});
onBeforeUnmount(() => clearInterval(timer));
const fullscreen = () => document.documentElement.requestFullscreen().catch(() => undefined);
</script>

<template>
  <div class="board" @dblclick="fullscreen">
    <header>
      <span class="blogo" aria-hidden="true"><i class="pi pi-shopping-bag" /></span>
      <span class="bname">{{ data?.store ?? 'Orders' }}</span>
      <span class="bclock">{{ clock }}</span>
    </header>
    <div v-if="error && !data" class="err">{{ error }}</div>
    <div v-else class="cols">
      <section class="prep">
        <h2><i class="pi pi-spin pi-cog" /> Preparing</h2>
        <div class="nums"><span v-for="q in data?.preparing ?? []" :key="q">{{ q }}</span></div>
      </section>
      <section class="ready">
        <h2><i class="pi pi-check-circle" /> Ready – please collect</h2>
        <TransitionGroup name="pop" tag="div" class="nums"><span v-for="q in data?.ready ?? []" :key="q">{{ q }}</span></TransitionGroup>
      </section>
    </div>
    <footer>Double-click for full screen</footer>
  </div>
</template>

<style scoped>
.board { height: 100vh; color: #fbf4ec; display: flex; flex-direction: column; font-size: clamp(16px, 1.6vw, 28px); user-select: none;
  background: radial-gradient(circle at 12% 0%, #6b4426 0, #2b1d14 55%), #1c130d; }
header { display: flex; align-items: center; gap: 1vw; padding: 2vh 2.5vw; }
.blogo { width: 1.9em; height: 1.9em; border-radius: .5em; display: grid; place-items: center; background: linear-gradient(135deg, #8b5a33, #c8893f); font-size: 1em; }
.bname { flex: 1; font-size: 1.5em; font-weight: 800; letter-spacing: -.01em; }
.bclock { font-size: 1.4em; font-weight: 800; font-variant-numeric: tabular-nums; opacity: .85; }
.cols { flex: 1; display: grid; grid-template-columns: 2fr 3fr; gap: 2vw; padding: 0 2.5vw 2vh; min-height: 0; }
section { border-radius: 28px; padding: 2.4vh 2vw; display: flex; flex-direction: column; min-height: 0; }
.prep { background: rgba(255, 255, 255, .06); border: 1px solid rgba(255, 255, 255, .08); }
.ready { background: linear-gradient(160deg, #1f5f34, #14462a); box-shadow: 0 1vh 4vh rgba(0, 0, 0, .35); }
h2 { margin: 0 0 2.4vh; font-size: 1.3em; text-align: center; display: flex; gap: .5em; justify-content: center; align-items: center; }
.prep h2 { color: #e8c9a6; }
.nums { display: flex; flex-wrap: wrap; gap: 1.4vw; justify-content: center; align-content: flex-start; overflow: hidden; }
.nums span { font-size: 2.4em; font-weight: 900; font-variant-numeric: tabular-nums; background: rgba(255, 255, 255, .08); color: #f1e2d2; border-radius: 18px; padding: .1em .45em; }
.ready .nums span { font-size: 3.2em; background: #fbf4ec; color: #14462a; box-shadow: 0 .6vh 2vh rgba(0, 0, 0, .25); }
.err { text-align: center; padding: 10vh; color: #f6b2a8; }
footer { text-align: center; color: rgba(251, 244, 236, .35); font-size: .5em; padding: 1vh; }
.pop-enter-active { animation: pop .6s ease-out; }
@keyframes pop { 0% { transform: scale(.3); opacity: 0; } 70% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
</style>
