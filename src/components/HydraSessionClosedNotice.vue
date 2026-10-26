<template>
  <div v-if="visible" class="hydra-closed-notice" role="status" :style="cssVars">
    <svg
      class="hydra-closed-notice-icon"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fill-rule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-2 3a1 1 0 0 1 2 0v4a1 1 0 1 1-2 0v-4Z"
        clip-rule="evenodd"
      />
    </svg>
    <span class="hydra-closed-notice-text">{{ message }}</span>
    <button
      type="button"
      class="hydra-closed-notice-close"
      aria-label="Cerrar aviso"
      @click="dismiss"
    >
      ×
    </button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getActiveContext } from '../store.js'
import { brandingCssVars, resolveBranding } from '../branding.js'

// Branded toast shown on the public/landing page after an automatic session
// close (closeRedirect: 'home'). Reads `?session_closed=idle|max` (also
// `?reason=` for backward compat) and renders nothing for missing/unknown
// values. Dismiss (or auto-hide after 8 s) hides it; dismissing also removes
// the query param from the URL, keeping the other params.
const MESSAGES = {
  idle: 'Tu sesión se cerró por inactividad',
  max: 'Tu sesión se cerró por tiempo máximo',
}
const AUTO_HIDE_MS = 8000

const route = useRoute()
const router = useRouter()

let context = null
try {
  context = getActiveContext()
} catch {
  // Standalone mount without createHydraAuth(): fall back to defaults.
}
const cssVars = brandingCssVars(resolveBranding(context))

const reason = route?.query?.session_closed ?? route?.query?.reason ?? null
const message = MESSAGES[reason] ?? null
const dismissed = ref(false)
const visible = computed(() => message != null && !dismissed.value)

let hideTimer = null
onMounted(() => {
  if (message == null) return
  hideTimer = setTimeout(() => {
    dismissed.value = true
  }, AUTO_HIDE_MS)
})
onBeforeUnmount(() => {
  if (hideTimer != null) clearTimeout(hideTimer)
})

function dismiss() {
  dismissed.value = true
  if (hideTimer != null) clearTimeout(hideTimer)
  if (!router || !route) return
  // Drop the close-reason params, keep everything else in the URL.
  const { session_closed: _closed, reason: _reason, ...rest } = route.query ?? {}
  router.replace({ query: rest })
}
</script>

<style scoped>
.hydra-closed-notice {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 28rem;
  width: calc(100% - 32px);
  background-color: #ffffff;
  color: #111827;
  border: 1px solid #e5e7eb;
  border-radius: 0.75rem;
  padding: 12px 14px;
  font-size: 14px;
  font-family: var(--hydra-font-family);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.12);
}

.hydra-closed-notice-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  color: var(--hydra-primary);
}

.hydra-closed-notice-text {
  flex: 1;
}

.hydra-closed-notice-close {
  flex-shrink: 0;
  background-color: transparent;
  color: #6b7280;
  font-family: inherit;
  font-size: 18px;
  line-height: 1;
  border: none;
  border-radius: 0.375rem;
  padding: 2px 6px;
  cursor: pointer;
}

.hydra-closed-notice-close:hover {
  color: #111827;
}

.hydra-closed-notice-close:focus-visible {
  outline: 2px solid var(--hydra-primary-active);
  outline-offset: 2px;
}
</style>
