import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { createPinia } from 'pinia';
import 'primeicons/primeicons.css';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import ToastService from 'primevue/toastservice';
import Tooltip from 'primevue/tooltip';
import { createApp } from 'vue';
import App from './App.vue';
import { registerComponents } from './components/register';
import { router } from './router';
import './styles.css';
import { startTranslator } from './i18n';

// Warm coffee brand: roasted-bean brown on cream, warm greys (stone) for borders and inputs.
const stone = {
  0: '#ffffff', 50: '#faf8f5', 100: '#f4f0eb', 200: '#e8e1d8', 300: '#d5cbbf', 400: '#a99c8f',
  500: '#7d7064', 600: '#5c5148', 700: '#463d36', 800: '#2e2722', 900: '#1f1a16', 950: '#120f0c',
};
const Theme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#f8f2ec', 100: '#efe1d3', 200: '#dfc3a8', 300: '#c9a07c', 400: '#ab7a50',
      500: '#8b5a33', 600: '#774b2a', 700: '#623d23', 800: '#4e301c', 900: '#3d2616', 950: '#2a1a0f',
    },
    colorScheme: {
      light: { surface: stone },
      // Same roasted brown in dark mode, so white text on buttons stays readable
      dark: { surface: stone, primary: { color: '{primary.500}', contrastColor: '#ffffff', hoverColor: '{primary.400}', activeColor: '{primary.300}' } },
    },
  },
});

// Dark mode chosen on this device applies to every screen (POS, display…), not only the admin pages.
try {
  if (localStorage.getItem('pos.dark') === '1') document.documentElement.classList.add('app-dark');
} catch { /* private mode */ }

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(PrimeVue, { theme: { preset: Theme, options: { darkModeSelector: '.app-dark' } } });
app.use(ToastService);
app.use(ConfirmationService);
app.directive('tooltip', Tooltip);
registerComponents(app);
app.mount('#app');
startTranslator(); // ខ្មែរ / English (src/i18n)

// Offline support (production builds only; needs HTTPS or localhost).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
