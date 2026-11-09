import { describe, expect, it } from 'vitest'
import { readExif, toTakenAt } from '../../../src/lib/upload/exif.ts'
import { fitWithin } from '../../../src/lib/upload/resize.ts'

// A hand-built JPEG: SOI, APP1 "Exif" with a TIFF header, IFD0 (Orientation, ExifIFD and GPS
// pointers), Exif IFD (DateTimeOriginal, OffsetTimeOriginal) and GPS IFD; then SOS and EOI.

type Entry = { tag: number; type: number; count: number; data: number[] }

function buildJpeg({
  little,
  date = '2026:12:20 14:33:05',
  offset = '+09:00' as string | null,
  lat = [35, 40, 48.6] as number[] | null,
  latRef = 'N',
  lng = [139, 45, 36] as number[] | null,
  lngRef = 'E',
  leadingApp0 = true,
}: {
  little: boolean
  date?: string
  offset?: string | null
  lat?: number[] | null
  latRef?: string
  lng?: number[] | null
  lngRef?: string
  leadingApp0?: boolean
}): ArrayBuffer {
  const u16 = (n: number) => (little ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff])
  const u32 = (n: number) =>
    little
      ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]
      : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0)
  const rationals = (values: number[]) =>
    values.flatMap((v) => {
      const den = 100
      return [...u32(Math.round(v * den)), ...u32(den)]
    })

  // Lay out IFDs: each IFD is 2 + 12n + 4 bytes, then its out-of-line data
  const tiff: number[] = []
  const ifd = (entries: Entry[], at: number): number[] => {
    const sizes: Record<number, number> = { 2: 1, 3: 2, 4: 4, 5: 8 }
    let dataAt = at + 2 + entries.length * 12 + 4
    const head: number[] = [...u16(entries.length)]
    const tail: number[] = []
    for (const e of entries) {
      head.push(...u16(e.tag), ...u16(e.type), ...u32(e.count))
      const size = sizes[e.type] * e.count
      if (size <= 4) head.push(...e.data, ...new Array(4 - e.data.length).fill(0))
      else {
        head.push(...u32(dataAt))
        tail.push(...e.data)
        dataAt += e.data.length
      }
    }
    return [...head, ...u32(0), ...tail]
  }
  const header = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8)]
  tiff.push(...header)
  const ifd0At = 8
  const ifd0Size = 2 + 3 * 12 + 4
  const exifAt = ifd0At + ifd0Size
  const exifEntries: Entry[] = [{ tag: 0x9003, type: 2, count: date.length + 1, data: ascii(date) }]
  if (offset)
    exifEntries.push({ tag: 0x9011, type: 2, count: offset.length + 1, data: ascii(offset) })
  const exifBytes = ifd(exifEntries, exifAt)
  const gpsAt = exifAt + exifBytes.length
  const gpsEntries: Entry[] = []
  if (lat) {
    gpsEntries.push({ tag: 0x0001, type: 2, count: 2, data: ascii(latRef) })
    gpsEntries.push({ tag: 0x0002, type: 5, count: 3, data: rationals(lat) })
  }
  if (lng) {
    gpsEntries.push({ tag: 0x0003, type: 2, count: 2, data: ascii(lngRef) })
    gpsEntries.push({ tag: 0x0004, type: 5, count: 3, data: rationals(lng) })
  }
  const gpsBytes = ifd(gpsEntries, gpsAt)
  tiff.push(
    ...ifd(
      [
        { tag: 0x0112, type: 3, count: 1, data: u16(6) },
        { tag: 0x8769, type: 4, count: 1, data: u32(exifAt) },
        { tag: 0x8825, type: 4, count: 1, data: u32(gpsAt) },
      ],
      ifd0At,
    ),
    ...exifBytes,
    ...gpsBytes,
  )
  const app1Payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const app1Length = app1Payload.length + 2
  const app0 = leadingApp0 ? [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00] : []
  const bytes = [
    0xff,
    0xd8,
    ...app0,
    0xff,
    0xe1,
    app1Length >> 8,
    app1Length & 0xff,
    ...app1Payload,
    0xff,
    0xda,
    0x00,
    0x02,
    0x12,
    0x34,
    0xff,
    0xd9,
  ]
  return new Uint8Array(bytes).buffer
}

describe('readExif', () => {
  it('reads time, offset, GPS and orientation (big-endian)', () => {
    expect(readExif(buildJpeg({ little: false }))).toEqual({
      takenAtLocal: '2026-12-20T14:33:05',
      offset: '+09:00',
      takenAt: '2026-12-20T05:33:05Z',
      lat: 35.6801667,
      lng: 139.76,
      orientation: 6,
    })
  })

  it('reads little-endian, southern/western refs, and no offset', () => {
    const info = readExif(
      buildJpeg({
        little: true,
        offset: null,
        latRef: 'S',
        lngRef: 'W',
        lat: [33, 52, 4],
        lng: [151, 12, 36],
        leadingApp0: false,
      }),
    )
    expect(info).toMatchObject({
      takenAtLocal: '2026-12-20T14:33:05',
      offset: null,
      takenAt: '2026-12-20T14:33:05',
      lat: -33.8677778,
      lng: -151.21,
    })
  })

  it('gives nulls without GPS, for non-JPEGs and for truncated files', () => {
    expect(readExif(buildJpeg({ little: true, lat: null, lng: null }))).toMatchObject({
      lat: null,
      lng: null,
    })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
    expect(readExif(png)).toEqual({
      takenAtLocal: null,
      offset: null,
      takenAt: null,
      lat: null,
      lng: null,
      orientation: null,
    })
    const full = new Uint8Array(buildJpeg({ little: false }))
    expect(readExif(full.slice(0, 60).buffer).lat).toBeNull()
    expect(readExif(new ArrayBuffer(0)).takenAt).toBeNull()
  })

  it('ignores 0,0 positions and zero dates', () => {
    expect(readExif(buildJpeg({ little: false, lat: [0, 0, 0], lng: [0, 0, 0] })).lat).toBeNull()
    expect(readExif(buildJpeg({ little: false, date: '0000:00:00 00:00:00' })).takenAt).toBeNull()
  })
})

describe('helpers', () => {
  it('toTakenAt converts to UTC only with an offset', () => {
    expect(toTakenAt('2026-12-31T23:30:00', '-05:00')).toBe('2027-01-01T04:30:00Z')
    expect(toTakenAt('2026-12-31T23:30:00', null)).toBe('2026-12-31T23:30:00')
    expect(toTakenAt(null, '+09:00')).toBeNull()
  })

  it('fitWithin keeps the ratio and never upscales', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3024, 4032, 400)).toEqual({ width: 300, height: 400 })
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 })
  })
})
