import { z } from 'zod'
import {
  colorValue,
  currencyCode,
  entityId,
  ianaTimeZone,
  isoDate,
  latitude,
  longitude,
} from './common.ts'
import { memberIdentity } from './member.ts'

export const tripStyles = [
  'roadtrip',
  'campervan',
  'private-driver',
  'city',
  'island',
  'rail',
  'other',
] as const
export const tripStyle = z.enum(tripStyles)
export type TripStyle = z.infer<typeof tripStyle>

/** The longest trip the API accepts: every date gets a Day row */
export const MAX_TRIP_DAYS = 90

// Editable trip fields without defaults: the base for PATCH (zod 4 applies defaults even inside
// optional fields, so the create schema adds them separately)
const tripFields = {
  name: z.string().trim().min(1).max(120),
  destination: z.string().trim().max(200),
  centerLat: latitude.nullable(),
  centerLng: longitude.nullable(),
  startDate: isoDate,
  endDate: isoDate,
  tz: ianaTimeZone,
  baseCurrency: currencyCode,
  secondaryCurrency: currencyCode.nullable(),
  localCurrencies: z.array(currencyCode).max(10),
  coverColor: colorValue.nullable(),
  coverAttachmentId: entityId.nullable(),
  summary: z.string().trim().max(300),
  style: tripStyle,
  /** Daily driving limit in minutes; null means the style's default (E2) */
  driveLimitMin: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .nullable(),
}

export const tripCreateSchema = z
  .object({
    ...tripFields,
    destination: tripFields.destination.default(''),
    centerLat: tripFields.centerLat.default(null),
    centerLng: tripFields.centerLng.default(null),
    baseCurrency: tripFields.baseCurrency.default('AUD'),
    secondaryCurrency: tripFields.secondaryCurrency.default('TWD'),
    localCurrencies: tripFields.localCurrencies.default([]),
    coverColor: tripFields.coverColor.default(null),
    coverAttachmentId: tripFields.coverAttachmentId.default(null),
    summary: tripFields.summary.default(''),
    style: tripFields.style.default('other'),
    driveLimitMin: tripFields.driveLimitMin.default(null),
    /** The creator becomes the owner member */
    owner: memberIdentity,
  })
  .refine((t) => t.endDate >= t.startDate, {
    message: 'endDate before startDate',
    path: ['endDate'],
  })
export type TripCreate = z.infer<typeof tripCreateSchema>

export const tripPatchSchema = z
  .object({
    ...tripFields,
    /** Owner only: true archives (read-only), false restores */
    archived: z.boolean(),
  })
  .partial()
export type TripPatch = z.infer<typeof tripPatchSchema>
