<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '@/stores/auth';
import { useApp } from '@/stores/app';

const auth = useAuth();
const app = useApp();
const router = useRouter();
const route = useRoute();
const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(email.value.trim(), password.value);
    await app.loadStores();
    router.push((route.query.next as string) || (auth.role === 'CASHIER' ? '/pos' : '/'));
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Login failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login">
    <form class="box card" @submit.prevent="submit">
      <div class="logo"><i class="pi pi-shopping-cart" /></div>
      <h1>POS Admin</h1>
      <p class="muted">Sign in to manage your stores</p>
      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
      <div class="field">
        <label for="email">Email</label>
        <InputText id="email" v-model="email" type="email" autocomplete="username" autofocus required />
      </div>
      <div class="field">
        <label for="password">Password</label>
        <Password v-model="password" input-id="password" :feedback="false" toggle-mask fluid autocomplete="current-password" required />
      </div>
      <Button type="submit" label="Sign in" :loading="loading" class="w-full" />
    </form>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px;
  background: radial-gradient(circle at 20% 10%, #1c3b6e 0, var(--sidebar) 55%); }
.box { width: 100%; max-width: 380px; display: grid; gap: 14px; padding: 32px; }
.logo { width: 48px; height: 48px; border-radius: 12px; background: var(--p-primary-color); color: #fff; display: grid; place-items: center; font-size: 22px; }
h1 { margin: 6px 0 0; font-size: 24px; }
p { margin: 0 0 6px; }
</style>
