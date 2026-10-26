import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { mount } from '@vue/test-utils'
import { createApp, nextTick } from 'vue'
import { routerKey } from 'vue-router'
import {
  createHydraAuth,
  useHydraAuth,
  HydraSessionGuard,
  OidcLogin,
} from '../src/index.js'
import {
  LAST_ACTIVITY_KEY,
  SESSION_EVENT_KEY,
  SESSION_START_KEY,
} from '../src/sessionTimeouts.js'

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
      this.removeUser = vi.fn().mockResolvedValue(undefined)
      this.stopSilentRenew = vi.fn()
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

const MINUTE = 60_000
const HOUR = 3_600_000

function makeAuth(extra = {}) {
  return createHydraAuth({ ...BASE_OPTIONS, ...extra })
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

/** Authenticate the store and start the timers (as signinCallback does). */
function signIn(profile = {}) {
  const store = useHydraAuth()
  store.user = {
    access_token: 'tok',
    profile: { sub: SUB, auth_time: nowSeconds(), ...profile },
  }
  sessionStorage.setItem('token', 'Bearer tok')
  store.startSessionTimeouts()
  return store
}

function seedProfileCache() {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      sub: SUB,
      fetchedAt: Date.now(),
      profile: { user: { id: 7, name: 'Juan', alias: 'jp' }, roles: ['admin'], permisos: ['x'] },
    }),
  )
}

function dispatchActivity() {
  window.dispatchEvent(new Event('mousemove'))
}

function dispatchStorage(key, newValue) {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

describe('session timeouts (idle + max session)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    const ctx = globalThis.__lastCtx
    if (ctx) ctx.sessionTimeoutsController?.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function track(auth) {
    globalThis.__lastCtx = auth.context
    return auth
  }

  it('closes the session after 60 min without activity (S1, S6)', async () => {
    const auth = track(makeAuth())
    seedProfileCache()
    const store = signIn()

    await vi.advanceTimersByTimeAsync(60 * MINUTE)

    expect(store.user).toBeNull()
    expect(store.closedReason).toBe('idle')
    expect(sessionStorage.getItem('token')).toBeNull()
    expect(auth.userManager.removeUser).toHaveBeenCalledTimes(1)
    expect(auth.userManager.stopSilentRenew).toHaveBeenCalledTimes(1)
    // Never Hydra end-session, never the last-profile cache (S6).
    expect(auth.userManager.signoutRedirect).not.toHaveBeenCalled()
    expect(localStorage.getItem(CACHE_KEY)).toBeTruthy()
    // Broadcast so the other tabs close too (S5).
    const event = JSON.parse(localStorage.getItem(SESSION_EVENT_KEY))
    expect(event).toMatchObject({ type: 'close', reason: 'idle' })
  })

  it('activity resets the inactivity window (S1)', async () => {
    track(makeAuth())
    const store = signIn()

    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    dispatchActivity()
    await vi.advanceTimersByTimeAsync(55 * MINUTE)

    expect(store.user).not.toBeNull()
    expect(store.closedReason).toBeNull()

    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(store.user).toBeNull()
    expect(store.closedReason).toBe('idle')
  })

  it('shows the idle warning at 59:00 with the countdown (S2)', async () => {
    track(makeAuth())
    const store = signIn()

    await vi.advanceTimersByTimeAsync(59 * MINUTE)
    expect(store.sessionWarning).toBe('idle')

    const wrapper = mount(HydraSessionGuard)
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('Tu sesión está por cerrarse')
    expect(dialog.text()).toContain('Por inactividad, en 1:00')

    await vi.advanceTimersByTimeAsync(10_000)
    await nextTick()
    expect(wrapper.find('[role="dialog"]').text()).toContain('Por inactividad, en 0:50')
    wrapper.unmount()
  })

  it('"Seguir conectado" resets the inactivity window (S2)', async () => {
    track(makeAuth())
    const store = signIn()
    await vi.advanceTimersByTimeAsync(59 * MINUTE)
    const wrapper = mount(HydraSessionGuard)

    const stayButton = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Seguir conectado')
    await stayButton.trigger('click')

    expect(store.sessionWarning).toBeNull()
    await vi.advanceTimersByTimeAsync(58 * MINUTE)
    expect(store.user).not.toBeNull()
    expect(store.sessionWarning).toBeNull()

    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(store.sessionWarning).toBe('idle')
    wrapper.unmount()
  })

  it('"Salir" closes immediately, same as the automatic close (S2)', async () => {
    const auth = track(makeAuth())
    seedProfileCache()
    const store = signIn()
    await vi.advanceTimersByTimeAsync(59 * MINUTE)
    const wrapper = mount(HydraSessionGuard)

    const exitButton = wrapper.findAll('button').find((b) => b.text() === 'Salir')
    await exitButton.trigger('click')
    await vi.advanceTimersByTimeAsync(0)

    expect(store.user).toBeNull()
    expect(store.closedReason).toBe('idle')
    expect(auth.userManager.signoutRedirect).not.toHaveBeenCalled()
    expect(localStorage.getItem(CACHE_KEY)).toBeTruthy()
    wrapper.unmount()
  })

  it('passive activity does not dismiss the idle warning modal (S2)', async () => {
    track(makeAuth())
    const store = signIn()

    await vi.advanceTimersByTimeAsync(59 * MINUTE)
    expect(store.sessionWarning).toBe('idle')

    dispatchActivity()
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.sessionWarning).toBe('idle')

    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(store.closedReason).toBe('idle')
  })

  it('max session closes at 10 h even with constant activity (S3)', async () => {
    track(makeAuth())
    const store = signIn()

    for (let i = 0; i < 19; i += 1) {
      await vi.advanceTimersByTimeAsync(30 * MINUTE)
      dispatchActivity()
    }
    expect(store.user).not.toBeNull()

    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(store.user).toBeNull()
    expect(store.closedReason).toBe('max')
  })

  it('max warning appears at 9:55 and "Entendido" only hides it (S4)', async () => {
    track(makeAuth())
    const store = signIn()

    for (let i = 0; i < 19; i += 1) {
      await vi.advanceTimersByTimeAsync(30 * MINUTE)
      dispatchActivity()
    }
    await vi.advanceTimersByTimeAsync(25 * MINUTE)
    dispatchActivity()
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.sessionWarning).toBe('max')

    const wrapper = mount(HydraSessionGuard)
    const notice = wrapper.find('[role="alert"]')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('Tu sesión vence en 5 min, guardá lo que estés haciendo')

    await notice.findAll('button').find((b) => b.text() === 'Entendido').trigger('click')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    // Hidden, never extended: the session still ends at 10 h.
    expect(store.sessionWarning).toBe('max')

    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(store.closedReason).toBe('max')
    wrapper.unmount()
  })

  it('explicit logout removes the profile cache and broadcasts (S7)', async () => {
    const auth = track(makeAuth())
    seedProfileCache()
    const store = signIn()

    await store.logout()

    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(auth.userManager.signoutRedirect).toHaveBeenCalledTimes(1)
    const event = JSON.parse(localStorage.getItem(SESSION_EVENT_KEY))
    expect(event).toMatchObject({ type: 'logout' })
    expect(localStorage.getItem(LAST_ACTIVITY_KEY)).toBeNull()
    expect(localStorage.getItem(SESSION_START_KEY)).toBeNull()
  })

  it('newer activity from another tab (storage event) prevents the close (S5)', async () => {
    track(makeAuth())
    const store = signIn()

    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    dispatchStorage(LAST_ACTIVITY_KEY, String(Date.now()))
    await vi.advanceTimersByTimeAsync(55 * MINUTE)

    expect(store.user).not.toBeNull()
    expect(store.closedReason).toBeNull()
  })

  it('a close broadcast from another tab closes this one without re-broadcasting (S5)', async () => {
    const auth = track(makeAuth())
    seedProfileCache()
    const store = signIn()

    dispatchStorage(
      SESSION_EVENT_KEY,
      JSON.stringify({ type: 'close', reason: 'idle', at: Date.now() }),
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(store.user).toBeNull()
    expect(store.closedReason).toBe('idle')
    expect(auth.userManager.signoutRedirect).not.toHaveBeenCalled()
    expect(localStorage.getItem(CACHE_KEY)).toBeTruthy()
    // No re-broadcast: the synthetic event never touched this tab's storage.
    expect(localStorage.getItem(SESSION_EVENT_KEY)).toBeNull()
  })

  it('disabled options never start any timer (S10)', async () => {
    const auth = track(makeAuth({ idleTimeoutMinutes: 0, maxSessionHours: null }))
    const store = signIn()

    expect(auth.context.sessionTimeoutsController).toBeNull()
    await vi.advanceTimersByTimeAsync(24 * HOUR)
    expect(store.user).not.toBeNull()
    expect(store.closedReason).toBeNull()
  })

  it('uses auth_time as the session start (S3)', async () => {
    track(makeAuth())
    const store = signIn({ auth_time: nowSeconds() - 9.5 * 3600 })

    // Max expires in 30 min (10 h after auth_time), long before the idle 60 min.
    await vi.advanceTimersByTimeAsync(30 * MINUTE)

    expect(store.user).toBeNull()
    expect(store.closedReason).toBe('max')
  })

  it('falls back to iat stored for the session when auth_time is missing (S3)', async () => {
    const iat = nowSeconds() - 9.5 * 3600
    track(makeAuth())
    const store = signIn({ auth_time: undefined, iat })

    expect(localStorage.getItem(SESSION_START_KEY)).toBe(String(iat * 1000))

    await vi.advanceTimersByTimeAsync(30 * MINUTE)
    expect(store.user).toBeNull()
    expect(store.closedReason).toBe('max')
  })

  it('a fresh sign-in ignores a stale sessionStart left by a closed tab (S3)', async () => {
    // Yesterday's session start survives when the tab was closed without logout.
    localStorage.setItem(SESSION_START_KEY, String(Date.now() - 25 * HOUR))
    const iat = nowSeconds()
    const auth = track(makeAuth())
    auth.userManager.signinRedirectCallback.mockResolvedValue({
      access_token: 'tok',
      profile: { sub: SUB, auth_time: undefined, iat },
    })
    const store = useHydraAuth()

    await store.signinCallback()
    await vi.advanceTimersByTimeAsync(MINUTE)

    expect(store.user).not.toBeNull()
    expect(store.closedReason).toBeNull()
    expect(localStorage.getItem(SESSION_START_KEY)).toBe(String(iat * 1000))
  })

  it('after a page reload with restored state the guard still starts the timers (S10)', async () => {
    // pinia-plugin-persistedstate can restore userLoaded=true and the user
    // after F5; loadUser() is then skipped, so the guard must start timers.
    const auth = track(makeAuth())
    const store = useHydraAuth()
    store.userLoaded = true
    store.user = { access_token: 'tok', profile: { sub: SUB, auth_time: nowSeconds() } }
    expect(auth.context.sessionTimeoutsController).toBeFalsy()

    const next = vi.fn()
    await auth.guard()({ path: '/perfil', meta: { requiresAuth: true } }, {}, next)

    expect(next).toHaveBeenCalled()
    expect(auth.context.sessionTimeoutsController).toBeTruthy()
  })

  it('only profile fields are persisted, never the OIDC user or runtime flags (S10)', async () => {
    const pinia = createPinia()
    pinia.use(piniaPluginPersistedstate)
    // Pinia only applies plugins once installed in a Vue app.
    createApp({}).use(pinia)
    setActivePinia(pinia)
    track(makeAuth())
    const store = useHydraAuth()

    // $patch notifies subscribers (and the persistence plugin) synchronously.
    store.$patch({
      user: { access_token: 'secret-token', profile: { sub: SUB } },
      userLoaded: true,
      name: 'Juan',
      roles: ['admin'],
    })

    const saved = JSON.parse(sessionStorage.getItem('hydraAuth'))
    expect(saved).toMatchObject({ name: 'Juan', roles: ['admin'] })
    expect(saved).not.toHaveProperty('user')
    expect(saved).not.toHaveProperty('userLoaded')
    expect(JSON.stringify(saved)).not.toContain('secret-token')
  })

  it('signinCallback starts the timers and clears closedReason (S10)', async () => {
    const auth = track(makeAuth())
    auth.userManager.signinRedirectCallback.mockResolvedValue({
      access_token: 'tok',
      profile: { sub: SUB, auth_time: nowSeconds() },
    })
    const store = useHydraAuth()
    store.closedReason = 'idle'

    await store.signinCallback()

    expect(auth.context.sessionTimeoutsController).not.toBeNull()
    expect(store.closedReason).toBeNull()
  })

  it('HydraSessionGuard redirects to the login route with the reason (S6, S9)', async () => {
    track(makeAuth())
    const store = signIn()
    const replace = vi.fn()
    const wrapper = mount(HydraSessionGuard, {
      global: { provide: { [routerKey]: { replace } } },
    })

    await store.closeSession('max')
    await nextTick()

    expect(replace).toHaveBeenCalledWith({ path: '/oidc-login', query: { reason: 'max' } })
    expect(store.closeRedirectPending).toBe(false)
    wrapper.unmount()
  })

  it('OidcLogin shows the close message for 2.5 s before login() (S6, S9)', async () => {
    const auth = track(makeAuth())
    const store = useHydraAuth()
    store.closedReason = 'idle'

    const wrapper = mount(OidcLogin)
    expect(wrapper.text()).toContain('Tu sesión se cerró por inactividad')
    expect(auth.userManager.signinRedirect).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2500)
    expect(auth.userManager.signinRedirect).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('OidcLogin keeps the immediate redirect when there is no close reason (S9)', async () => {
    const auth = track(makeAuth())

    const wrapper = mount(OidcLogin)
    await nextTick()

    expect(wrapper.text()).toContain('Redirigiendo al inicio de sesión…')
    expect(auth.userManager.signinRedirect).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
