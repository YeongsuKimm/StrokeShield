import { create } from 'zustand'
import type { TestName } from './contracts'

export type Locale = 'en' | 'es'

export const localeFromPath = (path: string): Locale =>
  path === '/es' || path.startsWith('/es/') ? 'es' : 'en'

const initialLocale = typeof window === 'undefined' ? 'en' : localeFromPath(window.location.pathname)

interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useLocale = create<LocaleState>((set) => ({
  locale: initialLocale,
  setLocale: (locale) => {
    if (typeof window !== 'undefined') {
      const path = locale === 'es' ? '/es' : '/'
      window.history.replaceState(window.history.state, '', `${path}${window.location.search}${window.location.hash}`)
      document.documentElement.lang = locale
    }
    set({ locale })
  },
}))

if (typeof document !== 'undefined') document.documentElement.lang = initialLocale

export const getLocale = (): Locale => useLocale.getState().locale
export const pick = <T>(locale: Locale, en: T, es: T): T => (locale === 'es' ? es : en)

export const SPEECH_PHRASES: Record<Locale, string> = {
  en: "You can't teach an old dog new tricks.",
  es: 'No se le pueden ense\u00f1ar trucos nuevos a un perro viejo.',
}

export const TEST_LABELS: Record<Locale, Record<TestName, string>> = {
  en: { eyes: 'Eyes', face: 'Face', arms: 'Arms', speech: 'Speech' },
  es: { eyes: 'Ojos', face: 'Cara', arms: 'Brazos', speech: 'Habla' },
}

const RUNTIME_ES: Record<string, string> = {
  'Starting the camera\u2026': 'Iniciando la c\u00e1mara\u2026',
  Done: 'Listo',
  "I can't get the camera image.": 'No puedo obtener la imagen de la c\u00e1mara.',
  "I can't see your face. Look at the camera.": 'No puedo ver tu cara. Mira a la c\u00e1mara.',
  'Center your face in the view.': 'Centra tu cara en la imagen.',
  'Move a little closer to the screen.': 'Ac\u00e9rcate un poco a la pantalla.',
  'Move back a little.': 'Retrocede un poco.',
  'Move a little closer.': 'Ac\u00e9rcate un poco.',
  'Good. Hold still.': 'Bien. Mantente quieto.',
  'Good. Hold still. Only one person in view, please.': 'Bien. Mantente quieto. Solo una persona en la imagen, por favor.',
  'Step back until I can see your upper body and both hands.': 'Retrocede hasta que pueda ver la parte superior de tu cuerpo y ambas manos.',
  'Step back until I can see both hands and both shoulders.': 'Retrocede hasta que pueda ver ambas manos y ambos hombros.',
  'Good. Get ready to raise your arms.': 'Bien. Prep\u00e1rate para levantar los brazos.',
  'Look straight at the screen.': 'Mira directamente a la pantalla.',
  'Serious face, lips closed': 'Cara seria, labios cerrados',
  'Now smile as big as you can and hold': 'Ahora sonr\u00ede todo lo que puedas y mant\u00e9n la sonrisa',
  'Get ready\u2026 raise your arms': 'Prep\u00e1rate\u2026 levanta los brazos',
  'Hold both arms straight out to your sides, palms up': 'Mant\u00e9n ambos brazos extendidos a los lados, con las palmas hacia arriba',
  'Follow the dot with your eyes. Keep your head still.': 'Sigue el punto con los ojos. Mant\u00e9n la cabeza quieta.',
  'Cancelled.': 'Cancelado.',
  "I didn't hear anything. Please try again and say the sentence clearly.": 'No o\u00ed nada. Int\u00e9ntalo de nuevo y di la frase con claridad.',
  "I couldn't hear you, please speak louder.": 'No pude o\u00edrte. Habla un poco m\u00e1s fuerte.',
  'That was too loud and distorted. Please speak a little softer, or move back from the microphone.': 'El sonido fue demasiado fuerte y se distorsion\u00f3. Habla m\u00e1s bajo o al\u00e9jate del micr\u00f3fono.',
}

export const translateRuntimeText = (locale: Locale, value: string): string =>
  locale === 'es' ? (RUNTIME_ES[value] ?? value) : value
