import type { ShareOptions } from '../../shared/schema/share.ts'

// Share links on the device (e1-t05): the URL a share token opens, the defaults the create dialog
// starts from, and which options show as chips in the list. Copying reuses `copyText` from
// members.ts. The hiding itself happens on the server (CLAUDE.md rule 4); this only names it.

export { copyText } from './members.ts'

/** The read-only page a share token opens (served by the Worker, worker/app.ts) */
export function shareUrl(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${encodeURIComponent(token)}`
}

/** What a new link starts with: money and addresses hidden, recap off (it comes with E8) */
export const DEFAULT_SHARE_OPTIONS: ShareOptions = {
  hideMoney: true,
  hideAddresses: true,
  showRecap: false,
}

export type ShareOption = keyof ShareOptions

/** The options in the order the dialog and the chips show them */
export const SHARE_OPTION_KEYS: readonly ShareOption[] = ['hideMoney', 'hideAddresses', 'showRecap']

/** The options that are on, in display order (for the chips) */
export const activeShareOptions = (options: ShareOptions): ShareOption[] =>
  SHARE_OPTION_KEYS.filter((key) => options[key])
