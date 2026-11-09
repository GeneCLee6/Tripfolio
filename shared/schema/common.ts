import { z } from 'zod'

// Building blocks shared by the entity schemas. All instants are UTC ISO strings ending in Z; all
// calendar dates are YYYY-MM-DD (ARCHITECTURE.md §3, RULES.md §3).

export const entityId = z.string().min(1).max(64)
export const isoDate = z.iso.date()
export const isoDateTime = z.iso.datetime()
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. AUD')
export const latitude = z.number().min(-90).max(90)
export const longitude = z.number().min(-180).max(180)
/** A colour token name or a hex value; the UI maps it through src/styles/tokens.ts */
export const colorValue = z.string().trim().min(1).max(32)

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const ianaTimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, 'unknown IANA time zone')

export const link = z.object({
  url: z.url({ protocol: /^https?$/ }).max(2000),
  label: z.string().trim().max(120).optional(),
})
export const linkList = z.array(link).max(20)
export type Link = z.infer<typeof link>
