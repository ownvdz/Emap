import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
    server: {
    allowedHosts: ['ownvdz.duckdns.org'],
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
