import { describe, expect, it } from 'vitest'
import { RESOURCES, RESOURCE_GROUPS, STATS } from '../components/pages/infoContent'

describe('resource links (numbers section)', () => {
  it('every link is https, has all its text, and appears once', () => {
    const hrefs = RESOURCES.map((r) => r.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const r of RESOURCES) {
      expect(r.href).toMatch(/^https:\/\//)
      for (const text of [r.org, r.title, r.detail]) expect(text.trim().length).toBeGreaterThan(3)
    }
  })

  it('papers are linked by DOI, so they keep working if a publisher reorganises its site', () => {
    for (const r of RESOURCES.filter((x) => x.group === 'research')) expect(r.href).toMatch(/^https:\/\/doi\.org\/10\./)
  })

  it('every group that is used has a heading, and both groups are used', () => {
    const used = new Set(RESOURCES.map((r) => r.group))
    expect([...used].sort()).toEqual(Object.keys(RESOURCE_GROUPS).sort())
  })

  it('every published figure has its paper linked: the source line under each number can be followed', () => {
    const research = RESOURCES.filter((r) => r.group === 'research')
    // The stat cards cite "Saver", "AHA/ASA guideline" (Powers et al.) and "Aroor et al."
    const cited = STATS.map((s) => s.source)
    const has = (name: RegExp) => research.some((r) => name.test(`${r.org} ${r.title}`))
    if (cited.some((c) => /Saver/.test(c))) expect(has(/Saver/)).toBe(true)
    if (cited.some((c) => /AHA\/ASA/.test(c))) expect(has(/Powers|Acute Ischemic Stroke/)).toBe(true)
    if (cited.some((c) => /Aroor/.test(c))) expect(has(/Aroor|BE-FAST/)).toBe(true)
  })
})
