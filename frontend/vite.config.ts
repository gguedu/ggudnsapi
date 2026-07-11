import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: frontendDir,
  plugins: [react(), tailwindcss()],
  base: '/',
  build: {
    outDir: path.resolve(frontendDir, '../public'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(frontendDir, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
