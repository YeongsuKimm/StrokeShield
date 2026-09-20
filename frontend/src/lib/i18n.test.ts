import { describe, expect, it } from 'vitest'
import { localeFromPath, pick, SPEECH_PHRASES, translateRuntimeText } from './i18n'

describe('i18n', () => {
  it('uses Spanish only for the Spanish route', () => {
    expect(localeFromPath('/')).toBe('en')
    expect(localeFromPath('/es')).toBe('es')
    expect(localeFromPath('/es/')).toBe('es')
    expect(localeFromPath('/escape')).toBe('en')
  })

  it('keeps the backend target phrase exact', () => {
    expect(SPEECH_PHRASES.es).toBe('No se le pueden ense\u00f1ar trucos nuevos a un perro viejo.')
    expect(pick('es', 'English', 'Espa\u00f1ol')).toBe('Espa\u00f1ol')
  })

  it('localizes camera failures that can appear during a Spanish check', () => {
    const failures = [
      'Camera access is blocked. Click the lock icon in the address bar, set Camera to Allow, then reload this page.',
      'No camera was found on this device.',
      'The camera is in use by another app or tab.',
      'This browser cannot open the camera (needs HTTPS or localhost).',
      'Could not start the camera.',
      'The camera stopped. It may have been unplugged, blocked in the address bar (lock icon), or taken by another app.',
      'The face/pose models could not load. Check the connection and reload; you can also skip this check.',
      'Face/pose detection keeps failing.',
    ]

    for (const message of failures) expect(translateRuntimeText('es', message)).not.toBe(message)
    expect(translateRuntimeText('es', "I couldn't start the camera. camera/models took too long to load")).toBe(
      'No pude iniciar la cámara. La cámara o los modelos tardaron demasiado en cargar.',
    )
  })
})
