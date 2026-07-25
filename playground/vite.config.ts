import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import { inertiaDevtools } from 'inertia-devtools/vite'

const dirname = path.dirname(fileURLToPath(import.meta.url))

interface PageDef {
  component: string
  props: Record<string, unknown>
  /** Deferred prop groups (Inertia protocol `deferredProps`) */
  deferred?: Record<string, string[]>
  /** Lazy resolvers for deferred props, awaited on partial reloads */
  resolveDeferred?: Record<string, () => Promise<unknown> | unknown>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Fake Inertia "server" implemented as Vite dev middleware.
 * Speaks the Inertia protocol: X-Inertia JSON responses, data-page HTML,
 * partial reloads, deferred props, 409 version conflicts, and POST→303.
 */
function inertiaServer(): Plugin {
  let ASSET_VERSION = 'v1'
  let requestCount = 0
  let timeCounter = 0
  let nextPostId = 4
  let pendingFlash: Record<string, string> | null = null

  const users = [
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 2, name: 'Grace Hopper', email: 'grace@example.com' },
    { id: 3, name: 'Alan Turing', email: 'alan@example.com' },
    { id: 4, name: 'Margaret Hamilton', email: 'margaret@example.com' },
    { id: 5, name: 'Edsger Dijkstra', email: 'edsger@example.com' },
  ]

  /** Sticky validation errors, set by POST /bugs — mimics an adapter sharing errors via always() */
  let bugErrors: Record<string, string> = {}

  const posts: Array<{ id: number; title: string }> = [
    { id: 1, title: 'Hello Inertia' },
    { id: 2, title: 'Server-driven UIs' },
    { id: 3, title: 'Devtools ftw' },
  ]

  const serverTiming = (): string => {
    const jitter = requestCount % 7
    const db = (23.4 + jitter).toFixed(1)
    const app = (45.1 + jitter * 1.5).toFixed(1)
    const view = 12 + jitter
    return `db;dur=${db};desc="SELECT users", app;dur=${app}, view;dur=${view}`
  }

  const pageFor = (pathname: string): PageDef | null => {
    switch (pathname) {
      case '/':
        return {
          component: 'Home',
          props: {
            appName: 'Inertia Devtools Playground',
            serverTime: new Date().toISOString(),
            assetVersion: ASSET_VERSION,
          },
        }
      case '/users':
        return {
          component: 'Users',
          props: { users },
          deferred: { default: ['stats'] },
          resolveDeferred: {
            stats: async () => {
              await sleep(300)
              return {
                total: users.length,
                active: 3,
                requestsServed: requestCount,
                generatedAt: new Date().toISOString(),
              }
            },
          },
        }
      case '/posts':
        return {
          component: 'Posts',
          props: { posts: posts.map((p) => ({ ...p })), loadedAt: new Date().toISOString() },
        }
      case '/bugs':
        return {
          component: 'Bugs',
          props: {
            time: ++timeCounter,
            stats: { total: 5, active: 3 },
            errors: { ...bugErrors },
          },
          // 'broken' auto-reloads on mount and the server 500s it (deferred-failed);
          // 'slow' resolves only on explicit reload (discarded-response scenario).
          deferred: { default: ['broken'] },
          resolveDeferred: {
            broken: () => ({}),
            slow: async () => {
              await sleep(1500)
              return { finally: 'arrived' }
            },
          },
        }
      case '/poll':
        return {
          component: 'Poll',
          props: { time: ++timeCounter, serverTime: new Date().toISOString() },
        }
      default:
        return null
    }
  }

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let body = ''
      req.on('data', (chunk: Buffer) => (body += chunk.toString()))
      req.on('end', () => resolve(body))
      req.on('error', () => resolve(''))
    })

  const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(payload))
  }

  return {
    name: 'playground-inertia-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const pathname = url.pathname

          // Plain fetch endpoint: flip the asset version so the NEXT
          // Inertia navigation gets a 409 + X-Inertia-Location response.
          if (pathname === '/api/bump') {
            ASSET_VERSION = ASSET_VERSION === 'v1' ? 'v2' : 'v1'
            sendJson(res, 200, { version: ASSET_VERSION })
            return
          }

          // Inertia form submission → 303 redirect back (PRG per protocol).
          if (pathname === '/posts' && req.method === 'POST') {
            const body = await readBody(req)
            let title = `Post #${nextPostId}`
            try {
              const parsed = JSON.parse(body)
              if (parsed && typeof parsed.title === 'string' && parsed.title) title = parsed.title
            } catch {
              /* not JSON — keep default title */
            }
            posts.push({ id: nextPostId++, title })
            pendingFlash = { success: 'Created!' }
            res.statusCode = 303
            res.setHeader('Location', '/posts')
            res.setHeader('Vary', 'X-Inertia')
            res.end()
            return
          }

          // Failing form submission: set sticky validation errors, PRG back.
          if (pathname === '/bugs' && req.method === 'POST') {
            bugErrors = { name: 'is required', email: 'is invalid' }
            res.statusCode = 303
            res.setHeader('Location', '/bugs')
            res.setHeader('Vary', 'X-Inertia')
            res.end()
            return
          }

          const page = pageFor(pathname)
          if (!page) return next()
          if (req.method !== 'GET') return next()

          requestCount++
          res.setHeader('Server-Timing', serverTiming())
          res.setHeader('Vary', 'X-Inertia')

          const isInertia = req.headers['x-inertia'] === 'true'

          if (isInertia) {
            // Version conflict → 409 + X-Inertia-Location (client hard-visits).
            const clientVersion = req.headers['x-inertia-version']
            if (typeof clientVersion === 'string' && clientVersion !== ASSET_VERSION) {
              res.statusCode = 409
              res.setHeader('X-Inertia-Location', req.url ?? pathname)
              // With the new version in the response, Inertia 3.6 fires
              // inertia:location with versionChange: true.
              res.setHeader('X-Inertia-Version', ASSET_VERSION)
              res.end()
              return
            }

            const partialDataHeader = req.headers['x-inertia-partial-data']
            const partialComponent = req.headers['x-inertia-partial-component']
            const isPartial =
              typeof partialDataHeader === 'string' &&
              partialDataHeader.length > 0 &&
              partialComponent === page.component

            let props: Record<string, unknown>
            let deferredProps: Record<string, string[]> | undefined

            if (isPartial) {
              const requested = partialDataHeader.split(',').map((k) => k.trim())

              // Bug scenario: the 'broken' deferred group always 500s (non-Inertia
              // response) so devtools can flag the failed deferred load.
              if (requested.includes('broken')) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'text/html')
                res.end('<h1>Server Error</h1>')
                return
              }

              // Return ONLY the requested props; resolve deferred ones lazily.
              // Dot-path entries ('stats.total') return the nested slice, like
              // real adapters do.
              props = {}
              for (const key of requested) {
                if (key.includes('.')) {
                  const [root, ...rest] = key.split('.')
                  let value: unknown = page.props[root]
                  for (const seg of rest) {
                    value =
                      value != null && typeof value === 'object' ? (value as Record<string, unknown>)[seg] : undefined
                  }
                  if (value !== undefined) props[root] = { [rest.join('.')]: value }
                  continue
                }
                if (key in page.props) {
                  props[key] = page.props[key]
                } else if (page.resolveDeferred && key in page.resolveDeferred) {
                  props[key] = await page.resolveDeferred[key]()
                }
              }
            } else {
              // Full page: deferred props are omitted and announced instead.
              props = { ...page.props, flash: pendingFlash ?? {} }
              pendingFlash = null
              deferredProps = page.deferred
            }

            res.setHeader('X-Inertia', 'true')
            res.setHeader('Content-Type', 'application/json')
            res.statusCode = 200
            res.end(
              JSON.stringify({
                component: page.component,
                props,
                url: pathname + url.search,
                version: ASSET_VERSION,
                ...(deferredProps ? { deferredProps } : {}),
              }),
            )
            return
          }

          // Initial HTML visit: embed the page object as a JSON script tag —
          // Inertia v3 reads <script data-page="app" type="application/json">,
          // not the classic data-page attribute on the app div.
          const pageObject = {
            component: page.component,
            props: { ...page.props, flash: pendingFlash ?? {} },
            url: pathname + url.search,
            version: ASSET_VERSION,
            ...(page.deferred ? { deferredProps: page.deferred } : {}),
          }
          pendingFlash = null

          const template = fs.readFileSync(path.resolve(dirname, 'index.html'), 'utf-8')
          const transformed = await server.transformIndexHtml(req.url ?? '/', template)
          const pageJson = JSON.stringify(pageObject).replaceAll('<', '\\u003c')
          const html = transformed.replace(
            '<div id="app"></div>',
            `<div id="app"></div>\n    <script data-page="app" type="application/json">${pageJson}</script>`,
          )

          res.statusCode = 200
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [inertiaServer(), inertiaDevtools()],
  optimizeDeps: {
    // Pre-bundle the JSX dev runtime so its late discovery doesn't trigger an
    // "optimized dependencies changed" full reload mid-session.
    include: ['react/jsx-dev-runtime'],
  },
  server: {
    port: 5199,
    strictPort: true,
    fs: {
      // Allow serving the linked inertia-devtools dist from the parent repo.
      allow: [path.resolve(dirname, '..')],
    },
  },
})
