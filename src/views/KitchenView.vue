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
const clock = computed(() => new Date(now.value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
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
      <span class="klogo" aria-hidden="true"><i class="pi pi-th-large" /></span>
      <b class="ktitle">Barista screen</b>
      <Select v-if="app.stores.length > 1" v-model="app.currentStoreId" :options="app.stores" option-label="name" option-value="id" size="small" @change="first = true; load()" />
      <span v-else class="muted">{{ app.currentStore?.name }}</span>
      <span class="spacer" />
      <span class="todo"><b>{{ totalItems }}</b> drink(s) to make</span>
      <span class="clock">{{ clock }}</span>
      <Tag v-if="!connected" severity="danger" value="Connection lost" icon="pi pi-wifi" />
      <Button :label="showDone ? 'Hide done' : 'Show done'" text size="small" @click="showDone = !showDone" />
      <Button :icon="sound ? 'pi pi-volume-up' : 'pi pi-volume-off'" text rounded :aria-label="sound ? 'Sound on' : 'Sound off'" v-tooltip.bottom="sound ? 'Beep on new orders' : 'Sound off'" @click="toggleSound" />
    </header>
    <Message v-if="app.currentStore && !app.currentStore.hasKitchen" severity="warn" :closable="false" style="margin: 12px">
      This store is not in café mode. Turn on "Café mode" for the store on the Stores page so orders come here.
    </Message>
    <div class="cols" :style="{ gridTemplateColumns: `repeat(${cols.length}, minmax(260px, 1fr))` }">
      <section v-for="c in cols" :key="c.key" class="col" :class="c.key.toLowerCase()">
        <h2><span>{{ c.title }}</span> <span class="count">{{ c.list.length }}</span></h2>
        <div class="list">
          <article v-for="o in c.list" :key="o.id" class="ticket" :class="age(o)" @click="move(o, next[o.kitchenStatus].to)">
            <div class="t-head">
              <span class="q">{{ o.queueNo ?? '—' }}</span>
              <span class="t-type">
                <span class="chip">{{ typeLabel(o) }}</span>
                <span v-if="o.channel === 'ONLINE'" class="chip online">Online</span>
              </span>
              <span class="t-time"><i class="pi pi-clock" /> {{ minutes(o) }}m</span>
            </div>
            <div v-if="o.customer" class="t-cust"><i class="pi pi-user" /> {{ o.customer.name }}</div>
            <ul class="items">
              <li v-for="i in o.items" :key="i.id">
                <span class="iq">{{ qty(i.quantity) }}×</span>
                <div class="iname">
                  {{ i.name }}
                  <div v-if="i.modifiers?.length" class="mods">{{ optionsText(i.modifiers) }}</div>
                  <div v-if="i.note" class="note"><i class="pi pi-comment" /> {{ i.note }}</div>
                </div>
              </li>
            </ul>
            <div v-if="o.note" class="note onote">{{ o.note }}</div>
            <div class="t-actions" @click.stop>
              <Button v-if="o.kitchenStatus === 'NEW'" label="Cancel" text severity="danger" size="small" @click="move(o, 'CANCELLED')" />
              <Button class="go" :label="next[o.kitchenStatus].label" :icon="next[o.kitchenStatus].icon" :severity="o.kitchenStatus === 'PREPARING' ? 'success' : o.kitchenStatus === 'COMPLETED' ? 'secondary' : undefined" @click="move(o, next[o.kitchenStatus].to)" />
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
.bar { height: 60px; display: flex; align-items: center; gap: 10px; padding: 0 14px; background: var(--surface); border-bottom: 1px solid var(--border); box-shadow: var(--shadow); flex-shrink: 0; }
.klogo { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, var(--p-primary-color), var(--accent-2)); }
.ktitle { font-size: 17px; }
.spacer { flex: 1; }
.todo { color: var(--text-2); }
.todo b { font-size: 20px; color: var(--text); }
.clock { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; padding: 0 6px; }
.cols { flex: 1; min-height: 0; display: grid; gap: 12px; padding: 12px; overflow-x: auto; }
.col { --c: #8b5a33; display: flex; flex-direction: column; min-height: 0; background: color-mix(in srgb, var(--c) 6%, var(--bg)); border-radius: 16px; border: 1px solid var(--border); overflow: hidden; }
.col.preparing { --c: #d18b00; }
.col.ready { --c: #2f7d32; }
.col.completed { --c: #7d7064; }
.col h2 { margin: 0; padding: 12px 16px; font-size: 18px; font-weight: 800; display: flex; justify-content: space-between; align-items: center; color: #fff; background: var(--c); }
.count { background: rgba(255, 255, 255, .25); border-radius: 999px; min-width: 34px; text-align: center; font-size: 16px; line-height: 28px; padding: 0 8px; }
.list { flex: 1; overflow-y: auto; padding: 10px; display: grid; gap: 10px; align-content: start; }
.ticket { background: var(--surface); border-radius: 14px; border: 1px solid var(--border); border-top: 5px solid var(--c); padding: 12px 14px; cursor: pointer; display: grid; gap: 8px; box-shadow: var(--shadow); }
.completed .ticket { opacity: .6; }
.t-head { display: flex; align-items: center; gap: 10px; }
.q { font-size: 26px; font-weight: 900; letter-spacing: -.01em; color: #fff; background: var(--c); border-radius: 10px; padding: 0 10px; line-height: 40px; }
.t-type { flex: 1; display: flex; gap: 6px; flex-wrap: wrap; }
.chip { font-size: 12.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: var(--bg); color: var(--text-2); }
.chip.online { background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color); }
.t-time { font-weight: 700; color: var(--good); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ticket.slow .t-time { color: var(--warn); }
.ticket.late .t-time { color: #fff; background: var(--bad); border-radius: 999px; padding: 1px 8px; animation: blink 1.4s ease-in-out infinite; }
@keyframes blink { 50% { opacity: .65; } }
.t-cust { font-weight: 700; color: var(--text-2); }
.items { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 17px; }
.items li { display: grid; grid-template-columns: 38px 1fr; gap: 6px; align-items: start; }
.iq { font-weight: 900; font-size: 18px; color: var(--c); }
.iname { font-weight: 650; }
.mods { color: var(--text-2); font-size: 14.5px; font-weight: 500; margin-top: 2px; }
.note { color: #7a4a00; background: #fff3cd; border-radius: 8px; padding: 4px 8px; font-size: 14px; font-weight: 700; margin-top: 4px; display: inline-block; }
.app-dark .note { color: #ffd98a; background: rgba(255, 196, 0, .14); }
.onote { margin-top: 0; }
.t-actions { display: flex; justify-content: flex-end; gap: 6px; align-items: center; }
.t-actions .go { flex: 1; padding: 12px; font-size: 16px; font-weight: 800; border-radius: 12px; }
.empty { text-align: center; padding: 30px 10px; }
</style>
