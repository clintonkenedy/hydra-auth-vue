import { defineStore, storeToRefs } from 'pinia'
import { computed } from 'vue'
import axios from 'axios'

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
        return this.user
      },
      async login() {
        const ctx = getActiveContext()
        await ctx.userManager.signinRedirect()
      },
      async logout() {
        const ctx = getActiveContext()
        ctx.clearToken()
        this.clearUser()
        this.user = null
        this.userLoaded = false
        await ctx.userManager.signoutRedirect()
      },
      async signinCallback() {
        const ctx = getActiveContext()
        const user = await ctx.userManager.signinRedirectCallback()
        this.user = user
        this.userLoaded = true
        ctx.setToken(user)
        return user
      },
      async fetchProfile() {
        const ctx = getActiveContext()
        const token = ctx.getToken()
        const response = await axios.get(`${ctx.coreApiUrl}/api/user`, {
          headers: token ? { Authorization: token } : {},
        })
        this.setUser(response.data)
        return response.data
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
  const { user, roles, permisos } = storeToRefs(store)
  return {
    user,
    roles,
    permisos,
    hasPermission: (permission) => store.hasPermission(permission),
    hasRole: (role) => store.hasRole(role),
    isAuthenticated: computed(() => store.isAuthenticated),
    login: () => store.login(),
    logout: () => store.logout(),
  }
}
