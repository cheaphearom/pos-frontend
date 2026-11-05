<script setup lang="ts">
import { useApp } from './stores/app';
const app = useApp();
</script>

<template>
  <Toast />
  <ConfirmDialog />
  <!-- The POS screen reloads its product list when the store changes -->
  <RouterView v-slot="{ Component, route }">
    <component :is="Component" :key="route.path === '/pos' ? `pos:${app.currentStoreId}` : 'app'" />
  </RouterView>
</template>
