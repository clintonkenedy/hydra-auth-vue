<template>
  <div
    class="hydra-auth-screen"
    :class="`hydra-auth-screen--${variant}`"
    :style="cssVars"
  >
    <div class="hydra-auth-card">
      <img
        v-if="branding.logo"
        class="hydra-auth-logo"
        :src="branding.logo"
        alt="Logo"
      />
      <h2 v-if="branding.title" class="hydra-auth-title">{{ branding.title }}</h2>
      <div
        v-if="variant === 'loading'"
        class="hydra-auth-spinner"
        aria-hidden="true"
      ></div>
      <div class="hydra-auth-content">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup>
import { getActiveContext } from '../store.js'
import { brandingCssVars, resolveBranding } from '../branding.js'

// Shared layout for the package-owned auth screens, replicating the look of
// the municipal IdP login page (centered white screen, 24rem column, logo,
// bold title, brand-colored primary button).
defineProps({
  variant: {
    type: String,
    default: 'info',
    validator: (value) => ['info', 'error', 'loading'].includes(value),
  },
})

let context = null
try {
  context = getActiveContext()
} catch {
  // Standalone mount without createHydraAuth(): fall back to defaults.
}
const branding = resolveBranding(context)
const cssVars = brandingCssVars(branding)
</script>

<style scoped>
.hydra-auth-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 0 1.5rem;
  background-color: #ffffff;
  font-family: var(--hydra-font-family);
  color: #374151;
}

.hydra-auth-card {
  width: 100%;
  max-width: 24rem;
  margin: 0 auto;
  text-align: center;
}

.hydra-auth-logo {
  display: block;
  margin: 0 auto;
  height: 12.5rem;
  width: auto;
}

.hydra-auth-title {
  margin: 2.5rem 0 0;
  font-size: 1.5rem;
  line-height: 2rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: #111827;
}

.hydra-auth-content {
  margin-top: 1.5rem;
}

.hydra-auth-content :slotted(p) {
  margin: 0 0 0.75rem;
  color: #374151;
}

.hydra-auth-content :slotted(.hydra-auth-message) {
  font-size: 1.0625rem;
  font-weight: 600;
  color: #111827;
}

.hydra-auth-screen--error .hydra-auth-content :slotted(.hydra-auth-message),
.hydra-auth-screen--error .hydra-auth-content :slotted(p:first-child) {
  color: #b91c1c;
  font-weight: 600;
}

.hydra-auth-content :slotted(.hydra-auth-muted) {
  font-size: 0.875rem;
  color: #6b7280;
}

/* Primary button, mirroring the reference login button:
   w-full / rounded-lg / px-4 py-3 / font-semibold / brand colors. */
.hydra-auth-content :slotted(.hydra-btn-primary) {
  width: 100%;
  margin-top: 1.5rem;
  background-color: var(--hydra-primary);
  color: #ffffff;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
}

.hydra-auth-content :slotted(.hydra-btn-primary:hover) {
  background-color: var(--hydra-primary-hover);
}

.hydra-auth-content :slotted(.hydra-btn-primary:focus),
.hydra-auth-content :slotted(.hydra-btn-primary:active) {
  background-color: var(--hydra-primary-active);
}

.hydra-auth-content :slotted(.hydra-btn-primary:focus-visible) {
  outline: 2px solid var(--hydra-primary-active);
  outline-offset: 2px;
}

.hydra-auth-spinner {
  margin: 1.5rem auto 0;
  width: 2.5rem;
  height: 2.5rem;
  border: 3px solid #e5e7eb;
  border-top-color: var(--hydra-primary);
  border-radius: 50%;
  animation: hydra-auth-spin 0.8s linear infinite;
}

@keyframes hydra-auth-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hydra-auth-spinner {
    animation: none;
  }
}
</style>
