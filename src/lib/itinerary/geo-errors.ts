import { isApiError } from '../api.ts'
import type { Translate } from '../i18n.ts'

// What the place picker says when the geo proxy refuses (e3-t02)

/** Typing pauses this long before a search is sent */
export const SEARCH_DEBOUNCE_MS = 300

/** The message for a failed search or parse: rate limit with its wait, provider down, or the code */
export function geoErrorMessage(error: unknown, t: Translate): string {
  if (isApiError(error)) {
    if (error.status === 429) {
      const details = error.details as { retryAfterS?: number } | undefined
      return t('place.error.rateLimited', { seconds: details?.retryAfterS ?? 60 })
    }
    if (error.status === 502 || error.status === 503) return t('place.error.unavailable')
    if (error.code === 'no_coordinates') return t('place.parse.none')
    if (error.code === 'network') return t('error.network')
    return t('place.error.generic', { code: error.code })
  }
  return t('place.error.generic', { code: 'unknown' })
}

