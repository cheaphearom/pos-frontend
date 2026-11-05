<script setup lang="ts">
/** Order ahead: choose the store, then the normal online menu (logged in, so points and wallet work). */
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { mem } from '@/online/memberApi';

const router = useRouter();
const stores = ref<any[] | null>(null);
const error = ref('');
const LAST = 'member.lastStore';
let last = '';
try { last = localStorage.getItem(LAST) ?? ''; } catch { /* ignore */ }

function pick(code: string) {
  try { localStorage.setItem(LAST, code); } catch { /* ignore */ }
  router.push(`/order/${code}`);
}
onMounted(async () => {
  document.title = 'Order ahead';
  try {
    stores.value = await mem('/public/stores');
    stores.value!.sort((a, b) => (b.code === last ? 1 : 0) - (a.code === last ? 1 : 0));
  } catch (e) { error.value = (e as Error).message; }
});
</script>

<template>
  <div class="stores">
    <h2>Order ahead</h2>
    <p class="muted">Choose where you will pick up. We start making it as soon as it is paid.</p>
    <Message v-if="error" severity="error" :closable="false" size="small">{{ error }}</Message>
    <button v-for="s in stores ?? []" :key="s.code" class="store card" @click="pick(s.code)">
      <i class="pi pi-map-marker" />
      <span class="sinfo"><b>{{ s.name }}</b><span class="small muted">{{ s.address }}</span><span v-if="s.code === last" class="small last">Last visited</span></span>
      <i class="pi pi-angle-right" />
    </button>
    <div v-if="stores && !stores.length" class="muted">No store takes online orders right now.</div>
  </div>
</template>

<style scoped>
.stores { display: grid; gap: 12px; }
h2 { margin: 0; }
p { margin: 0; }
.store { display: grid; grid-template-columns: 28px 1fr auto; gap: 10px; align-items: center; text-align: left; font: inherit; color: var(--text); cursor: pointer; }
.store > i:first-child { font-size: 20px; color: var(--p-primary-color); }
.sinfo { display: grid; gap: 2px; }
.last { color: var(--p-primary-color); font-weight: 700; }
</style>
