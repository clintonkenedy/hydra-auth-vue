import { defineStore, storeToRefs } from 'pinia'
import { computed } from 'vue'
import axios from 'axios'
import {
  isRetriableProfileError,
  readProfileCache,
  removeProfileCache,
  startProfileRetry,
  stopProfileRetry,
  writeProfileCache,
} from './profileCache.js'
import {
  broadcastSessionEvent,
  clearSessionState,
  createSessionTimeouts,
} from './sessionTimeouts.js'

let activeContext = null
let storeDefinition = null

/**
 * Bind the store to an auth context. Called by `createHydraAuth()`.
 */
export function setActiveContext(context) {
  activeContext = context
  // Re-create the store definition so persistence storage follows the context.
  storeDefinition = null
}

export function getActiveContext() {
  if (!activeContext) {
    throw new Error(
      '[hydra-auth-vue] No active auth context. Call createHydraAuth(options) first.',
    )
  }
  return activeContext
}

function defineHydraAuthStore(context) {
  return defineStore('hydraAuth', {
    state: () => ({
      user: null,
      id: null,
      name: null,
      email: null,
      alias: null,
      roles: null,
      permisos: null,
      userLoaded: false,
      // True while the profile shown comes from the last-known-profile cache
      // because the core API was unreachable.
      profileDegraded: false,
      // Epoch ms of the moment the applied profile was actually fetched.
      profileFetchedAt: null,
      // Epoch ms when the maximum session ends (null when disabled/stopped).
      sessionExpiresAt: null,
      // Epoch ms when the inactivity window ends (null when disabled/stopped).
      idleExpiresAt: null,
      // 'idle' | 'max' | null — which session warning is currently active.
      sessionWarning: null,
      // 'idle' | 'max' | null — why the session was closed automatically.
      closedReason: null,
      // Internal: true right after closeSession() until HydraSessionGuard
      // performs the redirect to the login route.
      closeRedirectPending: false,
    }),
    getters: {
      hasPermission: (state) => (permission) => state.permisos?.includes(permission),
      hasRole: (state) => (role) => state.roles?.includes(role),
      isAuthenticated: (state) => !!state.user,
    },
    actions: {
      async loadUser() {
        const ctx = getActiveContext()
        this.user = await ctx.userManager.getUser()
        this.userLoaded = true
        if (this.user) this.startSessionTimeouts()
        return this.user
      },
      async login() {
        const ctx = getActiveContext()
        await ctx.userManager.signinRedirect()
      },
      async logout() {
        const ctx = getActiveContext()
        this.stopSessionTimeouts()
        stopProfileRetry(ctx)
        // Explicit logout keeps removing the last-profile cache and
        // broadcasts so the other tabs close too.
        broadcastSessionEvent(ctx, 'logout')
        clearSessionState(ctx)
        removeProfileCache(ctx, this.user?.profile?.sub)
        ctx.clearToken()
        this.clearUser()
        this.user = null
        this.userLoaded = false
        this.profileDegraded = false
        this.profileFetchedAt = null
        await ctx.userManager.signoutRedirect()
      },
      async signinCallback() {
        const ctx = getActiveContext()
        const user = await ctx.userManager.signinRedirectCallback()
        this.user = user
        this.userLoaded = true
        ctx.setToken(user)
        this.closedReason = null
        this.closeRedirectPending = false
        // A redirect callback is always a fresh sign-in: drop any session start
        // or last activity left by a previous session (e.g. a tab closed
        // without logout yesterday) so the new session is measured from now.
        clearSessionState(ctx)
        this.startSessionTimeouts()
        return user
      },
      /**
       * Start the idle/max-session timers for the current user (no-op when
       * both timeouts are disabled or the timers already run). S10: timers
       * only run while there is an authenticated user.
       */
      startSessionTimeouts() {
        const ctx = getActiveContext()
        if (!this.user || ctx.sessionTimeoutsController) return
        const controller = createSessionTimeouts(ctx, {
          onState: ({ idleExpiresAt, sessionExpiresAt, warning }) => {
            this.idleExpiresAt = idleExpiresAt
            this.sessionExpiresAt = sessionExpiresAt
            this.sessionWarning = warning
          },
          onExpire: (reason) => {
            this.closeSession(reason)
          },
          onRemoteClose: (event) => {
            // A close/logout broadcast from another tab closes this one
            // without re-broadcasting (no storm).
            const reason = event.type === 'close' ? (event.reason ?? null) : null
            this.closeSession(reason, { broadcast: false })
          },
        })
        if (!controller) return
        ctx.sessionTimeoutsController = controller
        controller.start(this.user)
      },
      stopSessionTimeouts() {
        const ctx = getActiveContext()
        ctx.sessionTimeoutsController?.stop()
        ctx.sessionTimeoutsController = null
        this.sessionWarning = null
        this.idleExpiresAt = null
        this.sessionExpiresAt = null
      },
      /**
       * "Seguir conectado": reset the inactivity window and hide the warning.
       */
      stayConnected() {
        const ctx = getActiveContext()
        ctx.sessionTimeoutsController?.stayConnected()
        this.sessionWarning = null
      },
      /**
       * Automatic session close (idle/max or "Salir"). Unlike logout() it
       * never calls Hydra end-session (no signoutRedirect) and never removes
       * the last-profile cache (`hydraAuth.profile:<sub>`), so the SPA can
       * still start in degraded mode after re-login.
       */
      async closeSession(reason = null, { broadcast = true } = {}) {
        const ctx = getActiveContext()
        this.stopSessionTimeouts()
        stopProfileRetry(ctx)
        if (broadcast) broadcastSessionEvent(ctx, 'close', reason)
        clearSessionState(ctx)
        ctx.userManager.stopSilentRenew?.()
        await ctx.userManager.removeUser?.()
        ctx.clearToken()
        this.clearUser()
        this.user = null
        this.userLoaded = false
        this.profileDegraded = false
        this.profileFetchedAt = null
        this.closedReason = reason
        this.closeRedirectPending = true
      },
      async fetchProfile() {
        const ctx = getActiveContext()
        const token = ctx.getToken()
        const sub = this.user?.profile?.sub
        try {
          const response = await axios.get(`${ctx.coreApiUrl}/api/user`, {
            headers: token ? { Authorization: token } : {},
          })
          this.setUser(response.data)
          this.profileDegraded = false
          this.profileFetchedAt = Date.now()
          stopProfileRetry(ctx)
          writeProfileCache(ctx, sub, response.data)
          return response.data
        } catch (error) {
          // Fall back to the last known profile only for availability
          // failures (network/timeout/5xx). Any 4xx rethrows exactly as
          // before — 401 invalid_token keeps the existing re-login path.
          if (!isRetriableProfileError(error)) throw error
          const cached = readProfileCache(ctx, sub)
          if (!cached) throw error
          this.setUser(cached.profile)
          this.profileDegraded = true
          this.profileFetchedAt = cached.fetchedAt
          startProfileRetry(ctx, () => {
            this.fetchProfile().catch(() => {
              // Still down: stay degraded and keep retrying.
            })
          })
          return cached.profile
        }
      },
      setUser(payload) {
        if (payload.user.id) this.id = payload.user.id
        if (payload.user.name) this.name = payload.user.name
        if (payload.user.email) this.email = payload.user.email
        if (payload.user.alias) this.alias = payload.user.alias
        if (payload.permisos) this.permisos = payload.permisos
        if (payload.roles) this.roles = payload.roles
      },
      clearUser() {
        this.id = null
        this.name = null
        this.email = null
        this.alias = null
        this.roles = null
        this.permisos = null
      },
    },
    // Picked up by pinia-plugin-persistedstate when the consumer installs it;
    // ignored otherwise (feature detection by convention, no hard dependency).
    persist: {
      key: 'hydraAuth',
      storage: context.storage,
    },
  })
}

/**
 * Pinia store for the Hydra/OIDC session (id: `hydraAuth`).
 */
export function useHydraAuth(pinia) {
  const context = getActiveContext()
  if (!storeDefinition) {
    storeDefinition = defineHydraAuthStore(context)
  }
  return storeDefinition(pinia)
}

/**
 * Convenience composable over the store.
 */
export function useAuth() {
  const store = useHydraAuth()
  const {
    user,
    roles,
    permisos,
    profileDegraded,
    profileFetchedAt,
    sessionExpiresAt,
    idleExpiresAt,
    sessionWarning,
    closedReason,
  } = storeToRefs(store)
  return {
    user,
    roles,
    permisos,
    profileDegraded,
    profileFetchedAt,
    sessionExpiresAt,
    idleExpiresAt,
    sessionWarning,
    closedReason,
    hasPermission: (permission) => store.hasPermission(permission),
    hasRole: (role) => store.hasRole(role),
    isAuthenticated: computed(() => store.isAuthenticated),
    login: () => store.login(),
    logout: () => store.logout(),
    stayConnected: () => store.stayConnected(),
    closeSession: (reason) => store.closeSession(reason),
  }
}
