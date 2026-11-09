import { z } from 'zod'

/** Share link options; documents are always hidden and are not an option (E1) */
export const shareOptionsSchema = z.object({
  hideMoney: z.boolean().default(false),
  /** Lodging addresses and booking references */
  hideAddresses: z.boolean().default(false),
  showRecap: z.boolean().default(false),
})
export type ShareOptions = z.infer<typeof shareOptionsSchema>

export const shareCreateSchema = z.object({
  options: shareOptionsSchema.default({ hideMoney: false, hideAddresses: false, showRecap: false }),
})
export type ShareCreate = z.infer<typeof shareCreateSchema>
