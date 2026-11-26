// Copyright (c) 2026 Chea Phearom. All rights reserved.
// Proprietary and confidential: see the LICENSE file.
import { defineStore } from 'pinia';
import { setBusinessTimezone } from '@/utils/format';
import { computed, ref } from 'vue';
import { api, tokens } from '@/api/client';
import type { Me, Role } from '@/api/types';

export const useAuth = defineStore('auth', () => {
  const user = ref<Me | null>(null);

  const isLoggedIn = computed(() => !!user.value);
  const role = computed(() => user.value?.role);
  /** The owner (super admin). */
  const isAdmin = computed(() => role.value === 'SUPER_ADMIN');
  /** Store manager rights: store managers, admins, super admins. */
  const isManager = computed(() => role.value === 'SUPER_ADMIN' || role.value === 'ADMIN' || role.value === 'STORE_MANAGER');

  /** True if the user has one of the roles (super admin always passes; an admin passes manager and cashier pages). */
  const can = (...roles: Role[]) =>
    !!role.value && (role.value === 'SUPER_ADMIN' || roles.includes(role.value) || (role.value === 'ADMIN' && roles.some((r) => r === 'STORE_MANAGER' || r === 'CASHIER')));
  /** An owner area (utils/permissions.ts): super admin, or an admin a super admin allowed it. */
  const has = (perm: string) => role.value === 'SUPER_ADMIN' || (role.value === 'ADMIN' && !!user.value?.permissions?.includes(perm));

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
      setBusinessTimezone(user.value.timezone);
    } catch (e) {
      // No connection: keep working as the last logged-in user (POS offline mode).
      user.value = e instanceof TypeError ? cache.get() : null;
      setBusinessTimezone(user.value?.timezone);
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

  return { user, isLoggedIn, role, isAdmin, isManager, can, has, login, loadMe, logout, clear };
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
