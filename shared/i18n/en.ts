import type { MessageKey } from './zh-TW.ts'

// The English catalog: the same keys as zh-TW.ts (the source), checked by the type and by
// `npm run check-i18n`.
export const en: Record<MessageKey, string> = {
  'app.name': 'Tripfolio',
  'app.tagline': 'A trip handbook for friends',
  'health.checking': 'Connecting to the server…',
  'health.ok': 'Server OK · version {version}',
  'health.error': 'Cannot reach the server',
  'share.title': 'Shared trip',
  'share.placeholder': 'This is the read-only share page; its content will appear here.',
}
