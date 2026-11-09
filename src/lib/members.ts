import type { Member } from '../../shared/api/types.ts'

// Members and invites on the device (e1-t03): sorting for the list, the invite link a device joined
// with (kept for 「這不是我」), the invite URL, and copying it.

const ROLE_ORDER: Record<Member['role'], number> = { owner: 0, editor: 1, viewer: 2 }

/** Owner first, then editors, then viewers; by join time within each */
export function sortMembers<T extends Pick<Member, 'role' | 'createdAt' | 'id'>>(
  members: readonly T[],
): T[] {
  return [...members].sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )
}

/** The page a recipient opens */
export function inviteUrl(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/join/${encodeURIComponent(token)}`
}

const INVITE_KEY = 'tripfolio.joinedInvites'

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function readInvites(): Record<string, string> {
  try {
    const raw = session()?.getItem(INVITE_KEY)
    const value: unknown = raw ? JSON.parse(raw) : {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

/**
 * Remembers the invite token this tab joined `tripId` with, so 「這不是我」 can reopen the
 * "who are you" screen. sessionStorage: it lasts for this tab only, like the link itself.
 */
export function rememberInvite(tripId: string, token: string): void {
  try {
    session()?.setItem(INVITE_KEY, JSON.stringify({ ...readInvites(), [tripId]: token }))
  } catch {
    // Storage disabled: 「這不是我」 then asks for the link again
  }
}

export const rememberedInvite = (tripId: string): string | null => readInvites()[tripId] ?? null

export function forgetInvite(tripId: string): void {
  const invites = readInvites()
  if (!(tripId in invites)) return
  delete invites[tripId]
  try {
    session()?.setItem(INVITE_KEY, JSON.stringify(invites))
  } catch {
    // ignore
  }
}

/**
 * Copies `text`: the async clipboard first, then a selected field and execCommand. Returns false
 * when neither worked; `field` is left selected so the person can copy it by hand.
 */
export async function copyText(text: string, field?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Not allowed here (permissions, insecure context): fall back
  }
  if (!field) return false
  field.focus()
  field.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}
