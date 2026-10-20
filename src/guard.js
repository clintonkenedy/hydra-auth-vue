/**
 * Build the `guard(opts)` factory for a given auth context.
 *
 * `guard({ public: [] })` returns a `router.beforeEach` handler:
 * - loads the OIDC user once (`loadUser()`),
 * - if the route requires auth and there is no user, stores `to.fullPath`
 *   under `redirectToAfterLogin` and starts the login redirect,
 * - otherwise calls `next()`.
 *
 * A route requires auth when `to.meta.requiresAuth` is truthy, or — with
 * `requireAuthByDefault: true` — when `to.meta.public !== true`. Routes whose
 * path or name is listed in `opts.public` are always public.
 */
export function createGuard(context, useStore) {
  return function guard(opts = {}) {
    const publicRoutes = opts.public ?? []
    const requireAuthByDefault =
      opts.requireAuthByDefault ?? context.requireAuthByDefault

    return async function beforeEach(to, from, next) {
      const auth = useStore()

      if (!auth.userLoaded) {
        await auth.loadUser()
      }

      const isListedPublic =
        publicRoutes.includes(to.path) || publicRoutes.includes(to.name)
      const requiresAuth = requireAuthByDefault
        ? to.meta?.public !== true && !isListedPublic
        : !!to.meta?.requiresAuth && !isListedPublic

      if (requiresAuth && !auth.user) {
        context.storage.setItem('redirectToAfterLogin', to.fullPath)
        return auth.login()
      }

      next()
    }
  }
}
