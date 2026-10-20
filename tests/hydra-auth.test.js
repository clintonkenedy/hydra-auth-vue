import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import axios from 'axios'
import { createHydraAuth, useHydraAuth } from '../src/index.js'

vi.mock('oidc-client-ts', () => {
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
      this.getUser = vi.fn().mockResolvedValue(null)
    }
    _fire(name, arg) {
      this._handlers[name].forEach((fn) => fn(arg))
    }
  }
  return { UserManager, WebStorageStateStore }
})

const BASE_OPTIONS = {
  authority: 'https://hydra.example.test',
  clientId: 'test-client',
  redirectUri: 'http://localhost/oidc-callback',
  postLogoutRedirectUri: 'http://localhost/',
  coreApiUrl: 'https://core.example.test',
}

function makeAuth(extra = {}) {
  return createHydraAuth({ ...BASE_OPTIONS, ...extra })
}

describe('@munipuno/hydra-auth-vue', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('signinCallback stores "Bearer <access_token>" and never the id_token', async () => {
    const auth = makeAuth()
    auth.userManager.signinRedirectCallback.mockResolvedValue({
      access_token: 'the-access-token',
      id_token: 'the-id-token',
    })
    const store = useHydraAuth()

    await store.signinCallback()

    const stored = sessionStorage.getItem('token')
    expect(stored).toBe('Bearer the-access-token')
    expect(stored).not.toContain('the-id-token')
  })

  it('addUserLoaded updates the stored token (silent renew propagation)', () => {
    const auth = makeAuth()
    sessionStorage.setItem('token', 'Bearer stale-token')

    auth.userManager._fire('userLoaded', { access_token: 'renewed-token' })

    expect(sessionStorage.getItem('token')).toBe('Bearer renewed-token')
  })

  it('addSilentRenewError clears token and calls signinRedirect once even if fired twice', () => {
    const auth = makeAuth()
    sessionStorage.setItem('token', 'Bearer some-token')

    auth.userManager._fire('silentRenewError', new Error('renew failed'))
    auth.userManager._fire('silentRenewError', new Error('renew failed'))

    expect(sessionStorage.getItem('token')).toBeNull()
    expect(auth.userManager.signinRedirect).toHaveBeenCalledTimes(1)
  })

  it('attach sets the Authorization header from the stored token', async () => {
    const auth = makeAuth()
    sessionStorage.setItem('token', 'Bearer header-token')
    let seenConfig = null
    const instance = axios.create({
      adapter: async (config) => {
        seenConfig = config
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
      },
    })

    const ids = auth.attach(instance)
    await instance.get('/anything')

    expect(seenConfig.headers['Authorization']).toBe('Bearer header-token')
    expect(ids).toEqual({ request: expect.any(Number), response: expect.any(Number) })
  })

  it('attach does not set Authorization when no token is stored', async () => {
    const auth = makeAuth()
    let seenConfig = null
    const instance = axios.create({
      adapter: async (config) => {
        seenConfig = config
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
      },
    })

    auth.attach(instance)
    await instance.get('/anything')

    expect(seenConfig.headers['Authorization']).toBeUndefined()
  })

  it('401 invalid_token response clears token and redirects once', async () => {
    const auth = makeAuth()
    sessionStorage.setItem('token', 'Bearer doomed-token')
    const instance = axios.create({
      adapter: async (config) => {
        throw new axios.AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
          status: 401,
          statusText: 'Unauthorized',
          data: { error: 'invalid_token' },
          headers: {},
          config,
        })
      },
    })

    auth.attach(instance)
    await expect(instance.get('/x')).rejects.toThrow()
    await expect(instance.get('/x')).rejects.toThrow()

    expect(sessionStorage.getItem('token')).toBeNull()
    expect(auth.userManager.signinRedirect).toHaveBeenCalledTimes(1)
  })

  it('guard redirects an unauthenticated requiresAuth route and stores redirectToAfterLogin', async () => {
    const auth = makeAuth()
    auth.userManager.getUser.mockResolvedValue(null)
    const handler = auth.guard({ public: [] })
    const next = vi.fn()

    await handler(
      { fullPath: '/admin/users?tab=2', path: '/admin/users', meta: { requiresAuth: true } },
      {},
      next,
    )

    expect(sessionStorage.getItem('redirectToAfterLogin')).toBe('/admin/users?tab=2')
    expect(auth.userManager.signinRedirect).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
  })

  it('guard passes public routes through', async () => {
    const auth = makeAuth()
    auth.userManager.getUser.mockResolvedValue(null)
    const handler = auth.guard({ public: ['/about'] })
    const next = vi.fn()

    await handler({ fullPath: '/about', path: '/about', meta: {} }, {}, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(auth.userManager.signinRedirect).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('redirectToAfterLogin')).toBeNull()
  })

  it('fetchProfile maps the payload into the store', async () => {
    makeAuth()
    sessionStorage.setItem('token', 'Bearer profile-token')
    const payload = {
      user: { id: 7, name: 'Juan', email: 'juan@puno.gob.pe', alias: 'jp' },
      permisos: ['ver-usuarios', 'editar-usuarios'],
      roles: ['admin'],
    }
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: payload })
    const store = useHydraAuth()

    await store.fetchProfile()

    expect(get).toHaveBeenCalledWith('https://core.example.test/api/user', {
      headers: { Authorization: 'Bearer profile-token' },
    })
    expect(store.id).toBe(7)
    expect(store.name).toBe('Juan')
    expect(store.email).toBe('juan@puno.gob.pe')
    expect(store.alias).toBe('jp')
    expect(store.permisos).toEqual(['ver-usuarios', 'editar-usuarios'])
    expect(store.roles).toEqual(['admin'])
  })

  it('hasPermission returns true for granted and false for missing permissions', () => {
    makeAuth()
    const store = useHydraAuth()
    store.permisos = ['ver-usuarios']

    expect(store.hasPermission('ver-usuarios')).toBe(true)
    expect(store.hasPermission('borrar-usuarios')).toBe(false)
  })

  it('logout clears the token, clears the store and calls signoutRedirect', async () => {
    const auth = makeAuth()
    sessionStorage.setItem('token', 'Bearer bye-token')
    const store = useHydraAuth()
    store.user = { access_token: 'bye-token' }
    store.id = 1
    store.permisos = ['x']

    await store.logout()

    expect(sessionStorage.getItem('token')).toBeNull()
    expect(store.user).toBeNull()
    expect(store.id).toBeNull()
    expect(store.permisos).toBeNull()
    expect(auth.userManager.signoutRedirect).toHaveBeenCalledTimes(1)
  })
})
