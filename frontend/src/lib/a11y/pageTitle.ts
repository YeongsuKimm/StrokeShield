// Unique, meaningful <title> per route and phase (WCAG 2.4.2). Pure: App.tsx just assigns the result to document.title.

export const BASE_TITLE = 'StrokeShield, a guided BE-FAST check (not a medical device)'
const SUFFIX = 'StrokeShield'

const TEST_LABEL: Record<string, string> = { eyes: 'Eyes', face: 'Face', arms: 'Arms', speech: 'Speech' }

export function pageTitle(route: 'home' | 'info', phase: string, sequence: readonly string[], locale: Locale = 'en'): string {
  if (locale === 'es') {
    if (route === 'info') return `C\u00f3mo funciona y a qui\u00e9n llamar \u00b7 ${SUFFIX}`
    const labels: Record<string, string> = { eyes: 'Ojos', face: 'Cara', arms: 'Brazos', speech: 'Habla' }
    if (phase in labels) {
      const i = sequence.indexOf(phase)
      const step = i >= 0 ? `, paso ${i + 1} de ${sequence.length}` : ''
      return `Revisi\u00f3n de ${labels[phase].toLowerCase()}${step} \u00b7 ${SUFFIX}`
    }
    const titles: Record<string, string> = {
      scoring: 'Calculando tu resultado', countdown: 'Enviando mensaje al contacto de demo',
      alerting: 'Enviando la alerta', clear: 'Tu resultado', alerted: 'Tu resultado', cancelled: 'Tu resultado',
    }
    return `${titles[phase] ?? 'StrokeShield, una revisi\u00f3n BE-FAST guiada (no es un dispositivo m\u00e9dico)'}${titles[phase] ? ` \u00b7 ${SUFFIX}` : ''}`
  }
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
      return `Texting the demo contact · ${SUFFIX}`
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
import type { Locale } from '../i18n'
