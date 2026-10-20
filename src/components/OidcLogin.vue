<template>
  <div class="hydra-auth-login">
    <p>Redirigiendo al inicio de sesión…</p>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useHydraAuth } from '../store.js'

const auth = useHydraAuth()

onMounted(() => {
  auth.login()
})
</script>
