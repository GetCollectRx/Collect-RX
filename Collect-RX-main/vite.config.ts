import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
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
    plugins: [
      react(),
      {
        name: 'crx-inject-api-origin-meta',
        transformIndexHtml(html) {
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
