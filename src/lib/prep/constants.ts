import type { MessageKey } from '../../../shared/i18n/t.ts'
import type {
  BudgetCategory,
  ChecklistTemplateStyle,
  DocCategory,
} from '../../../shared/schema/prep.ts'

// The enum values the prep pages need at runtime, restated without zod so it stays out of the
// app's chunks (shared/schema/prep.ts imports zod). tests/src/prep/prep.test.ts checks they match.

export const BUDGET_CATEGORIES: readonly BudgetCategory[] = [
  'flights',
  'lodging',
  'transport',
  'fuel',
  'food',
  'tickets',
  'shopping',
  'insurance',
  'misc',
  'other',
]

/** Budget categories with a matching expense category (schema budgetTrackedCategories) */
export const TRACKED_CATEGORIES: readonly BudgetCategory[] = [
  'lodging',
  'transport',
  'fuel',
  'food',
  'tickets',
  'shopping',
  'misc',
  'other',
]

export const TEMPLATE_STYLES: readonly ChecklistTemplateStyle[] = [
  'general',
  'roadtrip',
  'campervan',
  'private-driver',
  'city',
  'island',
  'rail',
  'winter',
]

export const DOC_CATEGORIES: readonly DocCategory[] = [
  'passport',
  'visa',
  'insurance',
  'license',
  'other',
]

/** The trip style to its checklist template; `other` gets the general one */
export function templateForTripStyle(style: string): ChecklistTemplateStyle {
  return (TEMPLATE_STYLES as readonly string[]).includes(style)
    ? (style as ChecklistTemplateStyle)
    : 'general'
}

export const STYLE_LABEL: Record<ChecklistTemplateStyle, MessageKey> = {
  general: 'prep.style.general',
  roadtrip: 'prep.style.roadtrip',
  campervan: 'prep.style.campervan',
  'private-driver': 'prep.style.privateDriver',
  city: 'prep.style.city',
  island: 'prep.style.island',
  rail: 'prep.style.rail',
  winter: 'prep.style.winter',
}

export const BUDGET_LABEL: Record<BudgetCategory, MessageKey> = {
  flights: 'prep.budget.category.flights',
  lodging: 'prep.budget.category.lodging',
  transport: 'prep.budget.category.transport',
  fuel: 'prep.budget.category.fuel',
  food: 'prep.budget.category.food',
  tickets: 'prep.budget.category.tickets',
  shopping: 'prep.budget.category.shopping',
  insurance: 'prep.budget.category.insurance',
  misc: 'prep.budget.category.misc',
  other: 'prep.budget.category.other',
}

export const DOC_LABEL: Record<DocCategory, MessageKey> = {
  passport: 'prep.documents.category.passport',
  visa: 'prep.documents.category.visa',
  insurance: 'prep.documents.category.insurance',
  license: 'prep.documents.category.license',
  other: 'prep.documents.category.other',
}
