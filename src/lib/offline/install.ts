import { useSyncExternalStore } from 'react'

// The install prompt (e10-t05): Chrome/Edge/Android fire `beforeinstallprompt`, which is kept here
// (listened to from the first import, before React mounts) and replayed when the person taps
// 「安裝」. iOS Safari has no such event: there the banner explains 分享 → 加入主畫面. The banner shows
// on the trip home when the trip starts within 7 days (or is under way) and is not installed yet;
// dismissing it is remembered per trip in localStorage.

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'tripfolio.installDismissed'
export const INSTALL_WINDOW_DAYS = 7

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => {
  for (const listener of listeners) listener()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

export type InstallMode = 'prompt' | 'ios' | null

/** Running as an installed app already */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const nav = navigator as Navigator & { standalone?: boolean }
  return Boolean(nav.standalone) || window.matchMedia?.('(display-mode: standalone)').matches
}

/** iPhone/iPad Safari (iPadOS reports itself as a Mac with touch) */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
}

function currentMode(): InstallMode {
  if (installed || isStandalone()) return null
  if (deferred) return 'prompt'
  if (typeof navigator !== 'undefined' && isIos(navigator.userAgent, navigator.maxTouchPoints)) {
    return 'ios'
  }
  return null
}

/**
 * Whether the trip is close enough to want the app at hand: starts within `INSTALL_WINDOW_DAYS`
 * of `today`, or is under way. Dates are YYYY-MM-DD; `today` is the trip's local date.
 */
export function inInstallWindow(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  today: string,
): boolean {
  if (!startDate) return false
  const days = (Date.parse(`${startDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000
  if (days > INSTALL_WINDOW_DAYS) return false
  return days >= 0 || !endDate || endDate >= today
}

function readDismissed(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function isInstallDismissed(tripId: string): boolean {
  return readDismissed().includes(tripId)
}

export function dismissInstall(tripId: string): void {
  try {
    const list = [...new Set([...readDismissed(), tripId])].slice(-50)
    localStorage.setItem(DISMISS_KEY, JSON.stringify(list))
  } catch {
    // Private mode: the banner simply comes back next time
  }
  emit()
}

/** Shows the browser's own install dialog; false when it is not available */
export async function promptInstall(): Promise<boolean> {
  const event = deferred
  if (!event) return false
  deferred = null
  emit()
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === 'accepted') installed = true
  emit()
  return outcome === 'accepted'
}

let snapshot = { mode: currentMode(), version: 0 }
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
listeners.add(() => {
  snapshot = { mode: currentMode(), version: snapshot.version + 1 }
})

/** 'prompt' (Chromium), 'ios' (show the 加到主畫面 hint) or null; `version` changes on dismiss */
export function useInstallMode(): { mode: InstallMode; version: number } {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  )
}
