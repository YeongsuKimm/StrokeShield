// Hand-drawn icon set: one 24px grid, one 1.75 stroke weight, round caps and joins throughout.
// Inline SVG rather than an icon package — a dozen glyphs are not worth a dependency, and no emoji ever ships.
import type { ReactElement, SVGProps } from 'react'

export type IconName =
  | 'camera'
  | 'mic'
  | 'micOff'
  | 'pin'
  | 'phone'
  | 'check'
  | 'alert'
  | 'chevronDown'
  | 'arrowDown'
  | 'arrowRight'
  | 'arrowUpRight'
  | 'close'
  | 'refresh'
  | 'eye'
  | 'smile'
  | 'arms'
  | 'waveform'
  | 'hospital'
  | 'user'
  | 'clock'
  | 'skip'

const PATHS: Record<IconName, ReactElement> = {
  camera: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7a1 1 0 0 0 .83-.45l.94-1.4A1 1 0 0 1 9.8 3.7h4.4a1 1 0 0 1 .83.45l.94 1.4a1 1 0 0 0 .83.45h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5Z" />
      <circle cx="12" cy="12.2" r="3.4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
    </>
  ),
  micOff: (
    <>
      <path d="M15 5.8V6a3 3 0 0 0-6 0v5m0 1.6A3 3 0 0 0 15 11v-.6" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 10 5.5M18.5 11.5a6.4 6.4 0 0 1-.6 2.7M12 18v3M8.5 21h7M4 3l16 18" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21Z" />
      <circle cx="12" cy="10.3" r="2.5" />
    </>
  ),
  phone: (
    <path d="M6.3 3.5h3l1.4 3.6-2 1.4a12.3 12.3 0 0 0 6.8 6.8l1.4-2 3.6 1.4v3a2 2 0 0 1-2.2 2A16.8 16.8 0 0 1 4.3 5.7a2 2 0 0 1 2-2.2Z" />
  ),
  check: <path d="m4.5 12.5 5 5 10-11" />,
  alert: (
    <>
      <path d="M12 4.2 2.8 19.4h18.4Z" />
      <path d="M12 10v4.2M12 17.2v.2" />
    </>
  ),
  chevronDown: <path d="m5.5 9 6.5 6.5L18.5 9" />,
  arrowDown: <path d="M12 4v16m0 0 6-6m-6 6-6-6" />,
  arrowRight: <path d="M4 12h16m0 0-6-6m6 6-6 6" />,
  arrowUpRight: <path d="M7 17 17 7m0 0h-8m8 0v8" />,
  close: <path d="M5.5 5.5l13 13m0-13-13 13" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.5 3.5V9H15" />
    </>
  ),
  eye: (
    <>
      <path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="3.1" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 13.6a5 5 0 0 0 8 0M9 9.6v.2M15 9.6v.2" />
    </>
  ),
  arms: (
    <>
      <circle cx="12" cy="5" r="2.4" />
      <path d="M12 9v11M3 11h18M7.5 20l2-6M16.5 20l-2-6" />
    </>
  ),
  waveform: <path d="M3 12h1.8M7.4 7.5v9M11 4.5v15M14.6 8.5v7M18.2 10.5v3M21.5 12h.2" />,
  hospital: (
    <>
      <path d="M4 20V8.6a1 1 0 0 1 .5-.87l7-4a1 1 0 0 1 1 0l7 4a1 1 0 0 1 .5.87V20" />
      <path d="M2.5 20h19M12 8.8v5.4M9.3 11.5h5.4M9.5 20v-3.4h5v3.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M12 6.8V12l3.4 2" />
    </>
  ),
  skip: <path d="M5 5.5v13l9-6.5ZM18.5 5.5v13" />,
}

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
