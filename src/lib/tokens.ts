import { MAX_MEMBER_TOKENS, type TripListResponse } from '../../shared/api/types.ts'

// The device's memberTokens (E1: there are no accounts). One token per trip, keyed by trip id, in
// localStorage. Storage can be missing or throw (private mode, tests): then the tokens live in
// memory for this page only.

const STORAGE_KEY = 'tripfolio.memberTokens'

export type TokenMap = Record<string, string>

let memory: TokenMap = {}
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Parses the stored JSON, keeping only string → non-empty string entries */
export function parseTokenMap(raw: string | null): TokenMap {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const out: TokenMap = {}
    for (const [tripId, token] of Object.entries(value)) {
      if (typeof token === 'string' && token !== '') out[tripId] = token
    }
    return out
  } catch {
    return {}
  }
}

export function getTokens(): TokenMap {
  const store = storage()
  if (!store) return { ...memory }
  try {
    return parseTokenMap(store.getItem(STORAGE_KEY))
  } catch {
    return { ...memory }
  }
}

function write(tokens: TokenMap): void {
  memory = { ...tokens }
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(tokens))
  } catch {
    // Storage full or disabled: the in-memory copy still works for this page
  }
  for (const listener of listeners) listener()
}

export const getToken = (tripId: string): string | null => getTokens()[tripId] ?? null

/** Remembers the token POST /api/trips or POST /api/join returned */
export function setToken(tripId: string, token: string): void {
  write({ ...getTokens(), [tripId]: token })
}

export function removeToken(tripId: string): void {
  const tokens = getTokens()
  if (!(tripId in tokens)) return
  delete tokens[tripId]
  write(tokens)
}

/** Calls `listener` after every change; returns the unsubscribe function */
export function subscribeTokens(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** What GET /api/trips sends: the newest tokens first, at most MAX_MEMBER_TOKENS */
export function tokensForList(tokens: TokenMap = getTokens()): { tripId: string; token: string }[] {
  return Object.entries(tokens)
    .map(([tripId, token]) => ({ tripId, token }))
    .reverse()
    .slice(0, MAX_MEMBER_TOKENS)
}

/**
 * The tokens to keep after a list call: those the response answered for, plus any not sent at all.
 * A sent token missing from `trips` is revoked, removed or for a deleted trip (shared/api/types.ts).
 */
export function prunedTokens(
  tokens: TokenMap,
  sent: readonly { tripId: string; token: string }[],
  response: TripListResponse,
): TokenMap {
  const answered = new Set(response.trips.map((entry) => entry.tokenIndex))
  const out: TokenMap = { ...tokens }
  sent.forEach((entry, index) => {
    if (!answered.has(index) && out[entry.tripId] === entry.token) delete out[entry.tripId]
  })
  return out
}

/** Applies prunedTokens() to the stored tokens */
export function pruneTokens(
  sent: readonly { tripId: string; token: string }[],
  response: TripListResponse,
): void {
  const tokens = getTokens()
  const next = prunedTokens(tokens, sent, response)
  if (Object.keys(next).length !== Object.keys(tokens).length) write(next)
}

/** Test helper: forget everything */
export function clearTokens(): void {
  write({})
}
