import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { setLoggedOutHandler } from './api/client';
import type { Role } from './api/types';
import AppLayout from './layouts/AppLayout.vue';
import { useApp } from './stores/app';
import { useAuth } from './stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    public?: boolean;
    roles?: Role[];
  }
}

const M: Role[] = ['STORE_MANAGER'];
const A: Role[] = ['SUPER_ADMIN'];

const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true, title: 'Log in' } },
  // Customer-facing second screen: only listens to the POS window, so no login needed.
  { path: '/display', component: () => import('./views/CustomerDisplayView.vue'), meta: { public: true, title: 'Customer display' } },
  { path: '/pos', component: () => import('./views/PosView.vue'), meta: { title: 'POS' } },
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', component: () => import('./views/DashboardView.vue'), meta: { title: 'Dashboard' } },
      { path: 'sales', component: () => import('./views/SalesView.vue'), meta: { title: 'Sales' } },
      { path: 'shifts', component: () => import('./views/ShiftsView.vue'), meta: { title: 'Shifts' } },
      { path: 'products', component: () => import('./views/ProductsView.vue'), meta: { title: 'Products' } },
      { path: 'categories', component: () => import('./views/CategoriesView.vue'), meta: { title: 'Categories', roles: A } },
      { path: 'inventory', component: () => import('./views/InventoryView.vue'), meta: { title: 'Inventory', roles: M } },
      { path: 'transfers', component: () => import('./views/TransfersView.vue'), meta: { title: 'Transfers', roles: M } },
      { path: 'suppliers', component: () => import('./views/SuppliersView.vue'), meta: { title: 'Suppliers', roles: M } },
      { path: 'purchase-orders', component: () => import('./views/PurchaseOrdersView.vue'), meta: { title: 'Purchase orders', roles: M } },
      { path: 'promotions', component: () => import('./views/PromotionsView.vue'), meta: { title: 'Promotions', roles: M } },
      { path: 'wallet-cards', component: () => import('./views/WalletCardsView.vue'), meta: { title: 'Wallet cards', roles: M } },
      { path: 'customers', component: () => import('./views/CustomersView.vue'), meta: { title: 'Customers' } },
      { path: 'reports', component: () => import('./views/ReportsView.vue'), meta: { title: 'Reports', roles: M } },
      { path: 'users', component: () => import('./views/UsersView.vue'), meta: { title: 'Users', roles: M } },
      { path: 'stores', component: () => import('./views/StoresView.vue'), meta: { title: 'Stores', roles: A } },
      { path: 'integrations', component: () => import('./views/IntegrationsView.vue'), meta: { title: 'Integrations', roles: A } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!auth.user) await auth.loadMe();
  if (to.meta.public) return auth.user && to.path === '/login' ? (auth.role === 'CASHIER' ? '/pos' : '/') : true;
  if (!auth.user) return { path: '/login', query: to.fullPath !== '/' ? { next: to.fullPath } : {} };
  const app = useApp();
  if (!app.stores.length) await app.loadStores().catch(() => undefined);
  if (to.meta.roles && !auth.can(...to.meta.roles)) return '/';
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · POS Admin` : 'POS Admin';
});

setLoggedOutHandler(() => {
  useAuth().clear();
  if (router.currentRoute.value.path !== '/login') router.push('/login');
});
