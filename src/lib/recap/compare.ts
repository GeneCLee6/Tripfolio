// Planned vs actual for the recap page (e8-t04): the two bars share one scale (the larger amount
// fills the track) and the difference says whether the day went over or under its estimate.

export type CompareTone = 'over' | 'under' | 'even' | 'none'

export interface Comparison {
  /** Bar widths as fractions of the track, 0..1 */
  estimateRatio: number
  actualRatio: number
  /** actual − estimate, minor units */
  diffMinor: number
  tone: CompareTone
}

export function compare(estimateMinor: number, actualMinor: number): Comparison {
  const max = Math.max(estimateMinor, actualMinor)
  const diffMinor = actualMinor - estimateMinor
  return {
    estimateRatio: max > 0 ? estimateMinor / max : 0,
    actualRatio: max > 0 ? actualMinor / max : 0,
    diffMinor,
    tone: max === 0 ? 'none' : diffMinor > 0 ? 'over' : diffMinor < 0 ? 'under' : 'even',
  }
}

/** Paragraphs of a recap text: blank lines separate them, single newlines stay line breaks */
export function paragraphs(body: string): string[][] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((line) => line.trimEnd()))
    .filter((lines) => lines.some((line) => line.trim() !== ''))
}
