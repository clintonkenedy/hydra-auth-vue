import { UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { setActiveContext, useHydraAuth } from './store.js'
import { createAttach } from './axios.js'
import { createResourceTokens } from './resources.js'
import { createGuard } from './guard.js'
import { DEFAULT_BRANDING } from './branding.js'
import { hydraMetadata } from './metadata.js'

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
 * @param {boolean} [options.discovery] Fetch Hydra's discovery document (default `true`).
 *   With `false` the OIDC metadata is built from `authority` with Hydra's fixed paths
 *   (`hydraMetadata(authority)`, also passed to the resource managers) and userinfo is
 *   not loaded (`loadUserInfo: false`; the profile comes from the id_token). Use it when
 *   the SPA origin is only in the Hydra client's allowed CORS origins: such an origin
 *   cannot read the discovery document nor pass the userinfo CORS preflight.
 * @param {string} options.clientId OIDC client id.
 * @param {string} options.redirectUri Redirect URI (callback route).
 * @param {string} [options.silentRedirectUri] Silent-callback URI used by hidden-iframe
 *   silent authorizes (primary and resource managers). Default: with `resources`
 *   declared, `/oidc-silent-callback.html` on the `redirectUri` origin (the page the
 *   `hydraAuthVite()` plugin serves); without resources, `redirectUri`. Register it in
 *   the Hydra client either way.
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
 * @param {Object<string, {audience: string, scope?: string}>} [options.resources]
 *   One token per API: `name -> { audience, scope? }`. Use with
 *   `attach(axiosInstance, { resource: name })`. Absent/empty: unchanged behavior.
 * @returns {{ install(app): void, guard(opts): Function, attach(axiosInstance, opts?): object, store: Function, userManager: UserManager }}
 */
export function createHydraAuth(options) {
  const {
    authority,
    clientId,
    discovery = true,
    redirectUri,
    silentRedirectUri,
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
    resources = {},
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

  // S11: with resources the silent iframe should land on the shipped page
  // (served by the Vite plugin) instead of loading the whole SPA.
  const silentUri =
    silentRedirectUri ??
    (Object.keys(resources ?? {}).length > 0
      ? new URL('/oidc-silent-callback.html', redirectUri).href
      : redirectUri)

  // F9: without discovery, static Hydra metadata and no userinfo call
  // (both requests only pass Hydra's global CORS list).
  const staticMetadata = discovery === false
  const userManager = new UserManager({
    authority,
    ...(staticMetadata ? { metadata: hydraMetadata(authority) } : {}),
    client_id: clientId,
    redirect_uri: redirectUri,
    silent_redirect_uri: silentUri,
    post_logout_redirect_uri: postLogoutRedirectUri,
    response_type: 'code',
    scope,
    automaticSilentRenew: true,
    loadUserInfo: !staticMetadata,
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
  // Resource tokens (F5): one token per API, see resources.js. Clearing the
  // primary token (logout, close, expiry, 401) also clears and best-effort
  // revokes every resource token.
  context.resources = createResourceTokens(context, resources)
  context.clearToken = () => {
    storage.removeItem(tokenStorageKey)
    context.resources.revokeAll()
  }
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
