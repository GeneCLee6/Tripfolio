// Text helpers for components: MoneyField's text <-> integer minor units (string arithmetic only,
// never floats) and Avatar's initial

/**
 * Parses what the user typed into integer minor units, by string (never float math): `12.5` AUD is
 * 1250, `15000` IDR is 15000. Thousands separators and spaces are ignored. Returns null for an empty
 * field and 'invalid' for anything else that is not a non-negative amount with at most `digits`
 * decimals.
 */
export function parseAmount(text: string, digits: number): number | null | 'invalid' {
  const cleaned = text.replace(/[\s,]/g, '')
  if (cleaned === '') return null
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned)
  if (!match || (match[1] === '' && !match[2])) return 'invalid'
  const [, whole, fraction = ''] = match
  if (fraction.length > digits) return 'invalid'
  const minor = Number(`${whole || '0'}${fraction.padEnd(digits, '0')}`)
  return Number.isSafeInteger(minor) ? minor : 'invalid'
}

/** Minor units back into the plain text the input shows (no grouping, so it parses back) */
export function amountText(minor: number | null, digits: number): string {
  if (minor === null) return ''
  if (digits === 0) return String(minor)
  const padded = String(Math.abs(minor)).padStart(digits + 1, '0')
  return `${minor < 0 ? '-' : ''}${padded.slice(0, -digits)}.${padded.slice(-digits)}`
}

/** First character of a name (a whole grapheme, so CJK and emoji work), upper-cased */
export function initialOf(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next()
  return (first.done ? trimmed[0] : first.value.segment).toLocaleUpperCase()
}
