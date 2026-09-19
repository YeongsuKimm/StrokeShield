import { useEffect, useRef, useState } from 'react'

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

/**
 * A number that rolls up from zero like a slot machine once it scrolls into view. Each digit is its own reel
 * (a column of 0-9 that slides to the target digit), the reels land left to right, and anything that is not a
 * digit ("." or "→") stays put. Reduced-motion users get the final number immediately. The real value is exposed
 * as the accessible name, so screen readers never hear the spinning digits.
 */
export function SlotNumber({ value, className = '' }: { value: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [go, setGo] = useState(false)
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const el = ref.current
    if (!el || reduce) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setGo(true)
          io.disconnect()
        }
      },
      { threshold: 0.6 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduce])

  const rolled = go || reduce
  let reel = 0
  return (
    <span ref={ref} className={`inline-flex ${className}`} role="img" aria-label={value}>
      {value.split('').map((ch, i) => {
        if (!/\d/.test(ch)) {
          return (
            <span key={i} aria-hidden className="whitespace-pre">
              {ch}
            </span>
          )
        }
        const n = Number(ch)
        const r = reel++
        return (
          <span key={i} aria-hidden className="relative inline-block h-[1em] overflow-hidden leading-none">
            {/* an invisible copy holds the width; the reel column slides over it */}
            <span className="invisible block leading-none">{ch}</span>
            <span
              className="absolute inset-x-0 top-0 flex flex-col leading-none will-change-transform"
              style={{
                transform: `translateY(${rolled ? -n : 0}em)`,
                transition: reduce ? 'none' : `transform ${1600 + r * 260}ms cubic-bezier(0.16, 1, 0.3, 1) ${r * 90}ms`,
              }}
            >
              {DIGITS.map((d) => (
                <span key={d} className="block h-[1em] leading-none">
                  {d}
                </span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}
