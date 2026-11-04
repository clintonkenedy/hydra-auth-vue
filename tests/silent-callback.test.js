import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createHydraAuth } from '../src/index.js'

vi.mock('oidc-client-ts', () => {
  class InMemoryWebStorage {}
  class WebStorageStateStore {
    constructor(opts) {
      this.store = opts.store
    }
  }
  class UserManager {
    constructor(settings) {
      this.settings = settings
      this.events = {
        addUserLoaded: () => {},
        addAccessTokenExpired: () => {},
        addSilentRenewError: () => {},
      }
      this.getUser = vi.fn().mockResolvedValue(null)
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

const SILENT_URI = 'http://localhost/oidc-silent-callback.html'
const PAGE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../assets/oidc-silent-callback.html',
)

function inlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('no inline <script> in the silent callback page')
  return match[1]
}

describe('silentRedirectUri option (S9)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  // S11: with resources declared the default points at the shipped page.
  it('derives silentRedirectUri from redirectUri when resources are declared', () => {
    const auth = createHydraAuth({ ...BASE_OPTIONS, resources: { x: { audience: 'x-aud' } } })

    expect(auth.userManager.settings.silent_redirect_uri).toBe(SILENT_URI)
  })

  it('keeps silent_redirect_uri = redirectUri without resources', () => {
    const auth = createHydraAuth({ ...BASE_OPTIONS })

    expect(auth.userManager.settings.silent_redirect_uri).toBe(BASE_OPTIONS.redirectUri)
  })

  it('lets an explicit silentRedirectUri win over the derived default', () => {
    const auth = createHydraAuth({
      ...BASE_OPTIONS,
      resources: { x: { audience: 'x-aud' } },
      silentRedirectUri: 'http://localhost/custom.html',
    })

    expect(auth.userManager.settings.silent_redirect_uri).toBe('http://localhost/custom.html')
  })

  it('passes silentRedirectUri to the primary UserManager as silent_redirect_uri', () => {
    const auth = createHydraAuth({ ...BASE_OPTIONS, silentRedirectUri: SILENT_URI })

    expect(auth.userManager.settings.silent_redirect_uri).toBe(SILENT_URI)
    expect(auth.userManager.settings.redirect_uri).toBe(BASE_OPTIONS.redirectUri)
  })

  it('defaults the primary silent_redirect_uri to redirectUri', () => {
    const auth = createHydraAuth({ ...BASE_OPTIONS })

    expect(auth.userManager.settings.silent_redirect_uri).toBe(BASE_OPTIONS.redirectUri)
  })
})

describe('assets/oidc-silent-callback.html (S9)', () => {
  let html
  beforeEach(() => {
    html = readFileSync(PAGE_PATH, 'utf8')
  })
  const href = 'http://localhost/oidc-silent-callback.html?code=abc&state=xyz'

  it('is dependency-free (no external scripts)', () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc\s*=/i)
  })

  it('posts the oidc-client message to the parent with the page origin', () => {
    const postMessage = vi.fn()
    const fakeWindow = {
      parent: { postMessage },
      location: { href, origin: 'http://localhost' },
    }

    new Function('window', inlineScript(html))(fakeWindow)

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      { source: 'oidc-client', url: href, keepOpen: false },
      'http://localhost',
    )
  })

  it('does nothing when it is the top-level window', () => {
    const postMessage = vi.fn()
    const fakeWindow = { location: { href, origin: 'http://localhost' }, postMessage }
    fakeWindow.parent = fakeWindow

    new Function('window', inlineScript(html))(fakeWindow)

    expect(postMessage).not.toHaveBeenCalled()
  })
})
