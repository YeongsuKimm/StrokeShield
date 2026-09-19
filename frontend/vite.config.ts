import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Backend runs on :8000 in dev; the frontend calls relative /api/* paths.
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
