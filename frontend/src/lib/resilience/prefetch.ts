// Warm the browser cache for the vision runtime once the visitor has consented, so the first camera check does not sit
// on "Starting the camera..." while ~10 MB of models and WASM download. The MediaPipe JS runtime is its own lazy chunk;
// this only starts that import early. Same-origin static files, no personal data, skipped on Save-Data connections,
// and every failure is silent (the real load retries on its own and reports its own errors).
import { useSession } from '../session/store'

export interface PrefetchDeps {
  fetchAsset: (url: string) => Promise<void>
  importRuntime: () => Promise<unknown>
  saveData: () => boolean
  /** Schedule low-priority work. */
  later: (fn: () => void) => void
}

export interface PrefetchPlan {
  urls: string[]
}

let started = false
/** Test hook. */
export const __resetPrefetch = () => {
  started = false
}

export async function prefetchVisionAssets(plan: PrefetchPlan, deps: PrefetchDeps): Promise<'started' | 'skipped'> {
  if (started || deps.saveData()) return 'skipped'
  started = true
  await new Promise<void>((resolve) => deps.later(resolve))
  await deps.importRuntime().catch(() => undefined)
  for (const url of plan.urls) await deps.fetchAsset(url).catch(() => undefined) // one at a time: never compete with the UI
  return 'started'
}

export const browserPrefetchDeps = (): PrefetchDeps => ({
  fetchAsset: async (url) => {
    const res = await fetch(url, { cache: 'force-cache' })
    if (res.ok) await res.arrayBuffer()
  },
  importRuntime: () => import('@mediapipe/tasks-vision'),
  saveData: () => !!(navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData,
  later: (fn) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback
    if (ric) ric(fn, { timeout: 2000 })
    else setTimeout(fn, 500)
  },
})

/** Start the prefetch the moment `consented` becomes true (or immediately if it already is). Returns the cleanup. */
export function installPrefetchOnConsent(plan: PrefetchPlan, deps: PrefetchDeps = browserPrefetchDeps()): () => void {
  const go = () => void prefetchVisionAssets(plan, deps)
  if (useSession.getState().consented) go()
  return useSession.subscribe((s, prev) => {
    if (s.consented && !prev.consented) go()
  })
}
