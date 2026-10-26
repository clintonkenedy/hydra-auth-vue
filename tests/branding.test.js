import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import {
  createHydraAuth,
  useHydraAuth,
  HydraAuthScreen,
  OidcLogin,
  OidcCallback,
} from '../src/index.js'

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

function makeAuth(extra = {}) {
  return createHydraAuth({ ...BASE_OPTIONS, ...extra })
}

describe('branding (HydraAuthScreen + auth screens)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies the default branding colors as CSS custom properties', () => {
    makeAuth()
    const wrapper = mount(HydraAuthScreen)

    const style = wrapper.attributes('style')
    expect(style).toContain('--hydra-primary: #00aeee')
    expect(style).toContain('--hydra-primary-hover: #00caee')
    expect(style).toContain('--hydra-primary-active: #16759f')
    wrapper.unmount()
  })

  it('respects branding overrides', () => {
    makeAuth({
      branding: { primaryColor: '#ff0000', primaryHoverColor: '#cc0000' },
    })
    const wrapper = mount(HydraAuthScreen)

    const style = wrapper.attributes('style')
    expect(style).toContain('--hydra-primary: #ff0000')
    expect(style).toContain('--hydra-primary-hover: #cc0000')
    // Untouched values keep their defaults.
    expect(style).toContain('--hydra-primary-active: #16759f')
    wrapper.unmount()
  })

  it('renders the logo and title when configured', () => {
    makeAuth({
      branding: { logo: '/inicio_login.jpg', title: 'Municipalidad Puno' },
    })
    const wrapper = mount(HydraAuthScreen)

    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toBe('/inicio_login.jpg')
    expect(img.attributes('alt')).toBe('Logo')
    const title = wrapper.find('h2')
    expect(title.exists()).toBe(true)
    expect(title.text()).toBe('Municipalidad Puno')
    wrapper.unmount()
  })

  it('renders no logo nor title when branding does not configure them', () => {
    makeAuth()
    const wrapper = mount(HydraAuthScreen)

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('h2').exists()).toBe(false)
    wrapper.unmount()
  })

  it('OidcLogin with a close reason shows the message and an immediate "Iniciar sesión" button', async () => {
    const auth = makeAuth()
    const store = useHydraAuth()
    store.closedReason = 'idle'

    const wrapper = mount(OidcLogin)
    expect(wrapper.text()).toContain('Tu sesión se cerró por inactividad')
    expect(wrapper.text()).toContain('Te llevaremos al inicio de sesión…')

    const button = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Iniciar sesión')
    expect(button.exists()).toBe(true)
    expect(button.classes()).toContain('hydra-btn-primary')
    expect(auth.userManager.signinRedirect).not.toHaveBeenCalled()

    await button.trigger('click')
    expect(auth.userManager.signinRedirect).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('OidcCallback error shows "Reintentar" styled as hydra-btn-primary', async () => {
    const auth = makeAuth()
    auth.userManager.signinRedirectCallback.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const wrapper = mount(OidcCallback)
    await flushPromises()

    expect(wrapper.text()).toContain('No se pudo completar el inicio de sesión.')
    const button = wrapper.find('button.hydra-btn-primary')
    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('Reintentar')
    wrapper.unmount()
  })
})
