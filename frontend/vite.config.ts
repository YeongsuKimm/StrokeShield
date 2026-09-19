import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const PHONE = process.env.SS_PHONE === '1'

// https://vite.dev/config/
export default defineConfig({
  // `pnpm dev:phone` (SS_PHONE=1) serves over HTTPS on the local network so a REAL PHONE can open the site: browsers
  // only allow the camera and microphone on https:// or localhost, so a plain http://192.168.x.x address cannot run a
  // single check. The certificate is self-signed, so the phone warns once ("Advanced" -> "Proceed"); that is expected
  // locally and does not apply to the deployed site. Plain `pnpm dev` is unchanged: http, localhost only.
  plugins: [react(), tailwindcss(), ...(PHONE ? [basicSsl()] : [])],
  // The only chunk above 500 kB is the lazy voice-guide chunk (the ElevenLabs/LiveKit SDK, ~590 kB). It loads after
  // first paint and is optional, so it is allowed here; the app shell and every check stay well under.
  build: { chunkSizeWarningLimit: 650 },
  server: {
    // `host: true` (phone mode only) also listens on the LAN address. The proxy means the phone needs no second
    // address and no CORS entry: it reaches the backend through the same origin it loaded the page from.
    host: PHONE,
    proxy: { '/api': 'http://localhost:8000' },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
