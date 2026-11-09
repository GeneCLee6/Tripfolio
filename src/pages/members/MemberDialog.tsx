import { useState, type FormEvent } from 'react'
import styled from 'styled-components'
import type { Member } from '../../../shared/api/types.ts'
import { Button, ColorSwatches, Dialog, Input, Select, useToast } from '../../components/index.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { api } from '../../lib/api.ts'
import { useT } from '../../lib/i18n.ts'
import { can, useApiErrorToast } from '../../lib/role.ts'
import { color, dayColors, fontSize } from '../../styles/tokens.ts'
import { Stack } from '../parts.tsx'

// Add a traveller (owner) or edit one: the owner edits anyone's name, colour and role (never the
// owner's role) and removes anyone but themselves; everyone else edits only their own name and colour.

const Note = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

type EditableRole = 'editor' | 'viewer'

export interface MemberDialogProps {
  open: boolean
  /** null adds a new member */
  member: Member | null
  onClose: () => void
}

export function MemberDialog({ open, member, onClose }: MemberDialogProps) {
  // A fresh form every time it opens on someone
  return open ? <MemberForm key={member?.id ?? 'new'} member={member} onClose={onClose} /> : null
}

function MemberForm({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const { trip, me, reload } = useTripContext()
  const manage = can(me.role, 'manageMembers', { archived: Boolean(trip.archivedAt) })
  const [name, setName] = useState(member?.name ?? '')
  const [memberColor, setMemberColor] = useState<string>(member?.color ?? dayColors[3])
  const [role, setRole] = useState<EditableRole>(
    member && member.role !== 'owner' ? member.role : 'editor',
  )
  const [nameError, setNameError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const roleEditable = manage && member?.role !== 'owner'
  const removable = manage && member !== null && member.role !== 'owner' && member.id !== me.id
  const title = member ? t('members.editTitle') : t('members.add')
  const formId = `member-form-${member?.id ?? 'new'}`

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 60) {
      setNameError(t('members.nameError'))
      return
    }
    setBusy(true)
    try {
      if (member) {
        const patch: { name?: string; color?: string; role?: EditableRole } = {}
        if (trimmed !== member.name) patch.name = trimmed
        if (memberColor !== member.color) patch.color = memberColor
        if (roleEditable && role !== member.role) patch.role = role
        const response = await api.patchMember(trip.id, member.id, patch)
        toast.show(t('members.saved', { name: response.member.name }), { tone: 'success' })
      } else {
        const response = await api.createMember(trip.id, { name: trimmed, color: memberColor, role })
        toast.show(t('members.added', { name: response.member.name }), { tone: 'success' })
      }
      reload()
      onClose()
    } catch (error) {
      showError(error)
      setBusy(false)
    }
  }

  async function remove() {
    if (!member) return
    setBusy(true)
    try {
      await api.deleteMember(trip.id, member.id)
      toast.show(t('members.removed', { name: member.name }), { tone: 'success' })
      reload()
      onClose()
    } catch (error) {
      showError(error)
      setBusy(false)
    }
  }

  if (confirmRemove && member) {
    return (
      <Dialog
        open
        onClose={() => setConfirmRemove(false)}
        title={t('members.removeTitle', { name: member.name })}
        actions={
          <>
            <Button onClick={() => setConfirmRemove(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              {t('members.remove')}
            </Button>
          </>
        }
      >
        <Note>{t('members.removeBody', { name: member.name })}</Note>
      </Dialog>
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      actions={
        <>
          {removable && (
            <Button variant="danger" onClick={() => setConfirmRemove(true)} disabled={busy}>
              {t('members.remove')}
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>
            {busy ? t('members.saving') : member ? t('members.save') : t('members.add')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Stack $gap="lg">
          {!member && <Note>{t('members.addHint')}</Note>}
          <Input
            label={t('members.name')}
            value={name}
            maxLength={60}
            required
            error={nameError}
            onChange={(event) => {
              setName(event.target.value)
              setNameError(undefined)
            }}
          />
          <ColorSwatches label={t('members.color')} value={memberColor} onChange={setMemberColor} />
          {roleEditable ? (
            <Select
              label={t('members.role')}
              hint={t('members.roleHint')}
              value={role}
              onChange={(event) => setRole(event.target.value as EditableRole)}
            >
              <option value="editor">{t('role.editor')}</option>
              <option value="viewer">{t('role.viewer')}</option>
            </Select>
          ) : (
            member?.role === 'owner' && manage && <Note>{t('members.ownerFixed')}</Note>
          )}
        </Stack>
      </form>
    </Dialog>
  )
}
