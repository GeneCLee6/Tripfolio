import { useState } from 'react'
import styled from 'styled-components'
import type { Member } from '../../../shared/api/types.ts'
import { Avatar, Button, Card, Chip } from '../../components/index.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { paletteIndex } from '../../lib/colors.ts'
import { useT } from '../../lib/i18n.ts'
import { sortMembers } from '../../lib/members.ts'
import { useCan } from '../../lib/role.ts'
import { color, fontSize, fontWeight, space } from '../../styles/tokens.ts'
import { Count, SectionTitle, Stack } from '../parts.tsx'
import { MemberDialog } from './MemberDialog.tsx'

// Settings → 旅伴 (e1-t03): everyone with their colour, role and "you"; the owner adds, edits,
// re-roles and removes; anyone may fix their own name and colour.

const List = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  > li + li {
    border-top: 1px solid ${color.line};
  }
`

const Item = styled.li`
  display: flex;
  align-items: center;
  gap: ${space.md}px;
  padding: ${space.md}px 0;
`

const Name = styled.span`
  flex: 1;
  min-width: 0;
  font-weight: ${fontWeight.medium};
  overflow-wrap: anywhere;
`

const You = styled.span`
  color: ${color.muted};
  font-weight: ${fontWeight.regular};
`

export const Note = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

export const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.md}px;
`

const roleTone = (role: Member['role']) =>
  role === 'owner' ? 'fjord' : role === 'viewer' ? 'tussock' : 'neutral'

export interface MemberListProps {
  members: readonly Member[]
  meId: string
  /** Who gets an edit button */
  canEdit: (member: Member) => boolean
  onEdit: (member: Member) => void
}

/** The travellers, owner first; "you" is marked */
export function MemberList({ members, meId, canEdit, onEdit }: MemberListProps) {
  const t = useT()
  return (
    <List aria-label={t('settings.members')}>
      {sortMembers(members).map((member) => (
        <Item key={member.id} data-member-id={member.id}>
          <Avatar name={member.name} colorIndex={paletteIndex(member.color, member.id)} />
          <Name>
            {member.name}
            {member.id === meId && <You> · {t('member.you')}</You>}
          </Name>
          <Chip tone={roleTone(member.role)}>{t(`role.${member.role}`)}</Chip>
          {canEdit(member) && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('members.editLabel', { name: member.name })}
              onClick={() => onEdit(member)}
            >
              {t('members.edit')}
            </Button>
          )}
        </Item>
      ))}
    </List>
  )
}

export function MembersSection() {
  const t = useT()
  const can = useCan()
  const { trip, me, members } = useTripContext()
  const [editing, setEditing] = useState<{ member: Member | null } | null>(null)
  const manage = can('manageMembers')
  const archived = Boolean(trip.archivedAt)
  // Owners edit anyone; others only themselves (the API allows a viewer's own name and colour)
  const canEdit = (member: Member) => !archived && (manage || member.id === me.id)

  return (
    <Card as="section" aria-labelledby="settings-members">
      <Stack $gap="md">
        <Row>
          <SectionTitle id="settings-members">
            {t('settings.members')}
            <Count>{members.length}</Count>
          </SectionTitle>
          {manage && (
            <Button size="sm" onClick={() => setEditing({ member: null })}>
              {t('members.add')}
            </Button>
          )}
        </Row>
        <MemberList
          members={members}
          meId={me.id}
          canEdit={canEdit}
          onEdit={(member) => setEditing({ member })}
        />
        {me.role === 'viewer' && <Note>{t('members.viewerNote')}</Note>}
        {archived && <Note>{t('members.archivedNote')}</Note>}
      </Stack>
      <MemberDialog
        open={editing !== null}
        member={editing?.member ?? null}
        onClose={() => setEditing(null)}
      />
    </Card>
  )
}
