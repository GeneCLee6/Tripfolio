import { z } from 'zod'
import { currencyCode, entityId, ianaTimeZone, isoDateTime } from './common.ts'
import { hhmm, localDateTime, payStatus } from './lodging.ts'

// Transport and activity bookings (e4-t01): one `bookings` table, `type` + `details` JSON validated
// per type here (docs/PRD/e4-lodging-transport-bookings.md, 01-travel-domain-notes.md §5, §9b).

export const bookingTypes = [
  'flight',
  'rental',
  'driver',
  'ferry',
  'rail',
  'bus',
  'activity',
] as const
export const bookingType = z.enum(bookingTypes)
export type BookingType = z.infer<typeof bookingType>

const text = (max = 200) => z.string().trim().max(max)
const required = (max = 200) => z.string().trim().min(1).max(max)
const minor = z.number().int().min(0)

export const flightDetailsSchema = z.object({
  airline: required(100),
  flightNo: required(20),
  /** IATA code or a name */
  fromAirport: required(100),
  toAirport: required(100),
  fromTerminal: text(20).optional(),
  toTerminal: text(20).optional(),
  baggage: text(200).optional(),
})

/** Car or campervan hire */
export const rentalDetailsSchema = z.object({
  company: required(100),
  vehicle: required(100),
  pickupPlaceId: entityId.optional(),
  pickupText: text().optional(),
  dropoffPlaceId: entityId.optional(),
  dropoffText: text().optional(),
  insurance: text().optional(),
  /** Insurance excess, minor units of the booking's currency */
  excessMinor: minor.optional(),
  depositMinor: minor.optional(),
  mileageLimit: text(100).optional(),
  /** Campervan self-contained certificate */
  selfContained: z.boolean().optional(),
})

/** Hired car with driver (包車): one pickup stop per day of the range */
export const driverDetailsSchema = z.object({
  driverName: required(100),
  phone: text(50).optional(),
  /** WhatsApp / LINE handle or link */
  messenger: text(200).optional(),
  vehicle: text(100).optional(),
  dailyRateMinor: minor.optional(),
  /** What the daily rate includes, e.g. fuel, parking, tolls */
  includes: z.array(required(50)).max(20).optional(),
  pickupText: text().optional(),
  /** Daily pickup time in the trip's zone; defaults to the time of startAt */
  pickupTime: hhmm.optional(),
})

const routeDetails = {
  operator: text(100).optional(),
  fromText: required(),
  toText: required(),
}
export const ferryDetailsSchema = z.object({
  ...routeDetails,
  /** Vehicle length on board (campervans must declare it), e.g. "7.5 m" */
  vehicleLength: text(50).optional(),
})
export const railDetailsSchema = z.object(routeDetails)
export const busDetailsSchema = z.object(routeDetails)

export const activityDetailsSchema = z.object({
  operator: text(100).optional(),
  meetingPlaceId: entityId.optional(),
  meetingText: text().optional(),
  /** Check in this many minutes before startAt (a 'checkin' deadline) */
  checkInMinutesBefore: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .optional(),
  weatherPolicy: text(1000).optional(),
})

export const bookingDetailsSchemas = {
  flight: flightDetailsSchema,
  rental: rentalDetailsSchema,
  driver: driverDetailsSchema,
  ferry: ferryDetailsSchema,
  rail: railDetailsSchema,
  bus: busDetailsSchema,
  activity: activityDetailsSchema,
} as const

export type FlightDetails = z.infer<typeof flightDetailsSchema>
export type RentalDetails = z.infer<typeof rentalDetailsSchema>
export type DriverDetails = z.infer<typeof driverDetailsSchema>
export type FerryDetails = z.infer<typeof ferryDetailsSchema>
export type RailDetails = z.infer<typeof railDetailsSchema>
export type BusDetails = z.infer<typeof busDetailsSchema>
export type ActivityDetails = z.infer<typeof activityDetailsSchema>
export type BookingDetailsMap = {
  [K in BookingType]: z.infer<(typeof bookingDetailsSchemas)[K]>
}

/**
 * Times: send UTC (`startAt`) or local wall-clock (`startLocal`, read in `startTz`, default the
 * trip's zone; `endLocal` in `endTz`, default the start zone); the Worker stores UTC plus the
 * zones. A flight's startTz / endTz are the two airports' zones.
 */
const bookingFields = {
  title: required(200),
  startAt: isoDateTime.nullable(),
  endAt: isoDateTime.nullable(),
  startLocal: localDateTime.nullable(),
  endLocal: localDateTime.nullable(),
  startTz: ianaTimeZone.nullable(),
  endTz: ianaTimeZone.nullable(),
  priceMinor: minor.nullable(),
  currency: currencyCode.nullable(),
  payStatus,
  payerMemberId: entityId.nullable(),
  cancelBy: isoDateTime.nullable(),
  cancelByLocal: localDateTime.nullable(),
  ref: text(100).nullable(),
  note: z.string().max(5000),
}

const createCommon = {
  title: bookingFields.title,
  startAt: bookingFields.startAt.default(null),
  endAt: bookingFields.endAt.default(null),
  startLocal: bookingFields.startLocal.optional(),
  endLocal: bookingFields.endLocal.optional(),
  startTz: bookingFields.startTz.default(null),
  endTz: bookingFields.endTz.default(null),
  priceMinor: bookingFields.priceMinor.default(null),
  currency: bookingFields.currency.default(null),
  payStatus: bookingFields.payStatus.default('unpaid'),
  payerMemberId: bookingFields.payerMemberId.default(null),
  cancelBy: bookingFields.cancelBy.default(null),
  cancelByLocal: bookingFields.cancelByLocal.optional(),
  ref: bookingFields.ref.default(null),
  note: bookingFields.note.default(''),
}

const createVariant = <T extends BookingType>(type: T) =>
  z.object({ type: z.literal(type), details: bookingDetailsSchemas[type], ...createCommon })

export const bookingCreateSchema = z
  .discriminatedUnion('type', [
    createVariant('flight'),
    createVariant('rental'),
    createVariant('driver'),
    createVariant('ferry'),
    createVariant('rail'),
    createVariant('bus'),
    createVariant('activity'),
  ])
  .refine((b) => b.priceMinor === null || b.currency !== null, {
    message: 'currency is required with priceMinor',
    path: ['currency'],
  })
export type BookingCreate = z.infer<typeof bookingCreateSchema>

/**
 * The type cannot change. `details` is merged over the stored details (a key set to null is
 * removed) and the result validated against the booking's type (422 when it does not fit).
 */
export const bookingPatchSchema = z
  .object({
    ...bookingFields,
    /** Accepted only when it equals the stored type */
    type: bookingType,
    details: z.record(z.string(), z.unknown()),
  })
  .partial()
export type BookingPatch = z.infer<typeof bookingPatchSchema>
