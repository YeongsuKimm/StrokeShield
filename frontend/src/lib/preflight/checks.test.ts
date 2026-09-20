import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildChecks, guarded, overall, runPreflight, type CheckResult, type PreflightEnv } from './checks'
import { isPreflightSearch } from './store'

const healthy = (): PreflightEnv => ({
  health: async () => ({ ok: true, dryRun: true, demoMode: false }),
  preflight: async () => ({ alertChannel: 'email_sms', alertChannelValid: true, demoPhoneConfigured: true, dryRun: true, smtpConfigured: true, twilioConfigured: false, gatewayValid: true, agentConfigured: true, agentConfiguredEs: true, phonemeReady: true, secondOpinionEnabled: false }),
  isSecureContext: () => true,
  hostname: () => 'localhost',
  hasGetUserMedia: () => true,
  hasAudioWorklet: () => true,
  hasWebGL: () => true,
  hasWasm: () => true,
  permission: async () => 'granted',
  countDevices: async () => 1,
  probeMediaPipe: async () => ({ delegate: 'GPU', ms: 812 }),
})

async function run(env: PreflightEnv): Promise<Record<string, CheckResult>> {
  return runPreflight(buildChecks(env), () => {}, 1_000)
}

describe('preflight checks', () => {
  it('everything healthy: all green, overall ok, one row per item in the brief', async () => {
    const r = await run(healthy())
    expect(Object.keys(r).sort()).toEqual(['backend', 'browser', 'camera', 'live-services', 'mediapipe', 'microphone', 'secure'])
    for (const row of Object.values(r)) expect(row.status).toBe('ok')
    expect(overall(r)).toBe('ok')
    expect(r.backend.detail).toMatch(/DRY RUN/)
    expect(r.mediapipe.detail).toMatch(/GPU/)
  })

  it('fails when either language guide or the live alert path is not configured', async () => {
    const base = await healthy().preflight()
    const r = await run({ ...healthy(), preflight: async () => ({ ...base, dryRun: false, smtpConfigured: false, agentConfiguredEs: false }) })
    expect(r['live-services']).toMatchObject({ status: 'fail' })
    expect(r['live-services'].detail).toMatch(/live alert|Spanish guide/)
  })

  it('fails visibly when the speech articulation model is unavailable', async () => {
    const base = await healthy().preflight()
    const r = await run({ ...healthy(), preflight: async () => ({ ...base, phonemeReady: false }) })
    expect(r['live-services']).toMatchObject({ status: 'fail' })
    expect(r['live-services'].detail).toMatch(/speech articulation model/)
    expect(r['live-services'].fix).toMatch(/PHONEME_SCORING=true/)
  })

  it('fails closed for a misspelled channel and accepts a non-US Twilio destination', async () => {
    const base = await healthy().preflight()
    const typo = await run({ ...healthy(), preflight: async () => ({ ...base, alertChannelValid: false }) })
    expect(typo['live-services'].status).toBe('fail')

    const twilio = await run({
      ...healthy(),
      preflight: async () => ({ ...base, alertChannel: 'twilio', dryRun: false, gatewayValid: false, demoPhoneConfigured: true, twilioConfigured: true }),
    })
    expect(twilio['live-services'].status).toBe('ok')
  })

  it('backend down: red with a hint that the camera checks still work', async () => {
    const r = await run({ ...healthy(), health: () => Promise.reject(new Error('Could not reach the server')) })
    expect(r.backend.status).toBe('fail')
    expect(r.backend.fix).toMatch(/still work/)
    expect(overall(r)).toBe('fail')
  })

  it('live texts armed is amber, not green: a rehearsal must not text a real phone by accident', async () => {
    const r = await run({ ...healthy(), health: async () => ({ ok: true, dryRun: false, demoMode: true }) })
    expect(r.backend.status).toBe('warn')
    expect(r.backend.detail).toMatch(/LIVE/)
    expect(overall(r)).toBe('warn')
  })

  it('camera: denied and missing are red, not-asked-yet is amber; every non-green row has a fix', async () => {
    const denied = await run({ ...healthy(), permission: async (n) => (n === 'camera' ? 'denied' : 'granted') })
    expect(denied.camera.status).toBe('fail')
    expect(denied.camera.fix).toMatch(/lock icon/)
    expect(denied.microphone.status).toBe('ok')
    const none = await run({ ...healthy(), countDevices: async (k) => (k === 'videoinput' ? 0 : 1) })
    expect(none.camera.status).toBe('fail')
    const prompt = await run({ ...healthy(), permission: async () => 'prompt' })
    expect(prompt.camera.status).toBe('warn')
    expect(prompt.microphone.status).toBe('warn')
    for (const row of [...Object.values(denied), ...Object.values(none), ...Object.values(prompt)]) if (row.status !== 'ok') expect(row.fix.length).toBeGreaterThan(5)
  })

  it('insecure context: camera, microphone and the context row are all red', async () => {
    const r = await run({ ...healthy(), isSecureContext: () => false })
    expect(r.secure.status).toBe('fail')
    expect(r.camera.status).toBe('fail')
    expect(r.microphone.status).toBe('fail')
    expect(r.secure.fix).toMatch(/https|localhost/)
  })

  it('MediaPipe: CPU delegate is amber, a load failure is red with a fix', async () => {
    const cpu = await run({ ...healthy(), probeMediaPipe: async () => ({ delegate: 'CPU', ms: 2400 }) })
    expect(cpu.mediapipe.status).toBe('warn')
    expect(cpu.mediapipe.detail).toMatch(/CPU/)
    const bad = await run({ ...healthy(), probeMediaPipe: () => Promise.reject(new Error('404 face_landmarker.task')) })
    expect(bad.mediapipe.status).toBe('fail')
    expect(bad.mediapipe.fix).toMatch(/pnpm install/)
  })

  it('service readiness: unreachable is red; the other checks still finish', async () => {
    const r = await run({ ...healthy(), preflight: () => Promise.reject(new Error('The server took too long')) })
    expect(r['live-services'].status).toBe('fail')
    expect(r.camera.status).toBe('ok')
  })

  it('browser support: missing WebGL is amber, missing getUserMedia / AudioWorklet / WASM is red', async () => {
    expect((await run({ ...healthy(), hasWebGL: () => false })).browser.status).toBe('warn')
    for (const k of ['hasGetUserMedia', 'hasAudioWorklet', 'hasWasm'] as const) {
      expect((await run({ ...healthy(), [k]: () => false })).browser.status).toBe('fail')
    }
  })

  it('a check that throws or hangs becomes a red row, and never blocks the panel', async () => {
    vi.useFakeTimers()
    try {
      const p = runPreflight(buildChecks({ ...healthy(), probeMediaPipe: () => new Promise(() => {}), countDevices: () => Promise.reject(new Error('x')) }), () => {}, 500)
      await vi.advanceTimersByTimeAsync(600)
      const r = await p
      expect(r.mediapipe).toMatchObject({ status: 'fail', detail: 'Timed out.' })
      expect(r.camera.status).toBe('fail')
      expect(overall(r)).toBe('fail')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rows are published as they land (running first, then the result)', async () => {
    const seen: string[] = []
    await runPreflight(buildChecks(healthy()), (id, r) => seen.push(`${id}:${r === 'running' ? 'running' : r.status}`), 1_000)
    expect(seen.filter((x) => x.startsWith('backend'))).toEqual(['backend:running', 'backend:ok'])
  })
})

describe('guarded / overall / entry point', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('guarded turns a throw into a red row', async () => {
    const r = await guarded(() => Promise.reject(new Error('boom')), 100, 'retry')
    expect(r).toMatchObject({ status: 'fail', fix: 'retry' })
  })

  it('overall: worst wins, empty is pending', () => {
    const row = (status: CheckResult['status']): CheckResult => ({ status, detail: '', fix: '' })
    expect(overall({})).toBe('pending')
    expect(overall({ a: row('ok'), b: row('warn') })).toBe('warn')
    expect(overall({ a: row('warn'), b: row('fail') })).toBe('fail')
  })

  it('?preflight=1 opens the panel, nothing else does', () => {
    expect(isPreflightSearch('?preflight=1')).toBe(true)
    expect(isPreflightSearch('?demo=1&preflight=1')).toBe(true)
    expect(isPreflightSearch('?preflight=0')).toBe(false)
    expect(isPreflightSearch('')).toBe(false)
  })
})
