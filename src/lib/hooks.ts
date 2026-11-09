import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

// Small React hooks the pages share: an async loader and a media query.

export type Resource<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'ready'; data: T; error?: undefined }
  | { status: 'error'; data?: undefined; error: unknown }

/**
 * Runs `load` on mount and whenever `key` changes; `reload()` runs it again. A load that is
 * overtaken (key changed, unmount) is aborted and its result dropped.
 */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
): Resource<T> & { reload: () => void; set: (data: T) => void } {
  const [state, setState] = useState<{ key: string; resource: Resource<T> }>({
    key,
    resource: { status: 'loading' },
  })
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ key, resource: { status: 'ready', data } })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ key, resource: { status: 'error', error } })
      },
    )
    return () => controller.abort()
    // `load` is a new function every render; `key` and `generation` say when to run again
  }, [key, generation]) // oxlint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setGeneration((n) => n + 1), [])
  const set = useCallback(
    (data: T) => setState({ key, resource: { status: 'ready', data } }),
    [key],
  )
  // A reload keeps showing the old data; a new key starts from loading
  const resource: Resource<T> = state.key === key ? state.resource : { status: 'loading' }
  return { ...resource, reload, set }
}

/** Whether a media query matches; false on the server and in tests */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', listener)
      return () => list.removeEventListener('change', listener)
    },
    () =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  )
}

/** The time when the component mounted (render stays pure; a list does not need a ticking clock) */
export function useNow(): number {
  const [now] = useState(() => Date.now())
  return now
}
