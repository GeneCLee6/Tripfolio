import { describe, expect, it } from 'vitest'
import type { BalanceRow, FxResponse, Settlement } from '../../../shared/api/expenses.ts'
import type { Member } from '../../../shared/api/types.ts'
import {
  checkSettleAmount,
  myRow,
  parseRate,
  peopleOf,
  personFor,
  poolShares,
  secondaryRate,
  settlementLog,
  signedMoney,
  suggestionCards,
  toneOf,
  TONE_LABEL,
  toSecondaryMinor,
} from '../../../src/lib/balances/view.ts'

// The balances page's pure helpers (e7-t04, e7-t05)

const member = (id: string, name: string, color = '#0F6E74'): Member => ({
  id,
  tripId: 't1',
  name,
  color,
  email: null,
  role: 'editor',
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
})

const row = (memberId: string, netMinor: number, extra: Partial<BalanceRow> = {}): BalanceRow => ({
  memberId,
  paidMinor: 0,
  owedMinor: 0,
  poolInMinor: 0,
  poolBackMinor: 0,
  settledOutMinor: 0,
  settledInMinor: 0,
  netMinor,
  removed: false,
  ...extra,
})

describe('sign and labels', () => {
  it('maps the sign convention (net > 0 gets back) to a tone and a word', () => {
    expect(toneOf(1)).toBe('gets')
    expect(toneOf(-1)).toBe('owes')
    expect(toneOf(0)).toBe('even')
    expect(TONE_LABEL.gets).toBe('balances.tone.gets')
    expect(TONE_LABEL.owes).toBe('balances.tone.owes')
  })

  it('spells out the sign with the currency’s own decimals', () => {
    expect(signedMoney(31240, 'NZD', 'en')).toBe('+NZ$312.40')
    expect(signedMoney(-11960, 'NZD', 'en')).toBe('−NZ$119.60')
    expect(signedMoney(0, 'AUD', 'en')).toBe('A$0.00')
    // 0-decimal currency: minor units are whole yen
    expect(signedMoney(-1500, 'JPY', 'en')).toBe('−¥1,500')
  })
})

describe('secondary currency', () => {
  const fx: FxResponse = {
    base: 'AUD',
    date: '2026-11-09',
    overrides: {},
    rates: [{ quote: 'TWD', rate: 0.05, source: 'trip', rateDate: null }],
  }

  it('finds the rate of the secondary currency, or null', () => {
    expect(secondaryRate(fx, 'TWD')).toBe(0.05)
    expect(secondaryRate(fx, 'AUD')).toBeNull()
    expect(secondaryRate(fx, null)).toBeNull()
    expect(secondaryRate(null, 'TWD')).toBeNull()
    expect(
      secondaryRate({ ...fx, rates: [{ quote: 'TWD', rate: null, source: null, rateDate: null }] }, 'TWD'),
    ).toBeNull()
  })

  it('converts a base amount at 1 secondary = rate base, keeping the sign', () => {
    // A$10.00 at 1 TWD = 0.05 AUD is NT$200.00
    expect(toSecondaryMinor(1000, 'AUD', 'TWD', 0.05)).toBe(20000)
    expect(toSecondaryMinor(-1000, 'AUD', 'TWD', 0.05)).toBe(-20000)
    // To a 0-decimal currency: A$1.00 at 1 JPY = 0.01 AUD is ¥100
    expect(toSecondaryMinor(100, 'AUD', 'JPY', 0.01)).toBe(100)
    expect(toSecondaryMinor(1000, 'AUD', 'AUD', 1)).toBeNull()
    expect(toSecondaryMinor(1000, 'AUD', 'TWD', null)).toBeNull()
    expect(toSecondaryMinor(1000, 'AUD', null, 0.05)).toBeNull()
  })
})

describe('people and suggestion cards', () => {
  const members = [member('a', 'Gene'), member('b', 'Mei', '#B5654A'), member('c', 'Jo')]

  it('knows current members, marks me, and adds removed ids from the rows', () => {
    const people = peopleOf(members, 'b', [row('a', 0), row('x', 5, { removed: true })])
    expect(people.get('b')).toMatchObject({ name: 'Mei', isMe: true, removed: false, colorIndex: 1 })
    expect(people.get('x')).toMatchObject({ name: null, removed: true, isMe: false })
    expect(personFor(people, 'nobody')).toMatchObject({ name: null, removed: true })
  })

  it('maps suggested transfers to cards, mine first, otherwise in server order', () => {
    const people = peopleOf(members, 'c')
    const cards = suggestionCards(
      [
        { from: 'b', to: 'a', amountMinor: 500 },
        { from: 'c', to: 'a', amountMinor: 300 },
        { from: 'b', to: 'x', amountMinor: 0 },
      ],
      people,
    )
    expect(cards.map((card) => [card.from.id, card.to.id, card.amountMinor, card.mine])).toEqual([
      ['c', 'a', 300, true],
      ['b', 'a', 500, false],
    ])
    expect(new Set(cards.map((card) => card.key)).size).toBe(2)
  })

  it('finds my row', () => {
    expect(myRow([row('a', 1), row('b', -1)], 'b')?.netMinor).toBe(-1)
    expect(myRow([row('a', 0)], 'z')).toBeNull()
  })
})

describe('pool shares', () => {
  it('lists only people with a pool part, with negative refunds when overdrawn', () => {
    const shares = poolShares([
      row('a', 0, { poolInMinor: 50000, poolBackMinor: 12000 }),
      row('b', 0),
      row('c', 0, { poolInMinor: 10000, poolBackMinor: -300 }),
    ])
    expect(shares).toEqual([
      { memberId: 'a', inMinor: 50000, backMinor: 12000 },
      { memberId: 'c', inMinor: 10000, backMinor: -300 },
    ])
  })
})

describe('settlement log and the settle form', () => {
  const settlement = (id: string, date: string, createdAt: string, deletedAt: string | null = null): Settlement => ({
    id,
    tripId: 't1',
    fromMemberId: 'a',
    toMemberId: 'b',
    amountMinor: 100,
    method: 'cash',
    note: '',
    date,
    createdByMemberId: 'a',
    rev: 1,
    createdAt,
    updatedAt: createdAt,
    deletedAt,
  })

  it('shows the newest first and leaves deleted ones out', () => {
    const log = settlementLog([
      settlement('1', '2026-11-01', '2026-11-01T10:00:00Z'),
      settlement('2', '2026-11-03', '2026-11-03T10:00:00Z'),
      settlement('3', '2026-11-03', '2026-11-03T12:00:00Z'),
      settlement('4', '2026-11-04', '2026-11-04T12:00:00Z', '2026-11-05T00:00:00Z'),
    ])
    expect(log.map((item) => item.id)).toEqual(['3', '2', '1'])
  })

  it('accepts a full or partial amount, not nothing and not more than suggested', () => {
    expect(checkSettleAmount(500, 500)).toBeNull()
    expect(checkSettleAmount(1, 500)).toBeNull()
    expect(checkSettleAmount(null, 500)).toBe('empty')
    expect(checkSettleAmount(0, 500)).toBe('empty')
    expect(checkSettleAmount(501, 500)).toBe('tooMuch')
  })

  it('parses a typed rate', () => {
    expect(parseRate('19.02')).toBe(19.02)
    expect(parseRate(' 0,91 ')).toBe(0.91)
    expect(parseRate('0')).toBeNull()
    expect(parseRate('abc')).toBeNull()
    expect(parseRate('')).toBeNull()
  })
})
