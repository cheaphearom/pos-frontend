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

// Blue brand colour, matching the charts.
const Theme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#eef5fd', 100: '#cde2fb', 200: '#9ec5f4', 300: '#6da7ec', 400: '#3987e5',
      500: '#2a78d6', 600: '#256abf', 700: '#1c5cab', 800: '#184f95', 900: '#104281', 950: '#0d366b',
    },
  },
});

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
