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
  "I can't hear any sound at all. Your microphone looks muted or blocked. Check the mute switch on your headset or laptop and the input device in your sound settings, then try again.": 'No se oye ning\u00fan sonido. El micr\u00f3fono parece silenciado o bloqueado. Revisa el interruptor de silencio y el dispositivo de entrada, y vuelve a intentarlo.',
  'The analysis took too long, probably a slow connection. Please try again, or skip this step.': 'El an\u00e1lisis tard\u00f3 demasiado, probablemente por una conexi\u00f3n lenta. Int\u00e9ntalo de nuevo u omite este paso.',
  "I couldn't reach the analysis service. The camera checks still work. Please try again, or skip this step.": 'No se pudo contactar el servicio de an\u00e1lisis. Las revisiones con c\u00e1mara siguen funcionando. Int\u00e9ntalo de nuevo u omite este paso.',
  "You seem to be offline, so I can't analyze your speech. Check the connection and try again, or skip this step.": 'Parece que no tienes conexi\u00f3n, por lo que no se puede analizar el habla. Revisa la conexi\u00f3n e int\u00e9ntalo de nuevo, u omite este paso.',
  'Microphone permission was denied. Allow microphone access in the browser and try again.': 'Se deneg\u00f3 el permiso del micr\u00f3fono. Perm\u00edtelo en el navegador y vuelve a intentarlo.',
  'No microphone was found on this device.': 'No se encontr\u00f3 ning\u00fan micr\u00f3fono en este dispositivo.',
  'The microphone is in use by another app or tab.': 'Otra aplicaci\u00f3n o pesta\u00f1a est\u00e1 usando el micr\u00f3fono.',
  'Could not start the microphone.': 'No se pudo iniciar el micr\u00f3fono.',
  'lost sight of your eyes: face the screen and add light': 'se perdieron de vista tus ojos: mira de frente a la pantalla y a\u00f1ade luz',
  'too dark to see your eyes: add light in front of you': 'hay muy poca luz para ver tus ojos: a\u00f1ade luz delante de ti',
  'eyes are hard to track: take off glasses if there is glare': 'es dif\u00edcil seguir tus ojos: qu\u00edtate los lentes si hay reflejos',
  'your head moved: keep it still and move only your eyes': 'moviste la cabeza: mantenla quieta y mueve solo los ojos',
  'look straight at the screen, then follow the dot with your eyes only': 'mira de frente a la pantalla y luego sigue el punto solo con los ojos',
  'look at the dot, then follow it with your eyes only': 'mira el punto y s\u00edguelo solo con los ojos',
  'too far from the screen: move a little closer': 'est\u00e1s demasiado lejos de la pantalla: ac\u00e9rcate un poco',
  'too close to the screen: move back a little': 'est\u00e1s demasiado cerca de la pantalla: retrocede un poco',
  'face not centered: center your face in the view': 'tu cara no est\u00e1 centrada: c\u00e9ntrala en la imagen',
  'Face the screen straight on, about an arm\u2019s length away.': 'Mira de frente a la pantalla, aproximadamente a un brazo de distancia.',
  'Add light in front of you (a window or lamp behind you makes it worse).': 'A\u00f1ade luz delante de ti; una ventana o l\u00e1mpara detr\u00e1s dificulta la medici\u00f3n.',
  'Turn on a light in front of you.': 'Enciende una luz delante de ti.',
  'Face the screen straight on.': 'Mira de frente a la pantalla.',
  'Take off your glasses if the screen or a lamp reflects in them.': 'Qu\u00edtate los lentes si reflejan la pantalla o una l\u00e1mpara.',
  'Use even light in front of you.': 'Usa una luz uniforme delante de ti.',
  'Keep your head still, like a passport photo.': 'Mant\u00e9n la cabeza quieta, como en una foto de pasaporte.',
  'Move only your eyes to follow the dot.': 'Mueve solo los ojos para seguir el punto.',
  'Look straight at the screen before the dot starts.': 'Mira de frente a la pantalla antes de que empiece el punto.',
  'Then follow the dot with your eyes only.': 'Luego sigue el punto solo con los ojos.',
  'Watch the yellow dot the whole time.': 'Mira el punto amarillo durante toda la revisi\u00f3n.',
  'Follow it with your eyes only, without moving your head.': 'S\u00edguelo solo con los ojos, sin mover la cabeza.',
  'Sit about an arm\u2019s length from the screen.': 'Si\u00e9ntate aproximadamente a un brazo de distancia de la pantalla.',
  'Center your face inside the outline.': 'Centra tu cara dentro del contorno.',
  'The voice guide needs the microphone and it is blocked. Click the lock icon in the address bar, set Microphone to Allow, then reload and try again. The checks work without the guide.': 'La gu\u00eda de voz necesita el micr\u00f3fono, pero est\u00e1 bloqueado. Pulsa el candado de la barra de direcciones, permite el micr\u00f3fono, recarga la p\u00e1gina e int\u00e9ntalo de nuevo. Las revisiones funcionan sin la gu\u00eda.',
  'No microphone was found for the voice guide. Plug one in and try again. The checks work without the guide.': 'No se encontr\u00f3 un micr\u00f3fono para la gu\u00eda de voz. Conecta uno e int\u00e9ntalo de nuevo. Las revisiones funcionan sin la gu\u00eda.',
  'The microphone would not start for the voice guide. Another app or tab may be using it. The checks work without the guide.': 'No se pudo iniciar el micr\u00f3fono para la gu\u00eda de voz. Otra aplicaci\u00f3n o pesta\u00f1a puede estar us\u00e1ndolo. Las revisiones funcionan sin la gu\u00eda.',
  'The voice guide could not start. Check your connection and that the microphone is allowed, then try again. The checks work without the guide.': 'No se pudo iniciar la gu\u00eda de voz. Revisa la conexi\u00f3n y el permiso del micr\u00f3fono, e int\u00e9ntalo de nuevo. Las revisiones funcionan sin la gu\u00eda.',
}

export const translateRuntimeText = (locale: Locale, value: string): string => {
  if (locale !== 'es') return value
  const exact = RUNTIME_ES[value]
  if (exact) return exact
  const normalized = value.trim().replace(/[.!?]+$/, '').toLowerCase()
  const translated = RUNTIME_ES[normalized]
  if (!translated) return value
  const capitalized = /^[A-Z\u00bf\u00a1]/.test(value) ? translated.charAt(0).toUpperCase() + translated.slice(1) : translated
  return /[.!?]$/.test(value) && !/[.!?]$/.test(capitalized) ? `${capitalized}.` : capitalized
}
