import { z } from 'zod'
import { colorValue, entityId } from './common.ts'

export const roles = ['owner', 'editor', 'viewer'] as const
export const role = z.enum(roles)
export type Role = z.infer<typeof role>

/** What a person picks when they create themselves: name and avatar colour */
export const memberIdentity = z.object({
  name: z.string().trim().min(1).max(60),
  color: colorValue,
})

/** Owner adds a member (someone not on the app yet, or a child as viewer) */
export const memberCreateSchema = memberIdentity.extend({
  email: z.email().max(200).nullable().default(null),
  role: z.enum(['editor', 'viewer']).default('editor'),
})
export type MemberCreate = z.infer<typeof memberCreateSchema>

/** name/color/email: owner or the member themselves; role: owner only, never to or from owner */
export const memberPatchSchema = z
  .object({
    name: memberIdentity.shape.name,
    color: colorValue,
    email: z.email().max(200).nullable(),
    role: z.enum(['editor', 'viewer']),
  })
  .partial()
export type MemberPatch = z.infer<typeof memberPatchSchema>

/** POST /api/join/:inviteToken: claim an existing member, or create a new one (editor) */
export const joinSchema = z.union([z.object({ memberId: entityId }), memberIdentity])
export type JoinBody = z.infer<typeof joinSchema>
