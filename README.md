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
    "@munipuno/hydra-auth-vue": "github:clintonkenedy/hydra-auth-vue#v0.5.0"
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
| `silentRedirectUri` | no | `redirectUri` | Target of hidden-iframe silent authorizes (primary and resources). See [Página de silent callback](#página-de-silent-callback-silentredirecturi). |
| `postLogoutRedirectUri` | yes | — | Where Hydra sends the browser after logout. |
| `scope` | no | `openid profile email offline_access` | Requested scopes. |
| `coreApiUrl` | yes | — | Base URL used by `fetchProfile()` to GET `/api/user`. |
| `storage` | no | `window.sessionStorage` | Web Storage used for the token, the OIDC state and `redirectToAfterLogin`. |
| `tokenStorageKey` | no | `token` | Storage key for the `Bearer <access_token>` value. |
| `routes` | no | `{ login: '/oidc-login', callback: '/oidc-callback' }` | Route paths the consumer mounts the components on. |
| `closeRedirect` | no | `'home'` | Where the browser lands after an automatic session close: `'home'` → `postLogoutRedirectUri` with `?session_closed=idle\|max`; `'login'` → `routes.login` with `?reason=idle\|max`. See [Session timeouts](#session-timeouts). |
| `requireAuthByDefault` | no | `false` | When `true`, every route requires auth unless `to.meta.public === true`. |
| `profileCache` | no | `{ enabled: true, storage: window.localStorage, maxAgeSeconds: 86400, retrySeconds: 60 }` | Last-profile cache used when the core API is down. See [Last-profile cache (core outage)](#last-profile-cache-core-outage). |
| `idleTimeoutMinutes` | no | `60` | Inactivity timeout. See [Session timeouts](#session-timeouts). |
| `maxSessionHours` | no | `10` | Maximum session length. See [Session timeouts](#session-timeouts). |
| `branding` | no | see [Branding](#branding) | Look & feel of the package-owned auth screens (logo, title, colors, font). |
| `resources` | no | `{}` | One token per API: `name -> { audience, scope?, silentRequestTimeoutInSeconds? }`. See [Varios tokens por API (resources)](#varios-tokens-por-api-resources). |

The returned plugin object exposes:

- `install(app)` — provides the auth context under `HYDRA_AUTH_KEY`.
- `guard(opts)` — returns a `router.beforeEach` handler (`opts.public`: array of public paths/names).
- `attach(axiosInstance, { resource }?)` — adds request/response interceptors; returns `{ request, response }` ids for `eject`. With `{ resource: name }` the instance uses that resource's token (see [Varios tokens por API (resources)](#varios-tokens-por-api-resources)).
- `store` — the `useHydraAuth` Pinia store (id `hydraAuth`).

The store declares `persist: { key: 'hydraAuth', storage }`, which is picked up
automatically when the consumer installs `pinia-plugin-persistedstate` — the
plugin is optional and never required by this package.

## Branding

The package-owned screens (`OidcLogin`, `OidcCallback`, `HydraSessionGuard`) are
styled to match the municipal IdP login page. The `branding` option customizes
that look without any CSS framework:

| Option | Default | Description |
| --- | --- | --- |
| `logo` | `null` | Image URL shown centered above the content (rendered only when set, `alt="Logo"`). |
| `title` | `null` | Heading shown under the logo (rendered only when set). |
| `primaryColor` | `#00aeee` | Primary button background. |
| `primaryHoverColor` | `#00caee` | Primary button `:hover` background. |
| `primaryActiveColor` | `#16759f` | Primary button `:focus`/`:active` background. |
| `fontFamily` | system sans-serif stack | Font family applied to the auth screens. |

```js
const hydraAuth = createHydraAuth({
  // ...required options...
  branding: {
    logo: '/inicio_login.jpg',
    title: 'Provedor de identidad Municipalidad Puno',
  },
})
```

The resolved branding is available as `useAuth().branding`, and the shared
layout component is exported as `HydraAuthScreen` (props: `variant` —
`'info' | 'error' | 'loading'` — plus a default slot). The colors are exposed
to the scoped styles as CSS custom properties (`--hydra-primary`,
`--hydra-primary-hover`, `--hydra-primary-active`, `--hydra-font-family`), and
the primary button class is `.hydra-btn-primary`.

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

## Varios tokens por API (resources)

By default every attached axios instance sends the primary access token. With
`resources` each API gets **its own access token**, issued by Hydra for that
API's `audience` (one token per API, RFC 8707 style).

### Hydra prerequisite

The OIDC client must allow the audience: add it to the client's `audience`
allow-list (e.g. `audience: ["sistrans-local"]` on `usuarios-local`). Hydra
refuses a non-allowed audience with `invalid_request`, and that resource's
requests reject with the error.

The silent request crosses Hydra, the IdP login (which must accept a
remembered session without UI) and consent pages, and this app's callback
route; it gets 30 s by default (`silentRequestTimeoutInSeconds` per resource)
instead of oidc-client-ts's 10 s. A timeout surfaces as `ErrorTimeout: IFrame
timed out without a response`.

### Configuration

```js
export const hydraAuth = createHydraAuth({
  // ...required options...
  resources: {
    sistrans: { audience: 'sistrans-local' },
    // scope is optional; defaults to the primary `scope`
    rentas: { audience: 'rentas-local', scope: 'openid offline_access' },
  },
})

hydraAuth.attach(apiCore) // primary token, unchanged
hydraAuth.attach(apiSistrans, { resource: 'sistrans' }) // sistrans token
```

Without `resources` (or with `{}`) the package behaves exactly as before.
`attach(instance, { resource: 'nope' })` with an undeclared name throws
`hydra-auth: unknown resource "nope"; declare it in createHydraAuth({ resources })`.

### Behavior

- **Lazy acquisition** — the first request on a resource-attached instance
  obtains the token in the background with a silent authorize
  (`signinSilent({ extraQueryParams: { audience }, scope? })`, `prompt=none`,
  hidden iframe, no UI). Concurrent first requests share one acquisition. The
  iframe lands on `silentRedirectUri` (default: the callback route, where
  `OidcCallback` hands the silent response to the parent window and never
  touches the primary session; see
  [Página de silent callback](#página-de-silent-callback-silentredirecturi)).
- **Isolation** — each resource uses its own internal `UserManager` (same
  authority/client settings, in-memory user store, no automatic renew), so the
  primary user/token and its events are never replaced by a resource user.
- **Storage** — `Bearer <access_token>` under
  `<tokenStorageKey>:resource:<name>` (default `token:resource:<name>`) in the
  same `storage` as the primary token. Never the id_token; the resource user
  (refresh_token, expiry) lives only in memory, never in `localStorage`.
- **Renewal** — when the token is expired or expires within 60 s, the next
  request renews it first (refresh_token when present, otherwise a silent
  authorize). If a refreshed JWT no longer carries the audience, a fresh silent
  authorize is used. A failed renewal clears that resource token and rejects
  the request with the underlying error — it **never** redirects to login (the
  primary session is still valid).
- **401** — a `401 {"error":"invalid_token"}` on a resource-attached instance
  clears only that resource token; the next request acquires a new one. It
  never triggers the login redirect.
- **Logout** — `logout()`, the automatic session close and any primary token
  clear also clear every resource token and in-memory resource user, and
  best-effort revoke them (`revokeTokens`, errors ignored).

### Página de silent callback (`silentRedirectUri`)

**Why:** by default the hidden iframe of the silent authorize lands on the
callback route, so it loads the **whole SPA** (bundle, router, Pinia,
`OidcCallback`) just to pass the response URL to the parent window. The
package ships a tiny dependency-free page that does only that.

1. Copy `node_modules/@munipuno/hydra-auth-vue/assets/oidc-silent-callback.html`
   to the SPA's `public/` (it must be served from the SPA origin).
2. Set the option:

   ```js
   createHydraAuth({
     // ...
     silentRedirectUri: `${window.location.origin}/oidc-silent-callback.html`,
   })
   ```

3. Register that exact URI (e.g. `https://app.munipuno.gob.pe/oidc-silent-callback.html`)
   in the Hydra client's `redirect_uris` — from the core's **Accesos (clients)**
   tab. Hydra rejects an unregistered redirect URI.

The page posts `{ source: 'oidc-client', url: location.href, keepOpen: false }`
to `window.parent` with `targetOrigin = location.origin` (what oidc-client-ts
expects), does nothing when opened top-level, and renders no UI.

Without `silentRedirectUri` everything keeps working through the normal
callback route (`redirectUri`).

### Still to confirm in the browser

Verified against a local Hydra v2 (client_credentials): an allowed audience
yields `aud: ["sistrans-local"]`, a non-allowed one fails with
`invalid_request`. Pending confirmation in a real browser session:

- the silent authorize with `audience` and `prompt=none` returns a token
  without UI once the primary session exists (third-party cookie / iframe
  restrictions apply when Hydra is on another site),
- consent for the audience is remembered,
- a refreshed resource token keeps its `aud`.

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
| `closeRedirect` | `'home'` | Destination after an automatic close. `'home'` navigates to `postLogoutRedirectUri` (the same place an explicit logout lands) with `?session_closed=idle\|max`; `'login'` keeps the pre-0.5 behavior (`routes.login` with `?reason=idle\|max`). |
| `sessionTimeouts` | `{ storage: window.localStorage }` | Advanced overrides: injectable `now` clock and `storage` (mainly for tests). |

Timers only run while a user is authenticated — they start after the signin
callback (or `loadUser()` with a user), never run on public routes before
login, and stop on close/logout. When both timeouts are disabled no timer or
listener is ever installed.

### Behavior on automatic close

When the idle or the max deadline is reached (or the user clicks "Salir"):

- silent renew stops and the OIDC user is removed (`userManager.removeUser()`),
- the stored token and the store are cleared, the profile retry timer stops,
- the browser lands where `closeRedirect` points:
  - `'home'` (default) — the configured `postLogoutRedirectUri` (the same place
    an explicit logout lands) with `?session_closed=idle|max` appended. When
    the URI is same-origin the redirect uses `router.replace` (no reload);
    when it is cross-origin a full navigation (`window.location.assign`) is
    used; when it is missing the router path `/` is used. Mount
    [`HydraSessionClosedNotice`](#showing-why-the-session-closed) on that page
    to tell the user why the session ended.
  - `'login'` — the login route (`routes.login`) with `?reason=idle|max`,
    where `OidcLogin` shows "Tu sesión se cerró por inactividad" / "Tu sesión
    se cerró por tiempo máximo" for 2.5 s before starting the login redirect
    (the pre-0.5 behavior).

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

### Showing why the session closed

With the default `closeRedirect: 'home'`, mount `<HydraSessionClosedNotice />`
on the public/landing layout (the page `postLogoutRedirectUri` points to). It
reads `?session_closed=idle|max` (also `?reason=` for backward compatibility)
and renders a dismissible branded toast — fixed top-center, auto-hidden after
8 s — with "Tu sesión se cerró por inactividad" / "Tu sesión se cerró por
tiempo máximo". Dismissing it removes `session_closed` from the URL (keeping
the other query params); missing/unknown values render nothing.

```vue
<template>
  <HydraSessionClosedNotice />
  <router-view />
</template>

<script setup>
import { HydraSessionClosedNotice } from '@munipuno/hydra-auth-vue'
</script>
```

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
