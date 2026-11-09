import type { ExpenseCategory } from '../../../shared/schema/expense.ts'
import { CATEGORIES } from './form.ts'

// What the 記一筆 form remembers per trip on this device: the last currency and the last three
// categories (the quick picks). localStorage can throw (private mode, quota): then memory only.

const STORAGE_KEY = 'tripfolio.expenseRecent'
const QUICK_PICKS = 3

export interface RecentExpenseChoices {
  currency: string | null
  /** Most recent first, at most three, no repeats */
  categories: ExpenseCategory[]
}

type Store = Record<string, RecentExpenseChoices>

let memory: Store = {}

function read(): Store {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return memory
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Store) : memory
  } catch {
    return memory
  }
}

function write(store: Store): void {
  memory = store
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Memory only
  }
}

const isCategory = (value: unknown): value is ExpenseCategory =>
  typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)

export function loadRecent(tripId: string): RecentExpenseChoices {
  const entry = read()[tripId]
  return {
    currency: typeof entry?.currency === 'string' ? entry.currency : null,
    categories: Array.isArray(entry?.categories)
      ? entry.categories.filter(isCategory).slice(0, QUICK_PICKS)
      : [],
  }
}

/** Call after a save: this currency becomes the default, this category the first quick pick */
export function rememberExpense(
  tripId: string,
  choice: { currency: string; category: ExpenseCategory },
): RecentExpenseChoices {
  const store = read()
  const previous = loadRecent(tripId)
  const next: RecentExpenseChoices = {
    currency: choice.currency,
    categories: [
      choice.category,
      ...previous.categories.filter((c) => c !== choice.category),
    ].slice(0, QUICK_PICKS),
  }
  write({ ...store, [tripId]: next })
  return next
}

/** Tests: forget everything */
export function clearRecent(): void {
  write({})
}
