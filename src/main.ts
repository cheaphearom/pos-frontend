// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
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

// LOK blue brand: deep blue #1E3A8A with bright blue #3B82F6, cool greys (slate) for borders and inputs.
const stone = {
  0: '#ffffff', 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
  500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617',
};
const Theme = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#3b82f6',
      500: '#1e3a8a', 600: '#1a3278', 700: '#172a66', 800: '#132254', 900: '#0f1a42', 950: '#0a1230',
    },
    colorScheme: {
      light: { surface: stone },
      // Same deep blue in dark mode, so white text on buttons stays readable
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
