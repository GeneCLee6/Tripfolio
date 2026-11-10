import type {
  BudgetCategory,
  ChecklistKind,
  DocCategory,
  NoteSection,
  StoredLinkHint,
} from '../schema/prep.ts'
import type { Attachment } from './media.ts'
import type { Rev } from './types.ts'

// Response shapes of the pre-trip prep API (E9): worker/trips/{checklists,budget,notes,documents}.ts

export interface ChecklistItem {
  id: string
  checklistId: string
  text: string
  note: string
  done: boolean
  assigneeMemberId: string | null
  /** YYYY-MM-DD or null */
  dueAt: string | null
  order: number
  templateKey: string | null
  linkHint: StoredLinkHint | null
  rev: number
  createdAt: string
  updatedAt: string
}

export interface Checklist {
  id: string
  tripId: string
  kind: ChecklistKind
  title: string
  order: number
  templateKey: string | null
  rev: number
  createdAt: string
  updatedAt: string
  items: ChecklistItem[]
}

export interface ChecklistsResponse extends Rev {
  checklists: Checklist[]
}

export interface ChecklistResponse extends Rev {
  checklist: Checklist
}

export interface ChecklistItemResponse extends Rev {
  item: ChecklistItem
}

export interface ApplyTemplateResponse extends Rev {
  /** What this call added (0 and 0 when the template was already applied) */
  added: { lists: number; items: number }
  checklists: Checklist[]
}

// ---- Budget -------------------------------------------------------------------------------------

export interface BudgetRow {
  category: BudgetCategory
  /** Minor units of the trip's base currency */
  plannedMinor: number
  perPerson: boolean
}

export interface BudgetTotals {
  /** The whole group */
  plannedMinor: number
  /** Each member (group rows divided by the member count, rounded) */
  perPersonMinor: number
}

export interface BudgetResponse extends Rev {
  currency: string
  memberCount: number
  rows: BudgetRow[]
  totals: BudgetTotals
}

export interface BudgetCategoryProgress {
  category: BudgetCategory
  /** Group amount (a per-person row times the member count); 0 when not budgeted */
  plannedMinor: number
  /** Spent in this category; null when expenses have no such category (flights, insurance) */
  actualMinor: number | null
  /** planned − actual; null when actual is null */
  remainingMinor: number | null
}

export interface BurnPoint {
  /** YYYY-MM-DD, every day from the trip's start to its end */
  date: string
  /** Spent that day */
  spentMinor: number
  /** Spent up to and including that day (expenses dated before the trip count from day 1) */
  cumulativeMinor: number
  /** Tracked budget − cumulative */
  remainingMinor: number
  /** The straight line from the tracked budget on day 1 to 0 at the end of the last day */
  idealRemainingMinor: number
}

export interface BudgetProgressResponse extends Rev {
  currency: string
  memberCount: number
  hasBudget: boolean
  categories: BudgetCategoryProgress[]
  totals: {
    plannedMinor: number
    /** Planned in categories expenses can be compared with */
    trackedPlannedMinor: number
    actualMinor: number
    /** trackedPlanned − actual */
    remainingMinor: number
    plannedPerPersonMinor: number
    actualPerPersonMinor: number
  }
  /** Each member's share of the expenses (expenseShares), for the per-person view */
  members: { memberId: string; shareMinor: number }[]
  burn: BurnPoint[]
}

// ---- Notes --------------------------------------------------------------------------------------

export interface Note {
  id: string
  tripId: string
  section: NoteSection
  title: string
  body: string
  order: number
  templateKey: string | null
  shareable: boolean
  rev: number
  createdAt: string
  updatedAt: string
}

export interface NotesResponse extends Rev {
  notes: Note[]
}

export interface NoteResponse extends Rev {
  note: Note
}

export interface ApplyNotesResponse extends Rev {
  added: number
  notes: Note[]
}

// ---- Documents ----------------------------------------------------------------------------------

export interface TripDocument extends Attachment {
  docCategory: DocCategory | null
}

export interface DocumentsResponse extends Rev {
  documents: TripDocument[]
}

export interface DocumentResponse extends Rev {
  document: TripDocument
}
