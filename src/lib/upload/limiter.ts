// A concurrency gate shared across uploadQueue calls (e6-t02): uploadQueue caps one batch at three,
// but a person can drop a second batch (or press retry) while the first is still running. Every
// upload task runs inside the uploader's one limiter, so at most three files are in flight in total.

export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>
  /** Tasks running now */
  readonly active: number
  /** Tasks waiting for a slot */
  readonly waiting: number
}

export function createLimiter(max: number): Limiter {
  const limit = Math.max(1, max)
  let active = 0
  const queue: (() => void)[] = []
  // A finishing task hands its slot straight to the next waiter, so a run() that starts in between
  // cannot slip past the limit
  const release = () => {
    const next = queue.shift()
    if (next) next()
    else active--
  }
  return {
    get active() {
      return active
    },
    get waiting() {
      return queue.length
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve))
      else active++
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}
