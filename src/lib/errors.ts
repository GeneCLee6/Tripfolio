import type { MessageKey } from '../../shared/i18n/t.ts'
import { isApiError } from './api.ts'

// What to tell people when an API call fails (the codes in shared/api/types.ts ApiErrorBody)

const MESSAGES: Record<string, MessageKey> = {
  network: 'error.network',
  unauthorized: 'error.unauthorized',
  forbidden: 'error.forbidden',
  not_found: 'error.notFound',
  trip_archived: 'error.tripArchived',
  invalid: 'error.invalid',
  invalid_json: 'error.invalid',
}

/** The message key for an error, and the code to show with the generic one */
export function errorMessageKey(error: unknown): { key: MessageKey; code: string } {
  const code = isApiError(error) ? error.code : 'unknown'
  return { key: MESSAGES[code] ?? 'error.generic', code }
}

/** True when the trip cannot be opened from this device at all (no token, revoked, deleted) */
export function isAccessError(error: unknown): boolean {
  return isApiError(error) && (error.status === 401 || error.status === 403 || error.status === 404)
}
