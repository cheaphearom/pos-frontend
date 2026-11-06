<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useApp } from './stores/app';
const app = useApp();
const route = useRoute();
/** On the POS, messages appear bottom-left over the products, never over the cart and the Pay button. */
const toastPos = computed(() => (route.path === '/pos' ? 'bottom-left' : 'top-right'));
</script>

<template>
  <Toast :position="toastPos" />
  <ConfirmDialog />
  <!-- The POS screen reloads its product list when the store changes -->
  <RouterView v-slot="{ Component, route }">
    <component :is="Component" :key="route.path === '/pos' ? `pos:${app.currentStoreId}` : 'app'" />
  </RouterView>
</template>
