import { useEffect, useSyncExternalStore } from 'react'
import type { AuthUser } from '../../../shared/api/auth.ts'
import { isApiError } from '../api.ts'
import { getTokens, setToken, tokensForList } from '../tokens.ts'
import { authApi, mergedTokens } from './api.ts'

// Who is signed in (e1-t06). GET /api/auth/me runs once per page load and is shared by every
// component. `disabled` (503 auth_disabled, or anything but a clean 401) hides all sign-in UI, so
// the app looks exactly as before until the owner configures Google (DEPLOY.md §13).

export type AuthState =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser }

let state: AuthState = { status: 'loading' }
let loading: Promise<AuthState> | null = null
let syncing: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: AuthState): AuthState {
  state = next
  for (const listener of listeners) listener()
  return next
}

/** Fetches /api/auth/me the first time; later calls share that answer */
export function loadAuth(): Promise<AuthState> {
  loading ??= authApi.me().then(
    (response) => publish({ status: 'signedIn', user: response.user }),
    (error: unknown) =>
      publish(
        isApiError(error) && error.status === 401 ? { status: 'signedOut' } : { status: 'disabled' },
      ),
  )
  return loading
}

export function useAuth(): AuthState {
  useEffect(() => {
    void loadAuth()
  }, [])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => state,
    () => state,
  )
}

export async function signOut(): Promise<void> {
  await authApi.logout()
  loading = Promise.resolve(publish({ status: 'signedOut' }))
}

/**
 * Before the trip list loads: when signed in, asks for the account's linked trips and stores the
 * memberTokens minted for this device, so a new phone finds its trips. Once per page load; never
 * throws (the list still works from the local tokens).
 */
export function syncAuthTrips(): Promise<void> {
  syncing ??= (async () => {
    try {
      const auth = await loadAuth()
      if (auth.status !== 'signedIn') return
      const response = await authApi.trips(tokensForList().map((entry) => entry.token))
      const before = getTokens()
      const next = mergedTokens(before, response)
      for (const [tripId, token] of Object.entries(next)) {
        if (before[tripId] !== token) setToken(tripId, token)
      }
    } catch {
      // Rate limited or offline: the local tokens are enough for now
    }
  })()
  return syncing
}

/** Test helper: forget the cached state */
export function resetAuth(): void {
  state = { status: 'loading' }
  loading = null
  syncing = null
}
