import type { Place } from '../../../shared/api/types.ts'
import { foldText } from './library.ts'

// Finding places that are probably the same one (e3-t05, AC-3.4): the same search result, the same
// name close by, or two pins almost on top of each other. The page offers to merge each group.

/** Same (folded) name within this distance: the same place */
export const SAME_NAME_RADIUS_M = 100
/** Any two places closer than this: the same place */
export const SAME_SPOT_RADIUS_M = 25

export type DuplicateReason = 'externalId' | 'name' | 'distance'

export interface DuplicateGroup {
  /** Two or more places, the suggested merge target first */
  places: Place[]
  /** Why its members were put together (each rule that linked at least one pair) */
  reasons: DuplicateReason[]
}

const EARTH_RADIUS_M = 6_371_000

/** Great-circle distance in metres */
export function distanceM(a: Pick<Place, 'lat' | 'lng'>, b: Pick<Place, 'lat' | 'lng'>): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The folded names of a place (local and English), without empty ones */
function names(place: Pick<Place, 'nameLocal' | 'nameEn'>): string[] {
  return [place.nameLocal, place.nameEn].map(foldText).filter(Boolean)
}

type Comparable = Pick<Place, 'nameLocal' | 'nameEn' | 'lat' | 'lng' | 'externalId'>

/** Why `a` and `b` look like the same place, or null */
export function duplicateReason(a: Comparable, b: Comparable): DuplicateReason | null {
  if (a.externalId && a.externalId === b.externalId) return 'externalId'
  const d = distanceM(a, b)
  if (d < SAME_SPOT_RADIUS_M) return 'distance'
  if (d <= SAME_NAME_RADIUS_M) {
    const other = names(b)
    if (names(a).some((name) => other.includes(name))) return 'name'
  }
  return null
}

const REASON_ORDER: readonly DuplicateReason[] = ['externalId', 'name', 'distance']

/**
 * Groups of likely duplicates (pairs joined transitively). Each group lists the suggested target
 * first: the most referenced place, then one with a search id, then the oldest. Groups come in the
 * order of their target's creation.
 */
export function findDuplicateGroups(
  places: readonly Place[],
  refs: ReadonlyMap<string, number> = new Map(),
): DuplicateGroup[] {
  const parent = places.map((_, i) => i)
  const find = (i: number): number => {
    let at = i
    while (parent[at] !== at) {
      parent[at] = parent[parent[at]]
      at = parent[at]
    }
    return at
  }
  const links: [number, DuplicateReason][] = []
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      const reason = duplicateReason(places[i], places[j])
      if (!reason) continue
      links.push([i, reason])
      const ri = find(i)
      const rj = find(j)
      if (ri !== rj) parent[rj] = ri
    }
  }
  const reasons = new Map<number, Set<DuplicateReason>>()
  for (const [i, reason] of links) {
    const root = find(i)
    const set = reasons.get(root) ?? new Set<DuplicateReason>()
    set.add(reason)
    reasons.set(root, set)
  }
  const members = new Map<number, Place[]>()
  places.forEach((place, i) => {
    const root = find(i)
    members.set(root, [...(members.get(root) ?? []), place])
  })
  const rank = (a: Place, b: Place) =>
    (refs.get(b.id) ?? 0) - (refs.get(a.id) ?? 0) ||
    Number(Boolean(b.externalId)) - Number(Boolean(a.externalId)) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  const groups: DuplicateGroup[] = []
  for (const [root, list] of members) {
    if (list.length < 2) continue
    const found = reasons.get(root) ?? new Set<DuplicateReason>()
    groups.push({
      places: [...list].sort(rank),
      reasons: REASON_ORDER.filter((reason) => found.has(reason)),
    })
  }
  return groups.sort((a, b) => a.places[0].createdAt.localeCompare(b.places[0].createdAt))
}
