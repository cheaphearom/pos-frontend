<script setup lang="ts">
/** Member login with phone number + one-time code. New numbers become members. */
import LangSwitch from '@/components/LangSwitch.vue';
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { mem, setMemberSession } from '@/online/memberApi';

const route = useRoute();
document.title = 'Member login';
const router = useRouter();
const step = ref<'phone' | 'code' | 'name'>('phone');
const phone = ref('');
const code = ref('');
const name = ref('');
const busy = ref(false);
const error = ref('');
const devCode = ref('');
const wait = ref(0);
const codeInput = ref<any>(null);
let timer: ReturnType<typeof setInterval> | undefined;

function countdown(s: number) {
  wait.value = s;
  clearInterval(timer);
  timer = setInterval(() => { if (--wait.value <= 0) clearInterval(timer); }, 1000);
}
onBeforeUnmount(() => clearInterval(timer));

async function sendCode() {
  error.value = '';
  if (!phone.value.trim()) { error.value = 'Please enter your phone number'; return; }
  busy.value = true;
  try {
    const r = await mem('/public/member/otp', { body: { phone: phone.value } });
    devCode.value = r.devCode ?? '';
    code.value = '';
    step.value = 'code';
    countdown(45);
    await nextTick();
    codeInput.value?.$el?.focus?.();
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}

async function verify() {
  error.value = '';
  busy.value = true;
  try {
    const r = await mem('/public/member/verify', { body: { phone: phone.value, code: code.value.trim(), name: step.value === 'name' ? name.value.trim() : undefined } });
    if (r.needName) { step.value = 'name'; return; }
    setMemberSession({ token: r.token, ...r.member });
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/m';
    router.replace(next);
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
function onCode() {
  code.value = code.value.replace(/\D/g, '').slice(0, 6);
  if (code.value.length === 6 && !busy.value) verify();
}
</script>

<template>
  <div class="login">
    <div style="display: flex; justify-content: flex-end"><LangSwitch /></div>
    <div class="hero">
      <i class="pi pi-star-fill" />
      <h1>Member</h1>
      <p>Earn points on every drink, pay with your wallet and order ahead.</p>
    </div>

    <form v-if="step === 'phone'" class="card" @submit.prevent="sendCode">
      <label for="m-phone">Phone number</label>
      <InputText id="m-phone" v-model="phone" inputmode="tel" autocomplete="tel" placeholder="012 345 678" maxlength="20" autofocus />
      <p class="hint">We send you a 6-digit code. New number? You become a member.</p>
      <Message v-if="error" severity="error" :closable="false" size="small">{{ error }}</Message>
      <Button type="submit" label="Send code" :loading="busy" class="big" />
    </form>

    <form v-else-if="step === 'code'" class="card" @submit.prevent="verify">
      <label for="m-code">Code sent to {{ phone }}</label>
      <InputText id="m-code" ref="codeInput" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="otp" placeholder="••••••" @input="onCode" />
      <Message v-if="devCode" severity="info" :closable="false" size="small">Test mode (no SMS set up): your code is <b>{{ devCode }}</b></Message>
      <Message v-if="error" severity="error" :closable="false" size="small">{{ error }}</Message>
      <Button type="submit" label="Log in" :loading="busy" :disabled="code.length !== 6" class="big" />
      <div class="row between">
        <Button label="Change number" text size="small" @click="step = 'phone'; error = ''" />
        <Button :label="wait > 0 ? `Resend in ${wait}s` : 'Resend code'" text size="small" :disabled="wait > 0 || busy" @click="sendCode" />
      </div>
    </form>

    <form v-else class="card" @submit.prevent="verify">
      <h3>Welcome! What's your name?</h3>
      <label for="m-name">Name</label>
      <InputText id="m-name" v-model="name" autocomplete="name" maxlength="150" autofocus />
      <Message v-if="error" severity="error" :closable="false" size="small">{{ error }}</Message>
      <Button type="submit" label="Create my membership" :loading="busy" :disabled="!name.trim()" class="big" />
    </form>
  </div>
</template>

<style scoped>
.login { display: grid; gap: 16px; padding-top: 24px; }
.hero { text-align: center; }
.hero i { font-size: 34px; color: #d4a017; }
.hero h1 { margin: 8px 0 4px; }
.hero p { color: var(--text-2); margin: 0; }
.card { display: grid; gap: 10px; }
label { font-weight: 600; }
.hint { font-size: 13px; color: var(--text-2); margin: 0; }
.otp { font-size: 28px; letter-spacing: .4em; text-align: center; }
.big { padding: 14px; font-size: 17px; }
.between { justify-content: space-between; }
h3 { margin: 0; }
</style>
