<script setup lang="ts">
/**
 * One-series bar or line chart (Chart.js). Single series → no legend; the card title names it.
 * Colours come from CSS variables so light/dark mode both work.
 * `threshold` adds a dashed red line (e.g. an anomaly detector's alert threshold).
 * `animate: false` for charts that are redrawn on a timer (no grow-from-zero on every refresh).
 */
import { BarController, BarElement, CategoryScale, Chart, Filler, LinearScale, LineController, LineElement, PointElement, Tooltip, type ChartDataset } from 'chart.js';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Filler);

const props = withDefaults(
  defineProps<{
    type?: 'bar' | 'line';
    labels: string[];
    values: number[];
    format?: (v: number) => string;
    horizontal?: boolean;
    height?: number;
    threshold?: number | null;
    thresholdLabel?: string;
    animate?: boolean;
  }>(),
  { type: 'bar', format: (v: number) => String(v), horizontal: false, height: 260, animate: true },
);

const canvas = ref<HTMLCanvasElement>();
let chart: Chart | null = null;
let observer: MutationObserver | null = null;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function render() {
  chart?.destroy();
  if (!canvas.value) return;
  const series = css('--series-1') || '#8b5a33';
  const text2 = css('--text-2');
  const grid = css('--border');
  const valueAxis = {
    beginAtZero: true,
    grid: { color: grid, drawTicks: false },
    border: { display: false },
    ticks: { color: text2, padding: 8, callback: (v: string | number) => props.format(Number(v)) },
  };
  const catAxis = { grid: { display: false }, border: { color: grid }, ticks: { color: text2, maxRotation: 0, autoSkipPadding: 12 } };
  const hasThreshold = props.threshold !== undefined && props.threshold !== null && Number.isFinite(props.threshold);
  const thresholdSet: ChartDataset<'line'>[] = hasThreshold
    ? [{
        type: 'line', label: props.thresholdLabel ?? 'Threshold', data: props.labels.map(() => props.threshold as number),
        borderColor: css('--bad') || '#c0392b', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, pointHitRadius: 0, fill: false,
      }]
    : [];

  chart = new Chart(canvas.value, {
    type: props.type,
    data: {
      labels: props.labels,
      datasets: [
        {
          data: props.values,
          backgroundColor: props.type === 'line' ? series + '22' : series,
          hoverBackgroundColor: series,
          borderColor: series,
          borderWidth: props.type === 'line' ? 2 : 0,
          borderRadius: 4,
          maxBarThickness: 28,
          fill: props.type === 'line',
          tension: 0.25,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHitRadius: 12,
        },
        ...(thresholdSet as any[]),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: props.animate ? undefined : false,
      indexAxis: props.horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            label: (c) => (c.datasetIndex === 1 ? `${c.dataset.label}: ` : '') + props.format(Number(props.horizontal ? c.parsed.x : c.parsed.y)),
          },
        },
      },
      scales: props.horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
    },
  });
}

onMounted(() => {
  render();
  // Re-render when dark mode is toggled.
  observer = new MutationObserver(render);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
});
onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.destroy();
});
watch(() => [props.labels, props.values, props.type, props.threshold], render, { deep: true });
</script>

<template>
  <div :style="{ height: height + 'px', position: 'relative' }">
    <canvas ref="canvas" role="img" :aria-label="`Chart with ${labels.length} values`" />
  </div>
</template>
