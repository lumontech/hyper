import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE        — path-prefix per assets es. '/hyperliquid/' (default '/')
// VITE_API_BASE    — base URL per chiamate al backend (default 'http://127.0.0.1:7777')
//                    In prod con backend stesso origine si usa stringa vuota '' (chiamate relative).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE ?? '/'
  return {
    base,
    plugins: [react()],
    server: {
      port: 5174,
      host: '127.0.0.1',
      strictPort: true,
    },
    define: {
      // Compile-time const usata da services/api.ts
      __API_BASE__: JSON.stringify(env.VITE_API_BASE ?? 'http://127.0.0.1:7777'),
      __APP_BASE__: JSON.stringify(base),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
    },
  }
})
