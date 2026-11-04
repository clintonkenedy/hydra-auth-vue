// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import hydraAuthViteDefault, { hydraAuthVite } from '../src/vite.js'

const PAGE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../assets/oidc-silent-callback.html'),
  'utf8',
)

function serve(plugin) {
  let handler
  plugin.configureServer({ middlewares: { use: (fn) => (handler = fn) } })
  return handler
}

function fakeRes() {
  return { statusCode: 0, setHeader: vi.fn(), end: vi.fn() }
}

describe('hydraAuthVite (S10)', () => {
  // Quasar's `vitePlugins: [['pkg', opts]]` tuple calls the default export.
  it('is also the default export', () => {
    expect(hydraAuthViteDefault).toBe(hydraAuthVite)
  })

  it('is a named Vite plugin', () => {
    expect(hydraAuthVite().name).toBe('hydra-auth-vue:silent-callback')
  })

  it('serves the shipped page in dev at /oidc-silent-callback.html (query ignored)', () => {
    const handler = serve(hydraAuthVite())
    const res = fakeRes()
    const next = vi.fn()

    handler({ url: '/oidc-silent-callback.html?code=1&state=2', method: 'GET' }, res, next)

    expect(res.statusCode).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8')
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    expect(res.end).toHaveBeenCalledWith(PAGE)
    expect(next).not.toHaveBeenCalled()
  })

  it('passes every other request through', () => {
    const handler = serve(hydraAuthVite())
    const res = fakeRes()
    const next = vi.fn()

    handler({ url: '/oidc-callback?code=1', method: 'GET' }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.end).not.toHaveBeenCalled()
  })

  it('honours a custom path', () => {
    const handler = serve(hydraAuthVite({ path: '/auth/silent.html' }))
    const res = fakeRes()

    handler({ url: '/auth/silent.html', method: 'GET' }, res, vi.fn())

    expect(res.statusCode).toBe(200)
    expect(res.end).toHaveBeenCalledWith(PAGE)
  })

  it('emits the page at the build output root', () => {
    const emitFile = vi.fn()

    hydraAuthVite().generateBundle.call({ emitFile })

    expect(emitFile).toHaveBeenCalledWith({
      type: 'asset',
      fileName: 'oidc-silent-callback.html',
      source: PAGE,
    })
  })
})
