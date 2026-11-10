import { describe, expect, it } from 'vitest'
import { attachmentQuery } from '../../../src/lib/bookings/attachments.ts'

// e4-t04: a booking's or lodging's confirmations

describe('booking attachments', () => {
  it('lists documents of one booking or lodging', () => {
    expect(attachmentQuery({ bookingId: 'bk1' })).toBe('?kind=document&bookingId=bk1')
    expect(attachmentQuery({ lodgingId: 'lg 1' })).toBe('?kind=document&lodgingId=lg+1')
  })
})
