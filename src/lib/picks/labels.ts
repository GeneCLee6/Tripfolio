import type { MessageKey } from '../../../shared/i18n/t.ts'
import type { WishlistCategory } from '../../../shared/schema/index.ts'

/** 必吃／必買／必看／體驗 (DESIGN.md §5.7 glossary) */
export const CATEGORY_LABEL: Record<WishlistCategory, MessageKey> = {
  eat: 'picks.category.eat',
  buy: 'picks.category.buy',
  see: 'picks.category.see',
  experience: 'picks.category.experience',
}
