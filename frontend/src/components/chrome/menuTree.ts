import type { DrilldownMenuItem } from '../ui/DrilldownMenu'
import { getInfoSections, getProcessSteps, getTimeNote } from '../pages/infoContent'
import { pick, type Locale } from '../../lib/i18n'

const nav = (id: string, locale: Locale) => getInfoSections(locale).find((s) => s.id === id)?.nav ?? id

/**
 * The header menu's content (a Drilldown Menu, see ui/DrilldownMenu.tsx). Collapsed it shows one row; opening it
 * reveals this list, and "The process" and "Questions & hotlines" drill one level deeper.
 *
 * Each leaf id maps to an element id on the info page (see InfoPage.tsx): a section id, or `step-*` / `hotlines` / `faq`.
 * Branches also get an "Overview" leaf, because clicking a branch row drills in rather than navigating to it.
 * Every id must be unique across the whole tree.
 */
export function buildMenu(opts: {
  locale: Locale
  /** 'home' shows the marketing page, 'info' the long document. Changes the root label and the "back" row. */
  route: 'home' | 'info'
  goToSection: (elementId: string) => void
  goToCheck: () => void
}): DrilldownMenuItem[] {
  const { route, goToSection, goToCheck, locale } = opts
  const leaf = (id: string, label: string, target: string): DrilldownMenuItem => ({
    id,
    label,
    onSelect: () => goToSection(target),
  })

  return [
    {
      id: 'menu',
      label: route === 'info' ? pick(locale, 'Sections', 'Secciones') : pick(locale, 'Learn more', 'Conoce m\u00e1s'),
      items: [
        ...(route === 'info' ? [{ id: 'back', label: pick(locale, 'Back to the check', 'Volver a la revisi\u00f3n'), onSelect: goToCheck }] : []),
        {
          id: 'process',
          label: nav('process', locale),
          items: [
            leaf('process-overview', pick(locale, 'Overview', 'Resumen'), 'process'),
            ...getProcessSteps(locale).map((s) => leaf(`step-${s.id}`, s.name, `step-${s.id}`)),
            leaf('step-time', getTimeNote(locale).name, 'step-time'),
          ],
        },
        leaf('why', nav('why', locale), 'why'),
        leaf('stats', nav('stats', locale), 'stats'),
        {
          id: 'help',
          label: nav('help', locale),
          items: [
            leaf('help-overview', pick(locale, 'Overview', 'Resumen'), 'help'),
            leaf('hotlines', pick(locale, 'Hotlines', 'L\u00edneas de ayuda'), 'hotlines'),
            leaf('faq', pick(locale, 'Common questions', 'Preguntas comunes'), 'faq'),
          ],
        },
        leaf('team', nav('team', locale), 'team'),
      ],
    },
  ]
}
