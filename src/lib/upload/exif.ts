// A minimal JPEG EXIF reader (e6-t01, ARCHITECTURE.md §4.4): only what photo matching needs, the
// capture time and GPS position, read before the browser re-encodes the image (which drops every
// EXIF field). APP1 "Exif" → TIFF header → IFD0 → Exif IFD (DateTimeOriginal, OffsetTimeOriginal)
// and GPS IFD (latitude/longitude with their N/S/E/W refs). Anything else (PNG, HEIC, WebP, broken
// files) gives nulls rather than an error.

export interface ExifInfo {
  /** `YYYY-MM-DDTHH:MM:SS` wall-clock time as the camera recorded it */
  takenAtLocal: string | null
  /** `+HH:MM` / `-HH:MM` when the camera recorded one (OffsetTimeOriginal) */
  offset: string | null
  /** UTC ISO (…Z) when the offset is known, else the wall-clock value; what the API takes */
  takenAt: string | null
  lat: number | null
  lng: number | null
  /** EXIF orientation 1–8 (createImageBitmap applies it by itself) */
  orientation: number | null
}

const EMPTY: ExifInfo = {
  takenAtLocal: null,
  offset: null,
  takenAt: null,
  lat: null,
  lng: null,
  orientation: null,
}

const TAG = {
  orientation: 0x0112,
  dateTime: 0x0132,
  exifIfd: 0x8769,
  gpsIfd: 0x8825,
  dateTimeOriginal: 0x9003,
  offsetTimeOriginal: 0x9011,
  gpsLatRef: 0x0001,
  gpsLat: 0x0002,
  gpsLngRef: 0x0003,
  gpsLng: 0x0004,
} as const

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

type Value = string | number[] | null

class Tiff {
  readonly view: DataView
  readonly start: number
  readonly little: boolean

  constructor(view: DataView, start: number, little: boolean) {
    this.view = view
    this.start = start
    this.little = little
  }

  u16 = (at: number) => this.view.getUint16(this.start + at, this.little)
  u32 = (at: number) => this.view.getUint32(this.start + at, this.little)

  /** tag → value for one IFD at `offset` (relative to the TIFF header) */
  readIfd(offset: number): Map<number, Value> {
    const entries = new Map<number, Value>()
    const count = this.u16(offset)
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12
      entries.set(this.u16(entry), this.readValue(entry))
    }
    return entries
  }

  private readValue(entry: number): Value {
    const type = this.u16(entry + 2)
    const count = this.u32(entry + 4)
    const size = TYPE_SIZE[type]
    if (!size || count > 1024) return null
    const at = size * count <= 4 ? entry + 8 : this.u32(entry + 8)
    if (this.start + at + size * count > this.view.byteLength) return null
    if (type === 2) {
      let text = ''
      for (let i = 0; i < count; i++) {
        const code = this.view.getUint8(this.start + at + i)
        if (code === 0) break
        text += String.fromCharCode(code)
      }
      return text
    }
    const values: number[] = []
    for (let i = 0; i < count; i++) {
      const p = at + i * size
      if (type === 1 || type === 7) values.push(this.view.getUint8(this.start + p))
      else if (type === 3) values.push(this.u16(p))
      else if (type === 4) values.push(this.u32(p))
      else if (type === 9) values.push(this.view.getInt32(this.start + p, this.little))
      else if (type === 5) values.push(ratio(this.u32(p), this.u32(p + 4)))
      else
        values.push(
          ratio(
            this.view.getInt32(this.start + p, this.little),
            this.view.getInt32(this.start + p + 4, this.little),
          ),
        )
    }
    return values
  }
}

const ratio = (n: number, d: number) => (d === 0 ? Number.NaN : n / d)

/** Offset of the TIFF header inside the APP1 Exif segment, or -1 */
function findExif(view: DataView): number {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return -1
  let at = 2
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) return -1
    const marker = view.getUint8(at + 1)
    // Start of scan / end of image: no more metadata segments
    if (marker === 0xda || marker === 0xd9) return -1
    const length = view.getUint16(at + 2)
    if (
      marker === 0xe1 &&
      at + 10 <= view.byteLength &&
      view.getUint32(at + 4) === 0x45786966 && // "Exif"
      view.getUint16(at + 8) === 0
    )
      return at + 10
    at += 2 + length
  }
  return -1
}

function dms(values: Value, ref: Value, negative: string): number | null {
  if (!Array.isArray(values) || values.length < 3) return null
  const [d, m, s] = values
  const deg = d + m / 60 + s / 3600
  if (!Number.isFinite(deg)) return null
  const signed = typeof ref === 'string' && ref.trim().toUpperCase() === negative ? -deg : deg
  return Math.round(signed * 1e7) / 1e7
}

/** "2026:12:20 14:33:05" → "2026-12-20T14:33:05" */
function exifDate(value: Value): string | null {
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m || m[1] === '0000') return null
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
}

function exifOffset(value: Value): string | null {
  return typeof value === 'string' && /^[+-]\d{2}:\d{2}$/.test(value.trim()) ? value.trim() : null
}

/** Wall-clock + offset → UTC ISO (…Z); wall-clock alone stays as it is */
export function toTakenAt(local: string | null, offset: string | null): string | null {
  if (!local) return null
  if (!offset) return local
  const ms = Date.parse(`${local}${offset}`)
  return Number.isNaN(ms) ? local : new Date(ms).toISOString().replace('.000Z', 'Z')
}

/** Reads DateTimeOriginal and GPS from a JPEG's bytes; nulls for anything it cannot read */
export function readExif(buffer: ArrayBuffer): ExifInfo {
  try {
    const view = new DataView(buffer)
    const start = findExif(view)
    if (start < 0 || start + 8 > view.byteLength) return { ...EMPTY }
    const order = view.getUint16(start)
    if (order !== 0x4949 && order !== 0x4d4d) return { ...EMPTY }
    const tiff = new Tiff(view, start, order === 0x4949)
    if (tiff.u16(2) !== 42) return { ...EMPTY }
    const ifd0 = tiff.readIfd(tiff.u32(4))
    const pointer = (tag: number) => {
      const v = ifd0.get(tag)
      return Array.isArray(v) && v.length > 0 ? v[0] : null
    }
    const exifAt = pointer(TAG.exifIfd)
    const gpsAt = pointer(TAG.gpsIfd)
    const exif = exifAt ? tiff.readIfd(exifAt) : new Map<number, Value>()
    const gps = gpsAt ? tiff.readIfd(gpsAt) : new Map<number, Value>()
    const takenAtLocal =
      exifDate(exif.get(TAG.dateTimeOriginal) ?? null) ?? exifDate(ifd0.get(TAG.dateTime) ?? null)
    const offset = exifOffset(exif.get(TAG.offsetTimeOriginal) ?? null)
    const lat = dms(gps.get(TAG.gpsLat) ?? null, gps.get(TAG.gpsLatRef) ?? null, 'S')
    const lng = dms(gps.get(TAG.gpsLng) ?? null, gps.get(TAG.gpsLngRef) ?? null, 'W')
    const valid =
      lat !== null &&
      lng !== null &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(lat === 0 && lng === 0)
    const orientation = pointer(TAG.orientation)
    return {
      takenAtLocal,
      offset,
      takenAt: toTakenAt(takenAtLocal, offset),
      lat: valid ? lat : null,
      lng: valid ? lng : null,
      orientation: orientation && orientation >= 1 && orientation <= 8 ? orientation : null,
    }
  } catch {
    // Truncated or malformed: out-of-range reads throw RangeError
    return { ...EMPTY }
  }
}
