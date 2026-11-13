import { ref, watch } from 'vue';

/** Big mode on the POS screen: everything larger, for touchscreens. The cashier's choice, remembered on the till. */
export const BIG_ZOOM = 1.2;

function read() {
  try { return localStorage.getItem('pos.big') === '1'; } catch { return false; }
}
const big = ref(read());
watch(big, (v) => {
  try { localStorage.setItem('pos.big', v ? '1' : '0'); } catch { /* private mode */ }
});

export function useBigMode() {
  return big;
}
