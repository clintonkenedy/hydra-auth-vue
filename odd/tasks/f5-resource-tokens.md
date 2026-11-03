# F5: one token per API (resource tokens) in @munipuno/hydra-auth-vue

Branch: `feat/f5-resource-tokens`. Test-first, no push. Source: muni-infra `BACKLOG.md` § F5
(owner decision: option B, one token per API, RFC 8707 style via Hydra `audience`).

## Specs

- S1 (option) `createHydraAuth({ resources })`: `resources` is an optional map `name -> { audience: string, scope?: string }`. Absent or empty: behavior identical to v0.5.0 (every existing test passes unchanged).
- S2 (attach) `attach(axiosInstance, { resource: name })` attaches an instance to the token of that resource instead of the primary token. An unknown `name` throws at attach time with a clear message. `attach(axiosInstance)` without options keeps today's behavior.
- S3 (lazy acquisition) The first request on a resource-attached instance obtains that resource's token in the background with `userManager.signinSilent({ extraQueryParams: { audience }, scope? })` (prompt=none; no UI). Concurrent first requests share one in-flight acquisition. On success the request goes out with `Authorization: Bearer <resource access_token>`. The primary user/token is never replaced by the resource user.
- S4 (storage) Resource tokens are stored under `<tokenStorageKey>:resource:<name>` in the same `storage` as the primary token, as `Bearer <access_token>` (never the id_token); the resource `User` (with refresh_token/expires_at) is kept in memory per resource, never in localStorage.
- S5 (renewal) When a resource token is expired or expires within 60 s, the next request renews it before sending: with `signinSilent` again (Hydra keeps the audience on the refreshed token — spike result to confirm in the browser; if the refreshed token loses `aud`, a fresh silent authorize with `audience` is used). A failed renewal clears that resource token and rejects the request with the underlying error; it never redirects to login (the primary session is still valid).
- S6 (401) A 401 `invalid_token` on a resource-attached instance clears only that resource token and retries the acquisition once on the next request; it never triggers `redirectToLoginOnce()`.
- S7 (logout) `clearToken()` / logout also clears every resource token and in-memory resource user. Resource tokens are best-effort revoked on logout when `userManager.revokeTokens` is available.
- S8 (docs) README documents `resources`, `attach(..., { resource })`, the Hydra prerequisite (client `audience` allow-list) and the failure modes.

## Spike results (parent, local Hydra v2, client_credentials)

- Hydra enforces the per-client `audience` allow-list: requesting an allowed audience yields a token with `aud: ["sistrans-local"]`; a non-allowed one is refused with `invalid_request`; no audience → `aud: []`.
- Still to confirm in the browser (owner): silent authorize with `audience` and `prompt=none` returns a token without UI once the primary session exists; consent remembered; refresh keeps `aud`.

## Tasks

- [x] T1 S1-S7 — `src/resources.js` (`createResourceTokens`), resource-aware `attach(instance, { resource })`, lazy acquisition with shared in-flight promise, renewal 60 s before expiry, 401 clears only that token, `clearToken` revokes all (best-effort, errors swallowed). Design: one `UserManager` per resource (oidc-client-ts 3.5 `signinSilent` always stores the user), in-memory store, `silent_redirect_uri = redirectUri`; `store.signinCallback` detects the iframe and dispatches `signinCallback()` without touching the primary user. Route: worker, test-first. Commit: `86cb158`. Evidence: RED 19 → GREEN `tests/resources.test.js` 22/22; full suite 82/82 (60 existing unchanged).
- [x] T2 S8 — README: `resources` option, `attach(..., { resource })`, section "Varios tokens por API (resources)" with the Hydra prerequisite and failure modes. Same commit as T1.
- [ ] T3 — browser confirmation in front-usuarios dev (owner). Setup done by the parent: Hydra `usuarios-local` audience = [sistrans-local, usuarios-local]; muni-usuarios branch `spike/f5-resource-tokens` (DO NOT MERGE) installs the package from `file:../../hydra-auth-vue` and wires `resources.sistrans` + `window.__f5` (dev only). Waiting for the owner's result with `resources: { sistrans: { audience: 'sistrans-local' } }` after adding `audience: ["sistrans-local"]` to the `usuarios-local` Hydra client. Route: owner + parent. Commit: n/a.

## Log

- L1 (owner, verbatim): "si bro mergealo a min y marcalo como gechi y e inicia f5 bro" (after choosing option B: "ok bro ta bien tons vamos con esa").
- L2 (evidence): package is 993 lines; `src/axios.js` `createAttach(context)` reads `context.getToken()`; `src/createHydraAuth.js` builds one `UserManager` (authority, client_id, PKCE code flow, `automaticSilentRenew`), stores `Bearer <access_token>` under `tokenStorageKey` in `storage` (sessionStorage), and `redirectToLoginOnce()` on expiry/renew error/401.
- L3 (worker question, unanswered in time → option A taken): first acquisition has no resource user, so it goes through a hidden iframe on the existing callback route; `OidcCallback.vue` untouched, no `silentRedirectUri` option. Follow-up (post-T3): lightweight silent-callback page + optional `silentRedirectUri`, registered in Hydra.
- L4 (risk, open until T3): the iframe briefly loads the whole SPA on the callback route; Hydra must answer `prompt=none` inside an iframe (same-site cookies); a resource without `scope` inherits the primary scope incl. `offline_access` (refresh token kept in memory).
- Engram mirror: no memory tools callable in this session.
