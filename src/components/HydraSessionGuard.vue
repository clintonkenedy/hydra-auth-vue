<template>
  <div
    v-if="sessionWarning === 'idle'"
    role="dialog"
    aria-modal="true"
    :style="{
      position: 'fixed',
      inset: '0',
      zIndex: '9999',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
    }"
  >
    <div
      :style="{
        backgroundColor: '#ffffff',
        color: '#111827',
        borderRadius: '8px',
        padding: '24px',
        maxWidth: '360px',
        width: '90%',
        textAlign: 'center',
        boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
        fontSize: '15px',
      }"
    >
      <p :style="{ fontWeight: '600', fontSize: '17px', margin: '0 0 8px' }">
        Tu sesión está por cerrarse
      </p>
      <p :style="{ margin: '0 0 16px' }">{{ idleCountdownText }}</p>
      <div :style="{ display: 'flex', gap: '8px', justifyContent: 'center' }">
        <button
          type="button"
          :style="{
            backgroundColor: '#1d4ed8',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '8px 16px',
            cursor: 'pointer',
          }"
          @click="stay"
        >
          Seguir conectado
        </button>
        <button
          type="button"
          :style="{
            backgroundColor: '#ffffff',
            color: '#b91c1c',
            border: '1px solid #b91c1c',
            borderRadius: '6px',
            padding: '8px 16px',
            cursor: 'pointer',
          }"
          @click="exitNow"
        >
          Salir
        </button>
      </div>
    </div>
  </div>
  <div
    v-else-if="sessionWarning === 'max' && !maxNoticeDismissed"
    role="alert"
    :style="{
      position: 'fixed',
      bottom: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '9999',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      backgroundColor: '#fef3c7',
      color: '#92400e',
      border: '1px solid #f59e0b',
      borderRadius: '8px',
      padding: '10px 16px',
      fontSize: '14px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    }"
  >
    <span>Tu sesión vence en 5 min, guardá lo que estés haciendo</span>
    <button
      type="button"
      :style="{
        backgroundColor: 'transparent',
        color: '#92400e',
        border: '1px solid #92400e',
        borderRadius: '6px',
        padding: '4px 10px',
        cursor: 'pointer',
      }"
      @click="maxNoticeDismissed = true"
    >
      Entendido
    </button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { getActiveContext, useHydraAuth } from '../store.js'

// Renders the idle-warning modal (S2) and the max-session notice (S4), and
// redirects to the login route after an automatic close (S6). Mount it once
// in the authenticated layout.
const store = useHydraAuth()
const router = useRouter()
const { sessionWarning, idleExpiresAt, closeRedirectPending, closedReason } = storeToRefs(store)

// "Entendido" only hides the max-session notice — no extension (S4).
const maxNoticeDismissed = ref(false)
watch(sessionWarning, (warning) => {
  if (warning !== 'max') maxNoticeDismissed.value = false
})

// Local clock driving the "Por inactividad, en M:SS" countdown.
const timeNow = ref(Date.now())
let ticker = null
onMounted(() => {
  ticker = setInterval(() => {
    timeNow.value = Date.now()
  }, 500)
})
onBeforeUnmount(() => {
  if (ticker != null) clearInterval(ticker)
})

const idleCountdownText = computed(() => {
  const remaining = Math.max(0, (idleExpiresAt.value ?? 0) - timeNow.value)
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  return `Por inactividad, en ${minutes}:${String(seconds).padStart(2, '0')}`
})

function stay() {
  store.stayConnected()
}

function exitNow() {
  store.closeSession('idle')
}

// After closeSession() (this tab or broadcast from another one), redirect to
// the configured login route with the close reason as a query param.
watch(
  closeRedirectPending,
  (pending) => {
    if (!pending) return
    store.closeRedirectPending = false
    if (!router) return
    const ctx = getActiveContext()
    const reason = closedReason.value
    router.replace({ path: ctx.routes.login, query: reason ? { reason } : {} })
  },
  { immediate: true },
)
</script>
