// Drilldown menu: a list that drills into itself. The row you click stays put, fades to a grey breadcrumb with a
// return arrow, and its children arrive one indent deeper. No sliding panels.
//
// SOURCE: "Drilldown Menu" by ruixen.ui on 21st.dev (https://21st.dev/ruixen.ui/components/drilldown-menu), retrieved
// with `npx @21st-dev/cli get`. The motion design is theirs and is kept as-is. Adapted for this project:
//   - shadcn theme tokens (bg-muted, text-foreground, ring-ring) -> our tokens (index.css), and `cn` -> a tiny local join,
//     so the project needs no shadcn setup, `@/` alias or clsx/tailwind-merge.
//   - row pitch/height raised so each row is a comfortable target (about 44 px pitch, 38 px tall at the menu font size).
//   - accessibility: every button gets a real aria-label (the per-letter animation would otherwise be read out as
//     separate letters), and rows that open something expose aria-expanded.
//   - `onDepthChange` so the caller can size its card to the current level; fixed min-height / font size removed.
//
// Movement craft (from the original), most of it about NOT moving:
//  - Rows are placed absolutely, by index, on a grid of one ROW_PITCH, so a leaving row takes no space with it and
//    nothing behind it reflows.
//  - Rows are ONE flat list keyed by id (trail rows and choices are siblings), so the row you clicked is the same
//    element before and after and simply travels.
//  - Nothing moves sideways: indent is a function of the depth an item lives at, not of what is open.
//  - The text carries the transition: each label is set per character, scaling and unblurring in on a short stagger
//    and reversing out back-to-front.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion, usePresence, useReducedMotion } from 'framer-motion'

const cn = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ')

export interface DrilldownMenuItem {
  /** Stable identifier. Must be unique across the WHOLE tree (rows from every level share one keyed list). */
  id: string
  /** Row text. Also the accessible name. */
  label: string
  /** Children. A row with children drills in; one without is a leaf. */
  items?: DrilldownMenuItem[]
  /** Fires when a leaf row is chosen. */
  onSelect?: () => void
}

interface DrilldownMenuProps {
  /** The tree. Content lives with the caller, never in here. */
  items: DrilldownMenuItem[]
  className?: string
  /** Ids of the branches to open on mount, outermost first. */
  defaultPath?: string[]
  /** Fires when a leaf row is chosen, with the trail that led to it. */
  onSelect?: (item: DrilldownMenuItem, trail: DrilldownMenuItem[]) => void
  /** Fires with the number of open branches (0 = collapsed to the top level). */
  onDepthChange?: (depth: number) => void
  /** Accessible prefix for breadcrumb rows. */
  backLabel?: string
}

/** Near-critically damped: rows settle in about 300 ms with no overshoot, because every row carries a word being read. */
const SPRING = { type: 'spring' as const, stiffness: 520, damping: 46, mass: 0.9 }
/** Livelier, because a character travels a few pixels, not a few rows. */
const CHAR_SPRING = { type: 'spring' as const, stiffness: 500, damping: 30, mass: 1 }

/**
 * Layout grid, in em, so the whole menu scales off one font size. A touch device gets a taller grid so each row
 * clears the 44px minimum for a thumb; the pitch has to grow with it or absolutely-positioned rows would overlap.
 * Read once at module load: a device does not grow a touchscreen mid-session.
 */
const COARSE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true
const TOUCH_SCALE = COARSE ? 1.4 : 1
const ROW_PITCH = 2.2 * TOUCH_SCALE
const ROW_HEIGHT = 1.9 * TOUCH_SCALE
const INDENT = 0.9

/** Per-character cadence. Out is quicker than in, and runs back to front. */
const STAGGER_IN = 0.015
const STAGGER_OUT = 0.008

const CHAR_VARIANTS = {
  hidden: {
    opacity: 0,
    scale: 0,
    filter: 'blur(4px)',
    // A tween out, not a spring: a spring's tail keeps the row mounted long after it is invisible.
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] as const },
  },
  visible: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: CHAR_SPRING },
}

/** Return arrow: points back the way you came, tail curling away below. */
function ReturnArrow() {
  return (
    <svg
      aria-hidden="true"
      className="h-[0.9em] w-[0.9em]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M9 5 4 10l5 5" />
      <path d="M4 10h9a6 6 0 0 1 6 6v2" />
    </svg>
  )
}

/** Walk `defaultPath` down the tree, stopping at the first id that misses. */
function resolvePath(items: DrilldownMenuItem[], ids: string[]): DrilldownMenuItem[] {
  const trail: DrilldownMenuItem[] = []
  let level = items
  for (const id of ids) {
    const next = level.find((item) => item.id === id)
    if (!next?.items?.length) break
    trail.push(next)
    level = next.items
  }
  return trail
}

export function DrilldownMenu({ items, className, defaultPath, onSelect, onDepthChange, backLabel = 'Back to' }: DrilldownMenuProps) {
  const [trail, setTrail] = useState<DrilldownMenuItem[]>(() => (defaultPath ? resolvePath(items, defaultPath) : []))
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    onDepthChange?.(trail.length)
  }, [trail.length, onDepthChange])

  const level = trail.length ? (trail[trail.length - 1].items ?? []) : items

  // ONE list, not a trail list plus a choice list. Two sibling arrays under the same AnimatePresence scope key per
  // array, so the row you click gets torn down on one side and rebuilt on the other: it fades and reappears instead
  // of travelling.
  const rows = [
    ...trail.map((item, depth) => ({ item, depth, isTrail: true })),
    ...level.map((item) => ({ item, depth: trail.length, isTrail: false })),
  ]

  const handleItem = (item: DrilldownMenuItem) => {
    if (item.items?.length) {
      setTrail((current) => [...current, item])
      return
    }
    item.onSelect?.()
    onSelect?.(item, trail)
  }

  return (
    <div className={className}>
      {/* Height is a CSS transition rather than an animated value: it is the one property here expressed in `em`,
          and CSS interpolates units natively where an animation library has to re-read them in px. */}
      <div
        className={cn('relative', !reduceMotion && 'transition-[height] duration-300 ease-out')}
        style={{ height: `${(rows.length - 1) * ROW_PITCH + ROW_HEIGHT}em` }}
      >
        <AnimatePresence initial={false}>
          {rows.map(({ item, depth, isTrail }, index) => (
            <Row
              depth={depth}
              index={index}
              isTrail={isTrail}
              item={item}
              key={item.id}
              onActivate={() => (isTrail ? setTrail((current) => current.slice(0, depth)) : handleItem(item))}
              reduceMotion={!!reduceMotion}
              backLabel={backLabel}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

interface RowProps {
  item: DrilldownMenuItem
  depth: number
  index: number
  isTrail: boolean
  onActivate: () => void
  reduceMotion: boolean
  backLabel: string
}

/**
 * Position and presence are deliberately on two different elements.
 *
 * The outer one owns position: placed by CSS, moved by `layout` (it measures boxes, so it is indifferent to the
 * em units the position was authored in). The inner one owns presence, so it can orchestrate the characters in and
 * out on a stagger, and drives its own removal through `usePresence`, which is what lets the exit run per character.
 */
function Row({ item, depth, index, isTrail, onActivate, reduceMotion, backLabel }: RowProps) {
  const [isPresent, safeToRemove] = usePresence()
  const opensBelow = !!item.items?.length

  // Backstop: if the exit animation never reports completion, the row would stay mounted forever, invisible and
  // still in the tab order.
  useEffect(() => {
    if (isPresent) return
    const timer = window.setTimeout(() => safeToRemove?.(), 900)
    return () => window.clearTimeout(timer)
  }, [isPresent, safeToRemove])

  return (
    <motion.div
      className={cn('absolute', !isPresent && 'pointer-events-none')}
      layout={reduceMotion ? false : 'position'}
      style={{ left: `${depth * INDENT}em`, top: `${index * ROW_PITCH}em` }}
      transition={reduceMotion ? { duration: 0 } : SPRING}
    >
      <motion.button
        animate={isPresent ? 'visible' : 'hidden'}
        // The label is split per character for the animation, so give the button its real name explicitly.
        aria-label={isTrail ? `${backLabel} ${item.label}` : item.label}
        aria-expanded={opensBelow ? isTrail : undefined}
        initial="hidden"
        onAnimationComplete={() => {
          if (!isPresent) safeToRemove?.()
        }}
        onClick={onActivate}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { staggerChildren: isPresent ? STAGGER_IN : STAGGER_OUT, staggerDirection: isPresent ? 1 : -1 }
        }
        type="button"
        className={cn(
          `rounded-[0.3em] px-[0.28em] text-left font-medium leading-[1.25] outline-none transition-colors ${COARSE ? 'py-[0.68em]' : 'py-[0.32em]'}`,
          'hover:bg-sunken focus-visible:ring-2 focus-visible:ring-accent',
          // Weight is deliberately identical either way: a breadcrumb is the same word at the same size, greyed.
          // Drop its weight too and the label reflows its own width the moment you click it.
          isTrail ? 'text-ink-3' : 'text-ink',
        )}
      >
        <span className="relative inline-block whitespace-pre" aria-hidden="true">
          {/* CSS, not Motion: the arrow's state depends on a prop that flips while the row stays mounted and stays
              "visible", which Motion does not re-resolve. A class list is recomputed on every render. */}
          <span
            className={cn(
              'pointer-events-none absolute inset-y-0 right-full mr-[0.6em] flex items-center',
              !reduceMotion && 'transition-all duration-200 ease-out',
              isTrail && isPresent ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0',
            )}
          >
            <ReturnArrow />
          </span>
          {item.label.split('').map((char, charIndex) => (
            <motion.span className="inline-block" key={charIndex} variants={CHAR_VARIANTS}>
              {char}
            </motion.span>
          ))}
        </span>
      </motion.button>
    </motion.div>
  )
}

export default DrilldownMenu
