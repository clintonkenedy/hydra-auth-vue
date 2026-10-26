import { UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { setActiveContext, useHydraAuth } from './store.js'
import { createAttach } from './axios.js'
import { createGuard } from './guard.js'
import { DEFAULT_BRANDING } from './branding.js'

/**
 * Injection key under which the auth context is provided by `install(app)`.
 */
export const HYDRA_AUTH_KEY = Symbol('hydra-auth')

const DEFAULT_SCOPE = 'openid profile email offline_access'
const DEFAULT_ROUTES = { login: '/oidc-login', callback: '/oidc-callback' }
const DEFAULT_PROFILE_CACHE = {
  enabled: true,
  maxAgeSeconds: 86400,
  retrySeconds: 60,
}
const DEFAULT_SESSION_TIMEOUTS = {
  idleTimeoutMinutes: 60,
  idleWarningSeconds: 60,
  maxSessionHours: 10,
  maxSessionWarningMinutes: 5,
}

/**
 * Create the Hydra/OIDC auth plugin.
 *
 * @param {object} options
 * @param {string} options.authority OIDC authority (Hydra public URL).
 * @param {string} options.clientId OIDC client id.
 * @param {string} options.redirectUri Redirect URI (callback route).
 * @param {string} options.postLogoutRedirectUri Post-logout redirect URI.
 * @param {string} [options.scope] Defaults to `openid profile email offline_access`.
 * @param {string} options.coreApiUrl Base URL used to fetch `/api/user`.
 * @param {Storage} [options.storage] Defaults to `window.sessionStorage`.
 * @param {string} [options.tokenStorageKey] Defaults to `token`.
 * @param {object} [options.routes] Defaults to `{ login: '/oidc-login', callback: '/oidc-callback' }`.
 * @param {('home'|'login')} [options.closeRedirect] Where the browser lands after an
 *   automatic session close. `'home'` (default) navigates to `postLogoutRedirectUri`
 *   with `?session_closed=idle|max` (fallback: the router path `/`); `'login'` keeps
 *   the pre-0.5 behavior (`routes.login` with `?reason=idle|max`).
 * @param {boolean} [options.requireAuthByDefault] Treat every route as protected unless `to.meta.public === true`.
 * @param {object} [options.profileCache] Last-known-profile cache used when the core API is unreachable.
 *   Defaults to `{ enabled: true, storage: window.localStorage, maxAgeSeconds: 86400, retrySeconds: 60 }`.
 * @param {number|null} [options.idleTimeoutMinutes] Inactivity timeout (default 60; `0`/`null` disables).
 * @param {number} [options.idleWarningSeconds] Idle warning lead time (default 60).
 * @param {number|null} [options.maxSessionHours] Maximum session length (default 10; `0`/`null` disables).
 * @param {number} [options.maxSessionWarningMinutes] Max-session warning lead time (default 5).
 * @param {object} [options.sessionTimeouts] Advanced overrides for the session timers
 *   (`now` clock and `storage`, defaults `Date.now` / `window.localStorage`).
 * @param {object} [options.branding] Look & feel of the package-owned auth screens.
 *   Defaults to `{ logo: null, title: null, primaryColor: '#00aeee', primaryHoverColor: '#00caee',
 *   primaryActiveColor: '#16759f', fontFamily: <system sans-serif stack> }`.
 * @returns {{ install(app): void, guard(opts): Function, attach(axiosInstance): object, store: Function, userManager: UserManager }}
 */
export function createHydraAuth(options) {
  const {
    authority,
    clientId,
    redirectUri,
    postLogoutRedirectUri,
    scope = DEFAULT_SCOPE,
    coreApiUrl,
    storage = window.sessionStorage,
    tokenStorageKey = 'token',
    routes = DEFAULT_ROUTES,
    closeRedirect = 'home',
    requireAuthByDefault = false,
    profileCache = {},
    idleTimeoutMinutes = DEFAULT_SESSION_TIMEOUTS.idleTimeoutMinutes,
    idleWarningSeconds = DEFAULT_SESSION_TIMEOUTS.idleWarningSeconds,
    maxSessionHours = DEFAULT_SESSION_TIMEOUTS.maxSessionHours,
    maxSessionWarningMinutes = DEFAULT_SESSION_TIMEOUTS.maxSessionWarningMinutes,
    sessionTimeouts = {},
    branding = {},
  } = options

  const profileCacheConfig = {
    ...DEFAULT_PROFILE_CACHE,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    ...profileCache,
  }

  const sessionTimeoutsConfig = {
    idleTimeoutMinutes,
    idleWarningSeconds,
    maxSessionHours,
    maxSessionWarningMinutes,
    // Injectable clock/storage for tests. `now` stays undefined by default so
    // the controller resolves Date.now() lazily (fake-timer friendly).
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    ...sessionTimeouts,
  }

  const userManager = new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: postLogoutRedirectUri,
    response_type: 'code',
    scope,
    automaticSilentRenew: true,
    loadUserInfo: true,
    userStore: new WebStorageStateStore({ store: storage }),
  })

  const context = {
    userManager,
    storage,
    tokenStorageKey,
    coreApiUrl,
    routes,
    closeRedirect,
    postLogoutRedirectUri,
    requireAuthByDefault,
    branding: { ...DEFAULT_BRANDING, ...branding },
    profileCache: profileCacheConfig,
    sessionTimeouts: sessionTimeoutsConfig,
    // Session-timeouts controller (see sessionTimeouts.js); created by the
    // store when a user becomes authenticated, null while stopped.
    sessionTimeoutsController: null,
    // Interval id of the degraded-mode background retry (see store.fetchProfile).
    profileRetryTimer: null,
    // In-memory flag guarding against signinRedirect() loops when
    // expiry / renew-error events (or repeated 401s) fire more than once.
    redirecting: false,
  }

  context.getToken = () => storage.getItem(tokenStorageKey)
  context.setToken = (user) => {
    // Always store the access_token (never the id_token).
    storage.setItem(tokenStorageKey, 'Bearer ' + user.access_token)
  }
  context.clearToken = () => storage.removeItem(tokenStorageKey)
  context.redirectToLoginOnce = async () => {
    if (context.redirecting) return
    context.redirecting = true
    await userManager.signinRedirect()
  }

  // Keep the stored token fresh on every (re)load of the user,
  // including automatic silent renew.
  userManager.events.addUserLoaded((user) => {
    context.setToken(user)
  })
  userManager.events.addAccessTokenExpired(() => {
    context.clearToken()
    context.redirectToLoginOnce()
  })
  userManager.events.addSilentRenewError(() => {
    context.clearToken()
    context.redirectToLoginOnce()
  })

  setActiveContext(context)

  const auth = {
    context,
    userManager,
    store: useHydraAuth,
    attach: createAttach(context),
    guard: createGuard(context, useHydraAuth),
    install(app) {
      app.provide(HYDRA_AUTH_KEY, context)
    },
  }

  return auth
}
