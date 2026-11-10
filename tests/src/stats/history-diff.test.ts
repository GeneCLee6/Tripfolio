import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../../shared/api/expenses.ts'
import { t as translate, tp, type MessageKey, type MessageParams, type PluralKey } from '../../../shared/i18n/t.ts'
import type { Translate } from '../../../src/lib/i18n.ts'
import {
  diffLines,
  diffText,
  entityAmount,
  entityName,
  groupHistoryByDay,
  restorable,
  type DiffContext,
} from '../../../src/pages/expenses/history/diff.ts'

// The money log in words (e7-t07)

function translator(locale: 'zh-TW' | 'en'): Translate {
  return Object.assign((key: MessageKey, params?: MessageParams) => translate(key, params, locale), {
    plural: (key: PluralKey, count: number, params?: MessageParams) => tp(key, count, params, locale),
    locale,
  })
}

const names: Record<string, string> = { a: 'Gene', b: 'Mei', c: 'Lin' }
const ctx = (locale: 'zh-TW' | 'en' = 'zh-TW'): DiffContext => ({
  t: translator(locale),
  baseCurrency: 'AUD',
  member: (id) => names[id] ?? '?',
  stopName: (id) => (id === 's1' ? 'Hooker Valley' : null),
})

const snapshot = {
  amountMinor: 5000,
  currency: 'NZD',
  fxRate: 0.91,
  baseMinor: 4550,
  date: '2030-02-02',
  category: 'food',
  note: 'Lunch',
  payerMemberId: 'a',
  pool: false,
  splitMethod: 'equal',
  stopId: null,
  receiptAttachmentId: null,
  shares: [
    { memberId: 'a', shareMinor: 2275 },
    { memberId: 'b', shareMinor: 2275 },
  ],
}

function entry(over: Partial<HistoryEntry>): HistoryEntry {
  return {
    id: 'h',
    entity: 'expense',
    entityId: 'e1',
    memberId: 'b',
    at: '2030-02-02T03:00:00Z',
    action: 'update',
    diff: {},
    snapshot,
    ...over,
  }
}

describe('diffLines', () => {
  it('formats amounts with their currencies and skips bookkeeping fields', () => {
    const lines = diffLines(
      entry({
        diff: {
          amountMinor: [4500, 5000],
          baseMinor: [4095, 4550],
          fxSource: ['trip', 'trip'],
          shares: [snapshot.shares, snapshot.shares],
          note: ['', 'Lunch'],
        },
      }),
      ctx(),
    ).map((line) => diffText(ctx().t, line))
    expect(lines).toEqual(['金額：NZ$45.00 → NZ$50.00', '說明：（空白） → Lunch'])
  })

  it('puts a currency change inside the amount line', () => {
    const lines = diffLines(
      entry({ diff: { amountMinor: [4500, 150000], currency: ['NZD', 'IDR'] }, snapshot: { ...snapshot, currency: 'IDR', amountMinor: 150000 } }),
      ctx('en'),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].field).toBe('Amount')
    expect(lines[0].before).toBe('NZ$45.00')
    expect(lines[0].after).toMatch(/150,000/)
  })

  it('shows the base amount only when a rate change moved it', () => {
    const lines = diffLines(entry({ diff: { fxRate: [0.91, 0.95], baseMinor: [4550, 4750] } }), ctx('en'))
    expect(lines.map((l) => l.field)).toEqual(['Rate', 'Base amount'])
    expect(lines[0]).toMatchObject({ before: '0.91', after: '0.95' })
    expect(lines[1].after).toMatch(/47\.50/)
  })

  it('names payers, participants, categories, stops and receipts', () => {
    const lines = diffLines(
      entry({
        diff: {
          payerMemberId: ['a', null],
          pool: [false, true],
          category: ['food', 'fuel'],
          splitMethod: ['equal', 'shares'],
          shares: [snapshot.shares, [...snapshot.shares, { memberId: 'c', shareMinor: 0 }]],
          stopId: [null, 's1'],
          receiptAttachmentId: [null, 'r1'],
        },
      }),
      ctx(),
    ).map((line) => diffText(ctx().t, line))
    expect(lines).toEqual([
      '類別：餐飲 → 加油',
      '付款人：Gene → 公基金付',
      '分法：平均 → 份數',
      '分給誰：Gene、Mei → Gene、Mei、Lin',
      '行程點：無 → Hooker Valley',
      '收據：無 → 有收據',
    ])
  })

  it('has no lines for create and delete', () => {
    expect(diffLines(entry({ action: 'create', diff: { amountMinor: [null, 5000] } }), ctx())).toEqual([])
    expect(diffLines(entry({ action: 'delete', diff: { deletedAt: [null, 'x'] } }), ctx())).toEqual([])
  })

  it('uses the base currency for settlements', () => {
    const lines = diffLines(
      entry({
        entity: 'settlement',
        diff: { amountMinor: [1000, 1500], method: ['cash', 'transfer'] },
        snapshot: { fromMemberId: 'b', toMemberId: 'a', amountMinor: 1500, method: 'transfer' },
      }),
      ctx('en'),
    )
    expect(lines.map((l) => [l.field, l.after])).toEqual([
      ['Amount', 'A$15.00'],
      ['Method', 'Transfer'],
    ])
  })
})

describe('names and amounts', () => {
  it('names the entity from its snapshot', () => {
    expect(entityName(entry({}), ctx())).toBe('Lunch')
    expect(entityName(entry({ snapshot: { ...snapshot, note: ' ' } }), ctx())).toBe('餐飲')
    expect(entityName(entry({ entity: 'pool', snapshot: { memberId: 'b' } }), ctx())).toBe('Mei 出資')
    expect(
      entityName(entry({ entity: 'settlement', snapshot: { fromMemberId: 'b', toMemberId: 'a' } }), ctx()),
    ).toBe('Mei → Gene')
    expect(entityAmount(entry({}), ctx())).toBe('NZ$50.00')
    expect(entityAmount(entry({ entity: 'settlement', snapshot: { amountMinor: 1500 } }), ctx())).toMatch(/^AU?\$15\.00$/)
  })
})

describe('groupHistoryByDay', () => {
  it('groups by the trip-zone day, keeping the order', () => {
    const days = groupHistoryByDay(
      [
        entry({ id: '3', at: '2030-02-02T12:00:00Z' }), // 2030-02-03 01:00 in Auckland
        entry({ id: '2', at: '2030-02-02T10:00:00Z' }), // 2030-02-02 23:00
        entry({ id: '1', at: '2030-02-02T09:00:00Z' }),
      ],
      'Pacific/Auckland',
    )
    expect(days.map((d) => [d.date, d.entries.map((e) => e.id)])).toEqual([
      ['2030-02-03', ['3']],
      ['2030-02-02', ['2', '1']],
    ])
  })

  it('offers only expense versions with a full snapshot', () => {
    expect(restorable(entry({}))).toBe(true)
    expect(restorable(entry({ action: 'delete' }))).toBe(false)
    expect(restorable(entry({ entity: 'pool' }))).toBe(false)
    expect(restorable(entry({ snapshot: { note: 'x' } }))).toBe(false)
  })
})
