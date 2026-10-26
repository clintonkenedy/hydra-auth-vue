/**
 * Automatic-close redirect helpers (`closeRedirect: 'home'`).
 *
 * After an automatic session close (idle/max) the browser should land on the
 * same place an explicit logout lands: the configured `postLogoutRedirectUri`,
 * with `session_closed=<reason>` appended so the landing page can explain why
 * the session ended (see HydraSessionClosedNotice).
 */

/**
 * Full-page navigation, kept as a module export so tests can mock it
 * (jsdom does not implement real navigation for `window.location.assign`).
 *
 * @param {string} url Absolute URL to navigate to.
 */
export function navigateToUrl(url) {
  window.location.assign(url)
}

/**
 * Resolve the automatic-close destination for `closeRedirect: 'home'`.
 *
 * - Same-origin `postLogoutRedirectUri` → an SPA router location (no reload),
 *   preserving any query/hash already present on the configured URI.
 * - Cross-origin `postLogoutRedirectUri` → a full navigation URL.
 * - Missing/invalid `postLogoutRedirectUri` → the router path `/`.
 *
 * @param {object} context Auth context (reads `postLogoutRedirectUri`).
 * @param {('idle'|'max'|null)} reason Close reason, appended as `session_closed`.
 * @returns {{ mode: 'router', location: object } | { mode: 'assign', url: string }}
 */
export function resolveCloseRedirect(context, reason) {
  const query = reason ? { session_closed: reason } : {}
  const target = context?.postLogoutRedirectUri
  if (!target) return { mode: 'router', location: { path: '/', query } }

  let url
  try {
    url = new URL(target, window.location.origin)
  } catch {
    return { mode: 'router', location: { path: '/', query } }
  }

  if (url.origin === window.location.origin) {
    const mergedQuery = { ...Object.fromEntries(url.searchParams), ...query }
    const location = { path: url.pathname, query: mergedQuery }
    if (url.hash) location.hash = url.hash
    return { mode: 'router', location }
  }

  if (reason) url.searchParams.set('session_closed', reason)
  return { mode: 'assign', url: url.href }
}
