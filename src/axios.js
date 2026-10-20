/**
 * Build the `attach(axiosInstance)` function for a given auth context.
 *
 * - Request interceptor: sets `Authorization` from the stored token when present.
 * - Response interceptor: on 401 with body `{"error":"invalid_token"}`, clears
 *   the token and triggers `signinRedirect()` once (loop-guarded).
 *
 * Returns `{ request, response }` interceptor ids so consumers can detach via
 * `axiosInstance.interceptors.request.eject(ids.request)` etc.
 */
export function createAttach(context) {
  return function attach(axiosInstance) {
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
