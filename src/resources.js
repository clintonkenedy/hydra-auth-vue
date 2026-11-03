import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts'

// Renew a resource token when it expires within this window (S5).
const RENEW_BEFORE_MS = 60_000

export function unknownResourceError(name) {
  return new Error(
    `hydra-auth: unknown resource "${name}"; declare it in createHydraAuth({ resources })`,
  )
}

function expiresSoon(user) {
  if (user?.expires_at == null) return false
  return user.expires_at * 1000 - Date.now() <= RENEW_BEFORE_MS
}

// Best effort: Hydra access tokens may be opaque. Only a decodable JWT whose
// `aud` claim does not contain the audience counts as "lost the audience".
function lacksAudience(user, audience) {
  const payload = user?.access_token?.split('.')[1]
  if (!payload) return false
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const { aud } = JSON.parse(json)
    if (aud == null) return true
    return !(Array.isArray(aud) ? aud : [aud]).includes(audience)
  } catch {
    return false
  }
}

/**
 * One access token per API (F5). Each resource `name -> { audience, scope? }`
 * gets its token lazily with a silent authorize carrying Hydra's `audience`.
 *
 * Design: oidc-client-ts `signinSilent()` always stores the resulting user and
 * fires `userLoaded` on the manager that runs it, so running it on the primary
 * `UserManager` would replace the primary user/token. Each resource therefore
 * gets its own `UserManager`, built from the primary settings, with an
 * in-memory user store (`InMemoryWebStorage`) and no automatic renew. The
 * primary manager, its store and its events never see a resource user.
 * The resource `User` (refresh_token, expires_at) only lives in memory; the
 * storage only receives `Bearer <access_token>` under
 * `<tokenStorageKey>:resource:<name>`.
 */
export function createResourceTokens(context, resourcesOption = {}) {
  const resources = resourcesOption ?? {}
  const names = Object.keys(resources)
  const managers = new Map()
  const users = new Map()
  const inflight = new Map()
  const generations = new Map(names.map((name) => [name, 0]))

  const storageKey = (name) => `${context.tokenStorageKey}:resource:${name}`

  function resourceFor(name) {
    if (!names.includes(name)) throw unknownResourceError(name)
    return resources[name]
  }

  function managerFor(name) {
    if (!managers.has(name)) {
      const primary = context.userManager.settings
      managers.set(
        name,
        new UserManager({
          authority: primary.authority,
          client_id: primary.client_id,
          redirect_uri: primary.redirect_uri,
          post_logout_redirect_uri: primary.post_logout_redirect_uri,
          // The iframe lands on the already-registered callback route; the
          // store's signinCallback() dispatches it as a silent callback.
          silent_redirect_uri: primary.silent_redirect_uri ?? primary.redirect_uri,
          response_type: 'code',
          scope: primary.scope,
          automaticSilentRenew: false,
          loadUserInfo: false,
          monitorSession: false,
          userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
        }),
      )
    }
    return managers.get(name)
  }

  function silentArgs(name) {
    const { audience, scope } = resourceFor(name)
    return { extraQueryParams: { audience }, ...(scope ? { scope } : {}) }
  }

  async function acquire(name, renewing) {
    const generation = generations.get(name)
    const manager = managerFor(name)
    try {
      let user = await manager.signinSilent(silentArgs(name))
      if (renewing && lacksAudience(user, resourceFor(name).audience)) {
        // The refreshed token lost `aud`: fall back to a fresh silent authorize.
        user = await manager.signinSilent({ ...silentArgs(name), forceIframeAuth: true })
      }
      if (generations.get(name) !== generation) {
        throw new Error(`hydra-auth: resource "${name}" token was cleared during acquisition`)
      }
      users.set(name, user)
      const token = 'Bearer ' + user.access_token
      context.storage.setItem(storageKey(name), token)
      return token
    } catch (error) {
      // A failed acquisition/renewal drops this resource token only; the
      // primary session is untouched and nothing redirects.
      if (generations.get(name) === generation) clear(name)
      throw error
    }
  }

  function getToken(name) {
    resourceFor(name)
    return context.storage.getItem(storageKey(name))
  }

  function ensureToken(name) {
    resourceFor(name)
    const user = users.get(name)
    if (user && !expiresSoon(user)) return Promise.resolve('Bearer ' + user.access_token)
    if (!inflight.has(name)) {
      const promise = acquire(name, Boolean(user)).finally(() => {
        if (inflight.get(name) === promise) inflight.delete(name)
      })
      inflight.set(name, promise)
    }
    return inflight.get(name)
  }

  function forget(name) {
    generations.set(name, generations.get(name) + 1)
    users.delete(name)
    inflight.delete(name)
    context.storage.removeItem(storageKey(name))
  }

  function clear(name) {
    if (name !== undefined) resourceFor(name)
    const targets = name === undefined ? names : [name]
    for (const target of targets) {
      forget(target)
      Promise.resolve(managers.get(target)?.removeUser?.()).catch(() => {})
    }
  }

  function handle401(name) {
    clear(name)
  }

  // Logout: clear every resource token, then best-effort revoke them.
  function revokeAll() {
    for (const name of names) {
      const hadUser = users.has(name)
      forget(name)
      const manager = managers.get(name)
      if (!manager) continue
      Promise.resolve()
        .then(() => (hadUser && manager.revokeTokens ? manager.revokeTokens() : undefined))
        .catch(() => {})
        .then(() => manager.removeUser?.())
        .catch(() => {})
    }
  }

  return { names, getToken, ensureToken, clear, handle401, revokeAll }
}
