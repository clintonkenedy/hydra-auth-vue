/**
 * Last-known-profile cache ("core outage" fallback).
 *
 * Stores the minimal UI profile (id, name, alias, roles, permisos) per OIDC
 * subject so the SPA keeps rendering when `${coreApiUrl}/api/user` is down.
 * Never stores tokens or email — roles/permisos are UI-only hints; the
 * backend always enforces real authorization.
 */

const KEY_PREFIX = 'hydraAuth.profile:'

export function profileCacheKey(sub) {
  return `${KEY_PREFIX}${sub}`
}

function cacheConfig(context) {
  return context.profileCache
}

/**
 * Decide whether a fetchProfile failure may fall back to the cache.
 * Only network errors, timeouts and HTTP 5xx qualify — any 4xx (401, 403,
 * 404…) is an authorization/contract problem and must surface as today.
 */
export function isRetriableProfileError(error) {
  const status = error?.response?.status
  if (status != null) return status >= 500
  // No HTTP response at all: network error or timeout.
  return true
}

/**
 * Persist the freshly fetched profile for the given sub.
 * Strips everything except `{ user: { id, name, alias }, roles, permisos }`.
 */
export function writeProfileCache(context, sub, payload) {
  const cfg = cacheConfig(context)
  if (!cfg?.enabled || !cfg.storage || !sub) return
  const entry = {
    sub,
    fetchedAt: Date.now(),
    profile: {
      user: {
        id: payload?.user?.id ?? null,
        name: payload?.user?.name ?? null,
        alias: payload?.user?.alias ?? null,
      },
      roles: payload?.roles ?? null,
      permisos: payload?.permisos ?? null,
    },
  }
  try {
    cfg.storage.setItem(profileCacheKey(sub), JSON.stringify(entry))
  } catch {
    // Storage full/unavailable: caching is best-effort, never break login.
  }
}

/**
 * Read a usable cache entry for the given sub, or `null` when the cache is
 * disabled, missing, malformed, for another sub, or older than maxAgeSeconds.
 */
export function readProfileCache(context, sub) {
  const cfg = cacheConfig(context)
  if (!cfg?.enabled || !cfg.storage || !sub) return null
  let entry
  try {
    const raw = cfg.storage.getItem(profileCacheKey(sub))
    if (!raw) return null
    entry = JSON.parse(raw)
  } catch {
    return null
  }
  if (!entry || entry.sub !== sub || !entry.profile || typeof entry.fetchedAt !== 'number') {
    return null
  }
  const ageMs = Date.now() - entry.fetchedAt
  if (ageMs > cfg.maxAgeSeconds * 1000) return null
  return entry
}

/**
 * Remove the cache entry for the given sub (used on logout).
 */
export function removeProfileCache(context, sub) {
  const cfg = cacheConfig(context)
  if (!cfg?.storage || !sub) return
  try {
    cfg.storage.removeItem(profileCacheKey(sub))
  } catch {
    // Ignore storage errors on cleanup.
  }
}

/**
 * Start the background retry loop (idempotent). `retry` is called every
 * `retrySeconds`; it is expected to stop the loop itself on success.
 */
export function startProfileRetry(context, retry) {
  const cfg = cacheConfig(context)
  if (context.profileRetryTimer != null) return
  context.profileRetryTimer = setInterval(() => {
    retry()
  }, cfg.retrySeconds * 1000)
}

export function stopProfileRetry(context) {
  if (context.profileRetryTimer != null) {
    clearInterval(context.profileRetryTimer)
    context.profileRetryTimer = null
  }
}
