import { registerCatalog } from '../shared/i18n/core.ts'
import { enCommon } from '../shared/i18n/en.common.ts'
import { enShare } from '../shared/i18n/en.share.ts'
import { zhTWCommon } from '../shared/i18n/zh-TW.common.ts'
import { zhTWShare } from '../shared/i18n/zh-TW.share.ts'

// The share page's messages (RULES.md §2): its own keys and the ones it shares with the app (the
// map, formats), not the whole app catalog. Imported for its effect by share/main.tsx before
// anything renders.

registerCatalog('zh-TW', { ...zhTWCommon, ...zhTWShare })
registerCatalog('en', { ...enCommon, ...enShare })
