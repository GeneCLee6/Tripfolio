import { z } from 'zod'
import { currencyCode, entityId, isoDate, isoDateTime } from './common.ts'

// Lodgings (e4-t01): one row per stay, several nights (docs/PRD/e4-lodging-transport-bookings.md)

/** unpaid · deposit (part paid) · paid in full; shared with bookings */
export const payStatuses = ['unpaid', 'deposit', 'paid'] as const
export const payStatus = z.enum(payStatuses)
export type PayStatus = z.infer<typeof payStatus>

/** Campervan site kinds (01-travel-domain-notes.md §9) */
export const campTypes = ['holiday-park', 'doc', 'freedom'] as const
export const campType = z.enum(campTypes)
export type CampType = z.infer<typeof campType>

/** Local wall-clock time HH:mm (24-hour) */
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm')
/** Local wall-clock date-time YYYY-MM-DDTHH:mm, converted to UTC by the Worker */
export const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'YYYY-MM-DDTHH:mm')

export const campFacilitiesSchema = z.object({
  power: z.boolean().default(false),
  water: z.boolean().default(false),
  dump: z.boolean().default(false),
})
export type CampFacilities = z.infer<typeof campFacilitiesSchema>

const shortText = (max: number) => z.string().trim().max(max)

const lodgingFields = {
  placeId: entityId.nullable(),
  name: z.string().trim().min(1).max(200),
  checkIn: isoDate,
  /** The morning you leave; the nights are [checkIn, checkOut) */
  checkOut: isoDate,
  checkInTime: hhmm.nullable(),
  checkOutTime: hhmm.nullable(),
  roomType: shortText(200).nullable(),
  guests: z.number().int().min(1).max(99).nullable(),
  platform: shortText(100).nullable(),
  ref: shortText(100).nullable(),
  /** Integer minor units of `currency` (RULES.md §3) */
  priceMinor: z.number().int().min(0).nullable(),
  currency: currencyCode.nullable(),
  payStatus,
  /** UTC instant; or send `cancelByLocal` (YYYY-MM-DDTHH:mm in the trip's zone) instead */
  cancelBy: isoDateTime.nullable(),
  cancelByLocal: localDateTime.nullable(),
  phone: shortText(50).nullable(),
  campType: campType.nullable(),
  campFacilities: campFacilitiesSchema.nullable(),
  note: z.string().max(5000),
}

/** At most this many nights in one lodging row */
export const MAX_LODGING_NIGHTS = 90

export const lodgingCreateSchema = z
  .object({
    placeId: lodgingFields.placeId.default(null),
    name: lodgingFields.name,
    checkIn: lodgingFields.checkIn,
    checkOut: lodgingFields.checkOut,
    checkInTime: lodgingFields.checkInTime.default(null),
    checkOutTime: lodgingFields.checkOutTime.default(null),
    roomType: lodgingFields.roomType.default(null),
    guests: lodgingFields.guests.default(null),
    platform: lodgingFields.platform.default(null),
    ref: lodgingFields.ref.default(null),
    priceMinor: lodgingFields.priceMinor.default(null),
    currency: lodgingFields.currency.default(null),
    payStatus: lodgingFields.payStatus.default('unpaid'),
    cancelBy: lodgingFields.cancelBy.default(null),
    cancelByLocal: lodgingFields.cancelByLocal.optional(),
    phone: lodgingFields.phone.default(null),
    campType: lodgingFields.campType.default(null),
    campFacilities: lodgingFields.campFacilities.default(null),
    note: lodgingFields.note.default(''),
  })
  .refine((l) => l.priceMinor === null || l.currency !== null, {
    message: 'currency is required with priceMinor',
    path: ['currency'],
  })
export type LodgingCreate = z.infer<typeof lodgingCreateSchema>

/** Cross-field rules (dates, currency) are checked by the Worker on the merged row */
export const lodgingPatchSchema = z.object(lodgingFields).partial()
export type LodgingPatch = z.infer<typeof lodgingPatchSchema>
