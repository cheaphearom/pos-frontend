import { ref, watch } from 'vue';

/**
 * On-screen keyboard and number pad for tills without a keyboard (touchscreen PCs). The cashier chooses: off
 * until they tap a "Keyboard" button, then remembered on this till until they turn it off again.
 */
function read() {
  try {
    return localStorage.getItem('pos.touchKeyboard') === '1';
  } catch {
    return false;
  }
}

const on = ref(read());
watch(on, (v) => {
  try { localStorage.setItem('pos.touchKeyboard', v ? '1' : '0'); } catch { /* private mode */ }
});

export function useTouchKeyboard() {
  return on;
}
