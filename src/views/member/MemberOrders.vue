<script setup lang="ts">
/** Purchase history: every receipt linked to the member (in store and online). */
import { lang } from '@/i18n';
import { onMounted, ref } from 'vue';
import { mem, money } from '@/online/memberApi';

const rows = ref<any[]>([]);
const page = ref(0);
const more = ref(true);
const busy = ref(false);
const error = ref('');

async function next() {
  busy.value = true;
  try {
    const r = await mem(`/member/orders?page=${page.value + 1}&limit=20`);
    rows.value.push(...r.data);
    page.value = r.meta.page;
    more.value = r.meta.page < r.meta.totalPages;
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
const when = (d: string) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
onMounted(() => { document.title = 'History'; next(); });
</script>

<template>
  <div class="orders">
    <h2>History</h2>
    <Message v-if="error" severity="error" :closable="false" size="small">{{ error }}</Message>
    <RouterLink v-for="o in rows" :key="o.id" :to="`/m/orders/${o.id}`" class="row-o card">
      <span class="oinfo">
        <b>{{ (lang === 'km' && o.summaryKm) || o.summary || 'Order' }}</b>
        <span class="small muted">{{ when(o.createdAt) }} · {{ o.store.name }}{{ o.channel === 'ONLINE' ? ' · app' : '' }}</span>
        <span v-if="o.pointsEarned || o.pointsRedeemed" class="small pts">
          <template v-if="o.pointsEarned">+{{ o.pointsEarned }} points</template>
          <template v-if="o.pointsRedeemed"> · used {{ o.pointsRedeemed }}</template>
        </span>
      </span>
      <span class="oright"><b>{{ money(o.amountDue) }}</b><span v-if="o.status !== 'COMPLETED'" class="small muted">{{ o.status.toLowerCase().replace('_', ' ') }}</span></span>
    </RouterLink>
    <div v-if="!rows.length && !busy" class="muted center">No purchases yet. Show your member QR at the counter to collect points.</div>
    <Button v-if="more && rows.length" label="Load more" text :loading="busy" @click="next" />
    <div v-if="busy && !rows.length" class="center"><i class="pi pi-spin pi-spinner" /></div>
  </div>
</template>

<style scoped>
.orders { display: grid; gap: 10px; }
h2 { margin: 0 0 4px; }
.row-o { display: flex; justify-content: space-between; gap: 10px; color: var(--text); text-decoration: none; padding: 14px; }
.oinfo, .oright { display: grid; gap: 2px; }
.oright { text-align: right; align-content: start; }
.pts { color: #a0673f; font-weight: 700; }
.center { text-align: center; padding: 24px; }
</style>
