import { deflateSync } from 'node:zlib'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// e6-t02 / e6-t05 walk-through against a real Worker, local D1 and local R2: pick two PNGs → the
// browser resizes them (one is 3000 px wide, so it must come back 2048) and uploads them through
// the real pipeline → the grid shows both → set one as the cover → the trip home shows it → delete
// the other → the storage meter updates. Phone (375) and desktop (1440). Run with `npm run dev` and
// `wrangler d1 migrations apply tripfolio --local`, or BASE_URL.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

// --- A tiny PNG encoder (RGB, filter 0) so the test needs no fixture files ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function png(width: number, height: number, seed: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) {
      const at = row + 1 + x * 3
      raw[at] = (x * 255) / width
      raw[at + 1] = (y * 255) / height
      raw[at + 2] = (seed * 97 + ((x ^ y) & 63)) & 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- API helpers ---

async function createTrip(request: APIRequestContext, name: string) {
  const response = await request.post('/api/trips', {
    data: {
      name,
      destination: 'Bali',
      startDate: inDays(20),
      endDate: inDays(25),
      tz: 'Asia/Makassar',
      coverColor: '#B5654A',
      style: 'private-driver',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { trip: { id: string }; memberToken: string }
}

interface ListedPhoto {
  id: string
  mime: string
  width: number
  height: number
  thumbUrl: string | null
}

async function listPhotos(request: APIRequestContext, tripId: string, token: string) {
  const response = await request.get(`/api/trips/${tripId}/attachments?kind=photo`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(response.ok()).toBe(true)
  return ((await response.json()) as { attachments: ListedPhoto[] }).attachments
}

/** Every <img> under `scope` has decoded pixels */
async function imagesLoaded(page: Page, selector: string) {
  return page.$$eval(selector, (images) =>
    images.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
  )
}

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`${viewport.name}: upload two photos, set a cover, delete one`, async ({ page, request }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const name = `相簿測試 ${viewport.name}`
    const { trip, memberToken } = await createTrip(request, name)
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [trip.id, memberToken],
    )

    await page.goto(`/trips/${trip.id}/photos`)
    await expect(page.getByRole('heading', { level: 1, name: '照片' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '還沒有照片' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: '使用照片位置' })).toBeChecked()
    await expect(page.getByText(/^已用 0 byte／1\.5 GB$/)).toBeVisible()
    await shot(page, `${viewport.name}-photos-empty`)

    await page.getByTestId('photo-input').setInputFiles([
      { name: 'wide.png', mimeType: 'image/png', buffer: png(3000, 1500, 1) },
      { name: 'small.png', mimeType: 'image/png', buffer: png(200, 300, 2) },
    ])
    await expect(page.getByText('2／2 張完成 · 100%')).toBeVisible({ timeout: 45_000 })
    const tiles = page.getByRole('button', { name: /^查看照片 \d+$/ })
    await expect(tiles).toHaveCount(2)
    await expect.poll(() => imagesLoaded(page, '[data-testid="photo-grid"] img')).toBe(true)
    await expect(page.locator('[data-testid="photo-grid"] img')).toHaveCount(2)
    await shot(page, `${viewport.name}-photos-uploaded`)

    // The browser resized and re-encoded them: WebP, the long edge capped at 2048, a thumbnail each
    const photos = await listPhotos(request, trip.id, memberToken)
    const sizes = photos.map((p) => `${p.width}x${p.height}`).sort()
    expect(sizes).toEqual(['200x300', '2048x1024'])
    for (const photo of photos) {
      expect(photo.mime).toBe('image/webp')
      expect(photo.thumbUrl).not.toBeNull()
    }
    const usageBefore = await page.getByText(/^已用 .+／1\.5 GB$/).textContent()
    expect(usageBefore).not.toContain('0 byte')

    // Open the first photo, step to the second and back, set the first as the cover
    await tiles.first().click()
    const viewer = page.getByRole('dialog', { name: '第 1／2 張' })
    await expect(viewer).toBeVisible()
    await expect.poll(() => imagesLoaded(page, 'dialog[open] img')).toBe(true)
    await viewer.getByRole('button', { name: '下一張' }).click()
    await expect(page.getByRole('dialog', { name: '第 2／2 張' })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('dialog', { name: '第 1／2 張' })).toBeVisible()
    await shot(page, `${viewport.name}-photos-viewer`)
    await page.getByRole('button', { name: '設為旅程封面' }).click()
    await expect(page.getByText('已設為旅程封面')).toBeVisible()
    await expect(page.getByRole('button', { name: '取消封面' })).toBeVisible()
    await page.getByRole('dialog', { name: '第 1／2 張' }).getByRole('button', { name: '關閉' }).click()
    await expect(tiles.first().getByText('封面')).toBeVisible()
    const tripResponse = await request.get(`/api/trips/${trip.id}`, {
      headers: { authorization: `Bearer ${memberToken}` },
    })
    const cover = ((await tripResponse.json()) as { trip: { coverAttachmentId: string | null } })
      .trip.coverAttachmentId
    expect(photos.map((p) => p.id)).toContain(cover)

    // The trip home shows the cover photo in the hero, and the link back says 照片
    await page.goto(`/trips/${trip.id}`)
    const heroImage = page.getByRole('img', { name: `${name} 的封面照片` })
    await expect(heroImage).toBeVisible()
    await expect.poll(() => heroImage.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    await expect(page.getByRole('link', { name: '照片', exact: true })).toBeVisible()
    if (viewport.width === 375)
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375)
    await shot(page, `${viewport.name}-home-cover`)

    // Delete the other photo: the grid and the storage meter follow
    await page.getByRole('link', { name: '照片', exact: true }).click()
    await expect(tiles).toHaveCount(2)
    await expect(page.getByText(usageBefore ?? '')).toBeVisible()
    await tiles.nth(1).click()
    await expect(page.getByRole('dialog', { name: '第 2／2 張' })).toBeVisible()
    await page.getByRole('dialog', { name: '第 2／2 張' }).getByRole('button', { name: '刪除' }).click()
    const confirm = page.getByRole('dialog', { name: '刪除這張照片？' })
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: '刪除' }).click()
    await expect(page.getByText('已刪除照片')).toBeVisible()
    await expect(page.getByRole('dialog', { name: '第 1／1 張' })).toBeVisible()
    await page.getByRole('dialog', { name: '第 1／1 張' }).getByRole('button', { name: '關閉' }).click()
    await expect(tiles).toHaveCount(1)
    await expect(page.getByText(/^已用 .+／1\.5 GB$/)).not.toHaveText(usageBefore ?? '')
    const usage = await request.get(`/api/trips/${trip.id}/attachments/usage`, {
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(((await usage.json()) as { count: number }).count).toBe(1)
    if (viewport.width === 375)
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375)
    await shot(page, `${viewport.name}-photos-after-delete`)
  })
}

// --- e6-t03 / e6-t04: auto-matching, day albums, the lightbox, the stop card's photos ---

/** An APP1 "Exif" segment: DateTimeOriginal (wall clock, no offset) and GPS, big-endian */
function exifSegment(dateTime: string, lat: number, lng: number): Buffer {
  const u16 = (n: number) => [n >> 8, n & 0xff]
  const u32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0)
  const dms = (value: number) => {
    const abs = Math.abs(value)
    const deg = Math.floor(abs)
    const min = Math.floor((abs - deg) * 60)
    const sec = Math.round(((abs - deg) * 60 - min) * 60 * 10000)
    return [...u32(deg), ...u32(1), ...u32(min), ...u32(1), ...u32(sec), ...u32(10000)]
  }
  type Entry = { tag: number; type: number; count: number; data: number[] }
  const sizes: Record<number, number> = { 2: 1, 3: 2, 4: 4, 5: 8 }
  const ifd = (entries: Entry[], at: number) => {
    let dataAt = at + 2 + entries.length * 12 + 4
    const head = [...u16(entries.length)]
    const tail: number[] = []
    for (const e of entries) {
      head.push(...u16(e.tag), ...u16(e.type), ...u32(e.count))
      if (sizes[e.type] * e.count <= 4) head.push(...e.data, ...new Array(4 - e.data.length).fill(0))
      else {
        head.push(...u32(dataAt))
        tail.push(...e.data)
        dataAt += e.data.length
      }
    }
    return [...head, ...u32(0), ...tail]
  }
  const exifAt = 8 + 2 + 2 * 12 + 4
  const exif = ifd([{ tag: 0x9003, type: 2, count: dateTime.length + 1, data: ascii(dateTime) }], exifAt)
  const gpsAt = exifAt + exif.length
  const gps = ifd(
    [
      { tag: 0x0001, type: 2, count: 2, data: ascii(lat < 0 ? 'S' : 'N') },
      { tag: 0x0002, type: 5, count: 3, data: dms(lat) },
      { tag: 0x0003, type: 2, count: 2, data: ascii(lng < 0 ? 'W' : 'E') },
      { tag: 0x0004, type: 5, count: 3, data: dms(lng) },
    ],
    gpsAt,
  )
  const tiff = [
    0x4d,
    0x4d,
    ...u16(42),
    ...u32(8),
    ...ifd(
      [
        { tag: 0x8769, type: 4, count: 1, data: u32(exifAt) },
        { tag: 0x8825, type: 4, count: 1, data: u32(gpsAt) },
      ],
      8,
    ),
    ...exif,
    ...gps,
  ]
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const length = payload.length + 2
  return Buffer.from([0xff, 0xe1, length >> 8, length & 0xff, ...payload])
}

/** A real JPEG from the browser's canvas with the EXIF segment spliced in after SOI */
async function jpegWithExif(page: Page, dateTime: string, lat: number, lng: number) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createLinearGradient(0, 0, 640, 480)
    gradient.addColorStop(0, '#0f6e74')
    gradient.addColorStop(1, '#b88a1e')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 640, 480)
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
  })
  const jpeg = Buffer.from(base64, 'base64')
  return Buffer.concat([jpeg.subarray(0, 2), exifSegment(dateTime, lat, lng), jpeg.subarray(2)])
}

const TANAH_LOT = { lat: -8.6212, lng: 115.0868 }

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`${viewport.name}: auto-match to a stop, day albums, lightbox, move to Day 2`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const response = await request.post('/api/trips', {
      data: {
        name: `配對測試 ${viewport.name}`,
        destination: 'Bali',
        startDate: inDays(20),
        endDate: inDays(21),
        tz: 'Asia/Makassar',
        coverColor: '#B5654A',
        style: 'private-driver',
        owner: { name: 'Gene', color: '#0F6E74' },
      },
    })
    expect(response.status()).toBe(201)
    const { trip, memberToken } = (await response.json()) as {
      trip: { id: string }
      memberToken: string
    }
    const headers = { authorization: `Bearer ${memberToken}` }
    const days = (
      (await (await request.get(`/api/trips/${trip.id}/days`, { headers })).json()) as {
        days: { id: string; date: string; idx: number | null }[]
      }
    ).days
    expect(days.map((d) => d.idx)).toEqual([1, 2])
    const placeResponse = await request.post(`/api/trips/${trip.id}/places`, {
      headers,
      data: { nameLocal: 'Tanah Lot', ...TANAH_LOT, category: 'sight', source: 'manual' },
    })
    expect(placeResponse.status()).toBe(201)
    const placeId = ((await placeResponse.json()) as { place: { id: string } }).place.id
    const stopResponse = await request.post(`/api/trips/${trip.id}/stops`, {
      headers,
      data: { dayId: days[0].id, title: 'Tanah Lot', placeId },
    })
    expect(stopResponse.status()).toBe(201)
    const stopId = ((await stopResponse.json()) as { stop: { id: string } }).stop.id

    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [trip.id, memberToken],
    )
    await page.goto(`/trips/${trip.id}/photos`)
    await expect(page.getByRole('heading', { name: '還沒有照片' })).toBeVisible()

    // A JPEG taken on Day 1, about 60 m from Tanah Lot, and a PNG with no EXIF at all
    const day1 = days[0].date.replaceAll('-', ':')
    const jpeg = await jpegWithExif(page, `${day1} 17:45:00`, TANAH_LOT.lat + 0.0005, TANAH_LOT.lng + 0.0002)
    await page.getByTestId('photo-input').setInputFiles([
      { name: 'sunset.jpg', mimeType: 'image/jpeg', buffer: jpeg },
      { name: 'plain.png', mimeType: 'image/png', buffer: png(300, 200, 3) },
    ])
    await expect(page.getByText('2／2 張完成 · 100%')).toBeVisible({ timeout: 45_000 })
    // Filed automatically after the batch: the JPEG on the stop, the PNG left alone
    await expect(page.getByText('已整理 1 張照片')).toBeVisible({ timeout: 10_000 })
    const listed = (
      (await (await request.get(`/api/trips/${trip.id}/attachments?kind=photo`, { headers })).json()) as {
        attachments: { id: string; takenAt: string | null; lat: number | null; stopId: string | null; dayId: string | null }[]
      }
    ).attachments
    const sunset = listed.find((a) => a.takenAt !== null)!
    expect(sunset.lat).not.toBeNull()
    expect(sunset).toMatchObject({ stopId, dayId: days[0].id })
    expect(listed.find((a) => a.takenAt === null)).toMatchObject({ stopId: null, dayId: null })

    // By day: Day 1 holds it, the PNG waits under 「還沒分到哪一天」
    await page.getByRole('tab', { name: '依日' }).click()
    await expect(page.getByTestId('album-day-1').getByRole('button', { name: /^查看照片/ })).toHaveCount(1)
    await expect(page.getByTestId('album-day-2')).toHaveCount(0)
    await expect(page.getByTestId('album-unassigned').getByRole('heading', { name: /還沒分到哪一天/ })).toBeVisible()
    await expect(page.getByRole('button', { name: '自動整理' })).toBeVisible()
    if (viewport.width === 375) await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375)
    await shot(page, `${viewport.name}-albums-by-day`)

    // The stop card shows the photo
    await page.goto(`/trips/${trip.id}/itinerary`)
    const card = page.locator(`[data-stop-id="${stopId}"]`)
    await expect(card.getByTestId('stop-photos')).toBeVisible()
    await expect(card.getByRole('img', { name: '這個行程點有 1 張照片' })).toBeVisible()
    await shot(page, `${viewport.name}-stop-photos`)

    // All photos: open the first, arrow keys step, the info panel says where it is filed
    await page.goto(`/trips/${trip.id}/photos`)
    const tiles = page.getByTestId('photo-grid').getByRole('button', { name: /^查看照片 \d+$/ })
    await expect(tiles).toHaveCount(2)
    await tiles.first().click()
    const lightbox = page.getByTestId('lightbox')
    await expect(page.getByRole('dialog', { name: '第 1／2 張' })).toBeVisible()
    await expect(lightbox.getByTestId('photo-filed')).toHaveText('還沒分到哪一天')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('dialog', { name: '第 2／2 張' })).toBeVisible()
    await expect(lightbox.locator('[aria-live="polite"]')).toHaveText('第 2／2 張')
    await expect(lightbox.getByTestId('photo-filed')).toHaveText('Day 1 · Tanah Lot')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('dialog', { name: '第 1／2 張' })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('dialog', { name: '第 2／2 張' })).toBeVisible()
    await expect.poll(() => imagesLoaded(page, 'dialog[open] img')).toBe(true)
    await shot(page, `${viewport.name}-lightbox`)

    // Move it to Day 2 (no stop)
    await lightbox.getByRole('button', { name: '搬到…' }).click()
    await lightbox.getByLabel('哪一天').selectOption({ index: 2 })
    await lightbox.getByRole('button', { name: '搬過去' }).click()
    await expect(page.getByText(/^已搬到 Day 2/)).toBeVisible()
    await expect(lightbox.getByTestId('photo-filed')).toHaveText(/^Day 2 · /)
    await page.keyboard.press('Escape')
    await expect(lightbox).not.toBeVisible()
    await page.getByRole('tab', { name: '依日' }).click()
    await expect(page.getByTestId('album-day-2').getByRole('button', { name: /^查看照片/ })).toHaveCount(1)
    await expect(page.getByTestId('album-day-1')).toHaveCount(0)
    const moved = (
      (await (await request.get(`/api/trips/${trip.id}/attachments?kind=photo&dayId=${days[1].id}`, { headers })).json()) as {
        attachments: { id: string; stopId: string | null }[]
      }
    ).attachments
    expect(moved).toEqual([expect.objectContaining({ id: sunset.id, stopId: null })])
    await shot(page, `${viewport.name}-albums-moved`)

    // The stop card no longer has it
    await page.goto(`/trips/${trip.id}/itinerary`)
    await expect(page.locator(`[data-stop-id="${stopId}"]`)).toBeVisible()
    await expect(page.locator(`[data-stop-id="${stopId}"]`).getByTestId('stop-photos')).toHaveCount(0)
  })
}
