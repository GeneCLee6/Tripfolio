import { describe, expect, it } from 'vitest'
import {
  checklistTemplateSchema,
  checklistTemplateStyles,
  notesTemplateSchema,
  noteDestinations,
  templateForStyle,
} from '../../shared/schema/prep.ts'
import { tripStyles } from '../../shared/schema/trip.ts'
import {
  CHECKLIST_TEMPLATES,
  NOTE_TEMPLATES,
  checklistTemplateLists,
  dateMinusDays,
} from '../../shared/templates/index.ts'

// Every template in shared/templates/** matches the zod shape, has both languages, unique keys
// under its own prefix, and only official root-domain links (E9: templates say what to confirm).

const CJK = /[㐀-鿿]/

describe('checklist templates', () => {
  it.each(checklistTemplateStyles)('%s is valid, bilingual and keyed under its style', (style) => {
    const template = CHECKLIST_TEMPLATES[style]
    const parsed = checklistTemplateSchema.safeParse(template)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(template.style).toBe(style)
    const keys: string[] = []
    for (const list of template.lists) {
      expect(list.key.startsWith(`${style}.`)).toBe(true)
      keys.push(list.key)
      for (const item of list.items) {
        expect(item.key.startsWith(`${list.key}.`)).toBe(true)
        keys.push(item.key)
        // The Chinese text is Chinese, the English text is not
        expect(CJK.test(item.text['zh-TW'])).toBe(true)
        expect(CJK.test(item.text.en)).toBe(false)
        if (item.linkHint) expect(CJK.test(item.linkHint.label.en)).toBe(false)
      }
      expect(CJK.test(list.title.en)).toBe(false)
    }
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('phrases pre-trip items as things to confirm', () => {
    for (const style of checklistTemplateStyles)
      for (const list of CHECKLIST_TEMPLATES[style].lists.filter((l) => l.kind === 'pretrip'))
        for (const item of list.items) {
          expect(item.text['zh-TW'].startsWith('確認'), item.key).toBe(true)
          expect(item.text.en.startsWith('Confirm'), item.key).toBe(true)
        }
  })

  it('has a pre-trip and a packing list for every style once general is included', () => {
    for (const style of checklistTemplateStyles) {
      const kinds = new Set(checklistTemplateLists(style).map((l) => l.kind))
      expect(kinds).toEqual(new Set(['pretrip', 'packing']))
    }
  })

  it('maps every trip style to a template', () => {
    for (const style of tripStyles)
      expect(checklistTemplateStyles).toContain(templateForStyle(style))
    expect(templateForStyle('other')).toBe('general')
    expect(templateForStyle('campervan')).toBe('campervan')
  })

  it('covers the campervan essentials (01-travel-domain-notes §9)', () => {
    const keys = CHECKLIST_TEMPLATES.campervan.lists.flatMap((l) => l.items.map((i) => i.key))
    for (const key of ['self-contained', 'holiday-parks', 'doc-sites', 'dump', 'biosecurity'])
      expect(keys).toContain(`campervan.pretrip.${key}`)
  })

  it('subtracts days from a date across months and years', () => {
    expect(dateMinusDays('2026-12-20', 30)).toBe('2026-11-20')
    expect(dateMinusDays('2027-01-05', 10)).toBe('2026-12-26')
    expect(dateMinusDays('2026-03-01', 1)).toBe('2026-02-28')
  })
})

describe('note templates', () => {
  it.each(noteDestinations)('%s is valid, bilingual, with unique keys', (destination) => {
    const template = NOTE_TEMPLATES[destination]
    const parsed = notesTemplateSchema.safeParse(template)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    const keys = template.sections.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const section of template.sections) {
      expect(section.key.startsWith(`${destination}.`)).toBe(true)
      expect(CJK.test(section.body['zh-TW'])).toBe(true)
      expect(CJK.test(section.body.en)).toBe(false)
      expect(CJK.test(section.title.en)).toBe(false)
    }
  })

  it('links only to official root domains over https', () => {
    for (const destination of noteDestinations)
      for (const section of NOTE_TEMPLATES[destination].sections)
        for (const text of [section.body['zh-TW'], section.body.en])
          for (const url of text.match(/https?:\/\/\S+/g) ?? []) {
            const parsed = new URL(url)
            expect(parsed.protocol, url).toBe('https:')
            expect(parsed.pathname, url).toBe('/')
          }
  })

  it('has the sections E9 asks for, with the emergency numbers left to fill in', () => {
    const nz = NOTE_TEMPLATES.nz
    expect(nz.sections.map((s) => s.section)).toEqual(
      expect.arrayContaining([
        'emergency',
        'power',
        'money',
        'driving',
        'water',
        'customs',
        'apps',
        'campervan',
      ]),
    )
    const emergency = nz.sections.find((s) => s.section === 'emergency')!
    expect(emergency.body['zh-TW']).toContain('＿＿＿')
    expect(emergency.body.en).toContain('___')
  })
})
