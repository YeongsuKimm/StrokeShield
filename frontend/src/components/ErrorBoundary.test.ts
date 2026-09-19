import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CrashScreen, ErrorBoundary } from './ErrorBoundary'

const noop = () => {}

describe('crash screen', () => {
  it('always offers Reload / Start over / Clear my data and a Call 911 link', () => {
    for (const chunk of [false, true]) {
      const html = renderToStaticMarkup(createElement(CrashScreen, { chunk, onStartOver: noop, onClear: noop }))
      expect(html).toContain('Reload the page')
      expect(html).toContain('Start over')
      expect(html).toContain('Clear my data')
      expect(html).toContain('href="tel:911"')
      expect(html).toMatch(/not a medical device/i)
    }
  })

  it('a dropped-connection chunk failure gets its own wording', () => {
    const html = renderToStaticMarkup(createElement(CrashScreen, { chunk: true, onStartOver: noop, onClear: noop }))
    expect(html).toMatch(/connection/i)
  })
})

describe('ErrorBoundary state machine', () => {
  it('turns a render error into fallback state, and a new resetKey clears it', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('x'))).toMatchObject({ hasError: true })
    const cleared = ErrorBoundary.getDerivedStateFromProps({ children: null, resetKey: 'b' }, { error: new Error('x'), hasError: true, resetKey: 'a' })
    expect(cleared).toMatchObject({ hasError: false, error: null, resetKey: 'b' })
    expect(ErrorBoundary.getDerivedStateFromProps({ children: null, resetKey: 'a' }, { error: null, hasError: true, resetKey: 'a' })).toBeNull()
  })

  it('renders its children when nothing is wrong', () => {
    const html = renderToStaticMarkup(createElement(ErrorBoundary, null, createElement('p', null, 'all fine')))
    expect(html).toBe('<p>all fine</p>')
  })

  it('an inline (lazy-piece) boundary does not stop the camera when it catches', () => {
    const b = new ErrorBoundary({ children: null, inline: null })
    const debug = vi.spyOn(console, 'debug').mockImplementation(noop)
    expect(() => b.componentDidCatch(new Error('chunk'), { componentStack: '' })).not.toThrow()
    debug.mockRestore()
  })
})
