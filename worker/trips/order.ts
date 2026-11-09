// Fractional ordering of stops within a day (E2 設計方向): a new position takes the midpoint of its
// neighbours, so an insert or move writes one row. When the gap gets too small for a midpoint the
// day is renumbered 1..n first.

export interface Ordered {
  id: string
  order: number
}

/** Below this gap between neighbours the day is renumbered */
export const MIN_ORDER_GAP = 1e-6

export function orderBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1
  if (prev === null) return (next as number) - 1
  if (next === null) return prev + 1
  return (prev + next) / 2
}

export interface Placement {
  /** The order for the placed stop */
  order: number
  /** Other stops whose order must be rewritten first (empty unless the day was renumbered) */
  renumbered: Ordered[]
}

/**
 * Where a stop goes among `siblings` (the day's other stops, sorted by order, not including the
 * stop being placed). `afterId`: null = first, 'end' = last, otherwise right after that sibling.
 * Returns null when `afterId` is not among the siblings.
 */
export function planPlacement(
  siblings: Ordered[],
  afterId: string | null | 'end',
): Placement | null {
  let position: number
  if (afterId === null) position = 0
  else if (afterId === 'end') position = siblings.length
  else {
    const index = siblings.findIndex((s) => s.id === afterId)
    if (index < 0) return null
    position = index + 1
  }
  const prev = position > 0 ? siblings[position - 1].order : null
  const next = position < siblings.length ? siblings[position].order : null
  if (prev === null || next === null || next - prev >= MIN_ORDER_GAP) {
    return { order: orderBetween(prev, next), renumbered: [] }
  }
  // Renumber 1..n, keeping the current sequence, then take the midpoint of the new neighbours
  const renumbered = siblings
    .map((s, i) => ({ id: s.id, order: i + 1 }))
    .filter((s, i) => s.order !== siblings[i].order)
  return { order: position + 0.5, renumbered }
}
