<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { mem } from '@/online/memberApi';

const rows = ref<any[]>([]);
const page = ref(0);
const more = ref(true);
const busy = ref(false);
const T: Record<string, string> = { EARN: 'Earned', REDEEM: 'Used', REVERSE: 'Taken back (refund)', RETURN: 'Given back (refund)', ADJUST: 'Adjusted by the store' };

async function next() {
  busy.value = true;
  try {
    const r = await mem(`/member/points?page=${page.value + 1}&limit=30`);
    rows.value.push(...r.data);
    page.value = r.meta.page;
    more.value = r.meta.page < r.meta.totalPages;
  } finally { busy.value = false; }
}
onMounted(() => { document.title = 'Points'; next(); });
</script>

<template>
  <div class="pts">
    <RouterLink to="/m" class="back"><i class="pi pi-angle-left" /> Home</RouterLink>
    <h2>Points history</h2>
    <div class="card list">
      <div v-for="r in rows" :key="r.id" class="row-p">
        <div><b>{{ T[r.type] ?? r.type }}</b><div class="small muted">{{ new Date(r.createdAt).toLocaleString() }}{{ r.note ? ' · ' + r.note : '' }}</div></div>
        <div class="right"><b :class="r.points > 0 ? 'plus' : ''">{{ r.points > 0 ? '+' : '' }}{{ r.points }}</b><div class="small muted">{{ r.balanceAfter }}</div></div>
      </div>
      <div v-if="!rows.length && !busy" class="muted">No points yet.</div>
    </div>
    <Button v-if="more && rows.length" label="Load more" text :loading="busy" @click="next" />
  </div>
</template>

<style scoped>
.pts { display: grid; gap: 12px; }
h2 { margin: 0; }
.back { font-weight: 600; text-decoration: none; }
.row-p { display: flex; justify-content: space-between; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
.row-p:last-child { border: 0; }
.right { text-align: right; }
.plus { color: var(--good); }
</style>
