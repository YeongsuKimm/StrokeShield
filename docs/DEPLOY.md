# Deploying StrokeShield (Railway backend + Vercel frontend)

The demo normally runs both on the laptop (`localhost` gets camera/mic without HTTPS). Railway + Vercel is the backup.
The backend image is **torch-free** (`Dockerfile` at the repo root): no phoneme model, `PHONEME_SCORING` stays `false`.

## Backend on Railway
1. New project from this repo; Railway detects the root `Dockerfile` (python:3.11-slim, non-root user, `PORT` from Railway).
2. Set **Variables** in Railway. **Never** put keys in the image or the repo (`.dockerignore` excludes `.env`).

| Variable | Value |
|---|---|
| `DRY_RUN` | `true` until you have sent one consented test text; `false` only for the live demo |
| `DEMO_MODE` | `true` |
| `DEMO_PHONE_NUMBER` | E.164, US for email-to-SMS (`+1XXXXXXXXXX`); the only number the backend can ever alert |
| `ALERT_CHANNEL` | `email_sms` (or `twilio` for the legacy path) |
| `SMS_GATEWAY_DOMAIN` | `vtext.com` (Verizon) |
| `SMTP_USER`, `SMTP_APP_PASSWORD` | Gmail address + app password (docs/SMS-SETUP.md) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | voice guide (signed URL is minted server-side) |
| `ALLOWED_ORIGINS` | the exact Vercel origin, e.g. `https://strokeshield.vercel.app` (comma-separated for several) |
| `SECOND_OPINION`, `GEMINI_API_KEY` | leave off unless the volunteers consented (docs/PRIVACY.md) |

3. The container runs `uvicorn ... --proxy-headers --forwarded-allow-ips='*' --no-access-log`: the per-IP rate limits see the real
   client address behind Railway's proxy, and request lines are not logged.
4. Check it: `GET https://<backend>/api/health` and **`GET /api/preflight`** (booleans only: alert channel, dry run,
   SMTP configured, gateway valid, agent configured, ...). Startup also logs `preflight:` warnings for an inconsistent
   configuration (no secrets in them).

## Frontend on Vercel
1. Project root `frontend/`, build `pnpm build`, output `dist`.
2. Env var `VITE_API_BASE_URL=https://<backend origin>` (no trailing slash). It is a public value, baked in at build time.
3. `frontend/vercel.json` carries the CSP. Its `connect-src` currently allows `https://*.up.railway.app`; **once the real backend
   origin is known, replace that wildcard with it** (e.g. `https://strokeshield-production.up.railway.app`). Vercel cannot
   template env vars into headers, so this is a manual edit. Leave `https://api.elevenlabs.io wss://api.elevenlabs.io`.
4. Redeploy, open the site over HTTPS, and run the demo path once with `DRY_RUN=true`.

## Local without Docker
`pip install -r requirements.txt && uvicorn backend.main:app --port 8000`, and `pnpm dev` in `frontend/` (Vite proxies `/api`).
`docker build -t strokeshield-backend . && docker run --env-file .env -p 8000:8000 strokeshield-backend` also works
(`--env-file` passes secrets at run time; they are never in the image).
