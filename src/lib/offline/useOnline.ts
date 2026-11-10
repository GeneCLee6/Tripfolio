import { useSyncExternalStore } from 'react'

// Online or not (e10-t05). navigator.onLine says "offline" reliably but "online" too eagerly
// (a captive portal, a dead hotel Wi-Fi), so a failed request also counts as offline, and while
// offline a small GET /api/health probe (never answered by the Service Worker) decides when the
// connection is back.

const PROBE_MS = 10_000
const PROBE_TIMEOUT_MS = 5_000

let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false
const listeners = new Set<() => void>()
const backListeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null

function setOnline(next: boolean): void {
  if (next === online) return
  online = next
  for (const listener of listeners) listener()
  if (next) for (const listener of backListeners) listener()
  if (!next) scheduleProbe()
}

function scheduleProbe(): void {
  if (timer || typeof window === 'undefined') return
  timer = setTimeout(() => {
    timer = null
    void probe().then((ok) => {
      if (!ok) scheduleProbe()
    })
  }, PROBE_MS)
}

/** Asks GET /api/health; true when the Worker answered */
export async function probe(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setOnline(false)
    return false
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal })
    setOnline(response.ok)
    return response.ok
  } catch {
    setOnline(false)
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export const isOnline = (): boolean => online

/** A request just failed on the network: offline until the probe says otherwise */
export function reportNetworkFailure(): void {
  setOnline(false)
  scheduleProbe()
}

/** Called whenever the connection comes back */
export function onBackOnline(listener: () => void): () => void {
  backListeners.add(listener)
  return () => backListeners.delete(listener)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setOnline(false))
  // The browser's "online" is a hint: confirm with the probe
  window.addEventListener('online', () => void probe())
  if (!online) scheduleProbe()
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true)
}
