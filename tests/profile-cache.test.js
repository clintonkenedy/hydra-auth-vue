import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import axios from 'axios'
import { createHydraAuth, useHydraAuth, HydraDegradedBanner } from '../src/index.js'

vi.mock('oidc-client-ts', () => {
  class WebStorageStateStore {
    constructor(opts) {
      this.store = opts.store
    }
  }
  class UserManager {
    constructor(settings) {
      this.settings = settings
      this.events = {
        addUserLoaded: vi.fn(),
        addAccessTokenExpired: vi.fn(),
        addSilentRenewError: vi.fn(),
      }
      this.signinRedirect = vi.fn().mockResolvedValue(undefined)
      this.signoutRedirect = vi.fn().mockResolvedValue(undefined)
      this.signinRedirectCallback = vi.fn()
      this.getUser = vi.fn().mockResolvedValue(null)
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

const SUB = '40123456'
const CACHE_KEY = `hydraAuth.profile:${SUB}`

const PAYLOAD = {
  user: { id: 7, name: 'Juan', email: 'juan@puno.gob.pe', alias: 'jp' },
  permisos: ['ver-usuarios'],
  roles: ['admin'],
}

function makeAuth(extra = {}) {
  return createHydraAuth({ ...BASE_OPTIONS, ...extra })
}

function makeStoreWithUser() {
  const store = useHydraAuth()
  store.user = { access_token: 'tok', profile: { sub: SUB } }
  return store
}

function seedCache(fetchedAt = Date.now(), sub = SUB) {
  localStorage.setItem(
    `hydraAuth.profile:${sub}`,
    JSON.stringify({
      sub,
      fetchedAt,
      profile: {
        user: { id: 7, name: 'Juan', alias: 'jp' },
        roles: ['admin'],
        permisos: ['ver-usuarios'],
      },
    }),
  )
}

function networkError() {
  return Object.assign(new Error('Network Error'), {
    isAxiosError: true,
    code: 'ERR_NETWORK',
  })
}

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data: {} },
  })
}

describe('last-profile cache (core outage)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetchProfile success writes the cache under the sub key, without email', async () => {
    makeAuth()
    vi.spyOn(axios, 'get').mockResolvedValue({ data: PAYLOAD })
    const store = makeStoreWithUser()

    await store.fetchProfile()

    const raw = localStorage.getItem(CACHE_KEY)
    expect(raw).toBeTruthy()
    const entry = JSON.parse(raw)
    expect(entry.sub).toBe(SUB)
    expect(entry.fetchedAt).toEqual(expect.any(Number))
    expect(entry.profile).toEqual({
      user: { id: 7, name: 'Juan', alias: 'jp' },
      roles: ['admin'],
      permisos: ['ver-usuarios'],
    })
    expect(raw).not.toContain('juan@puno.gob.pe')
    expect(store.profileDegraded).toBe(false)
    expect(store.profileFetchedAt).toEqual(expect.any(Number))
  })

  it('network error with a fresh cache applies the cached profile in degraded mode', async () => {
    makeAuth()
    const fetchedAt = Date.now() - 1000
    seedCache(fetchedAt)
    vi.spyOn(axios, 'get').mockRejectedValue(networkError())
    const store = makeStoreWithUser()

    await store.fetchProfile()

    expect(store.profileDegraded).toBe(true)
    expect(store.profileFetchedAt).toBe(fetchedAt)
    expect(store.id).toBe(7)
    expect(store.name).toBe('Juan')
    expect(store.roles).toEqual(['admin'])
    expect(store.permisos).toEqual(['ver-usuarios'])
  })

  it('HTTP 503 with a cache entry falls back in degraded mode', async () => {
    makeAuth()
    seedCache()
    vi.spyOn(axios, 'get').mockRejectedValue(httpError(503))
    const store = makeStoreWithUser()

    await store.fetchProfile()

    expect(store.profileDegraded).toBe(true)
    expect(store.id).toBe(7)
  })

  it('HTTP 401 rethrows even when a cache entry exists (never degraded)', async () => {
    makeAuth()
    seedCache()
    vi.spyOn(axios, 'get').mockRejectedValue(httpError(401))
    const store = makeStoreWithUser()

    await expect(store.fetchProfile()).rejects.toThrow('HTTP 401')
    expect(store.profileDegraded).toBe(false)
    expect(store.id).toBeNull()
  })

  it('cache entry belonging to another sub rethrows the network error', async () => {
    makeAuth()
    seedCache(Date.now(), '99999999')
    vi.spyOn(axios, 'get').mockRejectedValue(networkError())
    const store = makeStoreWithUser()

    await expect(store.fetchProfile()).rejects.toThrow('Network Error')
    expect(store.profileDegraded).toBe(false)
  })

  it('cache older than maxAgeSeconds rethrows the network error', async () => {
    makeAuth()
    seedCache(Date.now() - (86400 * 1000 + 1))
    vi.spyOn(axios, 'get').mockRejectedValue(networkError())
    const store = makeStoreWithUser()

    await expect(store.fetchProfile()).rejects.toThrow('Network Error')
    expect(store.profileDegraded).toBe(false)
  })

  it('background retry recovers, clears degraded and stops the timer', async () => {
    vi.useFakeTimers()
    makeAuth()
    seedCache()
    const get = vi.spyOn(axios, 'get').mockRejectedValue(networkError())
    const store = makeStoreWithUser()

    await store.fetchProfile()
    expect(store.profileDegraded).toBe(true)

    get.mockResolvedValue({ data: PAYLOAD })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(store.profileDegraded).toBe(false)
    expect(store.profileFetchedAt).toEqual(expect.any(Number))

    const callsAfterRecovery = get.mock.calls.length
    await vi.advanceTimersByTimeAsync(180_000)
    expect(get.mock.calls.length).toBe(callsAfterRecovery)
  })

  it('logout removes the cache entry and stops the retry timer', async () => {
    vi.useFakeTimers()
    makeAuth()
    seedCache()
    const get = vi.spyOn(axios, 'get').mockRejectedValue(networkError())
    const store = makeStoreWithUser()

    await store.fetchProfile()
    expect(store.profileDegraded).toBe(true)
    expect(localStorage.getItem(CACHE_KEY)).toBeTruthy()

    await store.logout()

    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(store.profileDegraded).toBe(false)
    const callsAfterLogout = get.mock.calls.length
    await vi.advanceTimersByTimeAsync(180_000)
    expect(get.mock.calls.length).toBe(callsAfterLogout)
  })

  it('profileCache.enabled: false rethrows a network error even with a cache entry', async () => {
    makeAuth({ profileCache: { enabled: false } })
    seedCache()
    vi.spyOn(axios, 'get').mockRejectedValue(networkError())
    const store = makeStoreWithUser()

    await expect(store.fetchProfile()).rejects.toThrow('Network Error')
    expect(store.profileDegraded).toBe(false)
  })

  it('custom retrySeconds is honored by the retry timer', async () => {
    vi.useFakeTimers()
    makeAuth({ profileCache: { retrySeconds: 5 } })
    seedCache()
    const get = vi.spyOn(axios, 'get').mockRejectedValue(networkError())
    const store = makeStoreWithUser()

    await store.fetchProfile()
    expect(get).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('HydraDegradedBanner renders only when profileDegraded is true', async () => {
    makeAuth()
    const store = useHydraAuth()
    const wrapper = mount(HydraDegradedBanner)

    expect(wrapper.text()).toBe('')
    expect(wrapper.find('[role="status"]').exists()).toBe(false)

    store.profileDegraded = true
    await nextTick()

    const bar = wrapper.find('[role="status"]')
    expect(bar.exists()).toBe(true)
    expect(bar.text()).toBe(
      'Sin conexión con el servicio de usuarios — mostrando tu último perfil.',
    )
  })
})
