<template>
  <div class="hydra-auth-callback">
    <div v-if="error">
      <p>No se pudo completar el inicio de sesión.</p>
      <button type="button" @click="run">Reintentar</button>
    </div>
    <p v-else>Procesando login…</p>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useHydraAuth, getActiveContext } from '../store.js'

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
