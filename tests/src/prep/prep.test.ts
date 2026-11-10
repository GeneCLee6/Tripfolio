import { describe, expect, it } from 'vitest'
import type { BurnPoint, Checklist, ChecklistItem } from '../../../shared/api/prep.ts'
import {
  budgetCategories,
  budgetTrackedCategories,
  checklistTemplateStyles,
  docCategories,
  templateForStyle,
} from '../../../shared/schema/prep.ts'
import { tripStyles } from '../../../shared/schema/trip.ts'
import {
  burnPaths,
  draftFrom,
  draftTotals,
  rowsFromDraft,
  sameRows,
} from '../../../src/lib/prep/budget.ts'
import {
  isOverdue,
  listsOfKind,
  moveOrder,
  progressOf,
  withItem,
} from '../../../src/lib/prep/checklists.ts'
import {
  BUDGET_CATEGORIES,
  DOC_CATEGORIES,
  TEMPLATE_STYLES,
  TRACKED_CATEGORIES,
  templateForTripStyle,
} from '../../../src/lib/prep/constants.ts'
import { inline, parseNote } from '../../../src/lib/prep/markdown.ts'

// The prep pages' pure helpers (E9): constants in step with the schema, checklist ordering and
// progress, budget drafts (same totals as the Worker), the burn-down paths, markdown-lite.

const item = (fields: Partial<ChecklistItem>): ChecklistItem => ({
  id: 'i',
  checklistId: 'l',
  text: 'x',
  note: '',
  done: false,
  assigneeMemberId: null,
  dueAt: null,
  order: 1,
  templateKey: null,
  linkHint: null,
  rev: 1,
  createdAt: '',
  updatedAt: '',
  ...fields,
})

const list = (fields: Partial<Checklist>): Checklist => ({
  id: 'l',
  tripId: 't',
  kind: 'pretrip',
  title: 'L',
  order: 1,
  templateKey: null,
  rev: 1,
  createdAt: '',
  updatedAt: '',
  items: [],
  ...fields,
})

describe('constants', () => {
  it('match the zod enums', () => {
    expect(BUDGET_CATEGORIES).toEqual(budgetCategories)
    expect(TEMPLATE_STYLES).toEqual(checklistTemplateStyles)
    expect(DOC_CATEGORIES).toEqual(docCategories)
    expect(TRACKED_CATEGORIES).toEqual(budgetTrackedCategories)
    for (const style of [...tripStyles, 'whatever'])
      expect(templateForTripStyle(style)).toBe(templateForStyle(style))
  })
})

describe('checklists', () => {
  it('counts progress and filters by kind', () => {
    const lists = [
      list({ id: 'a', items: [item({ done: true }), item({})] }),
      list({ id: 'b', kind: 'packing', items: [item({ done: true })] }),
    ]
    expect(progressOf(lists)).toEqual({ done: 2, total: 3 })
    expect(listsOfKind(lists, 'packing').map((l) => l.id)).toEqual(['b'])
  })

  it('moves an item past its neighbour with one new order', () => {
    const items = [{ order: 1 }, { order: 2 }, { order: 3 }]
    expect(moveOrder(items, 0, -1)).toBeNull()
    expect(moveOrder(items, 2, 1)).toBeNull()
    expect(moveOrder(items, 2, -1)).toBe(1.5)
    expect(moveOrder(items, 1, -1)).toBe(0)
    expect(moveOrder(items, 0, 1)).toBe(2.5)
    expect(moveOrder(items, 1, 1)).toBe(4)
  })

  it('is overdue only when not done and due before today', () => {
    expect(isOverdue({ done: false, dueAt: '2026-11-01' }, '2026-11-10')).toBe(true)
    expect(isOverdue({ done: true, dueAt: '2026-11-01' }, '2026-11-10')).toBe(false)
    expect(isOverdue({ done: false, dueAt: '2026-11-10' }, '2026-11-10')).toBe(false)
    expect(isOverdue({ done: false, dueAt: null }, '2026-11-10')).toBe(false)
  })

  it('replaces an item and keeps the order', () => {
    const lists = [list({ items: [item({ id: 'a', order: 1 }), item({ id: 'b', order: 2 })] })]
    const next = withItem(lists, item({ id: 'a', order: 3, done: true }))
    expect(next[0].items.map((i) => [i.id, i.done])).toEqual([
      ['b', false],
      ['a', true],
    ])
  })
})

describe('budget', () => {
  it('keeps every category in the draft and sends only filled ones', () => {
    const draft = draftFrom([{ category: 'food', plannedMinor: 500, perPerson: true }])
    expect(draft).toHaveLength(BUDGET_CATEGORIES.length)
    expect(rowsFromDraft(draft)).toEqual([{ category: 'food', plannedMinor: 500, perPerson: true }])
    // A zero amount is a budget of zero, not "not budgeted"
    draft[0].plannedMinor = 0
    expect(rowsFromDraft(draft).map((r) => r.category)).toEqual(['flights', 'food'])
    expect(sameRows(rowsFromDraft(draftFrom([])), [])).toBe(true)
  })

  it('computes the same totals as the Worker (worker/trips/budget.ts budgetTotals)', () => {
    const draft = draftFrom([
      { category: 'lodging', plannedMinor: 100001, perPerson: false },
      { category: 'food', plannedMinor: 3000, perPerson: true },
    ])
    expect(draftTotals(draft, 1)).toEqual({ plannedMinor: 103001, perPersonMinor: 103001 })
    expect(draftTotals(draft, 3)).toEqual({ plannedMinor: 109001, perPersonMinor: 33334 + 3000 })
    expect(draftTotals(draft, 4)).toEqual({ plannedMinor: 112001, perPersonMinor: 25000 + 3000 })
  })

  it('draws the burn-down: ideal for every day, actual up to today', () => {
    const burn: BurnPoint[] = [0, 1, 2, 3].map((i) => ({
      date: `2026-12-2${i}`,
      spentMinor: 0,
      cumulativeMinor: i * 100,
      remainingMinor: 400 - i * 100,
      idealRemainingMinor: 400 - (i + 1) * 100,
    }))
    const paths = burnPaths(burn, '2026-12-21', 300, 100)
    expect(paths.ideal.split(' ')).toHaveLength(4)
    expect(paths.actual.split(' ')).toHaveLength(2)
    expect(paths.actual.split(' ')[0]).toBe('0.0,0.0')
    expect(paths.zeroY).toBe(100)
    expect(burnPaths(burn, '2026-12-01', 300, 100).actual).toBe('')
  })
})

describe('markdown-lite', () => {
  it('splits https links out of text, leaving trailing punctuation', () => {
    expect(inline('see https://www.doc.govt.nz.')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', url: 'https://www.doc.govt.nz' },
      { kind: 'text', text: '.' },
    ])
    expect(inline('http://example.com is not linked')).toEqual([
      { kind: 'text', text: 'http://example.com is not linked' },
    ])
  })

  it('parses headings, lists and paragraphs', () => {
    const blocks = parseNote('## Title\n- a\n- b\n\nline one\nline two\n- c')
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list', 'paragraph', 'list'])
    expect(blocks[1]).toEqual({
      kind: 'list',
      items: [[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]],
    })
    expect(blocks[2]).toMatchObject({ kind: 'paragraph', lines: [[{ text: 'line one' }], [{ text: 'line two' }]] })
    expect(parseNote('')).toEqual([])
  })

  it('never produces markup from the text', () => {
    const [block] = parseNote('<script>alert(1)</script>')
    expect(block).toEqual({
      kind: 'paragraph',
      lines: [[{ kind: 'text', text: '<script>alert(1)</script>' }]],
    })
  })
})
