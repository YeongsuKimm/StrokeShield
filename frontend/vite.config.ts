import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The only chunk above 500 kB is the lazy voice-guide chunk (the ElevenLabs/LiveKit SDK, ~590 kB). It loads after
  // first paint and is optional, so it is allowed here; the app shell and every check stay well under.
  build: { chunkSizeWarningLimit: 650 },
  server: {
    // Backend runs on :8000 in dev; the frontend calls relative /api/* paths.
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
