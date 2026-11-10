import { MAX_MEMBER_TOKENS } from '../../../shared/api/types.ts'
import { getTokens, subscribeTokens, type TokenMap } from '../tokens.ts'

// Tokens of trips that left the list. GET /api/trips does not answer for a soft-deleted trip, so
// api.listTrips() drops its token from the device (tokens.ts pruneTokens). The deleted-trips list
// (GET /api/trips/deleted) and restore still need that token for 30 days, so every token that
// disappears from the main store is kept here; the deleted list sends these too and forgets the
// ones the server no longer answers for (revoked, removed, purged). Stored in localStorage next to
// the main tokens; storage that is missing or throws falls back to memory for this page.

const STORAGE_KEY = 'tripfolio.retiredTokens'

let memory: TokenMap = {}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function getRetired(): TokenMap {
  const store = storage()
  if (!store) return { ...memory }
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return {}
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const out: TokenMap = {}
    for (const [tripId, token] of Object.entries(value))
      if (typeof token === 'string' && token !== '') out[tripId] = token
    return out
  } catch {
    return { ...memory }
  }
}

function write(tokens: TokenMap): void {
  // Keep the newest ones: the deleted list sends at most MAX_MEMBER_TOKENS tokens in total
  memory = Object.fromEntries(Object.entries(tokens).slice(-MAX_MEMBER_TOKENS))
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(memory))
  } catch {
    // Storage full or disabled: the in-memory copy still works for this page
  }
}

export function retireToken(tripId: string, token: string): void {
  const tokens = getRetired()
  delete tokens[tripId]
  write({ ...tokens, [tripId]: token })
}

export function forgetRetired(tripIds: readonly string[]): void {
  const tokens = getRetired()
  let changed = false
  for (const id of tripIds) {
    if (id in tokens) {
      delete tokens[id]
      changed = true
    }
  }
  if (changed) write(tokens)
}

/** The tokens the deleted list sends: retired ones first (likelier to be deleted), then the rest */
export function tokensForDeleted(
  active: TokenMap = getTokens(),
  retired: TokenMap = getRetired(),
): { tripId: string; token: string }[] {
  const seen = new Set<string>()
  const out: { tripId: string; token: string }[] = []
  const all = [...Object.entries(retired).reverse(), ...Object.entries(active).reverse()]
  for (const [tripId, token] of all) {
    if (seen.has(token)) continue
    seen.add(token)
    out.push({ tripId, token })
  }
  return out.slice(0, MAX_MEMBER_TOKENS)
}

// Watch the main store: whatever leaves it is retired here (installed once per page load)
let last: TokenMap | null = null

export function watchRetiredTokens(): void {
  if (last !== null) return
  last = getTokens()
  subscribeTokens(() => {
    const next = getTokens()
    for (const [tripId, token] of Object.entries(last ?? {}))
      if (next[tripId] !== token) retireToken(tripId, token)
    last = next
  })
}
