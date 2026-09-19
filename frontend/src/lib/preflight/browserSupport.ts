// Which browser is this, and can it run the check at all? Pure: a user-agent string in, a verdict out, so it is
// unit-testable (lib/preflight/browserSupport.test.ts). Nothing here touches the DOM.
//
// We support Safari and Chrome (project decision, docs/spec/00-overview.md). In practice that means the two engines
// those browsers use: WebKit (Safari everywhere, and every browser on iOS, which Apple requires to use WebKit) and
// Blink (Chrome, Edge, Samsung Internet, Opera, Brave). Anything else still runs; it just gets a "not tested here" line.
//
// The one case that genuinely BREAKS is an in-app browser: the web view inside Instagram, Facebook, TikTok and similar
// apps. Several block getUserMedia outright, so the camera check can never start, and the failure looks like a bug in
// our app rather than a browser limitation. Those get a clear "open this in Safari or Chrome" message instead.

export type SupportVerdict = 'supported' | 'untested' | 'in-app'

export interface BrowserSupport {
  verdict: SupportVerdict
  engine: 'webkit' | 'blink' | 'gecko' | 'unknown'
  /** iOS or iPadOS: several of the audio/camera workarounds in the app are only needed here. */
  ios: boolean
  android: boolean
  /** The app whose in-app browser this is ("Instagram"), when the verdict is 'in-app'. Null otherwise. */
  host: string | null
}

/** Extra signals the UA string alone cannot give. All optional so the function stays testable with a string. */
export interface BrowserHints {
  /** navigator.maxTouchPoints. iPadOS reports a desktop Mac UA, and a touch count is the usual way to tell them apart. */
  maxTouchPoints?: number
}

/**
 * In-app web views, by the marker each one puts in its user-agent string. Ordered most specific first: several of
 * these apps embed Facebook's SDK, so FBAN/FB_IAB would otherwise claim them.
 */
const IN_APP: [RegExp, string][] = [
  [/Instagram/i, 'Instagram'],
  [/\bLine\//i, 'LINE'],
  [/MicroMessenger/i, 'WeChat'],
  [/\bSnapchat/i, 'Snapchat'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/\bTikTok|musical_ly|BytedanceWebview/i, 'TikTok'],
  [/\bTwitter(?:Android|\b)|\bTwitterForiPhone/i, 'X'],
  [/\bPinterest/i, 'Pinterest'],
  [/FBAN|FBAV|FB_IAB|FB4A/i, 'Facebook'],
  [/\bGSA\//i, 'the Google app'],
]

/**
 * Decide what this browser is and whether the check can run in it.
 *
 * An empty or missing user-agent string is treated as 'untested', never as broken: a stripped UA (privacy tooling,
 * an odd embedded runtime) must not stop someone who may be having a stroke from running the check.
 */
export function detectBrowser(ua: string, hints: BrowserHints = {}): BrowserSupport {
  const s = ua || ''
  // iPadOS 13+ pretends to be a desktop Mac; a Mac with a touch screen does not exist, so touch points give it away.
  const iPadAsMac = /Macintosh/.test(s) && (hints.maxTouchPoints ?? 0) > 1
  const ios = /iPhone|iPad|iPod/.test(s) || iPadAsMac
  const android = /Android/.test(s)

  // Engine, not brand. On iOS every browser is WebKit whatever its name says, so the platform check comes first.
  const engine: BrowserSupport['engine'] = ios
    ? 'webkit'
    : /Edg\/|Chrome\/|Chromium\/|CriOS|SamsungBrowser|OPR\//.test(s)
      ? 'blink'
      : /\bFirefox\/|FxiOS/.test(s)
        ? 'gecko'
        : /\bSafari\/|AppleWebKit/.test(s)
          ? 'webkit'
          : 'unknown'

  for (const [re, host] of IN_APP) {
    if (re.test(s)) return { verdict: 'in-app', engine, ios, android, host }
  }

  const verdict: SupportVerdict = engine === 'webkit' || engine === 'blink' ? 'supported' : 'untested'
  return { verdict, engine, ios, android, host: null }
}

/** Read the live browser. Safe on a server / in tests, where there is no navigator. */
export function currentBrowser(): BrowserSupport {
  const nav = globalThis.navigator as Navigator | undefined
  return detectBrowser(nav?.userAgent ?? '', { maxTouchPoints: nav?.maxTouchPoints })
}
