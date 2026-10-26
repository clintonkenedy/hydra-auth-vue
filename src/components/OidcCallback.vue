<template>
  <HydraAuthScreen :variant="error ? 'error' : 'loading'">
    <template v-if="error">
      <p class="hydra-auth-message">No se pudo completar el inicio de sesión.</p>
      <button type="button" class="hydra-btn-primary" @click="run">Reintentar</button>
    </template>
    <p v-else>Procesando inicio de sesión…</p>
  </HydraAuthScreen>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useHydraAuth, getActiveContext } from '../store.js'
import HydraAuthScreen from './HydraAuthScreen.vue'

const auth = useHydraAuth()
const router = useRouter()
const error = ref(false)

async function run() {
  error.value = false
  try {
    const ctx = getActiveContext()
    await auth.signinCallback()
    await auth.fetchProfile()
    const target = ctx.storage.getItem('redirectToAfterLogin') ?? '/'
    ctx.storage.removeItem('redirectToAfterLogin')
    router.replace(target)
  } catch (err) {
    console.error('[hydra-auth-vue] signin callback failed', err)
    error.value = true
  }
}

onMounted(run)
</script>
