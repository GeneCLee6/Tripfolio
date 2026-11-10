// Field-level "last writer wins" for an editor that stays open while others change the same record
// (e2-t08b, PRD E2 多人編輯). Three versions of each field:
//   base   – what the editor started from (the record as last seen from the server)
//   local  – what the form holds now
//   remote – the record as the server has it now
// A field the person has not touched (local equals base) silently takes the remote value; a field
// they changed keeps their value; when the remote value also changed (and differs from theirs),
// the field is a conflict: the local value stays and the form can offer 「使用他們的版本」.
// Saving then sends only the fields that differ from the latest remote version, so the server's
// own per-field write never overwrites a field the person did not change.

export type Fields = Record<string, unknown>

/** Deep enough for form values: primitives, arrays and plain objects */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
  }
  const ka = Object.keys(a as Fields)
  const kb = Object.keys(b as Fields)
  return (
    ka.length === kb.length && ka.every((key) => sameValue((a as Fields)[key], (b as Fields)[key]))
  )
}

export interface MergeResult<T extends Fields> {
  /** What the form should hold now */
  merged: T
  /** Fields the person changed that someone else changed too: their (remote) value */
  conflicts: Partial<T>
  /** Fields that took the remote value silently */
  updated: (keyof T)[]
}

export function mergeFields<T extends Fields>(base: T, local: T, remote: T): MergeResult<T> {
  const merged = { ...local }
  const conflicts: Partial<T> = {}
  const updated: (keyof T)[] = []
  for (const key of Object.keys(remote) as (keyof T)[]) {
    const touched = !sameValue(local[key], base[key])
    if (!touched) {
      if (!sameValue(local[key], remote[key])) {
        merged[key] = remote[key]
        updated.push(key)
      }
      continue
    }
    const remoteChanged = !sameValue(remote[key], base[key])
    if (remoteChanged && !sameValue(remote[key], local[key])) conflicts[key] = remote[key]
  }
  return { merged, conflicts, updated }
}

/** The fields of `next` that differ from `base` (what a PATCH should carry) */
export function changedFields<T extends Fields>(base: T, next: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (!sameValue(next[key], base[key])) out[key] = next[key]
  }
  return out
}

/**
 * Conflicts still worth showing after another remote change: a newer remote value replaces an
 * older one, and a conflict disappears once the remote value equals the local one again.
 */
export function carryConflicts<T extends Fields>(
  previous: Partial<T>,
  next: Partial<T>,
  local: T,
): Partial<T> {
  const out: Partial<T> = { ...previous, ...next }
  for (const key of Object.keys(out) as (keyof T)[]) {
    if (sameValue(out[key], local[key])) delete out[key]
  }
  return out
}
