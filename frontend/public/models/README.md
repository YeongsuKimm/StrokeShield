# MediaPipe model files

Served locally so the app works offline (no CDN on demo day). Loaded by `src/lib/vision/useMediaPipe.ts`.

| File | Size | Source |
|---|---|---|
| `face_landmarker.task` | 3.8 MB | https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task |
| `pose_landmarker_lite.task` | 5.8 MB | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task |

Total is under 15 MB, so **these files are committed**; a fresh clone works without a download.

To refresh them (or re-download if they go missing): `cd frontend && pnpm fetch-models` (`--force` to overwrite).
To try the heavier pose model, change the URL in `scripts/fetch-models.mjs` and `POSE_MODEL` in `useMediaPipe.ts`.

The MediaPipe **wasm runtime** is not stored here: `scripts/copy-mediapipe-wasm.mjs` copies it from
`node_modules/@mediapipe/tasks-vision/wasm` to `public/mediapipe-wasm/` (gitignored) on `postinstall`, `predev` and `prebuild`.

Models are Apache-2.0 licensed by Google (see the MediaPipe model cards).
