import { afterEach, describe, expect, it } from 'vitest'
import type { ExpenseView } from '../../../shared/api/expenses.ts'
import { ApiError } from '../../../src/lib/api.ts'
import { isFxUnavailable } from '../../../src/lib/expenses/api.ts'
import {
  POOL,
  baseEstimate,
  categoryOrder,
  currencyOptions,
  defaultCurrency,
  describeExpense,
  evenPercents,
  exactRemainder,
  filterExpenses,
  formFromExpense,
  groupByDate,
  newExpenseForm,
  parseRate,
  previewSplit,
  secondaryMinor,
  toCreateBody,
  toPatchBody,
  toggleParticipant,
  withInitial,
  withMethod,
  type ExpenseForm,
} from '../../../src/lib/expenses/form.ts'
import { expensePrefill } from '../../../src/lib/picks/expense.ts'
import { clearRecent, loadRecent, rememberExpense } from '../../../src/lib/expenses/recent.ts'

// The 記一筆 form as data (e7-t02) and the list helpers (e7-t08)

afterEach(() => clearRecent())

const trip = {
  baseCurrency: 'AUD',
  secondaryCurrency: 'TWD',
  localCurrencies: ['NZD'],
  tz: 'Pacific/Auckland',
}
const members = [{ id: 'gene' }, { id: 'mei' }, { id: 'jo' }]
const me = { id: 'gene' }
// 2026-11-09T12:30Z is already 10 November in Auckland (UTC+13)
const NOW = Date.UTC(2026, 10, 9, 12, 30)

const blank = (recent = { currency: null as string | null }) =>
  newExpenseForm({ trip, me, members, recent, now: NOW })

const filled = (patch: Partial<ExpenseForm> = {}): ExpenseForm => ({
  ...blank(),
  amountMinor: 10000,
  category: 'food',
  ...patch,
})

describe('defaults', () => {
  it('starts today in the trip zone, I paid, everyone shares equally, local currency', () => {
    const form = blank()
    expect(form.date).toBe('2026-11-10')
    expect(form.payer).toBe('gene')
    expect(form.participants).toEqual(['gene', 'mei', 'jo'])
    expect(form.method).toBe('equal')
    expect(form.currency).toBe('NZD')
    expect(form.category).toBeNull()
  })

  it('uses the last currency, else local, else base', () => {
    expect(defaultCurrency(trip, { currency: 'IDR' })).toBe('IDR')
    expect(defaultCurrency(trip, { currency: 'XXX' })).toBe('NZD')
    expect(defaultCurrency({ ...trip, localCurrencies: [] }, { currency: null })).toBe('AUD')
    expect(blank({ currency: 'JPY' }).currency).toBe('JPY')
  })

  it('remembers the currency and the last three categories per trip', () => {
    rememberExpense('t1', { currency: 'IDR', category: 'food' })
    rememberExpense('t1', { currency: 'IDR', category: 'fuel' })
    rememberExpense('t1', { currency: 'NZD', category: 'tickets' })
    rememberExpense('t1', { currency: 'NZD', category: 'food' })
    rememberExpense('t1', { currency: 'NZD', category: 'lodging' })
    expect(loadRecent('t1')).toEqual({
      currency: 'NZD',
      categories: ['lodging', 'food', 'tickets'],
    })
    expect(loadRecent('t2')).toEqual({ currency: null, categories: [] })
    expect(categoryOrder(['fuel', 'food']).slice(0, 3)).toEqual(['fuel', 'food', 'lodging'])
    expect(categoryOrder([])).toHaveLength(8)
  })

  it('offers the trip currencies first', () => {
    expect(currencyOptions(trip, 'IDR').slice(0, 4)).toEqual(['IDR', 'NZD', 'AUD', 'TWD'])
  })
})

describe('request body for each split method', () => {
  const base = { baseCurrency: 'AUD' }

  it('equal', () => {
    const body = toCreateBody(filled(), base)
    expect(body).toEqual({
      ok: true,
      value: {
        amountMinor: 10000,
        currency: 'NZD',
        date: '2026-11-10',
        category: 'food',
        note: '',
        splitMethod: 'equal',
        participants: [{ memberId: 'gene' }, { memberId: 'mei' }, { memberId: 'jo' }],
        stopId: null,
        dayId: null,
        receiptAttachmentId: null,
        wishlistItemId: null,
        bookingId: null,
        pool: false,
        payerMemberId: 'gene',
      },
    })
  })

  it('carries the pick and booking links (e5-t05, e4-t06)', () => {
    const body = toCreateBody(filled({ wishlistItemId: 'w1', bookingId: 'b1' }), base)
    expect(body).toMatchObject({ ok: true, value: { wishlistItemId: 'w1', bookingId: 'b1' } })
    expect(toPatchBody(filled({ wishlistItemId: 'w1' }), base)).toMatchObject({
      ok: true,
      value: { wishlistItemId: 'w1', bookingId: null },
    })
  })

  it('shares: blank weights count as 1, decimals allowed', () => {
    const form = withMethod(filled({ weights: { mei: '2', jo: '0.5' } }), 'shares', 'gene')
    const body = toCreateBody(form, base)
    expect(body.ok && body.value.participants).toEqual([
      { memberId: 'gene', weight: 1 },
      { memberId: 'mei', weight: 2 },
      { memberId: 'jo', weight: 0.5 },
    ])
    expect(toCreateBody({ ...form, weights: { gene: '0', mei: '0', jo: '0' } }, base)).toEqual({
      ok: false,
      problem: 'weights',
    })
  })

  it('percent: starts even and must add up to 100', () => {
    const form = withMethod(filled(), 'percent', 'gene')
    expect(form.percents).toEqual({ gene: '33.34', mei: '33.33', jo: '33.33' })
    const body = toCreateBody(form, base)
    expect(body.ok && body.value.participants).toEqual([
      { memberId: 'gene', percent: 33.34 },
      { memberId: 'mei', percent: 33.33 },
      { memberId: 'jo', percent: 33.33 },
    ])
    expect(toCreateBody({ ...form, percents: { ...form.percents, jo: '40' } }, base)).toEqual({
      ok: false,
      problem: 'percentSum',
    })
  })

  it('exact: amounts in the expense currency must add up', () => {
    const form = withMethod(
      filled({ exacts: { gene: '50', mei: '30.5', jo: '' } }),
      'exact',
      'gene',
    )
    expect(exactRemainder(form)).toBe(1950)
    expect(toCreateBody(form, base)).toEqual({ ok: false, problem: 'exactSum' })
    const done = { ...form, exacts: { gene: '50', mei: '30.5', jo: '19.50' } }
    const body = toCreateBody(done, base)
    expect(body.ok && body.value.participants).toEqual([
      { memberId: 'gene', amountMinor: 5000 },
      { memberId: 'mei', amountMinor: 3050 },
      { memberId: 'jo', amountMinor: 1950 },
    ])
  })

  it('self: no participants, a member pays; the pool cannot', () => {
    const form = withMethod(filled({ payer: POOL }), 'self', 'gene')
    expect(form.payer).toBe('gene')
    const body = toCreateBody(form, base)
    expect(body.ok && body.value).toMatchObject({
      splitMethod: 'self',
      participants: [],
      payerMemberId: 'gene',
    })
    expect(toCreateBody({ ...form, payer: POOL }, base)).toEqual({ ok: false, problem: 'selfPool' })
  })

  it('the pool pays: pool true and no payerMemberId', () => {
    const body = toCreateBody(filled({ payer: POOL }), base)
    expect(body.ok && body.value).toMatchObject({ pool: true })
    expect(body.ok && 'payerMemberId' in body.value).toBe(false)
  })

  it('needs an amount, a category and someone to share', () => {
    expect(toCreateBody(filled({ amountMinor: null }), base)).toEqual({
      ok: false,
      problem: 'amount',
    })
    expect(toCreateBody(filled({ category: null }), base)).toEqual({
      ok: false,
      problem: 'category',
    })
    expect(toCreateBody(filled({ participants: [] }), base)).toEqual({
      ok: false,
      problem: 'participants',
    })
  })

  it('leaving someone out keeps member order and re-evens percents', () => {
    let form = withMethod(filled(), 'percent', 'gene')
    form = toggleParticipant(form, 'mei', members)
    expect(form.participants).toEqual(['gene', 'jo'])
    expect(form.percents).toEqual({ gene: '50', jo: '50' })
    form = toggleParticipant(form, 'mei', members)
    expect(form.participants).toEqual(['gene', 'mei', 'jo'])
  })
})

describe('the rate', () => {
  const base = { baseCurrency: 'AUD' }

  it('is not sent unless typed: the server resolves it (trip default, fxRates)', () => {
    const body = toCreateBody(filled({ fxRate: '0.91' }), base)
    expect(body.ok && 'fxRate' in body.value).toBe(false)
  })

  it('is sent as a manual rate once typed', () => {
    const body = toCreateBody(filled({ fxRate: '0.9123456', rateEdited: true }), base)
    expect(body.ok && body.value.fxRate).toBe(0.912346)
  })

  it('is required after 422 fx_unavailable, then sent', () => {
    const error = new ApiError(422, 'fx_unavailable', 'no rate', {
      needsRate: true,
      currency: 'IDR',
      base: 'AUD',
      date: '2026-11-10',
    })
    expect(isFxUnavailable(error)).toBe(true)
    expect(isFxUnavailable(new ApiError(422, 'invalid', 'x'))).toBe(false)
    const form = filled({ currency: 'IDR', amountMinor: 150000 })
    expect(toCreateBody(form, { ...base, needsRate: true })).toEqual({ ok: false, problem: 'rate' })
    const body = toCreateBody({ ...form, fxRate: '0.000095' }, { ...base, needsRate: true })
    expect(body.ok && body.value.fxRate).toBe(0.000095)
  })

  it('is never sent for the base currency', () => {
    const body = toCreateBody(filled({ currency: 'AUD', fxRate: '2', rateEdited: true }), base)
    expect(body.ok && 'fxRate' in body.value).toBe(false)
  })

  it('parses and estimates the base amount', () => {
    expect(parseRate('0')).toBeNull()
    expect(parseRate('abc')).toBeNull()
    expect(parseRate('1,000.5')).toBe(1000.5)
    expect(baseEstimate({ amountMinor: 4500, currency: 'NZD' }, 'AUD', 0.91)).toBe(4095)
    expect(baseEstimate({ amountMinor: 150000, currency: 'IDR' }, 'AUD', 0.000095)).toBe(1425)
    expect(baseEstimate({ amountMinor: 4500, currency: 'NZD' }, 'AUD', null)).toBeNull()
  })
})

describe('split preview', () => {
  it('shows exact minor amounts with the leftover cent going to the payer first', () => {
    const preview = previewSplit(filled({ payer: 'mei' }))
    expect(preview).toEqual({
      ok: true,
      value: [
        { memberId: 'gene', shareMinor: 3333 },
        { memberId: 'mei', shareMinor: 3334 },
        { memberId: 'jo', shareMinor: 3333 },
      ],
    })
  })

  it('shares in a 0-decimal currency', () => {
    const form = withMethod(
      filled({
        currency: 'IDR',
        amountMinor: 150000,
        weights: { mei: '2' },
        participants: ['gene', 'mei'],
      }),
      'shares',
      'gene',
    )
    expect(previewSplit(form)).toEqual({
      ok: true,
      value: [
        { memberId: 'gene', shareMinor: 50000 },
        { memberId: 'mei', shareMinor: 100000 },
      ],
    })
  })

  it('says why there is none', () => {
    expect(previewSplit(filled({ amountMinor: null }))).toEqual({ ok: false, problem: 'amount' })
    expect(
      previewSplit(
        withMethod(filled({ percents: { gene: '10', mei: '10', jo: '10' } }), 'percent', 'gene'),
      ),
    ).toEqual({
      ok: false,
      problem: 'percentSum',
    })
  })

  it('even percents always add up to 100', () => {
    for (const n of [1, 2, 3, 6, 7]) {
      const ids = Array.from({ length: n }, (_, i) => `m${i}`)
      const total = Object.values(evenPercents(ids)).reduce(
        (sum, v) => sum + Math.round(Number(v) * 100),
        0,
      )
      expect(total).toBe(10000)
    }
  })
})

const view = (patch: Partial<ExpenseView> = {}): ExpenseView => ({
  id: 'e1',
  tripId: 't1',
  payerMemberId: 'gene',
  pool: false,
  amountMinor: 4500,
  currency: 'NZD',
  fxRate: 0.91,
  fxSource: 'trip',
  fxDate: null,
  baseMinor: 4095,
  date: '2026-11-10',
  category: 'food',
  note: 'Fergburger',
  stopId: null,
  dayId: null,
  receiptAttachmentId: null,
  bookingId: null,
  wishlistItemId: null,
  splitMethod: 'equal',
  createdByMemberId: 'gene',
  rev: 1,
  createdAt: '2026-11-10T01:00:00Z',
  updatedAt: '2026-11-10T01:00:00Z',
  deletedAt: null,
  shares: [
    { memberId: 'gene', weight: null, percent: null, amountMinor: null, shareMinor: 1365 },
    { memberId: 'mei', weight: null, percent: null, amountMinor: null, shareMinor: 1365 },
    { memberId: 'jo', weight: null, percent: null, amountMinor: null, shareMinor: 1365 },
  ],
  ...patch,
})

describe('editing', () => {
  it('fills the form from a saved expense and maps back to the same PATCH', () => {
    const expense = view({
      splitMethod: 'shares',
      shares: [
        { memberId: 'gene', weight: 1, percent: null, amountMinor: null, shareMinor: 1365 },
        { memberId: 'mei', weight: 2, percent: null, amountMinor: null, shareMinor: 2730 },
      ],
    })
    const form = formFromExpense(expense, members)
    expect(form).toMatchObject({
      amountMinor: 4500,
      currency: 'NZD',
      participants: ['gene', 'mei'],
      method: 'shares',
      weights: { gene: '1', mei: '2' },
      fxRate: '0.91',
      rateEdited: false,
    })
    const body = toPatchBody({ ...form, note: 'Ferg' }, { baseCurrency: 'AUD' })
    expect(body.ok && body.value).toMatchObject({
      note: 'Ferg',
      splitMethod: 'shares',
      participants: [
        { memberId: 'gene', weight: 1 },
        { memberId: 'mei', weight: 2 },
      ],
    })
    expect(body.ok && 'fxRate' in body.value).toBe(false)
  })

  it('a self expense comes back with everyone selectable', () => {
    const form = formFromExpense(
      view({
        splitMethod: 'self',
        shares: [
          { memberId: 'gene', weight: null, percent: null, amountMinor: null, shareMinor: 4095 },
        ],
      }),
      members,
    )
    expect(form.participants).toEqual(['gene', 'mei', 'jo'])
    expect(form.method).toBe('self')
  })

  it('exact amounts come back in major units of the expense currency', () => {
    const form = formFromExpense(
      view({
        currency: 'IDR',
        amountMinor: 150000,
        splitMethod: 'exact',
        shares: [
          { memberId: 'gene', weight: null, percent: null, amountMinor: 100000, shareMinor: 950 },
          { memberId: 'mei', weight: null, percent: null, amountMinor: 50000, shareMinor: 475 },
        ],
      }),
      members,
    )
    expect(form.exacts).toEqual({ gene: '100000', mei: '50000' })
  })
})

describe('the list', () => {
  const list = [
    view({ id: 'a', date: '2026-11-10', baseMinor: 4095, createdAt: '2026-11-10T01:00:00Z' }),
    view({
      id: 'b',
      date: '2026-11-11',
      note: '',
      category: 'fuel',
      baseMinor: 9000,
      pool: true,
      payerMemberId: null,
    }),
    view({
      id: 'c',
      date: '2026-11-10',
      note: 'Groceries',
      baseMinor: 1000,
      createdAt: '2026-11-10T05:00:00Z',
    }),
    view({ id: 'd', date: '2026-11-10', deletedAt: '2026-11-10T06:00:00Z' }),
    view({
      id: 'e',
      date: '2026-11-12',
      note: 'Wine',
      splitMethod: 'self',
      shares: [
        { memberId: 'jo', weight: null, percent: null, amountMinor: null, shareMinor: 4095 },
      ],
      payerMemberId: 'jo',
    }),
  ]

  it('groups by date, newest first, with day totals in the base currency', () => {
    const days = groupByDate(filterExpenses(list, {}))
    expect(days.map((d) => [d.date, d.totalBaseMinor, d.expenses.map((e) => e.id)])).toEqual([
      ['2026-11-12', 4095, ['e']],
      ['2026-11-11', 9000, ['b']],
      ['2026-11-10', 5095, ['c', 'a']],
    ])
  })

  it('filters by dates, category, member and text (category label for rows without a note)', () => {
    const ids = (filter: Parameters<typeof filterExpenses>[1]) =>
      filterExpenses(list, filter, (c) => (c === 'fuel' ? 'Fuel' : c)).map((e) => e.id)
    expect(ids({ from: '2026-11-11', to: '2026-11-11' })).toEqual(['b'])
    expect(ids({ category: 'fuel' })).toEqual(['b'])
    expect(ids({ memberId: 'jo' })).toEqual(['a', 'b', 'c', 'e'])
    expect(ids({ memberId: 'mei' })).toEqual(['a', 'b', 'c'])
    expect(ids({ q: 'groc' })).toEqual(['c'])
    expect(ids({ q: 'fuel' })).toEqual(['b'])
  })

  it('describes who paid and who shares', () => {
    expect(describeExpense(list[0], members)).toEqual({
      payer: { kind: 'member', memberId: 'gene' },
      split: { kind: 'everyone' },
    })
    expect(describeExpense(list[1], members).payer).toEqual({ kind: 'pool' })
    expect(describeExpense(list[4], members).split).toEqual({ kind: 'self' })
    const two = view({ shares: list[0].shares.slice(0, 2) })
    expect(describeExpense(two, members).split).toEqual({ kind: 'some', count: 2, method: 'equal' })
  })

  it('converts base amounts to the secondary currency', () => {
    // 1 TWD = 0.05 AUD → A$40.95 = NT$819.00
    expect(secondaryMinor(4095, 'AUD', 'TWD', 0.05)).toBe(81900)
    expect(secondaryMinor(4095, 'AUD', null, 0.05)).toBeNull()
    expect(secondaryMinor(4095, 'AUD', 'AUD', 1)).toBeNull()
    expect(secondaryMinor(4095, 'AUD', 'TWD', null)).toBeNull()
  })
})

describe('prefill (initial)', () => {
  it('lays a pick’s prefill over the blank form', () => {
    const form = withInitial(
      blank(),
      expensePrefill({
        id: 'w1',
        name: 'Fergburger',
        category: 'eat',
        estMinor: 1800,
        currency: 'NZD',
        stopId: 's1',
      }),
    )
    expect(form).toMatchObject({
      amountMinor: 1800,
      currency: 'NZD',
      category: 'food',
      note: 'Fergburger',
      stopId: 's1',
      dayId: null,
      wishlistItemId: 'w1',
      bookingId: null,
      payer: 'gene',
      date: '2026-11-10',
    })
    expect(toCreateBody(form, { baseCurrency: 'AUD' })).toMatchObject({
      ok: true,
      value: { wishlistItemId: 'w1', stopId: 's1', amountMinor: 1800, category: 'food' },
    })
  })

  it('keeps defaults for missing or unknown values; pool and date and booking id apply', () => {
    const form = withInitial(blank(), {
      amountMinor: null,
      currency: 'XXX',
      category: 'lodging',
      note: 'Holiday Park',
      date: '2026-12-20',
      payerMemberId: POOL,
      bookingId: 'lg1',
    })
    expect(form).toMatchObject({
      amountMinor: null,
      currency: 'NZD',
      category: 'lodging',
      date: '2026-12-20',
      payer: POOL,
      bookingId: 'lg1',
    })
    expect(withInitial(blank(), { date: '20 Dec' }).date).toBe('2026-11-10')
    expect(withInitial(blank(), null)).toEqual(blank())
  })
})
