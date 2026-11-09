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
    await expect(page.getByText(/^已用 0 byte \/ 1\.5 GB$/)).toBeVisible()
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
    const usageBefore = await page.getByText(/^已用 .+ \/ 1\.5 GB$/).textContent()
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
    await page.getByRole('button', { name: '設為封面' }).click()
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
    await expect(page.getByText(/^已用 .+ \/ 1\.5 GB$/)).not.toHaveText(usageBefore ?? '')
    const usage = await request.get(`/api/trips/${trip.id}/attachments/usage`, {
      headers: { authorization: `Bearer ${memberToken}` },
    })
    expect(((await usage.json()) as { count: number }).count).toBe(1)
    if (viewport.width === 375)
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375)
    await shot(page, `${viewport.name}-photos-after-delete`)
  })
}
