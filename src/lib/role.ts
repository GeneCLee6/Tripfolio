import { useCallback, useContext } from 'react'
import type { Role } from '../../shared/schema/member.ts'
import { useToast } from '../components/toast-context.ts'
import { TripContext } from '../app/trip-context.ts'
import { isApiError } from './api.ts'
import { errorMessageKey } from './errors.ts'
import { useT } from './i18n.ts'

// What each role may do in the interface (e1-t04). The Worker decides (worker/auth.ts requireRole);
// these only hide or disable controls a person could not use anyway, so keep them in step with the
// API: owner manages members, invites, shares, archiving and deleting; editor edits everything else;
// viewer only reads.

export type Action = 'editContent' | 'manageMembers' | 'manageShares' | 'archive' | 'delete'

const MIN_ROLE: Record<Action, Role> = {
  editContent: 'editor',
  manageMembers: 'owner',
  manageShares: 'owner',
  archive: 'owner',
  delete: 'owner',
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 }

/** Actions an archived trip still allows (the API refuses other writes with 403 trip_archived) */
const ALLOWED_WHEN_ARCHIVED = new Set<Action>(['manageShares', 'archive', 'delete'])

export interface CanOptions {
  /** The trip is archived: content and member writes are refused */
  archived?: boolean
}

/** Whether `role` may do `action` */
export function can(role: Role, action: Action, { archived = false }: CanOptions = {}): boolean {
  if (RANK[role] < RANK[MIN_ROLE[action]]) return false
  return !archived || ALLOWED_WHEN_ARCHIVED.has(action)
}

/** The current member's role in the trip (inside the trip layout) */
export function useRole(): Role {
  const value = useContext(TripContext)
  if (!value) throw new Error('useRole() needs the trip layout above it')
  return value.me.role
}

/**
 * `const can = useCan(); can('editContent')`: the role of "me" in the current trip, with the
 * trip's archived state applied. Use it to hide or disable editing controls.
 */
export function useCan(): (action: Action) => boolean {
  const value = useContext(TripContext)
  if (!value) throw new Error('useCan() needs the trip layout above it')
  const role = value.me.role
  const archived = Boolean(value.trip.archivedAt)
  return useCallback((action: Action) => can(role, action, { archived }), [role, archived])
}

/**
 * Shows a failed API call as a danger toast (403 reads 「你沒有權限做這件事。」). On a 403 inside a
 * trip the trip is fetched again, so a role changed elsewhere reaches the interface.
 */
export function useApiErrorToast(): (error: unknown) => void {
  const t = useT()
  const toast = useToast()
  const reload = useContext(TripContext)?.reload
  return useCallback(
    (error: unknown) => {
      const { key, code } = errorMessageKey(error)
      toast.show(t(key, { code }), { tone: 'danger' })
      if (isApiError(error) && error.status === 403) reload?.()
    },
    [t, toast, reload],
  )
}
