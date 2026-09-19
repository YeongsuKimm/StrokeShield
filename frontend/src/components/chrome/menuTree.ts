import type { DrilldownMenuItem } from '../ui/DrilldownMenu'
import { INFO_SECTIONS, PROCESS_STEPS, TIME_NOTE } from '../pages/infoContent'

const nav = (id: string) => INFO_SECTIONS.find((s) => s.id === id)?.nav ?? id

/**
 * The header menu's content (a Drilldown Menu, see ui/DrilldownMenu.tsx). Collapsed it shows one row; opening it
 * reveals this list, and "The process" and "Questions & hotlines" drill one level deeper.
 *
 * Each leaf id maps to an element id on the info page (see InfoPage.tsx): a section id, or `step-*` / `hotlines` / `faq`.
 * Branches also get an "Overview" leaf, because clicking a branch row drills in rather than navigating to it.
 * Every id must be unique across the whole tree.
 */
export function buildMenu(opts: {
  /** 'home' shows the marketing page, 'info' the long document. Changes the root label and the "back" row. */
  route: 'home' | 'info'
  goToSection: (elementId: string) => void
  goToCheck: () => void
}): DrilldownMenuItem[] {
  const { route, goToSection, goToCheck } = opts
  const leaf = (id: string, label: string, target: string): DrilldownMenuItem => ({
    id,
    label,
    onSelect: () => goToSection(target),
  })

  return [
    {
      id: 'menu',
      label: route === 'info' ? 'Sections' : 'Learn more',
      items: [
        ...(route === 'info' ? [{ id: 'back', label: 'Back to the check', onSelect: goToCheck }] : []),
        {
          id: 'process',
          label: nav('process'),
          items: [
            leaf('process-overview', 'Overview', 'process'),
            ...PROCESS_STEPS.map((s) => leaf(`step-${s.name.toLowerCase()}`, s.name, `step-${s.name.toLowerCase()}`)),
            leaf('step-time', TIME_NOTE.name, 'step-time'),
          ],
        },
        leaf('why', nav('why'), 'why'),
        leaf('stats', nav('stats'), 'stats'),
        {
          id: 'help',
          label: nav('help'),
          items: [
            leaf('help-overview', 'Overview', 'help'),
            leaf('hotlines', 'Hotlines', 'hotlines'),
            leaf('faq', 'Common questions', 'faq'),
          ],
        },
        leaf('team', nav('team'), 'team'),
      ],
    },
  ]
}
