import { z } from 'zod'
import { currencyCode, entityId } from './common.ts'
import type { StopType } from './stop.ts'

// Wishlist (e5-t01): must-eat / must-buy / must-see / experiences (docs/PRD/e5-wishlist.md)

export const wishlistCategories = ['eat', 'buy', 'see', 'experience'] as const
export const wishlistCategory = z.enum(wishlistCategories)
export type WishlistCategory = z.infer<typeof wishlistCategory>

/**
 * wish: in the pocket list · scheduled: has a stop · done · dropped.
 * Invariant kept by the API: wish and dropped have no stopId, scheduled has one, done may have one.
 * `scheduled` is only reached through POST …/schedule (or PATCH back from done while the stop exists).
 */
export const wishlistStatuses = ['wish', 'scheduled', 'done', 'dropped'] as const
export const wishlistStatus = z.enum(wishlistStatuses)
export type WishlistStatus = z.infer<typeof wishlistStatus>

/** The stop type a scheduled item gets */
export const wishlistStopType: Record<WishlistCategory, StopType> = {
  eat: 'food',
  buy: 'shopping',
  see: 'sight',
  experience: 'other',
}

const httpUrl = z.url({ protocol: /^https?$/ }).max(2000)

const itemFields = {
  category: wishlistCategory,
  name: z.string().trim().min(1).max(200),
  /** Optional: "any supermarket" has no place */
  placeId: entityId.nullable(),
  photoAttachmentId: entityId.nullable(),
  /** Estimated price, integer minor units of `currency` (RULES.md §3) */
  estMinor: z.number().int().min(0).nullable(),
  currency: currencyCode.nullable(),
  sourceUrl: httpUrl.nullable(),
  sourceTitle: z.string().trim().max(300).nullable(),
  sourceImageUrl: httpUrl.nullable(),
  recommenderMemberId: entityId.nullable(),
  note: z.string().max(5000),
  /** Fractional sort key within the trip's wishlist */
  order: z.number().finite(),
}

const needsCurrency = {
  message: 'currency is required with estMinor',
  path: ['currency'],
}

export const wishlistItemCreateSchema = z
  .object({
    category: itemFields.category,
    name: itemFields.name,
    placeId: itemFields.placeId.default(null),
    photoAttachmentId: itemFields.photoAttachmentId.default(null),
    estMinor: itemFields.estMinor.default(null),
    currency: itemFields.currency.default(null),
    sourceUrl: itemFields.sourceUrl.default(null),
    sourceTitle: itemFields.sourceTitle.default(null),
    sourceImageUrl: itemFields.sourceImageUrl.default(null),
    recommenderMemberId: itemFields.recommenderMemberId.default(null),
    note: itemFields.note.default(''),
    /** Omitted: after the last item */
    order: itemFields.order.optional(),
  })
  .refine((i) => i.estMinor === null || i.currency !== null, needsCurrency)
export type WishlistItemCreate = z.infer<typeof wishlistItemCreateSchema>

/** status: wish / done / dropped / scheduled, within the invariant above (422 otherwise) */
export const wishlistItemPatchSchema = z.object({ ...itemFields, status: wishlistStatus }).partial()
export type WishlistItemPatch = z.infer<typeof wishlistItemPatchSchema>

export const wishlistQuerySchema = z.object({
  status: wishlistStatus.optional(),
  category: wishlistCategory.optional(),
})

const claimFields = {
  /** Who buys it; null = not decided yet */
  buyerMemberId: entityId.nullable(),
  /** Who it is for (free text: family back home are not members) */
  forName: z.string().trim().max(100),
  qty: z.number().int().min(1).max(999),
  done: z.boolean(),
}

export const wishlistClaimCreateSchema = z.object({
  buyerMemberId: claimFields.buyerMemberId.default(null),
  forName: claimFields.forName.default(''),
  qty: claimFields.qty.default(1),
  done: claimFields.done.default(false),
})
export type WishlistClaimCreate = z.infer<typeof wishlistClaimCreateSchema>

export const wishlistClaimPatchSchema = z.object(claimFields).partial()
export type WishlistClaimPatch = z.infer<typeof wishlistClaimPatchSchema>

export const wishlistScheduleSchema = z.object({
  dayId: entityId,
  /** Omitted: append at the end of the day; null: first; an id: right after that stop */
  afterStopId: entityId.nullable().optional(),
})
export type WishlistSchedule = z.infer<typeof wishlistScheduleSchema>
