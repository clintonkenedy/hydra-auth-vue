/**
 * Default branding applied to the package-owned auth screens
 * (HydraAuthScreen, OidcLogin, OidcCallback, HydraSessionGuard).
 *
 * The colors mirror the municipal IdP login page so the OIDC transition
 * screens look consistent with it out of the box.
 */
export const DEFAULT_BRANDING = {
  logo: null,
  title: null,
  primaryColor: '#00aeee',
  primaryHoverColor: '#00caee',
  primaryActiveColor: '#16759f',
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
}

/**
 * Merge the branding stored on the auth context with the defaults.
 * Safe to call with a null/partial context (standalone component mounts).
 */
export function resolveBranding(context) {
  return { ...DEFAULT_BRANDING, ...(context?.branding ?? {}) }
}

/**
 * CSS custom properties fed to the scoped style blocks. Custom properties
 * (instead of inline colors) keep :hover / :focus / :active working.
 */
export function brandingCssVars(branding) {
  return {
    '--hydra-primary': branding.primaryColor,
    '--hydra-primary-hover': branding.primaryHoverColor,
    '--hydra-primary-active': branding.primaryActiveColor,
    '--hydra-font-family': branding.fontFamily,
  }
}
