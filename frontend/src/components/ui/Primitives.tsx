// Small shared pieces: section headings, micro-labels, status pills, meters.
// Grouped in one file because each is a handful of lines and they always travel together.
import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

/** `level` makes it a heading for assistive tech without changing how it looks (it stays a styled <p>). */
export function MicroLabel({ children, className = '', level }: { children: ReactNode; className?: string; level?: 2 | 3 }) {
  return (
    <p className={`label-micro text-ink-3 ${className}`} role={level ? 'heading' : undefined} aria-level={level}>
      {children}
    </p>
  )
}

/** The rule + label that opens every section of the info page (mirrors the storyboard's hand-drawn underlines). */
export function SectionHead({ index, title, lede }: { index: string; title: string; lede?: string }) {
  return (
    <header className="mb-10">
      <div className="mb-5 h-1 w-full rounded-full bg-ink" />
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="label-micro text-accent">{index}</span>
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      </div>
      {lede && <p className="mt-3 max-w-[60ch] text-lg leading-relaxed text-ink-2">{lede}</p>}
    </header>
  )
}

export type PillTone = 'neutral' | 'ok' | 'caution' | 'danger' | 'accent'

const PILL: Record<PillTone, string> = {
  neutral: 'bg-sunken text-ink-2 border-line',
  ok: 'bg-ok-wash text-ok border-ok/25',
  caution: 'bg-caution-wash text-caution border-caution/25',
  danger: 'bg-danger-wash text-danger border-danger/25',
  accent: 'bg-accent-wash text-accent border-accent/25',
}

export function Pill({ tone = 'neutral', icon, children }: { tone?: PillTone; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 label-micro ${PILL[tone]}`}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  )
}

/** Horizontal meter. `mark` draws the threshold tick. Never animated to a value it hasn't reached. */
export function Meter({
  value,
  tone = 'accent',
  mark,
  height = 'h-2',
  label,
}: {
  value: number
  tone?: PillTone
  mark?: number
  height?: string
  label: string
}) {
  const fill = { neutral: 'bg-ink-3', ok: 'bg-ok', caution: 'bg-caution', danger: 'bg-danger', accent: 'bg-accent' }[tone]
  return (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-sunken forced-colors:border forced-colors:border-[CanvasText] ${height}`}
      role="meter"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out forced-colors:bg-[Highlight] ${fill}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
      {mark !== undefined && (
        <div className="absolute inset-y-0 w-0.5 bg-ink/45" style={{ left: `${mark * 100}%` }} aria-hidden />
      )}
    </div>
  )
}

/** Circular timer used for capture windows and the emergency countdown. */
export function Ring({
  fraction,
  label,
  size = 44,
  stroke = 4,
  tone = 'var(--color-accent)',
  track = 'rgba(255,255,255,0.22)',
}: {
  fraction: number
  label?: string
  size?: number
  stroke?: number
  tone?: string
  track?: string
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={tone}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(1, fraction)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 240ms linear' }}
      />
      {label && (
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize={size * 0.36}
          fontWeight={600}
          fontFamily="var(--font-sans)"
        >
          {label}
        </text>
      )}
    </svg>
  )
}
