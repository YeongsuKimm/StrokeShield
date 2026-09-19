// Unique, meaningful <title> per route and phase (WCAG 2.4.2). Pure: App.tsx just assigns the result to document.title.

export const BASE_TITLE = 'StrokeShield: BE-FAST check guide (not a medical device)'
const SUFFIX = 'StrokeShield'

const TEST_LABEL: Record<string, string> = { eyes: 'Eyes', face: 'Face', arms: 'Arms', speech: 'Speech' }

export function pageTitle(route: 'home' | 'info', phase: string, sequence: readonly string[]): string {
  if (route === 'info') return `How it works and who to call · ${SUFFIX}`
  if (phase in TEST_LABEL) {
    const i = sequence.indexOf(phase)
    const step = i >= 0 ? `, step ${i + 1} of ${sequence.length}` : ''
    return `${TEST_LABEL[phase]} check${step} · ${SUFFIX}`
  }
  switch (phase) {
    case 'scoring':
      return `Working out your result · ${SUFFIX}`
    case 'countdown':
      return `Contacting your emergency contact · ${SUFFIX}`
    case 'alerting':
      return `Sending the alert · ${SUFFIX}`
    case 'clear':
    case 'alerted':
    case 'cancelled':
      return `Your result · ${SUFFIX}`
    default:
      return BASE_TITLE
  }
}
