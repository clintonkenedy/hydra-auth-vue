/**
 * Static OIDC metadata for an Ory Hydra authority (F9).
 *
 * Built from Hydra's fixed public paths so oidc-client-ts never requests
 * `<authority>/.well-known/openid-configuration` (that request only passes
 * Hydra's global CORS list, not the client's allowed CORS origins).
 *
 * @param {string} authority Hydra public URL. Kept as given for `issuer`;
 *   one trailing `/` is trimmed to build the endpoints.
 * @returns {{ issuer: string, authorization_endpoint: string, token_endpoint: string,
 *   userinfo_endpoint: string, end_session_endpoint: string, revocation_endpoint: string,
 *   jwks_uri: string }}
 */
export function hydraMetadata(authority) {
  const base = authority.endsWith('/') ? authority.slice(0, -1) : authority
  return {
    issuer: authority,
    authorization_endpoint: `${base}/oauth2/auth`,
    token_endpoint: `${base}/oauth2/token`,
    userinfo_endpoint: `${base}/userinfo`,
    end_session_endpoint: `${base}/oauth2/sessions/logout`,
    revocation_endpoint: `${base}/oauth2/revoke`,
    jwks_uri: `${base}/.well-known/jwks.json`,
  }
}
