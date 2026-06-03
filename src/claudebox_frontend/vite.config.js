/** Vite configuration with dev server proxy and build output settings. */

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const noReload = process.env.CLAUDEBOX_NO_RELOAD === '1'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': process.env.VITE_API_URL || 'http://localhost:41921',
    },
    hmr: noReload ? false : undefined,
    watch: noReload ? null : undefined,
  },
  build: {
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
    cssTarget: 'esnext',
  },
})
