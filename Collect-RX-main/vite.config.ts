import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const workspaceDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(workspaceDir, '..')

// Force a single physical copy of react/react-dom — this is an npm workspace
// member, and without this a hoisting mismatch can leave a second copy under
// this package's own node_modules, breaking context/hooks across chunks.
// The Docker build installs this package standalone (no parent workspace),
// so react lives directly under workspaceDir there instead of repoRoot —
// resolve whichever one actually exists rather than assuming the monorepo
// layout unconditionally.
function resolveHoisted(pkg: string): string {
  const atRepoRoot = path.join(repoRoot, 'node_modules', pkg)
  if (fs.existsSync(atRepoRoot)) return atRepoRoot
  return path.join(workspaceDir, 'node_modules', pkg)
}

// Backstop for the eslint.config.js path-based rule: walks the actual Rollup
// module graph (so it can't be fooled by re-exports or barrel files) and fails
// `vite build` if the client bundle pulls in src/server/** or a Node builtin.
// This is the class of bug that crash-looped Railway — CI's typecheck and
// tests don't touch the Vite build, so this only surfaced in production.
// Errors are raised as soon as the offending module/specifier is seen (rather
// than collected for buildEnd) because Rollup's own native handling of a bare
// Node builtin (e.g. plain `crypto`) can abort the build first with a far more
// cryptic message ("X is not exported by __vite-browser-external:crypto").
function guardServerOnlyImports() {
  const serverDir = path.join(workspaceDir, 'src', 'server') + path.sep
  const workspacePrefix = workspaceDir + path.sep
  const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)])

  const describe = (id) => (id.startsWith(workspacePrefix) ? path.relative(workspaceDir, id) : id)

  return {
    name: 'crx-guard-server-only-imports',
    apply: 'build',
    resolveId(source, importer) {
      if (!importer) return null
      const importerIsFirstParty = importer.startsWith(workspacePrefix) && !importer.includes('node_modules')
      if (!importerIsFirstParty || importer.startsWith(serverDir)) return null

      if (NODE_BUILTINS.has(source)) {
        this.error(
          `[guard-server-only-imports] "${describe(importer)}" imports the Node builtin "${source}". ` +
            'Node builtins do not exist in the browser — this is the class of bug that crash-looped Railway. ' +
            'Remove the import, or move this code under src/server/** if it is genuinely server-only.',
        )
      }
      return null
    },
    moduleParsed(info) {
      if (info.id.startsWith(serverDir)) {
        const importer = info.importers[0] ? describe(info.importers[0]) : '(entry)'
        this.error(
          `[guard-server-only-imports] Client bundle graph pulled in "${describe(info.id)}" from src/server/** ` +
            `(imported by ${importer}). Server-only code (Node crypto, Prisma, PHI vault) does not exist in the ` +
            'browser. Move shared logic to a client-safe module, or remove the import.',
        )
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appSurface = (env.VITE_APP_SURFACE || '').trim()
  const isDesktopBuild = appSurface === 'desktop'
  const remoteProxy = (env.VITE_API_PROXY_TARGET || '').trim().replace(/\/$/, '')
  const rawApi = env.API_PORT || env.PORT || '3000'
  const apiPort = /^\d{1,5}$/.test(String(rawApi)) ? rawApi : '3000'
  const apiProxyTarget =
    remoteProxy && /^https?:\/\//i.test(remoteProxy)
      ? remoteProxy
      : `http://127.0.0.1:${apiPort}`
  const rawVite = env.VITE_DEV_SERVER_PORT || env.VITE_PORT || '5173'
  const vitePort = /^\d{1,5}$/.test(String(rawVite)) ? Number(rawVite) : 5173

  return {
    base: isDesktopBuild ? './' : '/',
    build: {
      target: 'es2022',
      rollupOptions: {
        output: {
          // Keep all third-party code in one vendor chunk. Splitting React into
          // its own chunk breaks libraries that call React.createContext at eval
          // time (cross-chunk init order leaves React undefined). Route-level
          // lazy() already carries the per-page code-splitting win.
          manualChunks(id) {
            if (id.includes('node_modules')) return 'vendor'
          },
        },
      },
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        react: resolveHoisted('react'),
        'react-dom': resolveHoisted('react-dom'),
      },
    },
    plugins: [
      react(),
      guardServerOnlyImports(),
      tailwindcss(),
      {
        name: 'crx-inject-api-origin-meta',
        transformIndexHtml(html) {
          if (isDesktopBuild) return html
          const o = (env.VITE_API_ORIGIN || '').trim().replace(/\/$/, '')
          if (!o) return html
          const meta = `<meta name="crx-public-api-origin" content="${o.replace(/"/g, '&quot;')}" />`
          if (/name="crx-public-api-origin"/i.test(html)) {
            return html.replace(/<meta\s+name="crx-public-api-origin"[^>]*>/i, meta)
          }
          return html.replace('</head>', `${meta}\n</head>`)
        },
      },
      {
        name: 'crx-log-api-proxy-target',
        configureServer(server) {
          server.httpServer?.once('listening', () => {
            const p = server.config.server.port ?? vitePort
            const label = remoteProxy ? 'production API' : 'local API'
            console.info(`[vite] http://localhost:${p}/  |  /api proxy → ${apiProxyTarget} (${label})`)
          })
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port: vitePort,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: apiProxyTarget.startsWith('https'),
        },
        '/ws': {
          target: apiProxyTarget,
          ws: true,
          changeOrigin: true,
          secure: apiProxyTarget.startsWith('https'),
        },
      },
    },
  }
})
