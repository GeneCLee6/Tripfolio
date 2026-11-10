import type { Checklist, ChecklistItem } from '../../../shared/api/prep.ts'
import type { ChecklistKind } from '../../../shared/schema/prep.ts'

// Pure helpers for the checklists page (e9-t03): progress, moving an item up or down, overdue.

export function progressOf(lists: readonly Checklist[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const list of lists)
    for (const item of list.items) {
      total += 1
      if (item.done) done += 1
    }
  return { done, total }
}

export const listsOfKind = (lists: readonly Checklist[], kind: ChecklistKind): Checklist[] =>
  lists.filter((list) => list.kind === kind)

/**
 * The new `order` for moving `items[index]` one place up (-1) or down (+1): swapping with the
 * neighbour is two writes, so it takes the midpoint beyond the neighbour instead (one write).
 * null at either end.
 */
export function moveOrder(
  items: readonly Pick<ChecklistItem, 'order'>[],
  index: number,
  direction: -1 | 1,
): number | null {
  const target = index + direction
  if (target < 0 || target >= items.length) return null
  const neighbour = items[target].order
  const beyond = items[target + direction]
  if (!beyond) return direction === -1 ? neighbour - 1 : neighbour + 1
  return (neighbour + beyond.order) / 2
}

/** Not done and due before `today` (both YYYY-MM-DD) */
export const isOverdue = (item: Pick<ChecklistItem, 'done' | 'dueAt'>, today: string): boolean =>
  !item.done && item.dueAt !== null && item.dueAt < today

/** Replaces one item inside the lists (after a PATCH answered with it) */
export function withItem(lists: readonly Checklist[], item: ChecklistItem): Checklist[] {
  return lists.map((list) =>
    list.id !== item.checklistId
      ? list
      : {
          ...list,
          items: list.items
            .map((i) => (i.id === item.id ? item : i))
            .sort((a, b) => a.order - b.order),
        },
  )
}
