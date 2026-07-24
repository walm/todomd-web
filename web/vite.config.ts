import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// The Go server embeds dist/, or proxies to this dev server when started with
// --dev. In dev, /api requests go the other way: to a todomd-web already
// running on its default port.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:7337' },
  },
})
