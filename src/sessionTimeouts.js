/**
 * Idle-timeout and maximum-session enforcement with cross-tab sync.
 *
 * The controller runs only while a user is authenticated (started after
 * signinCallback / loadUser with a user, stopped on close/logout). Tabs of
 * the same origin share the last-activity timestamp and a close/logout
 * broadcast through localStorage (`storage` events). The clock and the
 * storage are injectable for tests.
 *
 * Shared localStorage keys:
 * - `hydraAuth.lastActivity`  — epoch ms of the latest activity in any tab.
 * - `hydraAuth.sessionEvent`  — JSON `{ type: 'close'|'logout', reason, at }`.
 * - `hydraAuth.sessionStart`  — epoch ms fallback session start (first
 *   id_token `iat`) used when the OIDC profile has no `auth_time` claim.
 */

export const LAST_ACTIVITY_KEY = 'hydraAuth.lastActivity'
export const SESSION_EVENT_KEY = 'hydraAuth.sessionEvent'
export const SESSION_START_KEY = 'hydraAuth.sessionStart'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel']
// At most one localStorage activity write per 5 s (throttle).
const ACTIVITY_WRITE_THROTTLE_MS = 5000
const TICK_MS = 1000

function config(context) {
  return context.sessionTimeouts
}

/**
 * True when at least one of the two timeouts is enabled (> 0).
 */
export function sessionTimeoutsEnabled(context) {
  const cfg = config(context)
  if (!cfg) return false
  return Number(cfg.idleTimeoutMinutes) > 0 || Number(cfg.maxSessionHours) > 0
}

/**
 * Broadcast a close/logout event to the other tabs via localStorage.
 */
export function broadcastSessionEvent(context, type, reason = null) {
  const cfg = config(context)
  const now = cfg?.now ?? (() => Date.now())
  try {
    cfg?.storage?.setItem(SESSION_EVENT_KEY, JSON.stringify({ type, reason, at: now() }))
  } catch {
    // Storage unavailable: broadcasting is best-effort.
  }
}

/**
 * Remove the shared session keys (called on close/logout). Never touches the
 * last-profile cache (`hydraAuth.profile:<sub>`).
 */
export function clearSessionState(context) {
  const cfg = config(context)
  try {
    cfg?.storage?.removeItem(LAST_ACTIVITY_KEY)
    cfg?.storage?.removeItem(SESSION_START_KEY)
  } catch {
    // Ignore storage errors on cleanup.
  }
}

/**
 * Create the session-timeouts controller for an auth context.
 *
 * Returns `null` when both timeouts are disabled (no timers ever run).
 *
 * @param {object} context Auth context (reads `context.sessionTimeouts`).
 * @param {object} handlers
 * @param {Function} [handlers.onState] Called every tick with
 *   `{ idleExpiresAt, sessionExpiresAt, warning }` (warning: 'idle'|'max'|null).
 * @param {Function} [handlers.onExpire] Called once with 'idle'|'max' when a
 *   deadline is reached in this tab (the controller stops itself first).
 * @param {Function} [handlers.onRemoteClose] Called with the parsed
 *   `{ type, reason, at }` event broadcast by another tab.
 */
export function createSessionTimeouts(context, handlers = {}) {
  if (!sessionTimeoutsEnabled(context)) return null

  const cfg = config(context)
  const now = cfg.now ?? (() => Date.now())
  const storage = cfg.storage
  const idleMs = Number(cfg.idleTimeoutMinutes) > 0 ? cfg.idleTimeoutMinutes * 60_000 : 0
  const idleWarnMs = (cfg.idleWarningSeconds ?? 60) * 1000
  const maxMs = Number(cfg.maxSessionHours) > 0 ? cfg.maxSessionHours * 3_600_000 : 0
  const maxWarnMs = (cfg.maxSessionWarningMinutes ?? 5) * 60_000

  let running = false
  let tickTimer = null
  let lastActivity = 0
  let lastActivityWrite = 0
  let sessionStart = 0
  let warning = null

  function writeActivity(at) {
    lastActivityWrite = at
    try {
      storage?.setItem(LAST_ACTIVITY_KEY, String(at))
    } catch {
      // Storage unavailable: local tracking still works for this tab.
    }
  }

  function recordActivity(force = false) {
    const at = now()
    lastActivity = at
    if (force || at - lastActivityWrite >= ACTIVITY_WRITE_THROTTLE_MS) {
      writeActivity(at)
    }
  }

  function onActivityEvent() {
    // While the idle warning modal is visible, passive activity must not
    // extend the session — only "Seguir conectado" (stayConnected) does.
    if (!running || warning === 'idle') return
    recordActivity()
  }

  function onStorage(event) {
    if (!running) return
    if (event.key === LAST_ACTIVITY_KEY) {
      const at = Number(event.newValue)
      if (Number.isFinite(at) && at > lastActivity) {
        lastActivity = at
        tick()
      }
      return
    }
    if (event.key === SESSION_EVENT_KEY && event.newValue) {
      let parsed = null
      try {
        parsed = JSON.parse(event.newValue)
      } catch {
        return
      }
      if (parsed && (parsed.type === 'close' || parsed.type === 'logout')) {
        handlers.onRemoteClose?.(parsed)
      }
    }
  }

  /**
   * Session start = OIDC `auth_time` claim (seconds). Fallback: the `iat`
   * of the first id_token of the session, persisted under
   * `hydraAuth.sessionStart` so reloads and other tabs reuse it.
   */
  function resolveSessionStart(user) {
    const authTime = Number(user?.profile?.auth_time)
    if (Number.isFinite(authTime) && authTime > 0) return authTime * 1000

    const stored = Number(storage?.getItem(SESSION_START_KEY))
    if (Number.isFinite(stored) && stored > 0) return stored

    const iat = Number(user?.profile?.iat)
    const startedAt = Number.isFinite(iat) && iat > 0 ? iat * 1000 : now()
    try {
      storage?.setItem(SESSION_START_KEY, String(startedAt))
    } catch {
      // Best-effort persistence; this tab still enforces the max session.
    }
    return startedAt
  }

  function tick() {
    if (!running) return
    const at = now()
    const idleExpiresAt = idleMs ? lastActivity + idleMs : null
    const sessionExpiresAt = maxMs ? sessionStart + maxMs : null

    // Max session wins when both expire in the same tick.
    if (sessionExpiresAt != null && at >= sessionExpiresAt) return expire('max')
    if (idleExpiresAt != null && at >= idleExpiresAt) return expire('idle')

    const idleWarn = idleExpiresAt != null && at >= idleExpiresAt - idleWarnMs
    const maxWarn = sessionExpiresAt != null && at >= sessionExpiresAt - maxWarnMs
    if (idleWarn && maxWarn) {
      warning = sessionExpiresAt <= idleExpiresAt ? 'max' : 'idle'
    } else if (idleWarn) {
      warning = 'idle'
    } else if (maxWarn) {
      warning = 'max'
    } else {
      warning = null
    }
    handlers.onState?.({ idleExpiresAt, sessionExpiresAt, warning })
  }

  function expire(reason) {
    controller.stop()
    handlers.onExpire?.(reason)
  }

  const controller = {
    get running() {
      return running
    },
    start(user) {
      if (running) return
      running = true
      warning = null
      sessionStart = resolveSessionStart(user)
      recordActivity(true)
      ACTIVITY_EVENTS.forEach((name) =>
        window.addEventListener(name, onActivityEvent, { passive: true }),
      )
      window.addEventListener('storage', onStorage)
      tickTimer = setInterval(tick, TICK_MS)
      tick()
    },
    stop() {
      if (!running) return
      running = false
      warning = null
      if (tickTimer != null) {
        clearInterval(tickTimer)
        tickTimer = null
      }
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivityEvent))
      window.removeEventListener('storage', onStorage)
    },
    /**
     * "Seguir conectado": explicit reset of the inactivity window, allowed
     * even while the idle warning modal is visible.
     */
    stayConnected() {
      if (!running) return
      warning = null
      recordActivity(true)
      tick()
    },
  }

  return controller
}
