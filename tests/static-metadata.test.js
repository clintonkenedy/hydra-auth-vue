import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import axios from 'axios'
import { UserManager } from 'oidc-client-ts'
import { createHydraAuth, hydraMetadata } from '../src/index.js'

// Real oidc-client-ts, with UserManager wrapped only to record the raw
// constructor settings and each instance (primary first, then resources).
const oidc = vi.hoisted(() => ({ instances: [], rawSettings: [] }))

vi.mock('oidc-client-ts', async (importOriginal) => {
  const actual = await importOriginal()
  class RecordingUserManager extends actual.UserManager {
    constructor(settings, ...rest) {
      super(settings, ...rest)
      oidc.rawSettings.push(settings)
      oidc.instances.push(this)
    }
  }
  return { ...actual, UserManager: RecordingUserManager }
})

const AUTHORITY = 'https://hydra.example.test'
const DISCOVERY_URL = `${AUTHORITY}/.well-known/openid-configuration`

const BASE_OPTIONS = {
  authority: AUTHORITY,
  clientId: 'test-client',
  redirectUri: 'http://localhost/oidc-callback',
  postLogoutRedirectUri: 'http://localhost/',
  coreApiUrl: 'https://core.example.test',
}

const EXPECTED_METADATA = {
  issuer: AUTHORITY,
  authorization_endpoint: `${AUTHORITY}/oauth2/auth`,
  token_endpoint: `${AUTHORITY}/oauth2/token`,
  userinfo_endpoint: `${AUTHORITY}/userinfo`,
  end_session_endpoint: `${AUTHORITY}/oauth2/sessions/logout`,
  revocation_endpoint: `${AUTHORITY}/oauth2/revoke`,
  jwks_uri: `${AUTHORITY}/.well-known/jwks.json`,
}

const RESOURCES = { sistrans: { audience: 'sistrans-local' } }

function requestedUrls(fetchSpy) {
  return fetchSpy.mock.calls.map(([input]) => String(input?.url ?? input))
}

describe('static Hydra metadata (F9)', () => {
  let fetchSpy

  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    oidc.instances.length = 0
    oidc.rawSettings.length = 0
    setActivePinia(createPinia())
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(JSON.stringify(EXPECTED_METADATA), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    localStorage.clear()
  })

  describe('hydraMetadata(authority)', () => {
    it('builds the Hydra endpoints from the authority', () => {
      expect(hydraMetadata(AUTHORITY)).toEqual(EXPECTED_METADATA)
    })

    it('trims one trailing slash from the endpoints and keeps the issuer as given', () => {
      const withSlash = hydraMetadata('https://idp.example/')
      const withoutSlash = hydraMetadata('https://idp.example')

      const { issuer: issuerWith, ...endpointsWith } = withSlash
      const { issuer: issuerWithout, ...endpointsWithout } = withoutSlash
      expect(endpointsWith).toEqual(endpointsWithout)
      expect(endpointsWith.token_endpoint).toBe('https://idp.example/oauth2/token')
      expect(endpointsWith.jwks_uri).toBe('https://idp.example/.well-known/jwks.json')
      expect(issuerWith).toBe('https://idp.example/')
      expect(issuerWithout).toBe('https://idp.example')
    })
  })

  describe('discovery: false', () => {
    it('passes exactly the Hydra metadata and loadUserInfo: false to the UserManager', () => {
      const auth = createHydraAuth({ ...BASE_OPTIONS, discovery: false })

      expect(oidc.instances).toHaveLength(1)
      expect(oidc.rawSettings[0].metadata).toEqual(EXPECTED_METADATA)
      expect(oidc.rawSettings[0].loadUserInfo).toBe(false)
      expect(auth.userManager.settings.metadata).toEqual(EXPECTED_METADATA)
      expect(auth.userManager.settings.loadUserInfo).toBe(false)
    })

    it('reading the metadata never requests the discovery document', async () => {
      const auth = createHydraAuth({ ...BASE_OPTIONS, discovery: false })

      const metadata = await auth.userManager.metadataService.getMetadata()
      const tokenEndpoint = await auth.userManager.metadataService.getTokenEndpoint()

      expect(metadata).toEqual(EXPECTED_METADATA)
      expect(tokenEndpoint).toBe(`${AUTHORITY}/oauth2/token`)
      expect(requestedUrls(fetchSpy)).not.toContain(DISCOVERY_URL)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('sets no option that needs a discovery-only value or a CORS preflight', () => {
      const auth = createHydraAuth({ ...BASE_OPTIONS, discovery: false })

      // Session monitoring needs check_session_iframe and revoke-on-signout adds a call
      // the SPA does not need: both stay off, and the static metadata has no iframe.
      expect(auth.userManager.settings.monitorSession).toBe(false)
      expect(auth.userManager.settings.revokeTokensOnSignout).toBe(false)
      expect(auth.userManager.settings.metadata.check_session_iframe).toBeUndefined()
    })

    it('resource managers receive the same metadata and no userinfo', async () => {
      vi.spyOn(UserManager.prototype, 'signinSilent').mockResolvedValue({
        access_token: 'res-at',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })
      const auth = createHydraAuth({ ...BASE_OPTIONS, discovery: false, resources: RESOURCES })
      const seen = []
      const instance = axios.create({
        adapter: async (config) => {
          seen.push(config)
          return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
        },
      })

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/x')

      expect(oidc.instances).toHaveLength(2)
      const resourceManager = oidc.instances[1]
      expect(oidc.rawSettings[1].metadata).toEqual(EXPECTED_METADATA)
      expect(resourceManager.settings.metadata).toEqual(EXPECTED_METADATA)
      expect(resourceManager.settings.loadUserInfo).toBe(false)
      expect(await resourceManager.metadataService.getTokenEndpoint()).toBe(
        `${AUTHORITY}/oauth2/token`,
      )
      expect(seen[0].headers['Authorization']).toBe('Bearer res-at')
      expect(requestedUrls(fetchSpy)).not.toContain(DISCOVERY_URL)
    })
  })

  describe('default mode (discovery: true) is unchanged', () => {
    it('passes no metadata and loadUserInfo: true', () => {
      const auth = createHydraAuth({ ...BASE_OPTIONS })

      expect('metadata' in oidc.rawSettings[0]).toBe(false)
      expect(oidc.rawSettings[0].loadUserInfo).toBe(true)
      expect(auth.userManager.settings.metadata).toBeUndefined()
      expect(auth.userManager.settings.loadUserInfo).toBe(true)
    })

    it('explicit discovery: true behaves like the default', () => {
      createHydraAuth({ ...BASE_OPTIONS, discovery: true })

      expect('metadata' in oidc.rawSettings[0]).toBe(false)
      expect(oidc.rawSettings[0].loadUserInfo).toBe(true)
    })

    it('still reads the metadata from the discovery document', async () => {
      const auth = createHydraAuth({ ...BASE_OPTIONS })

      await auth.userManager.metadataService.getTokenEndpoint()

      expect(requestedUrls(fetchSpy)).toContain(DISCOVERY_URL)
    })

    it('resource managers get no metadata setting', async () => {
      vi.spyOn(UserManager.prototype, 'signinSilent').mockResolvedValue({
        access_token: 'res-at',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      })
      const auth = createHydraAuth({ ...BASE_OPTIONS, resources: RESOURCES })
      const instance = axios.create({
        adapter: async (config) => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config }),
      })

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/x')

      expect(oidc.instances).toHaveLength(2)
      expect('metadata' in oidc.rawSettings[1]).toBe(false)
      expect(oidc.rawSettings[1].loadUserInfo).toBe(false)
    })
  })
})
