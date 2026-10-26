<template>
  <div class="hydra-auth-login">
    <p v-if="closeMessage">{{ closeMessage }}</p>
    <p v-else>Redirigiendo al inicio de sesión…</p>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useHydraAuth } from '../store.js'

// Messages shown when the session was closed automatically (S6). The reason
// comes from the `?reason=idle|max` query param or from `closedReason` in the
// store; without a reason the component keeps the previous behavior and
// starts the login redirect immediately.
const CLOSE_MESSAGES = {
  idle: 'Tu sesión se cerró por inactividad',
  max: 'Tu sesión se cerró por tiempo máximo',
}
// How long the close-reason message stays visible before login().
const MESSAGE_MS = 2500

const auth = useHydraAuth()
const route = useRoute()
const reason = route?.query?.reason ?? auth.closedReason
const closeMessage = CLOSE_MESSAGES[reason] ?? null

let timer = null
onMounted(() => {
  if (closeMessage) {
    timer = setTimeout(() => auth.login(), MESSAGE_MS)
  } else {
    auth.login()
  }
})
onBeforeUnmount(() => {
  if (timer != null) clearTimeout(timer)
})
</script>
