import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, tokens } from '@/api/client';
import type { Me, Role } from '@/api/types';

export const useAuth = defineStore('auth', () => {
  const user = ref<Me | null>(null);

  const isLoggedIn = computed(() => !!user.value);
  const role = computed(() => user.value?.role);
  const isAdmin = computed(() => role.value === 'SUPER_ADMIN');
  const isManager = computed(() => role.value === 'SUPER_ADMIN' || role.value === 'STORE_MANAGER');

  /** True if the user has one of the roles (super admin always passes). */
  const can = (...roles: Role[]) => !!role.value && (role.value === 'SUPER_ADMIN' || roles.includes(role.value));

  async function login(email: string, password: string) {
    const t = await api.post('/auth/login', { email, password });
    tokens.set(t.accessToken, t.refreshToken);
    await loadMe();
  }

  async function loadMe() {
    if (!tokens.access) return null;
    try {
      user.value = await api.get<Me>('/auth/me');
      cache.set(user.value);
    } catch (e) {
      // No connection: keep working as the last logged-in user (POS offline mode).
      user.value = e instanceof TypeError ? cache.get() : null;
    }
    return user.value;
  }

  async function logout() {
    const refreshToken = tokens.refresh;
    tokens.clear();
    cache.clear();
    user.value = null;
    if (refreshToken) await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
  }

  function clear() {
    user.value = null;
    cache.clear();
  }

  return { user, isLoggedIn, role, isAdmin, isManager, can, login, loadMe, logout, clear };
});

const ME = 'pos.me';
const cache = {
  get(): Me | null {
    try { return JSON.parse(localStorage.getItem(ME) ?? 'null'); } catch { return null; }
  },
  set(me: Me) {
    try { localStorage.setItem(ME, JSON.stringify(me)); } catch { /* ignore */ }
  },
  clear() {
    try { localStorage.removeItem(ME); } catch { /* ignore */ }
  },
};
