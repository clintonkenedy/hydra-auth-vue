# F9 — SPAs work with the client's own CORS origins (no Hydra global CORS list)

`@munipuno/hydra-auth-vue` gets an opt-in mode that never fetches Hydra's discovery document, so a new
SPA only needs its origin in the client's "Orígenes permitidos (CORS)" (core UI) instead of Hydra's
global `HYDRA_CORS_ORIGINS` plus an IdP restart. Release v0.7.0; SGP and portal adopt it.

## Specs

- **S1 — Opt-in mode without discovery.** New option `discovery` (default `true`: behaviour unchanged).
  With `discovery: false` the library builds the OIDC metadata from `authority` with Hydra's fixed
  paths and passes it to oidc-client-ts, which then never requests `/.well-known/openid-configuration`:
  `issuer` = `authority`, `authorization_endpoint` = `<base>/oauth2/auth`, `token_endpoint` =
  `<base>/oauth2/token`, `userinfo_endpoint` = `<base>/userinfo`, `end_session_endpoint` =
  `<base>/oauth2/sessions/logout`, `revocation_endpoint` = `<base>/oauth2/revoke`, `jwks_uri` =
  `<base>/.well-known/jwks.json` (`<base>` = `authority` without a trailing `/`).
- **S2 — No userinfo in that mode.** With `discovery: false`, `loadUserInfo` is `false`: the userinfo
  call carries a bearer token, so the browser sends a CORS preflight that only Hydra's global list
  passes (L3). The OIDC profile then comes from the id_token (`sub`, `auth_time`, `iat`, which is all
  the library reads). The resource managers (F5 `resources`) receive the same metadata.
- **S3 — Exported helper.** `hydraMetadata(authority)` returns the S1 object (used by the library and
  by tests).
- **S4 — Tests.** With `discovery: false`: the UserManager settings carry exactly the S1 metadata and
  `loadUserInfo: false`, no request goes to the discovery URL when the metadata is read, and resource
  managers get the same metadata. Default mode: no `metadata` setting and `loadUserInfo: true`
  (unchanged). `hydraMetadata` trims one trailing slash.
- **S5 — Release v0.7.0.** `package.json` version, README section (when to use the option, what it
  changes, the requirement that the client's allowed CORS origins include the SPA origin). Tag
  `v0.7.0`; pushing it is the owner's call.
- **S6 — Consumers.** SGP (`frontend`) and muni-portal switch to v0.7.0 with `discovery: false`; their
  tests and builds pass.
- **S7 — Docs.** The core integration guide (muni-usuarios) explains that with `discovery: false`
  the client's "Orígenes permitidos (CORS)" is enough, and that apps without it still need Hydra's
  global list.

## Tasks

- [x] T1 — S1-S5 (library, tests, README, version) — worker — commit: the `feat:` commit tagged `v0.7.0`
  (Risk item 2, see L5)
- [x] T2 — S6 (SGP + portal) — inline — commits: SGP `c7055a7` (pushed), muni-portal `007d898` (local, no
  remote) (L6)
- [x] T3 — S7 (guide) — inline — commit: muni-usuarios `fed1d29` (pushed)
- [x] T4 — pushes — owner: "Sí, pusheá todo cuando esté verificado" — library `main` + tag `v0.7.0`,
  muni-usuarios `main`, SGP `main` (L6)

## Log

- L1 (user, verbatim, after the SGP CORS failure): "si aqui bro esto no puede ser configurable desde
  interfaz del core bro HYDRA_CORS_ORIGINS=..." ; then "bro explicame mas simple y de amnera
  intuitiva", "y bro no afectamos la seguridad con eso?" and "ok bro dale" (authorizes F9, including
  writes in `/Users/cventura/Desktop/proyectos/hydra-auth-vue`).
- L2 (evidence, Hydra source `x/oauth2cors/cors.go`): with a non-empty global list, an origin not in
  it is allowed only when the request names the client (`client_id` form field, basic auth or a bearer
  token that introspects to a client) and the client's `allowed_cors_origins` contains the origin.
- L3 (evidence, local Hydra v25.4.0 with a global list, throwaway public client allowing only
  `https://allowed.example`, deleted afterwards): token (authorization_code), refresh_token and revoke
  requests from that origin get `Access-Control-Allow-Origin`; the same token request from another
  origin does not; `/.well-known/openid-configuration` from that origin does not; a CORS preflight to
  `/userinfo` (`Access-Control-Request-Headers: authorization`) from that origin answers 204 without
  the header, while a preflight from a globally listed origin gets it.
- L4 (evidence, oidc-client-ts 3.5.0): it never validates the id_token issuer or signature
  (`_validateIdTokenAttributes` checks `sub`, `nonce`, and `sub`/`auth_time`/`azp` against the previous
  token; `getSigningKeys()` has no caller), so static metadata removes no browser-side check; the
  backends keep verifying access tokens against Hydra's JWKS.
- L5 (evidence, T1): the worker observed RED (5 of 9 new tests failing: no `hydraMetadata`, no
  metadata, the discovery URL was fetched) then GREEN; full suite 108. An independent verifier passed
  S1-S4 (S5 waited only for the tag): it re-ran the new tests against the `v0.6.0` sources (5 fail, so
  they detect the missing feature), confirmed default-mode settings are unchanged (no `metadata` key,
  `loadUserInfo: true`), that every remaining request to Hydra in that mode is a page navigation or a
  simple form POST with `client_id` (code exchange, refresh, revoke), and that no browser-side check is
  removed. Its suggested pinning test (no `monitorSession`, no `revokeTokensOnSignout`, no
  `check_session_iframe`) was added: suite 109. Advisories kept as documentation: pass a real boolean
  `false`; `authority` must be Hydra's public URL that is also its issuer.
- L6 (evidence, T2-T4): the library's `origin` remote is HTTPS without credentials, so `main` and the
  tag were pushed over SSH to the same repository (`7359b94..079bf50`, tag `v0.7.0` → `079bf50`);
  codeload answered 404 for `refs/tags/v0.7.0` for a few minutes (a request made before the push was
  cached) while the other archive URLs answered 200, then 200. SGP: 0.7.0 installed (`hydraMetadata`
  exported), vitest 17 OK, vite build OK, and the bundle contains the static Hydra paths and
  `discovery:false`; pushed `37c52e8..c7055a7`. Portal: 0.7.0 installed, vitest 17 OK, eslint and
  prettier clean, `quasar build` OK; committed locally `007d898` (no remote). Guide: muni-usuarios
  `fed1d29` pushed. Not verified: a full browser login from an origin that is only in the client's
  list (the CORS part was proven with curl against local Hydra in L3; the library part by unit tests).
- L7 (user, verbatim, production): "todo bien bro" — after deploying the SGP front `c7055a7` and
  removing `https://sgp.dev.munipuno.gob.pe` from Hydra's global `HYDRA_CORS_ORIGINS` (steps given
  in chat), the owner reports the SGP login works. Reported by the owner, not observed by the agent.
