# 01 — Architecture, Contracts & APIs

## System diagram
```
Browser (React)                                             Backend (FastAPI)
┌──────────────────────────────────────────┐   REST   ┌───────────────────────────────┐
│ Session state machine (Zustand)          │─────────▶│ POST /api/speech/analyze      │──▶ models/audio.py ──▶ ElevenLabs Scribe
│ MediaPipe Face+Pose  (webcam, real time) │          │ POST /api/vision/second-opinion│─▶ models/vision.py ─▶ Anthropic API
│ Web Audio recorder (WAV 16 kHz mono)     │          │ POST /api/alert               │──▶ services/twilio_service.py
│ Risk scorer (pure TS)                    │          │ GET  /api/agent/signed-url    │──▶ services/elevenlabs_service.py
│ Dashboard / overlay / demo panel         │          │ GET  /api/health              │
│ ElevenLabs agent SDK ◀──WebSocket──▶ ElevenLabs Agents platform (voice, client tools)
└──────────────────────────────────────────┘          └───────────────────────────────┘
```
The browser is the orchestrator. The agent talks; the app runs tests and owns state.

## Repo layout
```
AGENTS.md  CLAUDE.md  GEMINI.md  docs/spec/*.md  .env.example  requirements.txt
backend/
  main.py                 # FastAPI app, CORS, router mounting
  schemas.py              # Pydantic mirror of contracts
  routers/ speech.py vision.py alert.py agent.py
models/
  config.py               # thresholds/weights (uncalibrated flags)
  audio.py                # load wav → features → SpeechResult
  vision.py               # second-opinion call → VisionOpinion
services/
  elevenlabs_service.py   # signed URL, Scribe STT
  twilio_service.py       # place_call, send_sms, dry-run aware
tests/                    # pytest + fixtures/ (wav, jpg)
frontend/
  src/
    lib/contracts.ts      # TS mirror of contracts
    lib/config.ts         # thresholds/weights
    lib/vision/           # landmarks.ts face.ts arms.ts (pure metric fns) + useMediaPipe.ts
    lib/speech/           # recorder.ts (WAV encode) 
    lib/risk.ts           # pure scoring
    lib/session/          # store.ts (state machine)
    lib/agent/            # useAgent.ts clientTools.ts
    components/           # CameraView, Overlay, Dashboard, CountdownModal, DemoPanel
    pages/                # App.tsx
```

## Contracts (source of truth — mirror in `contracts.ts` and `schemas.py`)
```ts
type TestName = "face" | "arms" | "speech" | "eyes";   // "eyes" = stretch, gated by FEATURES.eyesTest

interface TestResult {
  test: TestName;
  severity: number;          // 0 = normal … 1 = clearly abnormal
  confidence: number;        // 0 = unusable … 1 = high quality capture
  metrics: Record<string, number>;   // raw named numbers shown on dashboard
  flags: string[];           // human-readable: "left mouth corner lifts less"
  side?: "left" | "right" | "both" | "none";   // patient's left/right, when applicable
  startedAt: number;         // epoch ms
  durationMs: number;
  needsRetry?: boolean;      // true when confidence too low to score
}

interface VisionOpinion {          // second opinion (optional signal)
  kind: "face" | "arms";
  finding: "asymmetric" | "symmetric" | "unclear";
  side: "left" | "right" | "none";
  confidence: number;
  rationale: string;               // <= 200 chars
}

interface RiskBreakdown {
  risk: number;                    // 0..1 overall
  threshold: number;
  contributions: { test: TestName | "vision"; weight: number; severity: number; confidence: number; contribution: number }[];
  triggered: boolean;
}

interface AlertRequest {
  reason: "risk_threshold" | "user_request";
  risk?: RiskBreakdown;
  patient: { name?: string; ageRange?: string };
  lastKnownWell?: string;          // free text: "about 20 minutes ago"
  location?: { lat: number; lng: number; accuracyM?: number };
  symptoms: string[];              // flags from TestResults
}
interface AlertResponse { ok: boolean; dryRun: boolean; callSid?: string; smsSid?: string; error?: string }
```
Rule: **no destination number in `AlertRequest`.** Backend reads `DEMO_PHONE_NUMBER`.

## Endpoints
| Method & path | Request | Response | Owner |
|---|---|---|---|
| `GET /api/health` | — | `{ok:true, dryRun, demoMode}` | Backend |
| `GET /api/agent/signed-url` | — | `{signedUrl}` | Backend/Agent |
| `POST /api/speech/analyze` | multipart: `audio` (wav), `target_phrase` | `TestResult` (+`transcript`, `metrics`) | Speech |
| `POST /api/vision/second-opinion` | `{images:[{kind, jpegBase64}]}` | `VisionOpinion[]` | Vision |
| `POST /api/alert` | `AlertRequest` | `AlertResponse` | Backend |

Timeouts: second opinion 5 s (non-blocking; the session proceeds without it), speech analyze 10 s, alert 10 s.
Errors: JSON `{error: string}` with proper status; frontend shows retry/fallback, never a blank screen.

## Environment variables
See `.env.example`. Backend reads via `python-dotenv`; frontend only gets `VITE_API_BASE_URL` and (if agent is public) `VITE_ELEVENLABS_AGENT_ID`.

## Optional ML dependencies
Heavy packages (torch, transformers) go in a separate `requirements-ml.txt` (exists: PyTorch CPU + transformers, ~1 GB, laptop only), NOT in `requirements.txt`, so the Railway image and teammates' installs stay light. Code must import them lazily and fall back gracefully when they're missing.

## Deployment
- Frontend → Vercel (`frontend/` root, build `pnpm build`, env `VITE_API_BASE_URL`).
- Backend → Railway (Dockerfile, Python 3.11). Include `ffmpeg` only if we fall back to webm uploads (default is WAV from the browser, so not needed). Set `ALLOWED_ORIGINS` to the Vercel URL.
- Fallback for demo day: run both locally; camera/mic work on `localhost` without HTTPS. Twilio calls need no inbound webhook (inline TwiML), so no tunnel needed.
