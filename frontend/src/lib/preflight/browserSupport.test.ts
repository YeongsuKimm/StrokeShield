import { describe, expect, it } from 'vitest'
import { detectBrowser } from './browserSupport'

// Real user-agent strings, trimmed. Keep them verbatim: this whole module is pattern-matching against them.
const UA = {
  iosSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  ipadOS:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.3.28.104',
  facebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/468.0.0.30.107]',
  tiktok:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 musical_ly_2023 BytedanceWebview/d8a21c6',
}

describe('detectBrowser', () => {
  it.each([
    ['iOS Safari', UA.iosSafari],
    ['Chrome on iOS (still WebKit)', UA.iosChrome],
    ['Android Chrome', UA.androidChrome],
    ['Samsung Internet (Blink)', UA.samsung],
    ['macOS Safari', UA.macSafari],
    ['macOS Chrome', UA.macChrome],
  ])('supports %s', (_name, ua) => {
    expect(detectBrowser(ua).verdict).toBe('supported')
  })

  it.each([
    ['Instagram', UA.instagram, 'Instagram'],
    ['Facebook', UA.facebook, 'Facebook'],
    ['TikTok', UA.tiktok, 'TikTok'],
  ])('flags the %s in-app browser and names it', (_name, ua, host) => {
    expect(detectBrowser(ua)).toMatchObject({ verdict: 'in-app', host })
  })

  it('Firefox runs but is marked untested, never blocked', () => {
    for (const ua of [UA.firefox, UA.androidFirefox]) {
      expect(detectBrowser(ua)).toMatchObject({ verdict: 'untested', engine: 'gecko' })
    }
  })

  it('an empty user agent is untested, never in-app: a stripped UA must not stop the check', () => {
    expect(detectBrowser('')).toMatchObject({ verdict: 'untested', engine: 'unknown', host: null })
  })

  it('knows the platform, including iPadOS pretending to be a Mac', () => {
    expect(detectBrowser(UA.iosSafari)).toMatchObject({ ios: true, android: false })
    expect(detectBrowser(UA.androidChrome)).toMatchObject({ ios: false, android: true })
    expect(detectBrowser(UA.macSafari)).toMatchObject({ ios: false, android: false })
    // Same string as a desktop Mac; only the touch count separates them.
    expect(detectBrowser(UA.ipadOS, { maxTouchPoints: 5 }).ios).toBe(true)
    expect(detectBrowser(UA.ipadOS, { maxTouchPoints: 0 }).ios).toBe(false)
  })

  it('an in-app browser on a supported engine still reports that engine', () => {
    // The fix we offer ("open in Safari") depends on the platform, not just the verdict.
    expect(detectBrowser(UA.instagram)).toMatchObject({ verdict: 'in-app', engine: 'webkit', ios: true })
    expect(detectBrowser(UA.tiktok)).toMatchObject({ verdict: 'in-app', engine: 'blink', android: true })
  })
})
