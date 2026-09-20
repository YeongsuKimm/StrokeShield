import { Icon } from '../ui/Icon'
import { pick, useLocale } from '../../lib/i18n'

/**
 * Always on screen, on every page, in every phase (docs/spec/05 "Always render a persistent manual tel:911 button").
 * A plain `tel:` link: the device dials, this app never places an emergency call itself.
 */
export function EmergencyButton() {
  const locale = useLocale((s) => s.locale)
  return (
    <a
      href="tel:911"
      aria-label={pick(locale, 'Call 911, emergency, any time', 'Llama al 911, emergencia, en cualquier momento')}
      className="group fixed bottom-5 left-5 z-40 flex min-h-14 items-center gap-3 rounded-full bg-danger pl-4 pr-5 text-white shadow-[var(--shadow-lift)] transition-[background-color,transform] duration-150 ease-out hover:bg-danger-press active:translate-y-px sm:bottom-7 sm:left-7"
    >
      <Icon name="phone" size={22} className="shrink-0" />
      {/* The subtitle is dropped on small screens so the button intrudes less on a narrow page. */}
      <span className="text-left leading-tight">
        <span className="block text-[1rem] font-semibold">{pick(locale, 'Call 911', 'Llama al 911')}</span>
        <span className="hidden text-[0.8125rem] text-white/80 sm:block">{pick(locale, 'Emergency, any time', 'Emergencia, en cualquier momento')}</span>
      </span>
    </a>
  )
}
