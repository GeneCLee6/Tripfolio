import { z } from 'zod'
import { currencyCode, entityId, isoDateTime, linkList } from './common.ts'

export const stopTypes = [
  'sight',
  'food',
  'shopping',
  'lodging',
  'transport',
  'fuel',
  'supplies',
  'rest',
  'other',
] as const
export const stopType = z.enum(stopTypes)
export type StopType = z.infer<typeof stopType>

/** none: no booking needed; todo: needs booking, not booked yet; booked */
export const bookingStates = ['none', 'todo', 'booked'] as const
export const bookingState = z.enum(bookingStates)
export type BookingState = z.infer<typeof bookingState>

/** Leg override modes; legOverrides.mode has no CHECK in SQL, so this list is the only gate */
export const legModes = ['drive', 'walk', 'cycle', 'transit', 'flight', 'ferry', 'other'] as const
export const legMode = z.enum(legModes)
export type LegMode = z.infer<typeof legMode>

const minutes = z
  .number()
  .int()
  .min(0)
  .max(7 * 24 * 60)

const stopFields = {
  type: stopType,
  title: z.string().trim().max(200),
  placeId: entityId.nullable(),
  startAt: isoDateTime.nullable(),
  endAt: isoDateTime.nullable(),
  durationMin: minutes.nullable(),
  /** Integer minor units of `currency` (RULES.md §3) */
  costMinor: z.number().int().min(0).nullable(),
  currency: currencyCode.nullable(),
  booking: bookingState,
  note: z.string().max(5000),
  links: linkList,
  wishlistItemId: entityId.nullable(),
  bookingId: entityId.nullable(),
  /** Rainy-day alternative: left out of the day's totals (E2) */
  isBackup: z.boolean(),
}

export const stopCreateSchema = z
  .object({
    dayId: entityId,
    /** Omitted: append at the end of the day; null: first; an id: right after that stop */
    afterStopId: entityId.nullable().optional(),
    type: stopFields.type.default('sight'),
    title: stopFields.title.default(''),
    placeId: stopFields.placeId.default(null),
    startAt: stopFields.startAt.default(null),
    endAt: stopFields.endAt.default(null),
    durationMin: stopFields.durationMin.default(null),
    costMinor: stopFields.costMinor.default(null),
    currency: stopFields.currency.default(null),
    booking: stopFields.booking.default('none'),
    note: stopFields.note.default(''),
    links: stopFields.links.default([]),
    wishlistItemId: stopFields.wishlistItemId.default(null),
    bookingId: stopFields.bookingId.default(null),
    isBackup: stopFields.isBackup.default(false),
  })
  .refine((s) => s.costMinor === null || s.currency !== null, {
    message: 'currency is required with costMinor',
    path: ['currency'],
  })
export type StopCreate = z.infer<typeof stopCreateSchema>

/** Moving between days or reordering goes through /move, not PATCH */
export const stopPatchSchema = z.object(stopFields).partial()
export type StopPatch = z.infer<typeof stopPatchSchema>

export const stopMoveSchema = z.object({
  dayId: entityId,
  /** null: first in the day */
  afterStopId: entityId.nullable(),
})
export type StopMove = z.infer<typeof stopMoveSchema>

export const legOverrideSchema = z.object({
  mode: legMode,
  /** null: keep the routed time, only override the mode */
  minutes: minutes.nullable().default(null),
})
export type LegOverrideInput = z.infer<typeof legOverrideSchema>
