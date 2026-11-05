<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { mem, memberSession, money, setMemberSession } from '@/online/memberApi';

const router = useRouter();
const me = ref<any>(null);
const form = reactive({ name: '', email: '' });
const busy = ref(false);
const msg = ref('');
const error = ref('');

onMounted(async () => {
  document.title = 'My profile';
  me.value = await mem('/member/me');
  form.name = me.value.name;
  form.email = me.value.email ?? '';
});

async function save() {
  busy.value = true; msg.value = ''; error.value = '';
  try {
    me.value = await mem('/member/me', { method: 'PATCH', body: { name: form.name.trim(), email: form.email.trim() || undefined } });
    if (memberSession.s) setMemberSession({ ...memberSession.s, name: me.value.name });
    msg.value = 'Saved';
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
function logout() {
  setMemberSession(null);
  router.replace('/m/login');
}
async function logoutAll() {
  if (!confirm('Log out on all phones, including this one?')) return;
  await mem('/member/logout-all', { method: 'POST', body: {} }).catch(() => undefined);
  logout();
}
</script>

<template>
  <div class="prof">
    <h2>Me</h2>
    <section v-if="me" class="card stats">
      <div><span class="small muted">Member no.</span><b>{{ me.code }}</b></div>
      <div><span class="small muted">Phone</span><b>{{ me.phone }}</b></div>
      <div><span class="small muted">Visits</span><b>{{ me.visitCount }}</b></div>
      <div><span class="small muted">Total spent</span><b>{{ money(me.totalSpent) }}</b></div>
    </section>
    <form v-if="me" class="card fields" @submit.prevent="save">
      <label for="p-name">Name</label>
      <InputText id="p-name" v-model="form.name" maxlength="150" />
      <label for="p-email">Email <span class="small muted">(optional)</span></label>
      <InputText id="p-email" v-model="form.email" type="email" maxlength="150" />
      <Message v-if="msg" severity="success" :closable="false" size="small">{{ msg }}</Message>
      <Message v-if="error" severity="error" :closable="false" size="small">{{ error }}</Message>
      <Button type="submit" label="Save" :loading="busy" :disabled="!form.name.trim()" />
    </form>
    <Button label="Log out" icon="pi pi-sign-out" severity="secondary" outlined @click="logout" />
    <Button label="Lost your phone? Log out on all phones" text size="small" severity="danger" @click="logoutAll" />
  </div>
</template>

<style scoped>
.prof { display: grid; gap: 12px; }
h2 { margin: 0; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.stats div { display: grid; gap: 2px; }
.fields { display: grid; gap: 8px; }
label { font-weight: 600; }
</style>
