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
      fontFamily: branding.fontFamily,
    }"
  >
    Sin conexión con el servicio de usuarios — mostrando tu último perfil.
  </div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { getActiveContext, useHydraAuth } from '../store.js'
import { resolveBranding } from '../branding.js'

// Renders nothing unless the store is in degraded (cached-profile) mode.
const { profileDegraded } = storeToRefs(useHydraAuth())

let context = null
try {
  context = getActiveContext()
} catch {
  // Standalone mount without createHydraAuth(): fall back to defaults.
}
const branding = resolveBranding(context)
</script>
