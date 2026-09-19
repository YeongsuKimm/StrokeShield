import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAllLocalData, defaultClearDeps, deleteAllIndexedDbs, type ClearDeps } from './clearData'
import { useSession } from '../session/store'
import { useRecorder } from '../calibration/recorder'
import type { TestResult } from '../contracts'

const fakeStorage = (initial: Record<string, string>) => {
  const data = { ...initial }
  return {
    data,
    clear: () => {
      for (const k of Object.keys(data)) delete data[k]
    },
  }
}

const deps = (over: Partial<ClearDeps> = {}, calls: string[] = []): ClearDeps => ({
  stopRunners: () => void calls.push('stopRunners'),
  endAgent: async () => void calls.push('endAgent'),
  releaseMic: () => void calls.push('releaseMic'),
  stopCamera: () => void calls.push('stopCamera'),
  resetSession: () => void calls.push('resetSession'),
  resetRecorders: () => void calls.push('resetRecorders'),
  local: null,
  session: null,
  clearIndexedDb: null,
  ...over,
})

describe('clearAllLocalData', () => {
  it('stops hardware and the voice guide before it forgets state, and reports no failures', async () => {
    const calls: string[] = []
    const report = await clearAllLocalData(deps({}, calls))
    expect(report.failed).toEqual([])
    expect(calls).toEqual(['stopRunners', 'endAgent', 'releaseMic', 'stopCamera', 'resetRecorders', 'resetSession'])
    expect(calls.indexOf('endAgent')).toBeLessThan(calls.indexOf('resetSession')) // no late transcript can land after the wipe
  })

  it('empties localStorage, sessionStorage and IndexedDB', async () => {
    const local = fakeStorage({ 'strokeshield.record.subject': 'sam', other: 'x' })
    const session = fakeStorage({ k: 'v' })
    const clearIndexedDb = vi.fn(async () => {})
    await clearAllLocalData(deps({ local, session, clearIndexedDb }))
    expect(local.data).toEqual({})
    expect(session.data).toEqual({})
    expect(clearIndexedDb).toHaveBeenCalledOnce()
  })

  it('keeps going when one step throws, and names the failed step', async () => {
    const local = fakeStorage({ a: '1' })
    const report = await clearAllLocalData(
      deps({
        stopCamera: () => {
          throw new Error('camera busy')
        },
        endAgent: async () => {
          throw new Error('socket')
        },
        local,
      }),
    )
    expect(report.failed).toEqual(['endAgent', 'stopCamera'])
    expect(local.data).toEqual({}) // later steps still ran
  })
})

describe('deleteAllIndexedDbs', () => {
  it('deletes every database it is told about, even when one is blocked', async () => {
    const deleted: string[] = []
    const idb = {
      databases: async () => [{ name: 'a' }, { name: 'b' }, {}],
      deleteDatabase: (name: string) => {
        deleted.push(name)
        const req = {} as IDBOpenDBRequest
        queueMicrotask(() => (name === 'a' ? req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent) : req.onsuccess?.(new Event('success'))))
        return req
      },
    }
    await deleteAllIndexedDbs(idb)
    expect(deleted).toEqual(['a', 'b'])
  })

  it('does nothing where databases() is unavailable', async () => {
    const deleteDatabase = vi.fn()
    await deleteAllIndexedDbs({ deleteDatabase } as never)
    expect(deleteDatabase).not.toHaveBeenCalled()
  })
})

describe('clearAllLocalData with the real stores', () => {
  beforeEach(() => useSession.getState().clearAll())

  it('wipes results, transcript, location, permissions, consent and calibration-tool memory', async () => {
    const s = () => useSession.getState()
    s().giveConsent()
    s().setVoiceConsent(true)
    s().setPermission('camera', 'granted')
    s().setLocation({ lat: 39.3, lng: -76.6 })
    s().setLastKnownWell('7pm')
    s().addTranscript('patient', 'my name is Sam')
    s().completeTest({ test: 'face', severity: 0.1, confidence: 1, metrics: {}, flags: [], startedAt: 0, durationMs: 0 } as TestResult)
    useRecorder.setState({ subject: 'Sam Smith', notes: 'n', conditions: { glasses: true } })

    // Camera and mic teardown need requestAnimationFrame (browser only), so those two are stubbed here.
    const { failed } = await clearAllLocalData({ ...defaultClearDeps(), releaseMic: () => {}, stopCamera: () => {} })

    expect(failed).toEqual([])
    expect(s().consented).toBe(false)
    expect(s().voiceConsent).toBe(false)
    expect(s().results).toEqual({})
    expect(s().transcript).toEqual([])
    expect(s().location).toBeUndefined()
    expect(s().lastKnownWell).toBeUndefined()
    expect(s().permissions).toEqual({ camera: 'unknown', microphone: 'unknown', location: 'unknown' })
    expect(useRecorder.getState().subject).toBe('')
    expect(useRecorder.getState().conditions).toEqual({})
  })
})
