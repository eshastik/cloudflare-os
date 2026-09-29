import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// Экран Mini App (telegram-app.html) несёт строгий CSP. В режиме разработки Vite вставляет
// встроенные скрипты, поэтому там эта строка снимается; в сборке она остаётся.
function miniAppDevCsp(): Plugin {
  return {
    name: 'mini-app-dev-csp',
    apply: 'serve',
    transformIndexHtml(html, ctx) {
      return ctx.path.endsWith('telegram-app.html') ? html.replace(/<meta http-equiv="Content-Security-Policy" data-mini-app-csp[^>]*>/, '') : html
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const backendHost = env.VITE_BACKEND_HOST?.trim() || 'localhost:8787'
  const frontendErrorReporting = env.VITE_FRONTEND_ERROR_REPORTING === 'true'
  return {
    plugins: [
      TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      tsconfigPaths(),
      miniAppDevCsp(),
    ],
    server: {
      port: 3000,
      host: true,
      proxy: {
        '/api/client-errors': `http://${backendHost}`,
        '/blueprint-screenshot': `http://${backendHost}`,
        '/api/site-logo': `http://${backendHost}`,
        // Вход через гейткипер: уход на /api/login/start и возврат через /api/login/finish.
        '/api/login': `http://${backendHost}`,
        // Подключение внешнего аккаунта на той же странице.
        '/api/connect': `http://${backendHost}`,
        '/api/telegram-app': `http://${backendHost}`,
      },
    },
    build: {
      // Production reporting uploads these separately; hidden maps never reveal a map URL to users.
      sourcemap: frontendErrorReporting ? 'hidden' : false,
      rollupOptions: {
        input: { main: resolve(__dirname, 'index.html'), telegramApp: resolve(__dirname, 'telegram-app.html') },
      },
    },
  }
})
