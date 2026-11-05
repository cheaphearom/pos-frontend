<script setup lang="ts">
/** Member app shell for phones: page + bottom tabs. */
import { memberSession } from '@/online/memberApi';

const tabs = [
  { to: '/m', icon: 'pi pi-home', label: 'Home', exact: true },
  { to: '/m/order', icon: 'pi pi-shopping-bag', label: 'Order' },
  { to: '/m/orders', icon: 'pi pi-receipt', label: 'History' },
  { to: '/m/profile', icon: 'pi pi-user', label: 'Me' },
];
</script>

<template>
  <div class="mapp">
    <main class="mpage"><RouterView /></main>
    <nav v-if="memberSession.s" class="tabs" aria-label="Member app">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="tab" :class="{ exact: t.exact }">
        <i :class="t.icon" /><span>{{ t.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.mapp { min-height: 100vh; background: var(--bg); }
.mpage { max-width: 560px; margin: 0 auto; padding: 16px 16px 90px; }
.tabs { position: fixed; bottom: 0; left: 0; right: 0; display: flex; justify-content: center; background: var(--surface); border-top: 1px solid var(--border); padding-bottom: env(safe-area-inset-bottom); z-index: 10; }
.tab { flex: 1; max-width: 140px; display: grid; justify-items: center; gap: 3px; padding: 9px 0 8px; color: var(--text-3); text-decoration: none; font-size: 12px; font-weight: 600; }
.tab i { font-size: 19px; }
.tab.router-link-active:not(.exact), .tab.exact.router-link-exact-active { color: var(--p-primary-color); }
</style>
