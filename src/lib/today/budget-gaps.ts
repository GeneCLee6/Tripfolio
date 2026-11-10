import type { BudgetCategoryProgress } from '../../../shared/api/prep.ts'

// The statistics page's budget card (E9 wiring, AC-9.1): the categories furthest from their
// budget, over or under. Lives beside the home helpers because this batch may only add files here;
// it has no React and no page code.

/**
 * Budgeted categories that expenses can be compared with, by how far actual is from planned
 * (largest gap first, overspends before underspends on a tie), at most `limit`.
 */
export function budgetGaps(
  categories: readonly BudgetCategoryProgress[],
  limit = 3,
): (BudgetCategoryProgress & { remainingMinor: number })[] {
  return categories
    .filter(
      (c): c is BudgetCategoryProgress & { remainingMinor: number } =>
        c.plannedMinor > 0 && c.remainingMinor !== null,
    )
    .sort(
      (a, b) =>
        Math.abs(b.remainingMinor) - Math.abs(a.remainingMinor) ||
        a.remainingMinor - b.remainingMinor ||
        a.category.localeCompare(b.category),
    )
    .slice(0, limit)
}
