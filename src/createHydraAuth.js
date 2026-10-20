import { UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { setActiveContext, useHydraAuth } from './store.js'
import { createAttach } from './axios.js'
import { createGuard } from './guard.js'

/**
 * Injection key under which the auth context is provided by `install(app)`.
 */
export const HYDRA_AUTH_KEY = Symbol('hydra-auth')

const DEFAULT_SCOPE = 'openid profile email offline_access'
const DEFAULT_ROUTES = { login: '/oidc-login', callback: '/oidc-callback' }

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
 * @param {boolean} [options.requireAuthByDefault] Treat every route as protected unless `to.meta.public === true`.
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
    requireAuthByDefault = false,
  } = options

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
    requireAuthByDefault,
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
