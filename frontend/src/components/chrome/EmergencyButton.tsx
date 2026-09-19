import { Icon } from '../ui/Icon'

/**
 * Always on screen, on every page, in every phase (docs/spec/05 "Always render a persistent manual tel:911 button").
 * A plain `tel:` link: the device dials, this app never places an emergency call itself.
 */
export function EmergencyButton() {
  return (
    <a
      href="tel:911"
      aria-label="Call 911, emergency, any time"
      className="group fixed bottom-[calc(1.25rem+var(--safe-b))] left-5 z-40 flex min-h-14 items-center gap-3 rounded-full bg-danger pl-4 pr-5 text-white shadow-[var(--shadow-lift)] transition-[background-color,transform] duration-150 ease-out hover:bg-danger-press active:translate-y-px sm:bottom-7 sm:left-7"
    >
      <Icon name="phone" size={22} className="shrink-0" />
      {/* The subtitle is dropped on small screens so the button intrudes less on a narrow page. */}
      <span className="text-left leading-tight">
        <span className="block text-[1rem] font-semibold">Call 911</span>
        <span className="hidden text-[0.8125rem] text-white/80 sm:block">Emergency, any time</span>
      </span>
    </a>
  )
}
