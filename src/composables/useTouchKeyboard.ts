import { ref, watch } from 'vue';

/**
 * On-screen keyboard for tills without a keyboard (touchscreen PCs). Turned on or off per device; on by default
 * when the device has only a touchscreen (no mouse).
 */
function read() {
  try {
    const v = localStorage.getItem('pos.touchKeyboard');
    if (v) return v === '1';
    return window.matchMedia('(any-pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
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
