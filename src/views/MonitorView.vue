<script setup lang="ts">
/**
 * System monitor (super admins): health of the API, database, Redis, webhook queue and the ML anomaly
 * detector, request and sales metrics of the last hour, anomaly scores and alerts.
 * Everything comes from /api/v1/monitoring/*; the browser never talks to the detector.
 * Refreshes every 15 s while the tab is visible.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '@/api/client';
import SimpleChart from '@/components/SimpleChart.vue';
import { useNotify } from '@/composables/useNotify';
import { dateTime } from '@/utils/format';

type Level = 'ok' | 'warn' | 'fail';
interface Point { time: string; requests: number; errorRate: number; p95Ms: number | null; sales: number; failedSales: number; failedPayments: number }
interface ScorePoint { time: string; methods: Record<string, { score: number; threshold: number; alert: boolean }> }
interface Alert {
  raised_at: string; method: string; window_start: string; window_end: string; score: number; threshold: number; fired_rules?: string[];
  explanation?: { suspected_service: string | null; suspected_problem: string; top_signals: { text: string }[]; notes: string[]; example_errors: string[] };
}

const REFRESH_MS = 15_000;
const notify = useNotify();
const status = ref<any>(null);
const points = ref<Point[]>([]);
const scores = ref<{ methods: string[]; points: ScorePoint[] } | null>(null);
const alerts = ref<Alert[]>([]);
const detectorError = ref('');
const loading = ref(false);
const sending = ref(false);
const updatedAt = ref<Date | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

const METHOD = { rules: 'Rules', isolation_forest: 'Isolation Forest', pca: 'PCA', random_forest: 'Random Forest' } as Record<string, string>;
const methodLabel = (m: string) => METHOD[m] ?? m;
const LEVEL = { ok: 'OK', warn: 'Warning', fail: 'Down' } as Record<Level, string>;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function load() {
  if (loading.value) return;
  loading.value = true;
  try {
    const [s, m] = await Promise.all([api.get<any>('/monitoring/status'), api.get<{ points: Point[] }>('/monitoring/metrics', { minutes: 60 })]);
    status.value = s;
    points.value = m.points;
    // Scores and alerts come from the detector, which may be down or not set up.
    try {
      const [sc, al] = await Promise.all([api.get<any>('/monitoring/scores', { minutes: 30 }), api.get<any>('/monitoring/alerts', { limit: 20 })]);
      scores.value = sc;
      alerts.value = al.alerts;
      detectorError.value = '';
    } catch (e) {
      detectorError.value = e instanceof Error ? e.message : String(e);
    }
    updatedAt.value = new Date();
  } catch (e) {
    notify.error(e);
  } finally {
    loading.value = false;
  }
}

async function sendTest() {
  sending.value = true;
  try {
    await api.post('/monitoring/notify-test');
    notify.success('Test message sent', 'Check your Telegram chat');
  } catch (e) {
    notify.error(e);
  } finally {
    sending.value = false;
  }
}

/** Polls only while the tab is visible; a hidden tab costs nothing. */
function start() {
  stop();
  load();
  timer = setInterval(load, REFRESH_MS);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
const onVisibility = () => (document.hidden ? stop() : start());
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility);
  if (!document.hidden) start();
});
onBeforeUnmount(() => {
  stop();
  document.removeEventListener('visibilitychange', onVisibility);
});

const cards = computed(() => {
  const s = status.value;
  if (!s) return [];
  const ms = (x: any) => (x?.ms != null ? `${x.ms} ms` : x?.error ?? '');
  const q = s.queue;
  const d = s.detector;
  return [
    { key: 'api', title: 'API', icon: 'pi pi-server', level: s.api.status as Level, lines: [`Up ${uptime(s.api.uptimeS)}`, `${s.api.memoryMb} MB memory`] },
    { key: 'db', title: 'Database', icon: 'pi pi-database', level: s.database.status as Level, lines: [s.database.status === 'fail' ? s.database.error : `Query ${ms(s.database)}`] },
    { key: 'redis', title: 'Redis', icon: 'pi pi-bolt', level: s.redis.status as Level, lines: [s.redis.status === 'fail' ? s.redis.error : `Ping ${ms(s.redis)}`] },
    {
      key: 'queue', title: 'Webhook queue', icon: 'pi pi-send', level: q.status as Level,
      lines: q.status === 'fail'
        ? [q.error]
        : [`${q.waiting} waiting · ${q.active} running`, `${q.delayed} retrying · ${q.failedLastHour} failed in the last hour`],
    },
    {
      key: 'detector', title: 'Anomaly detector', icon: 'pi pi-eye', level: d.status as Level,
      lines: !d.reachable
        ? [d.error]
        : [
            d.trained ? `Trained ${dateTime(d.trainedAt)}` : 'Not trained yet: rules only',
            d.lastWindowEnd ? `Last window ${clock(d.lastWindowEnd)}` : 'No window scored yet',
            d.telegram ? 'Telegram alerts on' : 'Telegram alerts off',
          ],
      notes: d.notes ?? [],
    },
  ];
});

function uptime(s: number) {
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

const labels = computed(() => points.value.map((p) => clock(p.time)));
const series = computed(() => ({
  requests: points.value.map((p) => p.requests),
  errorRate: points.value.map((p) => p.errorRate * 100),
  p95: points.value.map((p) => p.p95Ms ?? 0),
  sales: points.value.map((p) => p.sales),
}));
const failedLastHour = computed(() => points.value.reduce((n, p) => n + p.failedPayments, 0));

const scoreCharts = computed(() => {
  const sc = scores.value;
  if (!sc?.points.length) return [];
  return sc.methods.map((m) => {
    const pts = sc.points.filter((p) => p.methods[m]);
    const last = pts[pts.length - 1]?.methods[m];
    return {
      method: m,
      labels: pts.map((p) => clock(p.time)),
      values: pts.map((p) => p.methods[m].score),
      threshold: last?.threshold ?? null,
      alert: !!last?.alert,
    };
  });
});

const problemOf = (a: Alert) => {
  const e = a.explanation;
  if (!e) return a.fired_rules?.length ? a.fired_rules.join(', ') : '—';
  return e.suspected_service ? `${e.suspected_service}: ${e.suspected_problem}` : e.suspected_problem;
};
</script>

<template>
  <div class="page monitor">
    <div class="page-head">
      <div>
        <h1>System monitor</h1>
        <div class="sub">Health of the POS servers and the anomaly detector. Refreshes every 15 seconds.</div>
      </div>
      <div class="actions">
        <span v-if="updatedAt" class="small muted updated">Updated {{ updatedAt.toLocaleTimeString() }}</span>
        <Button icon="pi pi-refresh" label="Refresh" severity="secondary" outlined :loading="loading" @click="load" />
        <Button icon="pi pi-send" label="Send test Telegram message" :loading="sending" @click="sendTest" />
      </div>
    </div>

    <div class="status-grid">
      <div v-for="c in cards" :key="c.key" class="card status" :class="c.level" :data-status="c.key">
        <div class="status-head">
          <span class="ic"><i :class="c.icon" /></span>
          <b>{{ c.title }}</b>
          <span class="dot" :aria-label="LEVEL[c.level]" />
          <span class="level">{{ LEVEL[c.level] }}</span>
        </div>
        <div v-for="(l, i) in c.lines" :key="i" class="small muted">{{ l }}</div>
        <div v-for="(n, i) in c.notes ?? []" :key="'n' + i" class="small note"><i class="pi pi-info-circle" /> {{ n }}</div>
      </div>
      <div v-if="!status" class="card muted">Loading…</div>
    </div>

    <h2 class="section">Last 60 minutes</h2>
    <div class="grid grid-2">
      <div class="card"><h3>Requests per minute</h3><SimpleChart :animate="false" :labels="labels" :values="series.requests" :height="200" /></div>
      <div class="card"><h3>Error rate (5xx)</h3><SimpleChart :animate="false" type="line" :labels="labels" :values="series.errorRate" :format="(v) => v.toFixed(1) + '%'" :height="200" /></div>
      <div class="card"><h3>p95 response time</h3><SimpleChart :animate="false" type="line" :labels="labels" :values="series.p95" :format="(v) => Math.round(v) + ' ms'" :height="200" /></div>
      <div class="card">
        <h3>Sales per minute</h3>
        <SimpleChart :animate="false" :labels="labels" :values="series.sales" :height="200" />
        <div class="small muted" style="margin-top: 6px">Failed payments in the last hour: <b>{{ failedLastHour }}</b></div>
      </div>
    </div>

    <h2 class="section">Anomaly scores (30 minutes)</h2>
    <Message v-if="detectorError" severity="warn" :closable="false">{{ detectorError }}</Message>
    <div v-else-if="!scoreCharts.length" class="card muted">No scores yet: the detector scores a new window every 10 seconds once logs arrive.</div>
    <div v-else class="grid grid-3">
      <div v-for="s in scoreCharts" :key="s.method" class="card">
        <h3 class="row" style="justify-content: space-between">
          <span>{{ methodLabel(s.method) }}</span>
          <Tag :value="s.alert ? 'Alert' : 'Normal'" :severity="s.alert ? 'danger' : 'success'" />
        </h3>
        <SimpleChart :animate="false" type="line" :labels="s.labels" :values="s.values" :threshold="s.threshold" threshold-label="Threshold" :format="(v) => v.toFixed(2)" :height="170" />
        <div class="small muted">Above the dashed line = anomaly</div>
      </div>
    </div>

    <h2 class="section">Recent alerts</h2>
    <div class="card alerts-card">
      <DataTable :value="alerts" size="small" data-key="raised_at" table-style="min-width: 760px">
        <template #empty><span class="muted">{{ detectorError ? 'The detector is not reachable' : 'No alerts' }}</span></template>
        <Column header="Time" style="width: 170px"><template #body="{ data }"><span class="small">{{ dateTime(data.window_end) }}</span></template></Column>
        <Column header="Detected by" style="width: 160px"><template #body="{ data }"><Tag :value="methodLabel(data.method)" severity="warn" /></template></Column>
        <Column header="Suspected problem">
          <template #body="{ data }">
            <div>{{ problemOf(data) }}</div>
            <div v-for="(sig, i) in data.explanation?.top_signals?.slice(0, 2) ?? []" :key="i" class="small muted">• {{ sig.text }}</div>
          </template>
        </Column>
        <Column header="Example log lines">
          <template #body="{ data }">
            <div v-for="(line, i) in data.explanation?.example_errors ?? []" :key="i" class="mono log-line">{{ line }}</div>
            <span v-if="!data.explanation?.example_errors?.length" class="muted small">—</span>
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>

<style scoped>
.updated { align-self: center; }
.status-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); margin-bottom: 8px; }
.status { display: grid; gap: 4px; align-content: start; border-top: 4px solid var(--good); }
.status.warn { border-top-color: var(--warn); }
.status.fail { border-top-color: var(--bad); }
.status-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.ic { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: color-mix(in srgb, var(--p-primary-color) 13%, transparent); color: var(--p-primary-color); }
.dot { width: 10px; height: 10px; border-radius: 50%; margin-left: auto; background: var(--good); }
.warn .dot { background: var(--warn); }
.fail .dot { background: var(--bad); }
.level { font-weight: 700; font-size: 12px; color: var(--good); }
.warn .level { color: var(--warn); }
.fail .level { color: var(--bad); }
.note { color: var(--warn); }
.section { font-size: 16px; font-weight: 700; margin: 22px 0 10px; }
.grid-3 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
.log-line { white-space: pre-wrap; word-break: break-word; font-size: 11.5px; margin-bottom: 4px; }
.alerts-card { overflow-x: auto; } /* the table scrolls inside its card on phones, not the page */
@media (max-width: 600px) {
  .page.monitor { padding: 16px; }
  .grid-2, .grid-3 { grid-template-columns: minmax(0, 1fr); }
  .page-head .actions { width: 100%; }
}
</style>
