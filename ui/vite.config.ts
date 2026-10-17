import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// UI រត់លើ port 5173, sidecar លើ 8765. `proxy` ធ្វើឲ្យ browser គិតថា
// ទាំងពីរនៅ origin តែមួយ ដូច្នេះគ្មានបញ្ហា CORS ហើយ fetch('/api/health')
// ទៅដល់ sidecar ដោយស្វ័យប្រវត្តិ. `ws: true` សម្រាប់ WebSocket progress.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
