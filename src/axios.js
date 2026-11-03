import { unknownResourceError } from './resources.js'

/**
 * Build the `attach(axiosInstance, { resource } = {})` function for a given
 * auth context.
 *
 * Without `resource` (primary token):
 * - Request interceptor: sets `Authorization` from the stored token when present.
 * - Response interceptor: on 401 with body `{"error":"invalid_token"}`, clears
 *   the token and triggers `signinRedirect()` once (loop-guarded).
 *
 * With `resource: name` (a name declared in `createHydraAuth({ resources })`):
 * - Request interceptor: obtains/renews that resource token
 *   (`context.resources.ensureToken(name)`) and sets `Authorization`.
 * - Response interceptor: on 401 `invalid_token`, clears only that resource
 *   token (the next request re-acquires it); never redirects to login.
 * - An unknown name throws synchronously.
 *
 * Returns `{ request, response }` interceptor ids so consumers can detach via
 * `axiosInstance.interceptors.request.eject(ids.request)` etc.
 */
export function createAttach(context) {
  return function attach(axiosInstance, { resource } = {}) {
    if (resource !== undefined) return attachResource(context, axiosInstance, resource)

    const request = axiosInstance.interceptors.request.use(
      (config) => {
        const token = context.getToken()
        if (token) {
          config.headers['Authorization'] = token
        }
        return config
      },
      (error) => Promise.reject(error),
    )

    const response = axiosInstance.interceptors.response.use(
      (res) => res,
      async (error) => {
        const res = error?.response
        if (res?.status === 401 && res?.data?.error === 'invalid_token') {
          context.clearToken()
          await context.redirectToLoginOnce()
        }
        return Promise.reject(error)
      },
    )

    return { request, response }
  }
}

function attachResource(context, axiosInstance, name) {
  if (!context.resources?.names.includes(name)) throw unknownResourceError(name)

  const request = axiosInstance.interceptors.request.use(
    async (config) => {
      config.headers['Authorization'] = await context.resources.ensureToken(name)
      return config
    },
    (error) => Promise.reject(error),
  )

  const response = axiosInstance.interceptors.response.use(
    (res) => res,
    async (error) => {
      const res = error?.response
      if (res?.status === 401 && res?.data?.error === 'invalid_token') {
        context.resources.handle401(name)
      }
      return Promise.reject(error)
    },
  )

  return { request, response }
}
