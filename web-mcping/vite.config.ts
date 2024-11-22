import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/mcping',
  plugins: [
    vue()
  ],
  server: {
    proxy: {
      '/wsproxy' : {
        target: 'ws://rockpi.homelab/',
        ws: true,
        changeOrigin: true,
        auth: ''
      }
    }
  }
})
