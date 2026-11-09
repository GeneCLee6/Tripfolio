import { describe, expect, it } from 'vitest'
import { createLimiter } from '../../../src/lib/upload/limiter.ts'
import { uploadQueue } from '../../../src/lib/upload/upload.ts'

// Three uploads at most across every batch and retry of one uploader (e6-t02)

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createLimiter', () => {
  it('caps two overlapping uploadQueue batches at three in flight', async () => {
    const limiter = createLimiter(3)
    let running = 0
    let peak = 0
    const task = () =>
      limiter.run(async () => {
        running++
        peak = Math.max(peak, running)
        await tick()
        running--
      })
    await Promise.all([
      uploadQueue([1, 2, 3, 4], task, { concurrency: 3 }),
      uploadQueue([5, 6, 7], task, { concurrency: 3 }),
    ])
    expect(peak).toBe(3)
    expect(limiter.active).toBe(0)
    expect(limiter.waiting).toBe(0)
  })

  it('frees the slot when a task fails', async () => {
    const limiter = createLimiter(1)
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(await limiter.run(async () => 'next')).toBe('next')
    expect(limiter.active).toBe(0)
  })

  it('hands a freed slot to the waiter, not to a newcomer', async () => {
    const limiter = createLimiter(1)
    const order: string[] = []
    let release: () => void = () => {}
    const first = limiter.run(() => new Promise<void>((resolve) => (release = resolve)))
    const second = limiter.run(async () => {
      order.push('waiter')
    })
    await tick()
    release()
    const third = limiter.run(async () => {
      order.push('newcomer')
    })
    await Promise.all([first, second, third])
    expect(order).toEqual(['waiter', 'newcomer'])
  })
})
