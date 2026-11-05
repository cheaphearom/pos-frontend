import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { setLoggedOutHandler } from './api/client';
import { memberSession, setMemberLoggedOutHandler } from './online/memberApi';
import type { Role } from './api/types';
import AppLayout from './layouts/AppLayout.vue';
import { useApp } from './stores/app';
import { useAuth } from './stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    public?: boolean;
    roles?: Role[];
    /** Member app page: needs the member (customer) login, not staff */
    member?: boolean;
  }
}

const M: Role[] = ['STORE_MANAGER'];
const A: Role[] = ['SUPER_ADMIN'];

const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true, title: 'Log in' } },
  // Customer-facing second screen: only listens to the POS window, so no login needed.
  { path: '/display', component: () => import('./views/CustomerDisplayView.vue'), meta: { public: true, title: 'Customer display' } },
  { path: '/kitchen', component: () => import('./views/KitchenView.vue'), meta: { title: 'Barista screen' } },
  // Pickup board for a TV: public, shows queue numbers only.
  { path: '/board', component: () => import('./views/BoardView.vue'), meta: { public: true, title: 'Order board' } },
  // Online ordering for customers (public)
  { path: '/order/status/:token', component: () => import('./views/OrderStatusView.vue'), meta: { public: true, title: 'Your order' } },
  { path: '/order/:code', component: () => import('./views/OrderView.vue'), meta: { public: true, title: 'Order online' } },
  // Member app for customers' phones (own phone-number login)
  { path: '/m/login', component: () => import('./views/member/MemberLogin.vue'), meta: { public: true, title: 'Member login' } },
  {
    path: '/m',
    component: () => import('./views/member/MemberLayout.vue'),
    meta: { public: true, member: true },
    children: [
      { path: '', component: () => import('./views/member/MemberHome.vue'), meta: { public: true, member: true, title: 'My account' } },
      { path: 'order', component: () => import('./views/member/MemberStores.vue'), meta: { public: true, member: true, title: 'Order ahead' } },
      { path: 'orders', component: () => import('./views/member/MemberOrders.vue'), meta: { public: true, member: true, title: 'History' } },
      { path: 'orders/:id', component: () => import('./views/member/MemberOrder.vue'), meta: { public: true, member: true, title: 'Receipt' } },
      { path: 'points', component: () => import('./views/member/MemberPoints.vue'), meta: { public: true, member: true, title: 'Points' } },
      { path: 'profile', component: () => import('./views/member/MemberProfile.vue'), meta: { public: true, member: true, title: 'Me' } },
    ],
  },
  { path: '/pos', component: () => import('./views/PosView.vue'), meta: { title: 'POS' } },
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', component: () => import('./views/DashboardView.vue'), meta: { title: 'Dashboard' } },
      { path: 'sales', component: () => import('./views/SalesView.vue'), meta: { title: 'Sales' } },
      { path: 'shifts', component: () => import('./views/ShiftsView.vue'), meta: { title: 'Shifts' } },
      { path: 'products', component: () => import('./views/ProductsView.vue'), meta: { title: 'Products' } },
      { path: 'production', component: () => import('./views/ProductionView.vue'), meta: { title: 'Bakery production' } },
      { path: 'recipes', component: () => import('./views/RecipesView.vue'), meta: { title: 'Recipes', roles: M } },
      { path: 'modifiers', component: () => import('./views/ModifiersView.vue'), meta: { title: 'Drink options', roles: M } },
      { path: 'categories', component: () => import('./views/CategoriesView.vue'), meta: { title: 'Categories', roles: A } },
      { path: 'inventory', component: () => import('./views/InventoryView.vue'), meta: { title: 'Inventory', roles: M } },
      { path: 'transfers', component: () => import('./views/TransfersView.vue'), meta: { title: 'Transfers', roles: M } },
      { path: 'suppliers', component: () => import('./views/SuppliersView.vue'), meta: { title: 'Suppliers', roles: M } },
      { path: 'purchase-orders', component: () => import('./views/PurchaseOrdersView.vue'), meta: { title: 'Purchase orders', roles: M } },
      { path: 'coupons', component: () => import('./views/CouponsView.vue'), meta: { title: 'Coupons', roles: M } },
      { path: 'vouchers', component: () => import('./views/VouchersView.vue'), meta: { title: 'Gift vouchers', roles: M } },
      { path: 'promotions', component: () => import('./views/PromotionsView.vue'), meta: { title: 'Promotions', roles: M } },
      { path: 'wallet-cards', component: () => import('./views/WalletCardsView.vue'), meta: { title: 'Wallet cards', roles: M } },
      { path: 'customers', component: () => import('./views/CustomersView.vue'), meta: { title: 'Customers' } },
      { path: 'reports', component: () => import('./views/ReportsView.vue'), meta: { title: 'Reports', roles: M } },
      { path: 'users', component: () => import('./views/UsersView.vue'), meta: { title: 'Users', roles: M } },
      { path: 'stores', component: () => import('./views/StoresView.vue'), meta: { title: 'Stores', roles: A } },
      { path: 'audit', component: () => import('./views/AuditView.vue'), meta: { title: 'Audit log', roles: M } },
      { path: 'integrations', component: () => import('./views/IntegrationsView.vue'), meta: { title: 'Integrations', roles: A } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  // Member app: separate login, no staff checks.
  if (to.meta.member) return memberSession.s ? true : { path: '/m/login', query: { next: to.fullPath } };
  if (to.path === '/m/login') return memberSession.s ? '/m' : true;
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
  if (to.meta.member || to.path.startsWith('/order') || to.path === '/m/login') return; // the page sets its own title
  document.title = to.meta.title ? `${to.meta.title} · POS Admin` : 'POS Admin';
});

setLoggedOutHandler(() => {
  useAuth().clear();
  if (router.currentRoute.value.path !== '/login') router.push('/login');
});

setMemberLoggedOutHandler(() => {
  const at = router.currentRoute.value;
  if (at.meta.member) router.replace({ path: '/m/login', query: { next: at.fullPath } });
});
