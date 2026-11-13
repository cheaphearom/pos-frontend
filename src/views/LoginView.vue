<script setup lang="ts">
import LangSwitch from '@/components/LangSwitch.vue';
import TouchKeyboard from '@/components/TouchKeyboard.vue';
import KeyboardToggle from '@/components/KeyboardToggle.vue';
import { useDark } from '@/composables/useDark';
import { useTouchKeyboard } from '@/composables/useTouchKeyboard';
import { computed, nextTick, ref } from 'vue';
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
const dark = useDark();

// On-screen keyboard (touchscreen tills): types into the email or password box, whichever was tapped last
const touch = useTouchKeyboard();
const field = ref<'email' | 'password'>('email');
const kbOpen = ref(true);
const typed = computed({
  get: () => (field.value === 'email' ? email.value : password.value),
  set: (v: string) => (field.value === 'email' ? (email.value = v) : (password.value = v)),
});
function focusField(f: 'email' | 'password') {
  field.value = f;
  kbOpen.value = true;
}
function kbEnter() {
  if (field.value === 'email') {
    field.value = 'password';
    nextTick(() => document.getElementById('password')?.focus());
  } else submit();
}

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
    <aside class="brand">
      <div class="brand-top"><div class="logo"><i class="pi pi-shopping-bag" /></div><span>POS</span></div>
      <div class="brand-mid">
        <div class="kh">សូមស្វាគមន៍</div>
        <h2>Fresh coffee,<br />fast checkout.</h2>
        <ul>
          <li><i class="pi pi-bolt" /> Sell in seconds, even offline</li>
          <li><i class="pi pi-qrcode" /> KHQR, cash in dollars and riel</li>
          <li><i class="pi pi-chart-line" /> Stock and reports for every store</li>
        </ul>
      </div>
      <div class="brand-foot">© {{ new Date().getFullYear() }} · Point of sale</div>
    </aside>

    <main class="side">
      <form class="box" @submit.prevent="submit">
        <div class="top">
          <div class="logo small"><i class="pi pi-shopping-bag" /></div>
          <div class="tools">
            <KeyboardToggle @changed="kbOpen = true" />
            <Button :icon="dark ? 'pi pi-sun' : 'pi pi-moon'" severity="secondary" text rounded size="small" :aria-label="dark ? 'Light mode' : 'Dark mode'" @click="dark = !dark" />
            <LangSwitch />
          </div>
        </div>
        <div>
          <h1>Welcome back</h1>
          <p class="muted">Sign in to manage your stores</p>
        </div>
        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
        <div class="field">
          <label for="email">Email</label>
          <IconField>
            <InputIcon class="pi pi-envelope" />
            <InputText id="email" v-model="email" type="email" autocomplete="username" placeholder="you@example.com" autofocus required fluid
              :inputmode="touch ? 'none' : 'email'" :class="{ active: touch && field === 'email' }" @focus="focusField('email')" @click="focusField('email')" />
          </IconField>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <Password v-model="password" input-id="password" :feedback="false" toggle-mask fluid autocomplete="current-password" placeholder="Your password" required
            :input-props="{ inputmode: touch ? 'none' : 'text' }" :input-class="{ active: touch && field === 'password' }" @focus="focusField('password')" @click="focusField('password')" />
        </div>
        <Button type="submit" label="Sign in" icon="pi pi-arrow-right" icon-pos="right" :loading="loading" class="w-full signin" />
      </form>
      <TouchKeyboard v-if="touch && kbOpen" v-model="typed" class="kb" :enter-label="field === 'email' ? 'Next' : 'Sign in'" @enter="kbEnter" @close="kbOpen = false" />
    </main>
  </div>
</template>

<style scoped>
.login { min-height: 100vh; display: grid; grid-template-columns: minmax(360px, 5fr) 6fr; background: var(--bg); }

/* Left: coffee panel */
.brand {
  display: flex; flex-direction: column; justify-content: space-between; padding: 40px 48px; color: #fff8ef;
  background:
    radial-gradient(circle at 85% 15%, rgba(255, 220, 170, .22) 0, transparent 40%),
    radial-gradient(circle at 10% 90%, rgba(0, 0, 0, .25) 0, transparent 45%),
    linear-gradient(150deg, #a8703f 0%, #8b5a33 45%, #4a2f1c 100%);
}
.brand-top { display: flex; align-items: center; gap: 12px; font-weight: 800; letter-spacing: .14em; }
.brand-mid h2 { font-size: clamp(30px, 3.4vw, 46px); line-height: 1.1; margin: 8px 0 26px; font-weight: 800; }
.brand .kh { font-size: 22px; font-weight: 700; color: #ffd9a8; font-family: 'Khmer UI', 'Noto Sans Khmer', 'Kantumruy Pro', sans-serif; }
.brand ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; font-size: 16px; }
.brand li { display: flex; align-items: center; gap: 12px; }
.brand li i { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: rgba(255, 255, 255, .14); font-size: 15px; }
.brand-foot { font-size: 13px; opacity: .7; }

/* Right: form on cream */
.side { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 32px 24px; }
.kb { width: 100%; max-width: 680px; }
.tools { display: flex; align-items: center; gap: 4px; }
:deep(.active) { border-color: var(--p-primary-color) !important; box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 22%, transparent) !important; }
.box { width: 100%; max-width: 400px; display: grid; gap: 16px; padding: 34px; border-radius: 20px; background: var(--surface); border: 1px solid var(--border);
  box-shadow: 0 2px 6px rgba(60, 35, 15, .05), 0 18px 40px rgba(60, 35, 15, .08); }
.top { display: flex; justify-content: space-between; align-items: center; }
.logo { width: 44px; height: 44px; border-radius: 12px; background: rgba(255, 255, 255, .18); color: #fff; display: grid; place-items: center; font-size: 19px; }
.logo.small { background: linear-gradient(135deg, #8b5a33, #c8893f); box-shadow: 0 6px 16px rgba(139, 90, 51, .3); }
h1 { margin: 0; font-size: 26px; }
p { margin: 4px 0 0; }
.signin { padding: 12px; font-size: 16px; font-weight: 700; margin-top: 4px; }

/* Phones and small tablets: no side panel */
@media (max-width: 860px) {
  .login { grid-template-columns: 1fr; }
  .brand { display: none; }
  .side { justify-content: flex-start; padding-top: 10vh; background: linear-gradient(180deg, color-mix(in srgb, var(--p-primary-color) 14%, var(--bg)) 0, var(--bg) 220px); }
  .box { padding: 26px 22px; }
}
</style>
