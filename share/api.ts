import type { SharePayload } from '../shared/api/share.ts'

// The share page's only request. The payload is already filtered by the Worker (CLAUDE.md rule 4):
// what is hidden never arrives here, so the page shows everything it gets.

export type ShareResult =
  { kind: 'ok'; payload: SharePayload } | { kind: 'notFound' } | { kind: 'error' }

const TOKEN_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/

/** The share token from /s/<token>, or null when the path has none */
export function tokenFromPath(pathname: string): string | null {
  return TOKEN_PATH.exec(pathname)?.[1] ?? null
}

export async function loadShare(token: string | null, signal?: AbortSignal): Promise<ShareResult> {
  if (!token) return { kind: 'notFound' }
  try {
    const response = await fetch(`/api/share/${encodeURIComponent(token)}`, {
      headers: { accept: 'application/json' },
      signal,
    })
    if (response.status === 404) return { kind: 'notFound' }
    if (!response.ok) return { kind: 'error' }
    return { kind: 'ok', payload: (await response.json()) as SharePayload }
  } catch (error) {
    if (signal?.aborted) throw error
    return { kind: 'error' }
  }
}
