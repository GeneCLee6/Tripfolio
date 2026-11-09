import { z } from 'zod'
import { colorValue, entityId } from './common.ts'

export const dayPatchSchema = z
  .object({
    title: z.string().trim().max(120),
    color: colorValue.nullable(),
    note: z.string().max(5000),
    lodgingId: entityId.nullable(),
  })
  .partial()
export type DayPatch = z.infer<typeof dayPatchSchema>
