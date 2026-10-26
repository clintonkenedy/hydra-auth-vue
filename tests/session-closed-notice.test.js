import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { routeLocationKey, routerKey } from 'vue-router'
import { HydraSessionClosedNotice } from '../src/index.js'

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
    }
  }
  return { UserManager, WebStorageStateStore }
})

/** Mount the notice with a mocked route/router (no real vue-router needed). */
function mountNotice(query = {}) {
  const replace = vi.fn()
  const wrapper = mount(HydraSessionClosedNotice, {
    global: {
      provide: {
        [routeLocationKey]: { query },
        [routerKey]: { replace },
      },
    },
  })
  return { wrapper, replace }
}

describe('HydraSessionClosedNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the idle message for ?session_closed=idle', () => {
    const { wrapper } = mountNotice({ session_closed: 'idle' })
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Tu sesión se cerró por inactividad')
    wrapper.unmount()
  })

  it('shows the max message for ?session_closed=max', () => {
    const { wrapper } = mountNotice({ session_closed: 'max' })
    expect(wrapper.text()).toContain('Tu sesión se cerró por tiempo máximo')
    wrapper.unmount()
  })

  it('accepts ?reason= for backward compatibility', () => {
    const { wrapper } = mountNotice({ reason: 'max' })
    expect(wrapper.text()).toContain('Tu sesión se cerró por tiempo máximo')
    wrapper.unmount()
  })

  it('renders nothing without a close reason', () => {
    const { wrapper } = mountNotice({})
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('renders nothing for an unknown reason value', () => {
    const { wrapper } = mountNotice({ session_closed: 'whatever' })
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('dismiss hides the notice and removes session_closed from the URL (keeping other params)', async () => {
    const { wrapper, replace } = mountNotice({ session_closed: 'idle', foo: 'bar' })

    await wrapper.find('[aria-label="Cerrar aviso"]').trigger('click')

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(replace).toHaveBeenCalledWith({ query: { foo: 'bar' } })
    wrapper.unmount()
  })

  it('auto-hides after 8 s without touching the URL', async () => {
    const { wrapper, replace } = mountNotice({ session_closed: 'max' })
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(7999)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    await nextTick()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(replace).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
