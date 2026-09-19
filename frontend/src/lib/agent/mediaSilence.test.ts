import { describe, expect, it } from 'vitest'
import { muteAllMedia } from './mediaSilence'

/** A stand-in for a media element: only `muted` matters here. */
const el = (muted = false) => ({ muted }) as HTMLMediaElement
const rootOf = (els: HTMLMediaElement[]) => ({ querySelectorAll: () => els as unknown as NodeListOf<HTMLMediaElement> })

describe('muteAllMedia', () => {
  it('mutes everything, then restores each element to what it was', () => {
    const agent = el(false)
    const camera = el(true) // our own <video> is already muted; it must stay that way
    const restore = muteAllMedia(rootOf([agent, camera]))
    expect([agent.muted, camera.muted]).toEqual([true, true])
    restore()
    expect([agent.muted, camera.muted]).toEqual([false, true])
  })

  it('restoring twice does not un-mute something muted since', () => {
    const a = el(false)
    const restore = muteAllMedia(rootOf([a]))
    restore()
    a.muted = true // e.g. a later recording silenced it again
    restore()
    expect(a.muted).toBe(true)
  })

  it('never throws when the document cannot be read: silencing must not break the recording', () => {
    const broken = {
      querySelectorAll: () => {
        throw new Error('detached document')
      },
    } as unknown as Document
    const restore = muteAllMedia(broken)
    expect(restore).not.toThrow()
  })

  it('no media on the page is a no-op', () => {
    expect(muteAllMedia(rootOf([]))).not.toThrow()
  })
})
