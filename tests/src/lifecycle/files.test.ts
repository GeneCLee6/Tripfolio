import { describe, expect, it } from 'vitest'
import { TRIP_EXPORT_FORMAT, TRIP_EXPORT_VERSION } from '../../../shared/api/export.ts'
import {
  calendarFeedUrl,
  daysUntilPurge,
  filenameFromDisposition,
  parseImportFile,
  shiftedEndDate,
  webcalUrl,
} from '../../../src/lib/lifecycle/files.ts'
import { tokensForDeleted } from '../../../src/lib/lifecycle/graveyard.ts'

// Trip lifecycle helpers (e1-t07, e8-t03, e8-t05): the download file name, the calendar
// subscription URL, the import preview, date shifting and the purge countdown.

describe('filenameFromDisposition', () => {
  it('prefers the UTF-8 filename* the Worker sends (RFC 6266)', () => {
    const name = '紐西蘭-2026-12-20.tripfolio.json'
    const header = `attachment; filename="trip-2026-12-20.tripfolio.json"; filename*=UTF-8''${encodeURIComponent(name)}`
    expect(filenameFromDisposition(header, 'x.json')).toBe(name)
  })

  it('falls back to the quoted filename, then to the default', () => {
    expect(filenameFromDisposition('attachment; filename="bali-2030.ics"', 'trip.ics')).toBe(
      'bali-2030.ics',
    )
    expect(filenameFromDisposition('attachment; filename=plain.ics', 'trip.ics')).toBe('plain.ics')
    expect(filenameFromDisposition('attachment', 'trip.ics')).toBe('trip.ics')
    expect(filenameFromDisposition(null, 'trip.ics')).toBe('trip.ics')
    // A broken percent-encoding uses the plain name
    expect(
      filenameFromDisposition(`attachment; filename="ok.ics"; filename*=UTF-8''%E0%A4%A`, 'x'),
    ).toBe('ok.ics')
  })

  it('never returns a path', () => {
    expect(filenameFromDisposition('attachment; filename="../../evil.json"', 'x')).toBe(
      '....evil.json',
    )
    expect(filenameFromDisposition("attachment; filename*=UTF-8''a%2Fb.ics", 'x')).toBe('ab.ics')
  })
})

describe('calendar subscription URL', () => {
  it('is the share token feed, as https and as webcal://', () => {
    expect(calendarFeedUrl('tok_EN-1', 'https://trip.example/')).toBe(
      'https://trip.example/api/share/tok_EN-1/calendar.ics',
    )
    expect(webcalUrl('tok_EN-1', 'https://trip.example')).toBe(
      'webcal://trip.example/api/share/tok_EN-1/calendar.ics',
    )
    expect(webcalUrl('a b', 'http://localhost:5456')).toBe(
      'webcal://localhost:5456/api/share/a%20b/calendar.ics',
    )
  })
})

const file = {
  format: TRIP_EXPORT_FORMAT,
  version: TRIP_EXPORT_VERSION,
  exportedAt: '2026-11-10T00:00:00.000Z',
  includes: { expenses: true, photos: false },
  trip: { name: 'NZ South', destination: 'Queenstown', startDate: '2026-12-20', endDate: '2026-12-23' },
  members: [
    { id: 1, name: 'Gene', color: '#0F6E74', role: 'owner', removed: false },
    { id: 2, name: 'Mia', color: '#B5654A', role: 'editor', removed: false },
    { id: 3, name: 'Gone', color: '#B5654A', role: 'editor', removed: true },
  ],
  days: [
    { id: 1, idx: 1 },
    { id: 2, idx: 2 },
    { id: 3, idx: 3 },
    { id: 4, idx: 4 },
    { id: 5, idx: null },
  ],
  places: [{ id: 1 }, { id: 2 }],
  stops: [{ id: 1 }, { id: 2 }, { id: 3 }],
  legOverrides: [],
  lodgings: [{ id: 1 }],
  bookings: [],
  wishlist: [{ id: 1 }],
  expenses: [{ id: 1 }, { id: 2 }],
}

describe('parseImportFile', () => {
  it('summarises an export file: name, dates, counts, the members one can be', () => {
    const result = parseImportFile(JSON.stringify(file))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary).toEqual({
      name: 'NZ South',
      destination: 'Queenstown',
      startDate: '2026-12-20',
      endDate: '2026-12-23',
      days: 4,
      stops: 3,
      places: 2,
      lodgings: 1,
      bookings: 0,
      wishlist: 1,
      expenses: 2,
      photos: null,
      members: [
        { id: 1, name: 'Gene', role: 'owner' },
        { id: 2, name: 'Mia', role: 'editor' },
      ],
    })
    expect(result.file.trip.name).toBe('NZ South')
  })

  it('names the problem with anything else', () => {
    expect(parseImportFile('{ nope')).toEqual({ ok: false, problem: 'json' })
    expect(parseImportFile('[]')).toEqual({ ok: false, problem: 'format' })
    expect(parseImportFile(JSON.stringify({ ...file, format: 'other' }))).toEqual({
      ok: false,
      problem: 'format',
    })
    expect(parseImportFile(JSON.stringify({ ...file, version: 2 }))).toEqual({
      ok: false,
      problem: 'version',
    })
    expect(parseImportFile(JSON.stringify({ ...file, trip: { name: 'x' } }))).toEqual({
      ok: false,
      problem: 'format',
    })
    expect(parseImportFile('{}', 6 * 1024 * 1024)).toEqual({ ok: false, problem: 'tooLarge' })
  })
})

describe('dates', () => {
  it('moves the end date with a new start date, keeping the length', () => {
    expect(shiftedEndDate('2026-12-20', '2026-12-23', '2027-02-27')).toBe('2027-03-02')
    expect(shiftedEndDate('2026-12-20', '2026-12-23', '2026-12-10')).toBe('2026-12-13')
    expect(shiftedEndDate('2026-12-20', '2026-12-23', '')).toBe('2026-12-23')
  })

  it('counts the whole days left before the purge', () => {
    const now = Date.parse('2026-11-10T12:00:00Z')
    expect(daysUntilPurge('2026-12-10T12:00:00Z', now)).toBe(30)
    expect(daysUntilPurge('2026-11-11T00:00:00Z', now)).toBe(1)
    expect(daysUntilPurge('2026-11-10T11:00:00Z', now)).toBe(0)
  })
})

describe('tokensForDeleted', () => {
  it('sends retired tokens first, then the active ones, without duplicates', () => {
    expect(
      tokensForDeleted({ t1: 'a', t2: 'b' }, { t3: 'c', t2: 'b' }).map((entry) => entry.token),
    ).toEqual(['b', 'c', 'a'])
  })
})
