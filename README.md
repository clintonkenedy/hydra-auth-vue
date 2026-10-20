# @munipuno/hydra-auth-vue

Shared Hydra/OIDC authentication client for the municipal Vue 3 SPAs.
Wraps `oidc-client-ts` with a Pinia store, an axios attachment, a `vue-router`
guard and two drop-in route components. Plain ESM, no build step — your
bundler (Vite/Quasar) compiles it.

## Install

Git-installable (tagged release):

```json
{
  "dependencies": {
    "@munipuno/hydra-auth-vue": "github:MuniPuno/hydra-auth-vue#v0.1.0"
  }
}
```

Local development (sibling checkout):

```json
{
  "dependencies": {
    "@munipuno/hydra-auth-vue": "file:../hydra-auth-vue"
  }
}
```

Peer dependencies (installed by the consumer): `vue ^3.4`, `pinia ^2 || ^3`,
`vue-router ^4`, `oidc-client-ts ^3.4`, `axios ^1`.

## Options

`createHydraAuth(options)`:

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `authority` | yes | — | OIDC authority (Hydra public URL). |
| `clientId` | yes | — | OIDC client id. |
| `redirectUri` | yes | — | Redirect URI pointing at the callback route. |
| `postLogoutRedirectUri` | yes | — | Where Hydra sends the browser after logout. |
| `scope` | no | `openid profile email offline_access` | Requested scopes. |
| `coreApiUrl` | yes | — | Base URL used by `fetchProfile()` to GET `/api/user`. |
| `storage` | no | `window.sessionStorage` | Web Storage used for the token, the OIDC state and `redirectToAfterLogin`. |
| `tokenStorageKey` | no | `token` | Storage key for the `Bearer <access_token>` value. |
| `routes` | no | `{ login: '/oidc-login', callback: '/oidc-callback' }` | Route paths the consumer mounts the components on. |
| `requireAuthByDefault` | no | `false` | When `true`, every route requires auth unless `to.meta.public === true`. |

The returned plugin object exposes:

- `install(app)` — provides the auth context under `HYDRA_AUTH_KEY`.
- `guard(opts)` — returns a `router.beforeEach` handler (`opts.public`: array of public paths/names).
- `attach(axiosInstance)` — adds request/response interceptors; returns `{ request, response }` ids for `eject`.
- `store` — the `useHydraAuth` Pinia store (id `hydraAuth`).

The store declares `persist: { key: 'hydraAuth', storage }`, which is picked up
automatically when the consumer installs `pinia-plugin-persistedstate` — the
plugin is optional and never required by this package.

## Quasar boot example (front-sistrans wiring)

```js
// src/boot/hydraAuth.js
import { defineBoot } from '#q-app/wrappers'
import { createHydraAuth } from '@munipuno/hydra-auth-vue'
import { api, apiCore } from 'src/boot/axios'

export const hydraAuth = createHydraAuth({
  authority: process.env.OIDC_AUTHORITY,
  clientId: process.env.OIDC_CLIENT_ID,
  redirectUri: process.env.OIDC_REDIRECT_URI,
  postLogoutRedirectUri: process.env.OIDC_POST_LOGOUT_REDIRECT_URI,
  scope: process.env.OIDC_SCOPE,
  coreApiUrl: import.meta.env.VITE_API_CORE_URL,
})

export default defineBoot(({ app, router }) => {
  app.use(hydraAuth)
  hydraAuth.attach(api)
  hydraAuth.attach(apiCore)
  router.beforeEach(hydraAuth.guard())
})
```

## Plain Vue example

```js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import axios from 'axios'
import { createHydraAuth, OidcLogin, OidcCallback } from '@munipuno/hydra-auth-vue'
import App from './App.vue'

const hydraAuth = createHydraAuth({
  authority: import.meta.env.VITE_OIDC_AUTHORITY,
  clientId: import.meta.env.VITE_OIDC_CLIENT_ID,
  redirectUri: `${location.origin}/oidc-callback`,
  postLogoutRedirectUri: location.origin,
  coreApiUrl: import.meta.env.VITE_API_CORE_URL,
})

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/oidc-login', component: OidcLogin },
    { path: '/oidc-callback', component: OidcCallback },
    { path: '/', component: () => import('./pages/Home.vue'), meta: { requiresAuth: true } },
  ],
})
router.beforeEach(hydraAuth.guard({ public: ['/oidc-login', '/oidc-callback'] }))

const api = axios.create({ baseURL: import.meta.env.VITE_API_CORE_URL })
hydraAuth.attach(api)

createApp(App).use(createPinia()).use(router).use(hydraAuth).mount('#app')
```

In components:

```js
import { useAuth } from '@munipuno/hydra-auth-vue'

const { user, permisos, hasPermission, isAuthenticated, login, logout } = useAuth()
```

## Route setup

The plugin never registers routes. Mount the two exported components yourself
(paths must match the `routes` option, default `/oidc-login` and
`/oidc-callback`):

- `OidcLogin` — starts `signinRedirect()` on mount.
- `OidcCallback` — completes the code exchange (`signinRedirectCallback`),
  fetches the profile from `${coreApiUrl}/api/user`, then
  `router.replace(redirectToAfterLogin ?? '/')` and clears that key. On error it
  shows `No se pudo completar el inicio de sesión.` with a `Reintentar` button.

## Migrating from a hand-written `oidc.js`

Replace your local `oidc.js`, auth store, axios interceptors and router guard
with this package. It fixes six pitfalls commonly found in hand-rolled setups:

- **`id_token` used as bearer token** — the package always stores
  `Bearer <access_token>`, never the `id_token`.
- **Silent renew not propagated** — `events.addUserLoaded` refreshes the stored
  token on every renew, so axios never sends a stale token.
- **`localStorage` for tokens** — defaults to `sessionStorage` (per-tab,
  cleared on close); configurable via `storage`.
- **Token logging** — no `console.log` of tokens or user payloads anywhere.
- **No 401 handling** — a response interceptor detects
  `401 {"error":"invalid_token"}`, clears the token and re-runs the login
  redirect exactly once.
- **No renew-error handling** — `addAccessTokenExpired` and
  `addSilentRenewError` clear the token and trigger a single, loop-guarded
  `signinRedirect()`.

## Tests

```sh
npm install
npm test
```
