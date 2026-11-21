import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'

// The panel is built into ../server/public, which the Express server already serves.
// `npm run dev` runs Vite with hot reload and forwards /api to the server on port 8080.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
