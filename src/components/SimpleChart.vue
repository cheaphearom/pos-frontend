<script setup lang="ts">
/**
 * One-series bar or line chart (Chart.js). Single series → no legend; the card title names it.
 * Colours come from CSS variables so light/dark mode both work.
 */
import { BarController, BarElement, CategoryScale, Chart, Filler, LinearScale, LineController, LineElement, PointElement, Tooltip } from 'chart.js';
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
  }>(),
  { type: 'bar', format: (v: number) => String(v), horizontal: false, height: 260 },
);

const canvas = ref<HTMLCanvasElement>();
let chart: Chart | null = null;
let observer: MutationObserver | null = null;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function render() {
  chart?.destroy();
  if (!canvas.value) return;
  const series = css('--series-1') || '#2a78d6';
  const text2 = css('--text-2');
  const grid = css('--border');
  const valueAxis = {
    beginAtZero: true,
    grid: { color: grid, drawTicks: false },
    border: { display: false },
    ticks: { color: text2, padding: 8, callback: (v: string | number) => props.format(Number(v)) },
  };
  const catAxis = { grid: { display: false }, border: { color: grid }, ticks: { color: text2, maxRotation: 0, autoSkipPadding: 12 } };

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
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: props.horizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: { label: (c) => props.format(Number(props.horizontal ? c.parsed.x : c.parsed.y)) },
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
watch(() => [props.labels, props.values, props.type], render, { deep: true });
</script>

<template>
  <div :style="{ height: height + 'px', position: 'relative' }">
    <canvas ref="canvas" role="img" :aria-label="`Chart with ${labels.length} values`" />
  </div>
</template>
