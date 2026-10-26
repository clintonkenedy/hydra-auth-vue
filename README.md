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
| `profileCache` | no | `{ enabled: true, storage: window.localStorage, maxAgeSeconds: 86400, retrySeconds: 60 }` | Last-profile cache used when the core API is down. See [Last-profile cache (core outage)](#last-profile-cache-core-outage). |
| `idleTimeoutMinutes` | no | `60` | Inactivity timeout. See [Session timeouts](#session-timeouts). |
| `maxSessionHours` | no | `10` | Maximum session length. See [Session timeouts](#session-timeouts). |

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

`useAuth()` also exposes `profileDegraded` (ref, `true` while the profile shown
comes from the last-profile cache) and `profileFetchedAt` (ref, epoch ms of the
moment the applied profile was actually fetched), plus the session-timeout
surface: `sessionExpiresAt`, `idleExpiresAt`, `sessionWarning`, `closedReason`
(refs) and the `stayConnected()` / `closeSession(reason)` actions described in [Session timeouts](#session-timeouts).

## Session timeouts

The package closes the session automatically after **60 minutes of
inactivity** and after a **maximum session length of 10 hours**, with warnings
before each close and synchronization across tabs of the same origin.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `idleTimeoutMinutes` | `60` | Minutes without activity (`mousemove`, `mousedown`, `keydown`, `scroll`, `touchstart`, `wheel`) before the session closes. `0`/`null` disables the idle timeout. |
| `idleWarningSeconds` | `60` | Lead time of the idle warning modal ("Tu sesión está por cerrarse" with a countdown, "Seguir conectado" and "Salir"). |
| `maxSessionHours` | `10` | Maximum session length measured from the OIDC `auth_time` claim (fallback: the `iat` of the first id_token of the session). Counts even while the user is active. `0`/`null` disables it. |
| `maxSessionWarningMinutes` | `5` | Lead time of the max-session notice ("Tu sesión vence en 5 min, guardá lo que estés haciendo" with an "Entendido" button that only hides it — no extension). |
| `sessionTimeouts` | `{ storage: window.localStorage }` | Advanced overrides: injectable `now` clock and `storage` (mainly for tests). |

Timers only run while a user is authenticated — they start after the signin
callback (or `loadUser()` with a user), never run on public routes before
login, and stop on close/logout. When both timeouts are disabled no timer or
listener is ever installed.

### Behavior on automatic close

When the idle or the max deadline is reached (or the user clicks "Salir"):

- silent renew stops and the OIDC user is removed (`userManager.removeUser()`),
- the stored token and the store are cleared, the profile retry timer stops,
- the browser is redirected to the login route (`routes.login`) with
  `?reason=idle|max`, where `OidcLogin` shows "Tu sesión se cerró por
  inactividad" / "Tu sesión se cerró por tiempo máximo" for 2.5 s before
  starting the login redirect.

Unlike `logout()`, the automatic close **never** calls the Hydra end-session
endpoint and **never** removes the last-profile cache
(`hydraAuth.profile:<sub>`), so the SPA can still start in degraded mode after
re-login. Explicit `logout()` keeps today’s behavior (removes the cache,
`signoutRedirect`) and also broadcasts the close to the other tabs.

### Tab synchronization

Tabs of the same origin share state through `localStorage` + `storage` events:

- `hydraAuth.lastActivity` — epoch ms of the latest activity in any tab
  (written at most once every 5 s); activity in any tab keeps all tabs alive.
- `hydraAuth.sessionEvent` — `{ type: 'close'|'logout', reason, at }`; an
  automatic close or an explicit logout in one tab closes all tabs.
- `hydraAuth.sessionStart` — fallback session start (first id_token `iat`)
  used when the profile has no `auth_time` claim.

### Mounting the guard

Mount `<HydraSessionGuard />` once in the authenticated layout (next to
`<HydraDegradedBanner />`). It renders the idle warning modal and the
max-session notice (inline styles, no UI framework) and performs the redirect
to the login route after a close:

```vue
<template>
  <HydraDegradedBanner />
  <HydraSessionGuard />
  <router-view />
</template>

<script setup>
import { HydraDegradedBanner, HydraSessionGuard } from '@munipuno/hydra-auth-vue'
</script>
```

The store (and `useAuth()`) exposes `sessionExpiresAt`, `idleExpiresAt`,
`sessionWarning` (`'idle' | 'max' | null`), `closedReason`
(`'idle' | 'max' | null`, readable on the login page) and the actions
`stayConnected()` and `closeSession(reason)`.

### Security note

This is **front-side protection for unattended PCs** — it limits how long an
open tab keeps a usable session on a shared or abandoned machine. It is not
the primary security boundary: access tokens still expire server-side (10
minutes) and the backend enforces real authorization on every request.

## Last-profile cache (core outage)

When `GET ${coreApiUrl}/api/user` is unreachable, the SPA keeps working with
the user's **last known profile** instead of failing the login flow.

### Semantics

- Every successful `fetchProfile()` writes a cache entry under the key
  `hydraAuth.profile:<sub>` (the OIDC subject — the DNI). The entry stores only
  `{ sub, fetchedAt, profile: { user: { id, name, alias }, roles, permisos } }`
  — **never** the token and **never** the email.
- When `fetchProfile()` fails with a **network error, timeout or HTTP 5xx** and
  a cache entry exists for the *current* user's sub and is no older than
  `maxAgeSeconds`, the cached profile is applied, `profileDegraded` becomes
  `true` and a background retry calls `fetchProfile()` every `retrySeconds`
  until the core recovers (then degraded mode clears and the timer stops).
- Any **4xx** (401, 403, 404…), a missing/expired entry or an entry belonging
  to another sub rethrows the error exactly as before — the
  `401 invalid_token` re-login path is unchanged.
- `logout()` removes the current sub's cache entry **before**
  `signoutRedirect()` and stops the retry timer.

### Security reasoning

This is an **availability** feature, not an authorization bypass:

- Front-side `roles`/`permisos` are **UI-only hints** — the backend enforces
  real authorization on every request, so a stale cached profile can never
  grant access the server would deny.
- The cache key is **per sub**, and an entry for another sub is never applied,
  so profiles cannot leak between accounts on a shared computer.
- The entry is **cleared on logout**, so finishing a session on a shared
  machine leaves nothing behind.
- Entries expire after `maxAgeSeconds` (default **24 h**).
- **4xx responses are never cached or served from cache** — authentication and
  authorization failures always surface immediately.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `profileCache.enabled` | `true` | Set to `false` to restore the previous behavior exactly (no cache, every failure rethrows). |
| `profileCache.storage` | `window.localStorage` | Web Storage for the cache entries. |
| `profileCache.maxAgeSeconds` | `86400` | Maximum age (24 h) before an entry is considered expired. |
| `profileCache.retrySeconds` | `60` | Background retry interval while degraded. |

```js
createHydraAuth({
  // ...required options
  profileCache: { maxAgeSeconds: 3600, retrySeconds: 30 },
})
```

### Showing the degraded banner

Mount `<HydraDegradedBanner />` once in your layout; it renders nothing unless
`profileDegraded` is `true`, and otherwise shows a `role="status"` amber bar
with the text `Sin conexión con el servicio de usuarios — mostrando tu último
perfil.` (inline styles, no UI framework dependency):

```vue
<template>
  <HydraDegradedBanner />
  <router-view />
</template>

<script setup>
import { HydraDegradedBanner } from '@munipuno/hydra-auth-vue'
</script>
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
