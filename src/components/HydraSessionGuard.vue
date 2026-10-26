<template>
  <div
    v-if="sessionWarning === 'idle'"
    class="hydra-session-overlay"
    role="dialog"
    aria-modal="true"
    :style="cssVars"
  >
    <div class="hydra-session-card">
      <p class="hydra-session-title">Tu sesión está por cerrarse</p>
      <p class="hydra-session-text">{{ idleCountdownText }}</p>
      <div class="hydra-session-actions">
        <button type="button" class="hydra-btn-primary" @click="stay">
          Seguir conectado
        </button>
        <button type="button" class="hydra-btn-secondary" @click="exitNow">
          Salir
        </button>
      </div>
    </div>
  </div>
  <div
    v-else-if="sessionWarning === 'max' && !maxNoticeDismissed"
    class="hydra-session-notice"
    role="alert"
    :style="cssVars"
  >
    <span>Tu sesión vence en 5 min, guardá lo que estés haciendo</span>
    <button
      type="button"
      class="hydra-session-notice-btn"
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
import { brandingCssVars, resolveBranding } from '../branding.js'

// Renders the idle-warning modal (S2) and the max-session notice (S4), and
// redirects to the login route after an automatic close (S6). Mount it once
// in the authenticated layout.
const store = useHydraAuth()
const router = useRouter()
const { sessionWarning, idleExpiresAt, closeRedirectPending, closedReason } = storeToRefs(store)

let context = null
try {
  context = getActiveContext()
} catch {
  // Standalone mount without createHydraAuth(): fall back to defaults.
}
const cssVars = brandingCssVars(resolveBranding(context))

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

<style scoped>
.hydra-session-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.5);
  font-family: var(--hydra-font-family);
}

.hydra-session-card {
  background-color: #ffffff;
  color: #111827;
  border-radius: 0.75rem;
  padding: 1.5rem;
  max-width: 360px;
  width: 90%;
  text-align: center;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  font-size: 15px;
}

.hydra-session-title {
  font-weight: 600;
  font-size: 17px;
  margin: 0 0 8px;
}

.hydra-session-text {
  margin: 0 0 16px;
  color: #374151;
}

.hydra-session-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.hydra-btn-primary {
  background-color: var(--hydra-primary);
  color: #ffffff;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  border: none;
  border-radius: 0.5rem;
  padding: 0.625rem 1rem;
  cursor: pointer;
}

.hydra-btn-primary:hover {
  background-color: var(--hydra-primary-hover);
}

.hydra-btn-primary:focus,
.hydra-btn-primary:active {
  background-color: var(--hydra-primary-active);
}

.hydra-btn-primary:focus-visible {
  outline: 2px solid var(--hydra-primary-active);
  outline-offset: 2px;
}

.hydra-btn-secondary {
  background-color: #ffffff;
  color: #b91c1c;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  border: 1px solid #b91c1c;
  border-radius: 0.5rem;
  padding: 0.625rem 1rem;
  cursor: pointer;
}

.hydra-btn-secondary:hover {
  background-color: #fef2f2;
}

.hydra-btn-secondary:focus-visible {
  outline: 2px solid #b91c1c;
  outline-offset: 2px;
}

.hydra-session-notice {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 12px;
  background-color: #fef3c7;
  color: #92400e;
  border: 1px solid #f59e0b;
  border-radius: 0.75rem;
  padding: 10px 16px;
  font-size: 14px;
  font-family: var(--hydra-font-family);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.hydra-session-notice-btn {
  background-color: transparent;
  color: #92400e;
  font-family: inherit;
  border: 1px solid #92400e;
  border-radius: 0.5rem;
  padding: 4px 10px;
  cursor: pointer;
}
</style>
