import { z } from 'zod'
import { entityId, isoDate } from './common.ts'

// Pre-trip prep (E9, docs/PRD/e9-pretrip-prep.md): checklists and items (e9-t02/t03), the budget
// (e9-t01), destination notes (e9-t05), document categories (e9-t04), and the shape of the
// bilingual templates in shared/templates/** (validated by tests/shared/templates.test.ts).

export const checklistKinds = ['pretrip', 'packing'] as const
export const checklistKind = z.enum(checklistKinds)
export type ChecklistKind = z.infer<typeof checklistKind>

/** The checklist templates; trip styles map onto them (`templateForStyle`) and `winter` is extra */
export const checklistTemplateStyles = [
  'general',
  'roadtrip',
  'campervan',
  'private-driver',
  'city',
  'island',
  'rail',
  'winter',
] as const
export const checklistTemplateStyle = z.enum(checklistTemplateStyles)
export type ChecklistTemplateStyle = z.infer<typeof checklistTemplateStyle>

/** The trip style (shared/schema/trip.ts) to its checklist template; `other` gets the general one */
export function templateForStyle(style: string): ChecklistTemplateStyle {
  return (checklistTemplateStyles as readonly string[]).includes(style)
    ? (style as ChecklistTemplateStyle)
    : 'general'
}

export const noteDestinations = ['nz'] as const
export const noteDestination = z.enum(noteDestinations)
export type NoteDestination = z.infer<typeof noteDestination>

/** The language a template is copied in (the person applying it chooses) */
export const templateLocale = z.enum(['zh-TW', 'en'])
export type TemplateLocale = z.infer<typeof templateLocale>

// ---- Checklists ---------------------------------------------------------------------------------

const title = z.string().trim().min(1).max(200)
const order = z.number().finite()

export const checklistCreateSchema = z.object({
  kind: checklistKind,
  title,
  order: order.optional(),
})
export type ChecklistCreate = z.input<typeof checklistCreateSchema>

export const checklistPatchSchema = z.object({ title, order }).partial()
export type ChecklistPatch = z.infer<typeof checklistPatchSchema>

const itemFields = {
  text: z.string().trim().min(1).max(500),
  note: z.string().max(2000),
  done: z.boolean(),
  /** On a packing list: who brings it */
  assigneeMemberId: entityId.nullable(),
  /** A calendar date in the trip's zone */
  dueAt: isoDate.nullable(),
  order,
}

export const checklistItemCreateSchema = z.object({
  text: itemFields.text,
  note: itemFields.note.default(''),
  done: itemFields.done.default(false),
  assigneeMemberId: itemFields.assigneeMemberId.default(null),
  dueAt: itemFields.dueAt.default(null),
  order: order.optional(),
})
export type ChecklistItemCreate = z.input<typeof checklistItemCreateSchema>

export const checklistItemPatchSchema = z.object(itemFields).partial()
export type ChecklistItemPatch = z.infer<typeof checklistItemPatchSchema>

/** POST /checklists/apply-template: `general` always comes along with the chosen style */
export const applyChecklistTemplateSchema = z.object({
  style: checklistTemplateStyle,
  locale: templateLocale.default('zh-TW'),
})
export type ApplyChecklistTemplate = z.input<typeof applyChecklistTemplateSchema>

// ---- Budget -------------------------------------------------------------------------------------

/**
 * The categories of a travel agent quote (01-travel-domain-notes §6). Every expense category
 * (shared/schema/expense.ts) is one of them, so actual spending maps 1:1; flights and insurance are
 * usually paid before the trip and have no expense category (see budgetTrackedCategories).
 */
export const budgetCategories = [
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
] as const
export const budgetCategory = z.enum(budgetCategories)
export type BudgetCategory = z.infer<typeof budgetCategory>

/** Categories with a matching expense category, so actual spending can be compared */
export const budgetTrackedCategories: readonly BudgetCategory[] = [
  'lodging',
  'transport',
  'fuel',
  'food',
  'tickets',
  'shopping',
  'misc',
  'other',
]

export const budgetRowSchema = z.object({
  category: budgetCategory,
  /** Integer minor units of the trip's base currency */
  plannedMinor: z.number().int().min(0).max(100_000_000_000),
  /** true: the amount is for each member; false: for the whole group */
  perPerson: z.boolean().default(false),
})
export type BudgetRowInput = z.input<typeof budgetRowSchema>

/** PUT /budget: the whole table; a category left out is removed */
export const budgetPutSchema = z
  .object({ rows: z.array(budgetRowSchema).max(budgetCategories.length) })
  .refine((body) => new Set(body.rows.map((r) => r.category)).size === body.rows.length, {
    message: 'each category at most once',
    path: ['rows'],
  })
export type BudgetPut = z.input<typeof budgetPutSchema>

// ---- Notes --------------------------------------------------------------------------------------

/** Note sections; `custom` is anything the members add themselves */
export const noteSections = [
  'emergency',
  'power',
  'money',
  'driving',
  'water',
  'customs',
  'apps',
  'campervan',
  'links',
  'custom',
] as const
export const noteSection = z.enum(noteSections)
export type NoteSection = z.infer<typeof noteSection>

const noteFields = {
  section: noteSection,
  title,
  /** Markdown-lite: paragraphs, `- ` bullets, `## ` headings, bare https links */
  body: z.string().max(20_000),
  order,
  /** May be shown on share pages (E8, later) */
  shareable: z.boolean(),
}

export const noteCreateSchema = z.object({
  section: noteFields.section.default('custom'),
  title: noteFields.title,
  body: noteFields.body.default(''),
  order: order.optional(),
  shareable: noteFields.shareable.default(false),
})
export type NoteCreate = z.input<typeof noteCreateSchema>

export const notePatchSchema = z.object(noteFields).partial()
export type NotePatch = z.infer<typeof notePatchSchema>

export const applyNotesTemplateSchema = z.object({
  destination: noteDestination,
  locale: templateLocale.default('zh-TW'),
})
export type ApplyNotesTemplate = z.input<typeof applyNotesTemplateSchema>

// ---- Documents ----------------------------------------------------------------------------------

export const docCategories = ['passport', 'visa', 'insurance', 'license', 'other'] as const
export const docCategory = z.enum(docCategories)
export type DocCategory = z.infer<typeof docCategory>

export const documentPatchSchema = z.object({ docCategory: docCategory.nullable() })
export type DocumentPatch = z.infer<typeof documentPatchSchema>

// ---- Templates (shared/templates/**) -------------------------------------------------------------

/** Both languages, both non-empty */
export const localizedText = z.object({
  'zh-TW': z.string().trim().min(1),
  en: z.string().trim().min(1),
})
export type LocalizedText = z.infer<typeof localizedText>

/** Official sites only as root domains (https://www.doc.govt.nz): deep links rot */
export const officialRootUrl = z
  .url({ protocol: /^https$/ })
  .refine((value) => {
    const url = new URL(value)
    return (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash
  }, 'official links are root domains only')

export const linkHintSchema = z.object({
  label: localizedText,
  url: officialRootUrl.optional(),
})
export type LinkHint = z.infer<typeof linkHintSchema>

/** A link hint as stored on an item: the label in the language the template was applied in */
export interface StoredLinkHint {
  label: string
  url?: string
}

const templateKey = z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'dotted lower-case key')

export const checklistTemplateItemSchema = z.object({
  key: templateKey,
  text: localizedText,
  linkHint: linkHintSchema.optional(),
  /** Due this many days before the trip starts */
  dueDaysBefore: z.number().int().min(0).max(365).optional(),
})

export const checklistTemplateListSchema = z.object({
  key: templateKey,
  kind: checklistKind,
  title: localizedText,
  items: z.array(checklistTemplateItemSchema).min(1),
})

export const checklistTemplateSchema = z.object({
  style: checklistTemplateStyle,
  title: localizedText,
  lists: z.array(checklistTemplateListSchema).min(1),
})
export type ChecklistTemplate = z.infer<typeof checklistTemplateSchema>

export const notesTemplateSchema = z.object({
  destination: noteDestination,
  title: localizedText,
  /** Shown above the sections: the template says what to confirm, not what the rules are */
  disclaimer: localizedText,
  sections: z
    .array(
      z.object({
        key: templateKey,
        section: noteSection,
        title: localizedText,
        body: localizedText,
      }),
    )
    .min(1),
})
export type NotesTemplate = z.infer<typeof notesTemplateSchema>
