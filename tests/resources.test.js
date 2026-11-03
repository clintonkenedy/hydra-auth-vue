import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import axios from 'axios'
import { createHydraAuth, useHydraAuth } from '../src/index.js'

const oidc = vi.hoisted(() => ({ instances: [], silentImpl: null }))

vi.mock('oidc-client-ts', () => {
  class InMemoryWebStorage {
    constructor() {
      this._data = {}
    }
    getItem(key) {
      return key in this._data ? this._data[key] : null
    }
    setItem(key, value) {
      this._data[key] = String(value)
    }
    removeItem(key) {
      delete this._data[key]
    }
  }
  class WebStorageStateStore {
    constructor(opts) {
      this.store = opts.store
    }
  }
  class UserManager {
    constructor(settings) {
      this.settings = settings
      this._handlers = {
        userLoaded: [],
        accessTokenExpired: [],
        silentRenewError: [],
      }
      this.events = {
        addUserLoaded: (fn) => this._handlers.userLoaded.push(fn),
        addAccessTokenExpired: (fn) => this._handlers.accessTokenExpired.push(fn),
        addSilentRenewError: (fn) => this._handlers.silentRenewError.push(fn),
      }
      this.signinRedirect = vi.fn().mockResolvedValue(undefined)
      this.signoutRedirect = vi.fn().mockResolvedValue(undefined)
      this.signinRedirectCallback = vi.fn()
      this.signinCallback = vi.fn()
      this.signinSilent = vi.fn((args) => oidc.silentImpl(args, this))
      this.revokeTokens = vi.fn().mockResolvedValue(undefined)
      this.removeUser = vi.fn().mockResolvedValue(undefined)
      this.getUser = vi.fn().mockResolvedValue(null)
      oidc.instances.push(this)
    }
    _fire(name, arg) {
      this._handlers[name].forEach((fn) => fn(arg))
    }
  }
  return { UserManager, WebStorageStateStore, InMemoryWebStorage }
})

const BASE_OPTIONS = {
  authority: 'https://hydra.example.test',
  clientId: 'test-client',
  redirectUri: 'http://localhost/oidc-callback',
  postLogoutRedirectUri: 'http://localhost/',
  coreApiUrl: 'https://core.example.test',
}

const RESOURCES = { sistrans: { audience: 'sistrans-local' } }

const nowSeconds = () => Math.floor(Date.now() / 1000)

function resourceUser(accessToken, { expiresIn = 3600, ...rest } = {}) {
  return {
    access_token: accessToken,
    id_token: 'resource-id-token',
    refresh_token: 'resource-refresh-token',
    expires_at: nowSeconds() + expiresIn,
    ...rest,
  }
}

function makeAuth(extra = {}) {
  return createHydraAuth({ ...BASE_OPTIONS, ...extra })
}

function okInstance(seen) {
  return axios.create({
    adapter: async (config) => {
      seen.push(config)
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
    },
  })
}

function unauthorized(config, error = 'invalid_token') {
  return new axios.AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
    status: 401,
    statusText: 'Unauthorized',
    data: { error },
    headers: {},
    config,
  })
}

function jwt(payload) {
  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=+$/, '')
  return `${enc({ alg: 'none' })}.${enc(payload)}.sig`
}

function resourceManagers() {
  return oidc.instances.slice(1)
}

describe('resource tokens (F5)', () => {
  afterEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    oidc.instances.length = 0
    oidc.silentImpl = async () => resourceUser('res-at')
    setActivePinia(createPinia())
  })

  describe('S1 option', () => {
    it('without resources attach(instance) keeps the primary token and creates no extra UserManager', async () => {
      const auth = makeAuth()
      sessionStorage.setItem('token', 'Bearer primary-token')
      const seen = []
      const instance = okInstance(seen)

      auth.attach(instance)
      await instance.get('/x')

      expect(seen[0].headers['Authorization']).toBe('Bearer primary-token')
      expect(oidc.instances).toHaveLength(1)
      expect(auth.context.resources.names).toEqual([])
    })

    it('with resources declared, attach(instance) without options still uses the primary token', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      sessionStorage.setItem('token', 'Bearer primary-token')
      const seen = []
      const instance = okInstance(seen)

      auth.attach(instance)
      await instance.get('/x')

      expect(seen[0].headers['Authorization']).toBe('Bearer primary-token')
      expect(auth.userManager.signinSilent).not.toHaveBeenCalled()
      expect(oidc.instances).toHaveLength(1)
    })

    it('with resources declared, a primary 401 invalid_token still clears and redirects once', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      sessionStorage.setItem('token', 'Bearer doomed')
      const instance = axios.create({
        adapter: async (config) => {
          throw unauthorized(config)
        },
      })

      auth.attach(instance)
      await expect(instance.get('/x')).rejects.toThrow()
      await expect(instance.get('/x')).rejects.toThrow()

      expect(sessionStorage.getItem('token')).toBeNull()
      expect(auth.userManager.signinRedirect).toHaveBeenCalledTimes(1)
    })
  })

  describe('S2 attach', () => {
    it('throws synchronously for an unknown resource name', () => {
      const auth = makeAuth({ resources: RESOURCES })
      const instance = okInstance([])

      expect(() => auth.attach(instance, { resource: 'nope' })).toThrow(
        'hydra-auth: unknown resource "nope"; declare it in createHydraAuth({ resources })',
      )
    })

    it('throws when no resources were declared at all', () => {
      const auth = makeAuth()

      expect(() => auth.attach(okInstance([]), { resource: 'sistrans' })).toThrow(
        'hydra-auth: unknown resource "sistrans"; declare it in createHydraAuth({ resources })',
      )
    })

    it('returns interceptor ids for a known resource', () => {
      const auth = makeAuth({ resources: RESOURCES })

      const ids = auth.attach(okInstance([]), { resource: 'sistrans' })

      expect(ids).toEqual({ request: expect.any(Number), response: expect.any(Number) })
    })
  })

  describe('S3 lazy acquisition', () => {
    it('first request acquires the resource token silently and sends it; the primary token is untouched', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      sessionStorage.setItem('token', 'Bearer primary-token')
      const seen = []
      const instance = okInstance(seen)

      auth.attach(instance, { resource: 'sistrans' })
      expect(resourceManagers()).toHaveLength(0)
      await instance.get('/x')

      expect(seen[0].headers['Authorization']).toBe('Bearer res-at')
      expect(sessionStorage.getItem('token')).toBe('Bearer primary-token')
      expect(auth.userManager.signinSilent).not.toHaveBeenCalled()
      const [manager] = resourceManagers()
      expect(manager.signinSilent).toHaveBeenCalledTimes(1)
      expect(manager.signinSilent).toHaveBeenCalledWith({
        extraQueryParams: { audience: 'sistrans-local' },
      })
    })

    it('passes the resource scope when declared', async () => {
      const auth = makeAuth({
        resources: { sistrans: { audience: 'sistrans-local', scope: 'openid offline_access' } },
      })
      const instance = okInstance([])

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/x')

      expect(resourceManagers()[0].signinSilent).toHaveBeenCalledWith({
        extraQueryParams: { audience: 'sistrans-local' },
        scope: 'openid offline_access',
      })
    })

    it('builds the resource UserManager from the primary settings with an in-memory user store', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      const instance = okInstance([])

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/x')

      const settings = resourceManagers()[0].settings
      expect(settings.authority).toBe(BASE_OPTIONS.authority)
      expect(settings.client_id).toBe(BASE_OPTIONS.clientId)
      expect(settings.redirect_uri).toBe(BASE_OPTIONS.redirectUri)
      expect(settings.silent_redirect_uri).toBe(BASE_OPTIONS.redirectUri)
      expect(settings.response_type).toBe('code')
      expect(settings.automaticSilentRenew).toBe(false)
      expect(settings.userStore.store).not.toBe(sessionStorage)
      expect(settings.userStore.store).not.toBe(localStorage)
      expect(settings.userStore.store.constructor.name).toBe('InMemoryWebStorage')
    })

    // The silent authorize crosses Hydra, the IdP login and consent pages and
    // the SPA callback; oidc-client-ts's default 10 s is too short for that
    // chain (seen in the browser: "IFrame timed out without a response").
    it('gives the silent request 30 s by default', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      const instance = okInstance([])

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/x')

      expect(resourceManagers()[0].settings.silentRequestTimeoutInSeconds).toBe(30)
    })

    it('lets a resource override the silent request timeout', async () => {
      const auth = makeAuth({
        resources: { sistrans: { audience: 'sistrans-local', silentRequestTimeoutInSeconds: 45 } },
      })
      const instance = okInstance([])

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/x')

      expect(resourceManagers()[0].settings.silentRequestTimeoutInSeconds).toBe(45)
    })

    it('two concurrent first requests share one signinSilent', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      const seen = []
      const instance = okInstance(seen)

      auth.attach(instance, { resource: 'sistrans' })
      await Promise.all([instance.get('/a'), instance.get('/b')])

      expect(resourceManagers()).toHaveLength(1)
      expect(resourceManagers()[0].signinSilent).toHaveBeenCalledTimes(1)
      expect(seen.map((c) => c.headers['Authorization'])).toEqual([
        'Bearer res-at',
        'Bearer res-at',
      ])
    })

    it('a valid token is reused without a new signinSilent', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      const instance = okInstance([])

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/a')
      await instance.get('/b')

      expect(resourceManagers()[0].signinSilent).toHaveBeenCalledTimes(1)
    })

    it('a silent signin callback inside the iframe is dispatched without touching the primary token', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      sessionStorage.setItem('token', 'Bearer primary-token')
      auth.userManager.signinCallback.mockResolvedValue(undefined)
      const store = useHydraAuth()
      const descriptor = Object.getOwnPropertyDescriptor(window, 'parent')
      Object.defineProperty(window, 'parent', { value: {}, configurable: true })
      try {
        let settled = false
        store.signinCallback().then(
          () => (settled = true),
          () => (settled = true),
        )
        await new Promise((r) => setTimeout(r, 0))

        expect(auth.userManager.signinCallback).toHaveBeenCalledTimes(1)
        expect(auth.userManager.signinRedirectCallback).not.toHaveBeenCalled()
        expect(sessionStorage.getItem('token')).toBe('Bearer primary-token')
        expect(store.user).toBeNull()
        expect(settled).toBe(false)
      } finally {
        if (descriptor) Object.defineProperty(window, 'parent', descriptor)
        else delete window.parent
      }
    })
  })

  describe('S4 storage', () => {
    it('stores "Bearer <access_token>" under <tokenStorageKey>:resource:<name> and nothing in localStorage', async () => {
      const auth = makeAuth({ resources: RESOURCES, tokenStorageKey: 'tk' })
      const instance = okInstance([])

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/x')

      expect(sessionStorage.getItem('tk:resource:sistrans')).toBe('Bearer res-at')
      expect(auth.context.resources.getToken('sistrans')).toBe('Bearer res-at')
      const sessionValues = Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k))
      expect(sessionValues.join('|')).not.toContain('resource-id-token')
      expect(sessionValues.join('|')).not.toContain('resource-refresh-token')
      expect(localStorage.length).toBe(0)
    })
  })

  describe('S5 renewal', () => {
    it('renews a token expiring within 60 s before sending', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      const users = [resourceUser('first-at', { expiresIn: 30 }), resourceUser('second-at')]
      oidc.silentImpl = async () => users.shift()
      const seen = []
      const instance = okInstance(seen)

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/a')
      await instance.get('/b')

      expect(resourceManagers()[0].signinSilent).toHaveBeenCalledTimes(2)
      expect(seen[1].headers['Authorization']).toBe('Bearer second-at')
      expect(sessionStorage.getItem('token:resource:sistrans')).toBe('Bearer second-at')
    })

    it('renews an expired token before sending', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      const users = [resourceUser('old-at', { expiresIn: -10 }), resourceUser('new-at')]
      oidc.silentImpl = async () => users.shift()
      const seen = []
      const instance = okInstance(seen)

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/a')
      await instance.get('/b')

      expect(seen[1].headers['Authorization']).toBe('Bearer new-at')
    })

    it('a failed renewal clears the resource token and rejects without redirecting', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      sessionStorage.setItem('token', 'Bearer primary-token')
      const failure = new Error('login_required')
      let calls = 0
      oidc.silentImpl = async () => {
        calls += 1
        if (calls === 1) return resourceUser('soon-at', { expiresIn: 10 })
        throw failure
      }
      const seen = []
      const instance = okInstance(seen)

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/a')
      await expect(instance.get('/b')).rejects.toBe(failure)

      expect(seen).toHaveLength(1)
      expect(sessionStorage.getItem('token:resource:sistrans')).toBeNull()
      expect(sessionStorage.getItem('token')).toBe('Bearer primary-token')
      expect(auth.userManager.signinRedirect).not.toHaveBeenCalled()
    })

    it('a refreshed JWT that lost the audience is replaced by a fresh silent authorize', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      const users = [
        resourceUser(jwt({ aud: ['sistrans-local'] }), { expiresIn: 10 }),
        resourceUser(jwt({ aud: [] })),
        resourceUser(jwt({ aud: ['sistrans-local'], n: 3 })),
      ]
      oidc.silentImpl = async () => users.shift()
      const seen = []
      const instance = okInstance(seen)

      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/a')
      await instance.get('/b')

      const manager = resourceManagers()[0]
      expect(manager.signinSilent).toHaveBeenCalledTimes(3)
      expect(manager.signinSilent).toHaveBeenLastCalledWith({
        extraQueryParams: { audience: 'sistrans-local' },
        forceIframeAuth: true,
      })
      expect(seen[1].headers['Authorization']).toBe(
        'Bearer ' + jwt({ aud: ['sistrans-local'], n: 3 }),
      )
    })
  })

  describe('S6 401', () => {
    it('401 invalid_token clears only the resource token, never redirects, and the next request re-acquires', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      sessionStorage.setItem('token', 'Bearer primary-token')
      const users = [resourceUser('rejected-at'), resourceUser('fresh-at')]
      oidc.silentImpl = async () => users.shift()
      let fail = true
      const seen = []
      const instance = axios.create({
        adapter: async (config) => {
          seen.push(config)
          if (fail) {
            fail = false
            throw unauthorized(config)
          }
          return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
        },
      })

      auth.attach(instance, { resource: 'sistrans' })
      await expect(instance.get('/a')).rejects.toThrow()

      expect(sessionStorage.getItem('token:resource:sistrans')).toBeNull()
      expect(sessionStorage.getItem('token')).toBe('Bearer primary-token')
      expect(auth.userManager.signinRedirect).not.toHaveBeenCalled()
      expect(resourceManagers()[0].removeUser).toHaveBeenCalled()

      await instance.get('/b')

      expect(resourceManagers()[0].signinSilent).toHaveBeenCalledTimes(2)
      expect(seen[1].headers['Authorization']).toBe('Bearer fresh-at')
    })

    it('a 401 with another error keeps the resource token', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      const instance = axios.create({
        adapter: async (config) => {
          throw unauthorized(config, 'something_else')
        },
      })

      auth.attach(instance, { resource: 'sistrans' })
      await expect(instance.get('/a')).rejects.toThrow()

      expect(sessionStorage.getItem('token:resource:sistrans')).toBe('Bearer res-at')
    })
  })

  describe('S7 logout', () => {
    it('logout clears every resource token and revokes them best-effort', async () => {
      const auth = makeAuth({
        resources: { sistrans: { audience: 'sistrans-local' }, core: { audience: 'core-local' } },
      })
      const a = okInstance([])
      const b = okInstance([])
      auth.attach(a, { resource: 'sistrans' })
      auth.attach(b, { resource: 'core' })
      await a.get('/x')
      await b.get('/x')
      const [m1, m2] = resourceManagers()
      m1.revokeTokens.mockRejectedValue(new Error('revocation down'))
      const store = useHydraAuth()

      await store.logout()
      await new Promise((r) => setTimeout(r, 0))

      expect(sessionStorage.getItem('token:resource:sistrans')).toBeNull()
      expect(sessionStorage.getItem('token:resource:core')).toBeNull()
      expect(m1.revokeTokens).toHaveBeenCalledTimes(1)
      expect(m2.revokeTokens).toHaveBeenCalledTimes(1)
      expect(m1.removeUser).toHaveBeenCalled()
      expect(auth.userManager.signoutRedirect).toHaveBeenCalledTimes(1)
    })

    it('after clearToken the next request acquires a new resource token', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      const users = [resourceUser('before-at'), resourceUser('after-at')]
      oidc.silentImpl = async () => users.shift()
      const seen = []
      const instance = okInstance(seen)
      auth.attach(instance, { resource: 'sistrans' })
      await instance.get('/a')

      auth.context.clearToken()
      await instance.get('/b')

      expect(seen[1].headers['Authorization']).toBe('Bearer after-at')
    })

    it('an acquisition still in flight when the session is cleared stores nothing', async () => {
      const auth = makeAuth({ resources: RESOURCES })
      let resolve
      oidc.silentImpl = () => new Promise((r) => (resolve = r))
      const instance = okInstance([])
      auth.attach(instance, { resource: 'sistrans' })

      const pending = instance.get('/a')
      await new Promise((r) => setTimeout(r, 0))
      auth.context.clearToken()
      resolve(resourceUser('late-at'))

      await expect(pending).rejects.toThrow('hydra-auth: resource "sistrans" token was cleared')
      expect(sessionStorage.getItem('token:resource:sistrans')).toBeNull()
    })
  })
})
