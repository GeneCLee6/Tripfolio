import { describe, expect, it } from 'vitest'
import type { Booking } from '../../../shared/api/bookings.ts'
import { bookingCreateSchema } from '../../../shared/schema/booking.ts'
import { lodgingCreateSchema } from '../../../shared/schema/lodging.ts'
import {
  bookingBody,
  bookingPatch,
  bookingToForm,
  dualTimes,
  emptyBookingForm,
  emptyLodgingForm,
  localDateTime,
  localToUtc,
  lodgingBody,
  relativeDue,
  suggestedTitle,
  utcToLocal,
  type BookingForm,
} from '../../../src/lib/bookings/form.ts'

// The lodging and booking forms' pure helpers (e4-t02, e4-t03, e4-t05): local ↔ UTC per zone
// (AC-4.5: a flight's two airports, overnight, daylight saving), form → request body per type, and
// the deadline's relative label.

const TRIP_TZ = 'Pacific/Auckland'

const form = (type: BookingForm['type'], extra: Partial<BookingForm> = {}): BookingForm => ({
  ...emptyBookingForm(type, TRIP_TZ, 'NZD'),
  ...extra,
})

describe('local ↔ UTC', () => {
  it('reads a wall-clock time in the given zone', () => {
    // NZDT is UTC+13 in February
    expect(localToUtc('2027-02-07', '04:10', 'Pacific/Auckland')).toBe('2027-02-06T15:10:00Z')
    // AEDT is UTC+11
    expect(localToUtc('2027-02-06', '23:00', 'Australia/Sydney')).toBe('2027-02-06T12:00:00Z')
    // NZST (UTC+12) after daylight saving ends in April
    expect(localToUtc('2027-04-10', '12:00', 'Pacific/Auckland')).toBe('2027-04-10T00:00:00Z')
    expect(localToUtc('2027-02-07', '', 'Pacific/Auckland')).toBeNull()
    expect(localToUtc('', '10:00', 'Pacific/Auckland')).toBeNull()
  })

  it('and back', () => {
    expect(utcToLocal('2027-02-06T15:10:00Z', 'Pacific/Auckland')).toEqual({
      date: '2027-02-07',
      time: '04:10',
    })
    expect(utcToLocal('2027-02-06T15:10:00Z', 'Asia/Taipei')).toEqual({ date: '2027-02-06', time: '23:10' })
    expect(utcToLocal(null, 'Asia/Taipei')).toEqual({ date: '', time: '' })
  })

  it('local date-time strings default to the end of the day', () => {
    expect(localDateTime('2027-02-01', '18:00')).toBe('2027-02-01T18:00')
    expect(localDateTime('2027-02-01', '')).toBe('2027-02-01T23:59')
    expect(localDateTime('', '18:00')).toBeNull()
  })
})

describe('flight times in two zones (AC-4.5)', () => {
  it('SYD → AKL overnight: each end in its own airport zone', () => {
    const f = form('flight', {
      text: { airline: 'Air New Zealand', flightNo: 'NZ 104', fromAirport: 'SYD', toAirport: 'AKL' },
      startDate: '2027-02-06',
      startTime: '23:00',
      startTz: 'Australia/Sydney',
      endDate: '2027-02-07',
      endTime: '04:10',
      endTz: 'Pacific/Auckland',
    })
    const body = bookingBody(f, TRIP_TZ)
    expect(body.startAt).toBe('2027-02-06T12:00:00Z')
    expect(body.endAt).toBe('2027-02-06T15:10:00Z')
    expect(body.startTz).toBe('Australia/Sydney')
    expect(body.endTz).toBe('Pacific/Auckland')
    expect(body.title).toBe('NZ 104 SYD→AKL')
    expect(bookingCreateSchema.safeParse(body).success).toBe(true)

    const times = dualTimes(
      { startAt: body.startAt!, endAt: body.endAt!, startTz: body.startTz!, endTz: body.endTz! },
      TRIP_TZ,
    )!
    expect(times.start).toMatchObject({ date: '2027-02-06', time: '23:00', offsetMinutes: 660 })
    expect(times.end).toMatchObject({ date: '2027-02-07', time: '04:10', offsetMinutes: 780 })
    // 3 h 10 min in the air, but the arrival's local date is the next day
    expect(times.dayShift).toBe(1)
  })

  it('TPE → AKL: the same instants read back into the form', () => {
    const f = form('flight', {
      text: { airline: 'China Airlines', flightNo: 'CI 53', fromAirport: 'TPE', toAirport: 'AKL' },
      startDate: '2027-02-06',
      startTime: '13:00',
      startTz: 'Asia/Taipei',
      endDate: '2027-02-07',
      endTime: '05:00',
      endTz: 'Pacific/Auckland',
    })
    const body = bookingBody(f, TRIP_TZ)
    expect(body.startAt).toBe('2027-02-06T05:00:00Z')
    expect(body.endAt).toBe('2027-02-06T16:00:00Z')
    const stored = {
      ...body,
      id: 'b1',
      tripId: 't1',
      stops: [],
      rev: 1,
      createdAt: '',
      updatedAt: '',
    } as unknown as Booking
    const back = bookingToForm(stored, TRIP_TZ, 'NZD')
    expect(back).toMatchObject({
      startDate: '2027-02-06',
      startTime: '13:00',
      startTz: 'Asia/Taipei',
      endDate: '2027-02-07',
      endTime: '05:00',
      endTz: 'Pacific/Auckland',
    })
  })

  it('other types use the trip zone; an end time before the start rolls to the next day', () => {
    const body = bookingBody(
      form('ferry', {
        text: { fromText: 'Wellington', toText: 'Picton' },
        startDate: '2027-02-08',
        startTime: '20:30',
        endTime: '00:00',
      }),
      TRIP_TZ,
    )
    expect(body.startTz).toBeNull()
    expect(body.endTz).toBeNull()
    expect(body.startAt).toBe('2027-02-08T07:30:00Z')
    expect(body.endAt).toBe('2027-02-08T11:00:00Z')
    expect(body.title).toBe('Wellington→Picton')
  })
})

describe('form → body per type', () => {
  it('rental: places, money in minor units and the self-contained flag', () => {
    const body = bookingBody(
      form('rental', {
        text: { company: 'Jucy', vehicle: 'Condo 4-berth', insurance: 'Zero excess' },
        pickupPlaceId: 'p1',
        startDate: '2027-02-06',
        startTime: '10:00',
        endDate: '2027-02-12',
        endTime: '09:00',
        excessMinor: 0,
        depositMinor: 50000,
        selfContained: true,
        priceMinor: 180000,
      }),
      TRIP_TZ,
    )
    expect(body.details).toEqual({
      company: 'Jucy',
      vehicle: 'Condo 4-berth',
      insurance: 'Zero excess',
      pickupPlaceId: 'p1',
      excessMinor: 0,
      depositMinor: 50000,
      selfContained: true,
    })
    expect(body.currency).toBe('NZD')
    expect(bookingCreateSchema.safeParse(body).success).toBe(true)
  })

  it('driver: the range at the daily pickup time and what the rate includes', () => {
    const body = bookingBody(
      form('driver', {
        text: { driverName: 'Mr Kim', pickupText: 'Hotel lobby' },
        startDate: '2027-02-08',
        endDate: '2027-02-09',
        pickupTime: '08:30',
        dailyRateMinor: 35000,
        includes: ['fuel', 'tolls'],
      }),
      TRIP_TZ,
    )
    expect(body.startAt).toBe('2027-02-07T19:30:00Z')
    expect(body.endAt).toBe('2027-02-08T19:30:00Z')
    expect(body.details).toEqual({
      driverName: 'Mr Kim',
      pickupText: 'Hotel lobby',
      dailyRateMinor: 35000,
      includes: ['fuel', 'tolls'],
      pickupTime: '08:30',
    })
    expect(body.title).toBe('Mr Kim')
    expect(bookingCreateSchema.safeParse(body).success).toBe(true)
  })

  it('activity: needs a title; check-in minutes and the cancel-by as local time', () => {
    const f = form('activity', {
      text: { meetingText: 'i-SITE' },
      startDate: '2027-02-09',
      startTime: '09:00',
      checkInMinutes: '30',
      cancelDate: '2027-02-07',
      cancelTime: '',
    })
    expect(suggestedTitle(f)).toBe('')
    expect(bookingCreateSchema.safeParse(bookingBody(f, TRIP_TZ)).success).toBe(false)
    const body = bookingBody({ ...f, title: 'Milford Sound cruise' }, TRIP_TZ)
    expect(body.details).toEqual({ meetingText: 'i-SITE', checkInMinutesBefore: 30 })
    expect(body).toMatchObject({ cancelByLocal: '2027-02-07T23:59' })
    expect(bookingCreateSchema.safeParse(body).success).toBe(true)
  })

  it('a flight without its required fields does not validate', () => {
    const result = bookingCreateSchema.safeParse(bookingBody(form('flight'), TRIP_TZ))
    expect(result.success).toBe(false)
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'))
    expect(paths).toEqual(expect.arrayContaining(['details.airline', 'details.flightNo']))
  })

  it('a patch nulls the details keys the form dropped', () => {
    const stored = {
      id: 'b1',
      type: 'rental',
      details: { company: 'Jucy', vehicle: 'Condo', insurance: 'Basic' },
      startAt: null,
      endAt: null,
      startTz: null,
      endTz: null,
      currency: null,
      priceMinor: null,
      payStatus: 'unpaid',
      payerMemberId: null,
      cancelBy: null,
      ref: null,
      note: '',
      title: 'Jucy Condo',
      stops: [],
    } as unknown as Booking
    const f = bookingToForm(stored, TRIP_TZ, 'NZD')
    const patch = bookingPatch(stored, { ...f, text: { ...f.text, insurance: '' } }, TRIP_TZ)
    expect(patch.details).toEqual({ company: 'Jucy', vehicle: 'Condo', insurance: null })
    expect(patch).not.toHaveProperty('type')
    expect(patch.cancelBy).toBeNull()
  })
})

describe('lodging body', () => {
  it('campervan: site type and facilities; cancel-by as local time in the trip zone', () => {
    const body = lodgingBody(
      {
        ...emptyLodgingForm('2027-02-06', 'NZD'),
        name: 'Top 10 Holiday Park',
        checkOut: '2027-02-08',
        checkInTime: '14:00',
        campType: 'holiday-park',
        power: true,
        priceMinor: 6800,
        cancelDate: '2027-02-01',
        cancelTime: '18:00',
        guests: '2',
      },
      true,
    )
    expect(body).toMatchObject({
      checkIn: '2027-02-06',
      checkOut: '2027-02-08',
      checkInTime: '14:00',
      checkOutTime: null,
      campType: 'holiday-park',
      campFacilities: { power: true, water: false, dump: false },
      priceMinor: 6800,
      currency: 'NZD',
      cancelByLocal: '2027-02-01T18:00',
      guests: 2,
    })
    expect(lodgingCreateSchema.safeParse(body).success).toBe(true)
  })

  it('not a campervan trip: no campsite fields; no price means no currency', () => {
    const body = lodgingBody(
      { ...emptyLodgingForm('2027-02-06', 'NZD'), name: 'Hotel', campType: 'doc', power: true },
      false,
    )
    expect(body).toMatchObject({
      checkOut: '2027-02-07',
      campType: null,
      campFacilities: null,
      currency: null,
      cancelBy: null,
    })
  })
})

describe('deadline labels', () => {
  const now = Date.parse('2027-02-01T00:00:00Z')
  const day = 86_400_000
  it('ahead, through Intl.RelativeTimeFormat', () => {
    expect(relativeDue(now + 3 * day, now, 'zh-TW')).toEqual({ past: false, text: '3 天後' })
    expect(relativeDue(now + 3 * day, now, 'en')).toEqual({ past: false, text: 'in 3 days' })
    expect(relativeDue(now + 5 * 3_600_000, now, 'zh-TW').text).toBe('5 小時後')
    expect(relativeDue(now + 10 * 60_000, now, 'en').text).toBe('in 10 minutes')
  })
  it('past: the bare amount for 「已過 {amount}」', () => {
    expect(relativeDue(now - 2 * day, now, 'zh-TW')).toEqual({ past: true, text: '2 天' })
    expect(relativeDue(now - 2 * day, now, 'en')).toEqual({ past: true, text: '2 days' })
    expect(relativeDue(now - 3_600_000, now, 'en')).toEqual({ past: true, text: '1 hour' })
  })
})
