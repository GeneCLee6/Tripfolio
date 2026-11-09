// The source catalog (CLAUDE.md rule 1): every key starts here, and en.ts must have the same keys.
// Placeholders are written {name}. A2 (e10-t02) grows this into the real catalog.
export const zhTW = {
  'app.name': '旅誌',
  'app.tagline': '給朋友的自由行手冊',
  'health.checking': '正在連線伺服器…',
  'health.ok': '伺服器正常 · 版本 {version}',
  'health.error': '連不到伺服器',
  'share.title': '分享的旅程',
  'share.placeholder': '這是唯讀的分享頁，內容之後會出現在這裡。',
} as const

export type MessageKey = keyof typeof zhTW
