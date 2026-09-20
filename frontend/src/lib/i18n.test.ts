import { describe, expect, it } from 'vitest'
import { localeFromPath, pick, SPEECH_PHRASES } from './i18n'

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
})
