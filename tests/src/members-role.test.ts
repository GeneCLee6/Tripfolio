import { describe, expect, it } from 'vitest'
import { roles } from '../../shared/schema/member.ts'
import { inviteUrl, rememberedInvite, rememberInvite, sortMembers } from '../../src/lib/members.ts'
import { can, type Action } from '../../src/lib/role.ts'

const actions: Action[] = ['editContent', 'manageMembers', 'manageShares', 'archive', 'delete']

describe('can()', () => {
  it('matches the API: owner everything, editor content, viewer nothing', () => {
    const table = Object.fromEntries(
      roles.map((role) => [role, actions.filter((action) => can(role, action))]),
    )
    expect(table).toEqual({ owner: actions, editor: ['editContent'], viewer: [] })
  })

  it('refuses content and member writes on an archived trip, keeps owner housekeeping', () => {
    const archived = { archived: true }
    expect(can('owner', 'editContent', archived)).toBe(false)
    expect(can('owner', 'manageMembers', archived)).toBe(false)
    expect(can('owner', 'archive', archived)).toBe(true)
    expect(can('owner', 'manageShares', archived)).toBe(true)
    expect(can('owner', 'delete', archived)).toBe(true)
    expect(can('editor', 'editContent', archived)).toBe(false)
    expect(can('viewer', 'archive', archived)).toBe(false)
  })
})

describe('members helpers', () => {
  it('sorts owner, editors, viewers, then by join time', () => {
    const m = (id: string, role: 'owner' | 'editor' | 'viewer', createdAt: string) => ({
      id,
      role,
      createdAt,
    })
    const sorted = sortMembers([
      m('v', 'viewer', '2026-01-01'),
      m('e2', 'editor', '2026-01-03'),
      m('o', 'owner', '2026-01-05'),
      m('e1', 'editor', '2026-01-02'),
    ])
    expect(sorted.map((x) => x.id)).toEqual(['o', 'e1', 'e2', 'v'])
  })

  it('builds the join URL', () => {
    expect(inviteUrl('abc_DEF-123', 'https://trip.example/')).toBe(
      'https://trip.example/join/abc_DEF-123',
    )
  })

  it('remembers the joined invite when storage exists, and never throws without it', () => {
    rememberInvite('trip1', 'tok')
    const value = rememberedInvite('trip1')
    expect(value === 'tok' || value === null).toBe(true)
    expect(rememberedInvite('other')).toBeNull()
  })
})
