#!/usr/bin/env node
// Download the MediaPipe model files into frontend/public/models/ so the app runs fully OFFLINE (no CDN on demo day).
//
//   pnpm fetch-models            # download any missing model
//   pnpm fetch-models --force    # re-download everything
//
// The models are small (~9.5 MB total) and ARE COMMITTED, so a fresh clone works without running this.
// Run it only to refresh/replace them (e.g. switch to pose_landmarker_full). URLs are the official
// Google-hosted MediaPipe model bundles (float16, version 1). See public/models/README.md.
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models')
const BASE = 'https://storage.googleapis.com/mediapipe-models'

const MODELS = [
  {
    file: 'face_landmarker.task',
    url: `${BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
    minBytes: 1_000_000,
  },
  {
    file: 'pose_landmarker_lite.task',
    url: `${BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
    minBytes: 1_000_000,
  },
]

const force = process.argv.includes('--force')
await mkdir(OUT_DIR, { recursive: true })

let failed = 0
for (const m of MODELS) {
  const dest = join(OUT_DIR, m.file)
  const existing = await stat(dest).catch(() => null)
  if (existing && existing.size >= m.minBytes && !force) {
    console.log(`ok      ${m.file} (${(existing.size / 1e6).toFixed(1)} MB, already present)`)
    continue
  }
  try {
    const res = await fetch(m.url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < m.minBytes) throw new Error(`suspiciously small (${buf.length} bytes)`)
    await writeFile(`${dest}.tmp`, buf)
    await rename(`${dest}.tmp`, dest)
    console.log(`fetched ${m.file} (${(buf.length / 1e6).toFixed(1)} MB)`)
  } catch (e) {
    failed++
    const why = e instanceof Error ? e.message : String(e)
    console.error(
      `FAILED  ${m.file}: ${why}\n        download it manually from ${m.url}\n        and save it as frontend/public/models/${m.file}`,
    )
  }
}
process.exit(failed ? 1 : 0)
