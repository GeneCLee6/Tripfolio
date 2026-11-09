import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../src/lib/api.ts'
import {
  describeUploadError,
  isHeic,
  overallProgress,
  type UploadItem,
} from '../../../src/lib/upload/queue-items.ts'
import { formatBytes, usageRatio, usageTone } from '../../../src/lib/upload/storage.ts'
import { UploadRejected } from '../../../src/lib/upload/upload.ts'

// The uploader's row logic (e6-t02) and the storage meter's numbers (e6-t05)

const jpeg = { name: 'a.jpg', type: 'image/jpeg' }
const heic = { name: 'IMG_0001.HEIC', type: '' }

const item = (status: UploadItem['status'], loaded = 0, total = 0): UploadItem => ({
  id: status,
  name: `${status}.jpg`,
  previewUrl: null,
  status,
  loaded,
  total,
  error: null,
})

describe('describeUploadError', () => {
  it('explains rejections without offering a retry', () => {
    expect(describeUploadError(new UploadRejected('too_large', 'x'), jpeg)).toEqual({
      key: 'photos.upload.error.tooLarge',
      retryable: false,
    })
    const pdf = { name: 'a.pdf', type: 'application/pdf' }
    expect(describeUploadError(new UploadRejected('unsupported_type', 'x'), pdf).key).toBe(
      'photos.upload.error.unsupported',
    )
    expect(describeUploadError(new ApiError(413, 'too_large', 'x'), jpeg).key).toBe(
      'photos.upload.error.tooLarge',
    )
  })

  it('turns a decode failure of a HEIC file into the conversion hint', () => {
    expect(isHeic(heic)).toBe(true)
    expect(isHeic({ name: 'x.jpg', type: 'image/heif' })).toBe(true)
    expect(isHeic(jpeg)).toBe(false)
    expect(describeUploadError(new DOMException('bad', 'InvalidStateError'), heic)).toEqual({
      key: 'photos.upload.error.heic',
      retryable: false,
    })
    expect(describeUploadError(new Error('image encoding failed'), jpeg)).toEqual({
      key: 'photos.upload.error.decode',
      retryable: true,
    })
  })

  it('offers a retry for network and server errors but not for 403', () => {
    expect(describeUploadError(new ApiError(0, 'network', 'x'), jpeg)).toEqual({
      key: 'error.network',
      code: 'network',
      retryable: true,
    })
    expect(describeUploadError(new ApiError(503, 'unavailable', 'x'), jpeg).retryable).toBe(true)
    expect(describeUploadError(new ApiError(403, 'forbidden', 'x'), jpeg)).toMatchObject({
      key: 'error.forbidden',
      retryable: false,
    })
  })
})

describe('overallProgress', () => {
  it('averages the files still counted', () => {
    expect(overallProgress([])).toEqual({ done: 0, total: 0, percent: 0 })
    expect(
      overallProgress([
        item('done'),
        item('uploading', 50, 100),
        item('queued'),
        item('failed'),
        item('cancelled'),
      ]),
    ).toEqual({ done: 1, total: 3, percent: 50 })
  })
})

describe('storage numbers', () => {
  const warn = 1.5 * 1024 ** 3
  it('warns from 80 % and turns red once over', () => {
    expect(usageTone(0, warn)).toBe('ok')
    expect(usageTone(warn * 0.79, warn)).toBe('ok')
    expect(usageTone(warn * 0.8, warn)).toBe('warning')
    expect(usageTone(warn, warn)).toBe('warning')
    expect(usageTone(warn + 1, warn)).toBe('danger')
    expect(usageRatio(warn / 2, warn)).toBe(0.5)
    expect(usageRatio(5, 0)).toBe(0)
  })

  it('formats bytes in binary steps with Intl', () => {
    expect(formatBytes(warn, 'en')).toBe('1.5 GB')
    expect(formatBytes(2048, 'en')).toBe('2 kB')
    expect(formatBytes(312 * 1024 ** 2, 'en')).toBe('312 MB')
    expect(formatBytes(3.25 * 1024 ** 2, 'zh-TW')).toMatch(/^3\.3 ?MB$/)
  })
})
