import { useSyncExternalStore } from 'react'

// Registers /sw.js (sw/sw.ts, e10-t05) in production builds and tracks whether a new version is
// waiting. The waiting worker only takes over when the person taps 「重新整理」: applyUpdate() tells
// it to skip waiting, and the page reloads once the new one controls it.

let registration: ServiceWorkerRegistration | null = null
let waiting = false
let reloadOnChange = false
const listeners = new Set<() => void>()

const UPDATE_CHECK_MS = 60 * 60 * 1000

function setWaiting(next: boolean): void {
  if (next === waiting) return
  waiting = next
  for (const listener of listeners) listener()
}

function watch(reg: ServiceWorkerRegistration): void {
  // Only an update when a worker already controls the page; the very first install is not one
  if (reg.waiting && navigator.serviceWorker.controller) setWaiting(true)
  reg.addEventListener('updatefound', () => {
    const incoming = reg.installing
    incoming?.addEventListener('statechange', () => {
      if (incoming.state === 'installed' && navigator.serviceWorker.controller) setWaiting(true)
    })
  })
}

let started = false

export function registerServiceWorker(): void {
  if (started || !import.meta.env.PROD || typeof navigator === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  started = true
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadOnChange) {
      reloadOnChange = false
      window.location.reload()
    }
  })
  const register = () =>
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(
      (reg) => {
        registration = reg
        watch(reg)
        setInterval(() => void reg.update().catch(() => undefined), UPDATE_CHECK_MS)
      },
      () => undefined,
    )
  // After load, so installing (and precaching) never competes with the first screen
  if (document.readyState === 'complete') void register()
  else window.addEventListener('load', () => void register(), { once: true })
}

/** The person said yes to the new version */
export function applyUpdate(): void {
  const next = registration?.waiting
  if (!next) {
    window.location.reload()
    return
  }
  reloadOnChange = true
  next.postMessage({ type: 'skip-waiting' })
}

/** Tells the worker which trip was opened: it keeps the data of the last 3 */
export function notifyTripOpened(tripId: string): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  navigator.serviceWorker.controller?.postMessage({ type: 'trip-opened', tripId })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUpdateWaiting(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => waiting,
    () => false,
  )
}
