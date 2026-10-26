<template>
  <div
    v-if="profileDegraded"
    role="status"
    :style="{
      backgroundColor: '#fef3c7',
      color: '#92400e',
      border: '1px solid #f59e0b',
      padding: '8px 16px',
      fontSize: '14px',
      textAlign: 'center',
    }"
  >
    Sin conexión con el servicio de usuarios — mostrando tu último perfil.
  </div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useHydraAuth } from '../store.js'

// Renders nothing unless the store is in degraded (cached-profile) mode.
const { profileDegraded } = storeToRefs(useHydraAuth())
</script>
