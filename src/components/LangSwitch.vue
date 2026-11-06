<script setup lang="ts">
/** ខ្មែរ / English switch. The choice is kept on this device (and followed by the customer display). */
import { lang, setLang } from '@/i18n';
</script>

<template>
  <button type="button" class="lang" data-no-i18n :aria-label="lang === 'km' ? 'Switch to English' : 'ប្តូរទៅភាសាខ្មែរ'" @click="setLang(lang === 'km' ? 'en' : 'km')">
    {{ lang === 'km' ? 'EN' : 'ខ្មែរ' }}
  </button>
</template>

<style scoped>
.lang { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.lang:hover { border-color: var(--p-primary-color); color: var(--p-primary-color); }
</style>
