import { ref, watch } from 'vue';

/**
 * Dark mode chosen on this device (localStorage "pos.dark"). One shared value for the whole app, and it follows
 * changes made in another window too: the customer display turns dark when the POS window switches to dark.
 */
function read() {
  try {
    const v = localStorage.getItem('pos.dark');
    return v ? v === '1' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

const dark = ref(read());
watch(dark, (v) => {
  document.documentElement.classList.toggle('app-dark', v);
  try { localStorage.setItem('pos.dark', v ? '1' : '0'); } catch { /* private mode */ }
}, { immediate: true });
window.addEventListener('storage', (e) => {
  if (e.key === 'pos.dark') dark.value = e.newValue === '1';
});

export function useDark() {
  return dark;
}
