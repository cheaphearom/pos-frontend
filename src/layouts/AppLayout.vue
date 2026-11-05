<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Role } from '@/api/types';
import { ROLE_LABEL } from '@/api/types';
import { useApp } from '@/stores/app';
import { useAuth } from '@/stores/auth';

const auth = useAuth();
const app = useApp();
const route = useRoute();
const router = useRouter();
const open = ref(false);

interface NavItem { to: string; label: string; icon: string; roles?: Role[] }
const sections: { title: string; items: NavItem[] }[] = [
  { title: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: 'pi pi-home' },
    { to: '/reports', label: 'Reports', icon: 'pi pi-chart-bar', roles: ['STORE_MANAGER'] },
  ] },
  { title: 'Selling', items: [
    { to: '/sales', label: 'Sales', icon: 'pi pi-receipt' },
    { to: '/shifts', label: 'Shifts', icon: 'pi pi-clock' },
    { to: '/kitchen', label: 'Barista screen', icon: 'pi pi-th-large' },
    { to: '/customers', label: 'Customers', icon: 'pi pi-heart' },
    { to: '/wallet-cards', label: 'Wallet cards', icon: 'pi pi-credit-card', roles: ['STORE_MANAGER'] },
  ] },
  { title: 'Catalogue & stock', items: [
    { to: '/products', label: 'Products', icon: 'pi pi-box' },
    { to: '/categories', label: 'Categories', icon: 'pi pi-tags', roles: ['SUPER_ADMIN'] },
    { to: '/modifiers', label: 'Drink options', icon: 'pi pi-sliders-v', roles: ['STORE_MANAGER'] },
    { to: '/recipes', label: 'Recipes', icon: 'pi pi-book', roles: ['STORE_MANAGER'] },
    { to: '/inventory', label: 'Inventory', icon: 'pi pi-warehouse', roles: ['STORE_MANAGER'] },
    { to: '/transfers', label: 'Transfers', icon: 'pi pi-arrow-right-arrow-left', roles: ['STORE_MANAGER'] },
  ] },
  { title: 'Marketing', items: [
    { to: '/promotions', label: 'Promotions', icon: 'pi pi-megaphone', roles: ['STORE_MANAGER'] },
    { to: '/coupons', label: 'Coupons', icon: 'pi pi-ticket', roles: ['STORE_MANAGER'] },
    { to: '/vouchers', label: 'Gift vouchers', icon: 'pi pi-gift', roles: ['STORE_MANAGER'] },
  ] },
  { title: 'Purchasing', items: [
    { to: '/purchase-orders', label: 'Purchase orders', icon: 'pi pi-file-edit', roles: ['STORE_MANAGER'] },
    { to: '/suppliers', label: 'Suppliers', icon: 'pi pi-truck', roles: ['STORE_MANAGER'] },
  ] },
  { title: 'Administration', items: [
    { to: '/users', label: 'Users', icon: 'pi pi-users', roles: ['STORE_MANAGER'] },
    { to: '/stores', label: 'Stores', icon: 'pi pi-building', roles: ['SUPER_ADMIN'] },
    { to: '/integrations', label: 'Integrations', icon: 'pi pi-link', roles: ['SUPER_ADMIN'] },
  ] },
];
const visible = computed(() =>
  sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || auth.can(...i.roles)) }))
    .filter((s) => s.items.length),
);
const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to));

const dark = ref(readDark());
watch(dark, (v) => {
  document.documentElement.classList.toggle('app-dark', v);
  try { localStorage.setItem('pos.dark', v ? '1' : '0'); } catch { /* ignore */ }
}, { immediate: true });
function readDark() {
  try {
    const v = localStorage.getItem('pos.dark');
    return v ? v === '1' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch { return false; }
}

watch(() => route.path, () => (open.value = false));

async function logout() {
  await auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="shell" :class="{ open }">
    <aside class="sidebar">
      <div class="brand"><span class="logo"><i class="pi pi-shopping-cart" /></span> POS Admin</div>
      <nav>
        <div v-for="s in visible" :key="s.title" class="nav-section">
          <div class="nav-title">{{ s.title }}</div>
          <RouterLink v-for="i in s.items" :key="i.to" :to="i.to" class="nav-item" :class="{ active: isActive(i.to) }">
            <i :class="i.icon" /> {{ i.label }}
          </RouterLink>
        </div>
      </nav>
    </aside>
    <div class="backdrop" @click="open = false" />

    <div class="main">
      <header class="topbar">
        <Button icon="pi pi-bars" text rounded class="menu-btn" aria-label="Menu" @click="open = !open" />
        <div class="store-pick">
          <i class="pi pi-building muted" />
          <Select
            v-model="app.currentStoreId"
            :options="app.stores"
            option-label="name"
            option-value="id"
            placeholder="Select store"
            class="store-select"
            :disabled="app.stores.length <= 1"
          >
            <template #option="{ option }"><b class="mono">{{ option.code }}</b>&nbsp; {{ option.name }}</template>
          </Select>
        </div>
        <div class="spacer" />
        <RouterLink to="/pos"><Button label="Open POS" icon="pi pi-shopping-cart" size="small" /></RouterLink>
        <Button :icon="dark ? 'pi pi-sun' : 'pi pi-moon'" text rounded aria-label="Toggle dark mode" @click="dark = !dark" />
        <div class="user">
          <div class="name">{{ auth.user?.fullName }}</div>
          <div class="role">{{ auth.role ? ROLE_LABEL[auth.role] : '' }}</div>
        </div>
        <Button icon="pi pi-sign-out" text rounded aria-label="Log out" v-tooltip.bottom="'Log out'" @click="logout" />
      </header>
      <main>
        <Message v-if="!app.stores.length" severity="warn" class="page">
          You are not assigned to any store yet. Ask an administrator to add you to a store.
        </Message>
        <RouterView :key="app.currentStoreId ?? 'none'" />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 236px; flex-shrink: 0; background: var(--sidebar); color: var(--sidebar-text);
  position: sticky; top: 0; height: 100vh; overflow-y: auto; padding: 16px 12px;
  scrollbar-width: none; /* still scrolls, but no visible bar (Firefox, Chrome, Edge) */
}
.sidebar::-webkit-scrollbar { display: none; } /* older Chrome / Edge / Safari */
.brand { display: flex; align-items: center; gap: 10px; color: #fff; font-weight: 700; font-size: 17px; padding: 4px 8px 18px; }
.logo { width: 32px; height: 32px; border-radius: 8px; background: var(--sidebar-active); display: grid; place-items: center; }
.nav-section { margin-bottom: 14px; }
.nav-title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .55; padding: 6px 10px; }
.nav-item {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 8px;
  color: var(--sidebar-text); text-decoration: none; font-weight: 500;
}
.nav-item:hover { background: rgba(255, 255, 255, .07); color: #fff; }
.nav-item.active { background: var(--sidebar-active); color: #fff; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.topbar {
  height: 60px; display: flex; align-items: center; gap: 8px; padding: 0 16px;
  background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 5;
}
.store-pick { display: flex; align-items: center; gap: 8px; }
.store-select { min-width: 240px; }
.spacer { flex: 1; }
.user { text-align: right; line-height: 1.2; margin-left: 6px; }
.user .name { font-weight: 600; }
.user .role { font-size: 12px; color: var(--text-2); }
.menu-btn { display: none; }
.backdrop { display: none; }
@media (max-width: 900px) {
  .sidebar { position: fixed; left: 0; z-index: 20; transform: translateX(-100%); transition: transform .2s; }
  .open .sidebar { transform: none; }
  .open .backdrop { display: block; position: fixed; inset: 0; background: rgba(0, 0, 0, .35); z-index: 15; }
  .menu-btn { display: inline-flex; }
  .user { display: none; }
  .store-select { min-width: 0; width: 180px; }
}
</style>
