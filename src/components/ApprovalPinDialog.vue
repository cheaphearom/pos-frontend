<script setup lang="ts">
/** Managers set the PIN they type on a cashier's POS to approve discounts, refunds and voids. */
import { reactive, watch } from 'vue';
import { api } from '@/api/client';
import { useNotify } from '@/composables/useNotify';

const visible = defineModel<boolean>('visible', { required: true });
const notify = useNotify();
const f = reactive({ currentPassword: '', pin: '', pin2: '', busy: false, error: '' });
watch(visible, (v) => v && Object.assign(f, { currentPassword: '', pin: '', pin2: '', busy: false, error: '' }));

async function save(remove = false) {
  f.error = '';
  if (!remove && !/^\d{4,8}$/.test(f.pin)) { f.error = 'The PIN has 4 to 8 digits'; return; }
  if (!remove && f.pin !== f.pin2) { f.error = 'The two PINs are different'; return; }
  f.busy = true;
  try {
    await api.post('/auth/approval-pin', { currentPassword: f.currentPassword, pin: remove ? '' : f.pin });
    notify.success(remove ? 'Approval PIN removed' : 'Approval PIN saved', remove ? '' : 'Type it on a cashier’s POS to approve discounts, refunds and voids');
    visible.value = false;
  } catch (e: any) { f.error = e?.message ?? String(e); } finally { f.busy = false; }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="My approval PIN" :style="{ width: '400px' }" :breakpoints="{ '440px': '96vw' }">
    <form class="form" @submit.prevent="save()">
      <p class="small muted" style="margin: 0">Cashiers ask for it to give a discount above their limit, refund or void a sale. Do not share it.</p>
      <div class="field"><label for="ap-pw">Your password</label><Password v-model="f.currentPassword" input-id="ap-pw" :feedback="false" toggle-mask fluid autocomplete="current-password" /></div>
      <div class="field"><label for="ap-pin">New PIN (4–8 digits)</label><InputText id="ap-pin" v-model="f.pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off" /></div>
      <div class="field"><label for="ap-pin2">Type it again</label><InputText id="ap-pin2" v-model="f.pin2" type="password" inputmode="numeric" maxlength="8" autocomplete="off" /></div>
      <Message v-if="f.error" severity="error" :closable="false" size="small">{{ f.error }}</Message>
      <div class="row" style="justify-content: space-between">
        <Button label="Remove PIN" text severity="danger" size="small" :disabled="!f.currentPassword || f.busy" @click="save(true)" />
        <Button type="submit" label="Save PIN" icon="pi pi-check" :loading="f.busy" :disabled="!f.currentPassword" />
      </div>
    </form>
  </Dialog>
</template>
