import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Vite plugin that serves (dev) and emits (build) the shipped silent-callback
 * page, so every SPA gets `/oidc-silent-callback.html` without copying files.
 *
 *   // quasar.config.js
 *   build: { vitePlugins: [['@munipuno/hydra-auth-vue/vite', {}]] }
 *   // plain Vite
 *   plugins: [hydraAuthVite()]
 *
 * The page is the single shipped asset (`assets/oidc-silent-callback.html`);
 * `createHydraAuth` derives `silentRedirectUri` to this path when `resources`
 * are declared. The URI still has to be registered on the Hydra client.
 *
 * @param {{ path?: string }} [options] URL path to serve, default `/oidc-silent-callback.html`.
 */
export function hydraAuthVite(options = {}) {
  const path = options.path ?? '/oidc-silent-callback.html'
  const page = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../assets/oidc-silent-callback.html'),
    'utf8',
  )

  return {
    name: 'hydra-auth-vue:silent-callback',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (url !== path || (req.method !== 'GET' && req.method !== 'HEAD')) return next()
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(req.method === 'HEAD' ? undefined : page)
      })
    },

    generateBundle() {
      this.emitFile({ type: 'asset', fileName: path.replace(/^\//, ''), source: page })
    },
  }
}
