import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const raw = env.API_PORT || env.PORT || '3000'
  const apiPort = /^\d{1,5}$/.test(String(raw)) ? raw : '3000'

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
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
