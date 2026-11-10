import { describe, expect, it } from 'vitest'
import { EXPENSE_CATEGORY_OF_PICK, expensePrefill } from '../../../src/lib/picks/expense.ts'

// e5-t05: what the 記一筆 form starts with when a pick is marked done

const item = {
  id: 'w1',
  name: 'Fergburger',
  category: 'eat' as const,
  estMinor: 1800,
  currency: 'NZD',
  stopId: 's1',
}

describe('expense prefill from a pick', () => {
  it('amount, currency, note and both links', () => {
    expect(expensePrefill(item)).toEqual({
      amountMinor: 1800,
      currency: 'NZD',
      category: 'food',
      note: 'Fergburger',
      wishlistItemId: 'w1',
      stopId: 's1',
    })
  })

  it('category by the pick’s', () => {
    expect(EXPENSE_CATEGORY_OF_PICK).toEqual({
      eat: 'food',
      buy: 'shopping',
      see: 'tickets',
      experience: 'tickets',
    })
    expect(expensePrefill({ ...item, category: 'buy' }).category).toBe('shopping')
  })

  it('no price: no amount and the form keeps its own currency; not scheduled: no stop', () => {
    expect(expensePrefill({ ...item, estMinor: null, stopId: null })).toMatchObject({
      amountMinor: null,
      currency: null,
      stopId: null,
    })
    expect(expensePrefill({ ...item, currency: null })).toMatchObject({
      amountMinor: null,
      currency: null,
    })
  })
})
