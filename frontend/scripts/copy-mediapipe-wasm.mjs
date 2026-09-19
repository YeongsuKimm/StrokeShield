#!/usr/bin/env node
// Copy the MediaPipe wasm runtime from node_modules into public/mediapipe-wasm/ so it is served locally
// (no CDN). Runs on postinstall / predev / prebuild. The output (~35 MB) is gitignored, never committed.
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const DEST = join(ROOT, 'public', 'mediapipe-wasm')

const files = await readdir(SRC).catch(() => null)
if (!files) {
  console.error(`copy-mediapipe-wasm: ${SRC} not found. Run "pnpm install" first.`)
  process.exit(1)
}
await mkdir(DEST, { recursive: true })
let copied = 0
for (const f of files) {
  const [s, d] = [join(SRC, f), join(DEST, f)]
  const [ss, ds] = [await stat(s), await stat(d).catch(() => null)]
  if (ds && ds.size === ss.size) continue
  await copyFile(s, d)
  copied++
}
console.log(`copy-mediapipe-wasm: ${copied} copied, ${files.length - copied} up to date -> public/mediapipe-wasm/`)
