import { z } from 'zod'
import { latitude, linkList, longitude } from './common.ts'

export const placeSources = ['manual', 'photon', 'nominatim', 'link', 'coords'] as const
export const placeSource = z.enum(placeSources)
export type PlaceSource = z.infer<typeof placeSource>

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM')

/** Opening hours: free text from the source and/or structured periods (0 = Sunday) */
export const placeHours = z.object({
  text: z.string().max(500).optional(),
  periods: z
    .array(z.object({ day: z.number().int().min(0).max(6), open: hhmm, close: hhmm }))
    .max(50)
    .optional(),
})
export type PlaceHours = z.infer<typeof placeHours>

const placeFields = {
  /** Name in the local language; the UI falls back to it when nameEn is empty */
  nameLocal: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().max(200),
  lat: latitude,
  lng: longitude,
  address: z.string().trim().max(500),
  category: z.string().trim().max(40),
  source: placeSource,
  hours: placeHours.nullable(),
  links: linkList,
}

export const placeCreateSchema = z.object({
  ...placeFields,
  nameEn: placeFields.nameEn.default(''),
  address: placeFields.address.default(''),
  category: placeFields.category.default('other'),
  source: placeFields.source.default('manual'),
  hours: placeFields.hours.default(null),
  links: placeFields.links.default([]),
})
export type PlaceCreate = z.infer<typeof placeCreateSchema>

export const placePatchSchema = z.object(placeFields).partial()
export type PlacePatch = z.infer<typeof placePatchSchema>
