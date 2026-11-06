<script setup lang="ts">
/** Barista / kitchen screen: live café orders from the POS and online, New → Preparing → Ready → Done. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';
import { useApp } from '@/stores/app';
import { humanize, qty } from '@/utils/format';
import { optionsText } from '@/utils/modifiers';

const app = useApp();
const router = useRouter();
const notify = useNotify();
const orders = ref<any[]>([]);
const connected = ref(true);
const now = ref(Date.now());
const sound = ref(readSound());
const showDone = ref(false);
let poll: ReturnType<typeof setInterval> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
let known = new Set<string>();
let first = true;

function readSound() {
  try { return localStorage.getItem('pos.kitchenSound') !== '0'; } catch { return true; }
}
function toggleSound() {
  sound.value = !sound.value;
  try { localStorage.setItem('pos.kitchenSound', sound.value ? '1' : '0'); } catch { /* ignore */ }
  if (sound.value) beep();
}
function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.16);
    });
  } catch { /* audio not allowed until the page is clicked */ }
}

async function load() {
  if (!app.currentStoreId) return;
  try {
    const r = await api.get('/kitchen/orders', { storeId: app.currentStoreId });
    const fresh = r.orders.filter((o: any) => o.kitchenStatus === 'NEW' && !known.has(o.id));
    if (fresh.length && !first && sound.value) beep();
    known = new Set(r.orders.map((o: any) => o.id));
    first = false;
    orders.value = r.orders;
    connected.value = true;
  } catch {
    connected.value = false;
  }
}

async function move(o: any, status: string) {
  const prev = o.kitchenStatus;
  o.kitchenStatus = status; // instant feedback
  try {
    Object.assign(o, await api.post(`/kitchen/orders/${o.id}/status`, { status }));
  } catch (e) {
    o.kitchenStatus = prev;
    notify.error(e);
  }
}
const next: Record<string, { to: string; label: string; icon: string }> = {
  NEW: { to: 'PREPARING', label: 'Start', icon: 'pi pi-play' },
  PREPARING: { to: 'READY', label: 'Ready', icon: 'pi pi-check' },
  READY: { to: 'COMPLETED', label: 'Picked up', icon: 'pi pi-check-circle' },
  COMPLETED: { to: 'READY', label: 'Recall', icon: 'pi pi-undo' },
};
const cols = computed(() => [
  { key: 'NEW', title: 'New', list: orders.value.filter((o) => o.kitchenStatus === 'NEW') },
  { key: 'PREPARING', title: 'Preparing', list: orders.value.filter((o) => o.kitchenStatus === 'PREPARING') },
  { key: 'READY', title: 'Ready', list: orders.value.filter((o) => o.kitchenStatus === 'READY') },
  ...(showDone.value ? [{ key: 'COMPLETED', title: 'Done (30 min)', list: orders.value.filter((o) => o.kitchenStatus === 'COMPLETED').reverse() }] : []),
]);
const minutes = (o: any) => Math.floor((now.value - new Date(o.createdAt).getTime()) / 60000);
const age = (o: any) => (minutes(o) >= 10 ? 'late' : minutes(o) >= 5 ? 'slow' : 'ok');
const typeLabel = (o: any) => (o.orderType === 'DINE_IN' ? `Dine-in${o.tableNo ? ' · T' + o.tableNo : ''}` : humanize(o.orderType));
const totalItems = computed(() => orders.value.filter((o) => ['NEW', 'PREPARING'].includes(o.kitchenStatus)).reduce((s, o) => s + o.items.reduce((t: number, i: any) => t + Number(i.quantity), 0), 0));

onMounted(() => {
  document.title = 'Barista screen';
  load();
  poll = setInterval(load, 3000);
  tick = setInterval(() => (now.value = Date.now()), 15_000);
});
onBeforeUnmount(() => {
  clearInterval(poll);
  clearInterval(tick);
});
</script>

<template>
  <div class="kds">
    <header class="bar">
      <Button icon="pi pi-arrow-left" text rounded aria-label="Back" @click="router.push('/pos')" />
      <b>Barista screen</b>
      <Select v-if="app.stores.length > 1" v-model="app.currentStoreId" :options="app.stores" option-label="name" option-value="id" size="small" @change="first = true; load()" />
      <span v-else class="muted">{{ app.currentStore?.name }}</span>
      <span class="spacer" />
      <span class="muted small">{{ totalItems }} drink(s) to make</span>
      <Tag v-if="!connected" severity="danger" value="Connection lost" icon="pi pi-wifi" />
      <Button :label="showDone ? 'Hide done' : 'Show done'" text size="small" @click="showDone = !showDone" />
      <Button :icon="sound ? 'pi pi-volume-up' : 'pi pi-volume-off'" text rounded :aria-label="sound ? 'Sound on' : 'Sound off'" v-tooltip.bottom="sound ? 'Beep on new orders' : 'Sound off'" @click="toggleSound" />
    </header>
    <Message v-if="app.currentStore && !app.currentStore.hasKitchen" severity="warn" :closable="false" style="margin: 12px">
      This store is not in café mode. Turn on "Café mode" for the store on the Stores page so orders come here.
    </Message>
    <div class="cols" :style="{ gridTemplateColumns: `repeat(${cols.length}, minmax(260px, 1fr))` }">
      <section v-for="c in cols" :key="c.key" class="col" :class="c.key.toLowerCase()">
        <h2>{{ c.title }} <span class="count">{{ c.list.length }}</span></h2>
        <div class="list">
          <article v-for="o in c.list" :key="o.id" class="ticket" :class="age(o)" @click="move(o, next[o.kitchenStatus].to)">
            <div class="t-head">
              <span class="q">{{ o.queueNo ?? '—' }}</span>
              <span class="t-type">{{ typeLabel(o) }}<span v-if="o.channel === 'ONLINE'" class="online"> · Online</span></span>
              <span class="t-time"><i class="pi pi-clock" /> {{ minutes(o) }}m</span>
            </div>
            <div v-if="o.customer" class="t-cust">{{ o.customer.name }}</div>
            <ul class="items">
              <li v-for="i in o.items" :key="i.id">
                <b>{{ qty(i.quantity) }}×</b> {{ i.name }}
                <div v-if="i.modifiers?.length" class="mods">{{ optionsText(i.modifiers) }}</div>
                <div v-if="i.note" class="note"><i class="pi pi-comment" /> {{ i.note }}</div>
              </li>
            </ul>
            <div v-if="o.note" class="note">{{ o.note }}</div>
            <div class="t-actions" @click.stop>
              <Button v-if="o.kitchenStatus === 'NEW'" label="Cancel" text severity="danger" size="small" @click="move(o, 'CANCELLED')" />
              <Button :label="next[o.kitchenStatus].label" :icon="next[o.kitchenStatus].icon" size="small" @click="move(o, next[o.kitchenStatus].to)" />
            </div>
          </article>
          <div v-if="!c.list.length" class="empty muted">—</div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.kds { height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
.bar { height: 54px; display: flex; align-items: center; gap: 10px; padding: 0 12px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.spacer { flex: 1; }
.cols { flex: 1; min-height: 0; display: grid; gap: 12px; padding: 12px; overflow-x: auto; }
.col { display: flex; flex-direction: column; min-height: 0; background: color-mix(in srgb, var(--surface) 60%, var(--bg)); border-radius: 12px; border: 1px solid var(--border); }
.col h2 { margin: 0; padding: 12px 14px; font-size: 17px; display: flex; justify-content: space-between; border-bottom: 3px solid var(--border); }
.col.new h2 { border-color: #8b5a33; }
.col.preparing h2 { border-color: #eda100; }
.col.ready h2 { border-color: #1a7f37; }
.count { background: var(--bg); border-radius: 999px; padding: 0 10px; font-size: 14px; line-height: 24px; }
.list { flex: 1; overflow-y: auto; padding: 10px; display: grid; gap: 10px; align-content: start; }
.ticket { background: var(--surface); border-radius: 10px; border: 1px solid var(--border); border-left: 6px solid #8b5a33; padding: 10px 12px; cursor: pointer; display: grid; gap: 6px; }
.preparing .ticket { border-left-color: #eda100; }
.ready .ticket { border-left-color: #1a7f37; }
.completed .ticket { opacity: .6; }
.ticket.slow .t-time { color: #b45309; font-weight: 700; }
.ticket.late .t-time { color: var(--bad); font-weight: 800; }
.t-head { display: flex; align-items: baseline; gap: 10px; }
.q { font-size: 24px; font-weight: 800; }
.t-type { flex: 1; color: var(--text-2); font-weight: 600; }
.online { color: var(--p-primary-color); }
.t-cust { font-weight: 600; }
.items { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 16px; }
.mods { color: var(--text-2); font-size: 14px; padding-left: 22px; }
.note { color: #b45309; font-size: 14px; font-weight: 600; padding-left: 22px; }
.t-actions { display: flex; justify-content: flex-end; gap: 6px; }
.empty { text-align: center; padding: 20px; }
</style>
