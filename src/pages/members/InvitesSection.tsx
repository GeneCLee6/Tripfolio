import { useState } from 'react'
import styled from 'styled-components'
import type { Invite } from '../../../shared/api/types.ts'
import { formatDate } from '../../../shared/i18n/format.ts'
import { Button, Card, Dialog, Input, Skeleton, useToast } from '../../components/index.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { api } from '../../lib/api.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { copyText, inviteUrl } from '../../lib/members.ts'
import { can, useApiErrorToast } from '../../lib/role.ts'
import { color, fontSize, space } from '../../styles/tokens.ts'
import { SectionTitle, Stack } from '../parts.tsx'
import { Note, Row } from './MembersSection.tsx'

// Settings → 邀請連結 (owner, e1-t03). A new link's token comes back once (POST /invites) and is
// shown once in a dialog; the list (GET /invites) never has tokens, only when each was made.

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
  justify-content: space-between;
  gap: ${space.md}px;
  padding: ${space.sm}px 0;
  font-size: ${fontSize.sm}px;
`

const LINK_FIELD = 'invite-link-field'

export function InvitesSection() {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const { trip, me } = useTripContext()
  const archived = Boolean(trip.archivedAt)
  const owner = can(me.role, 'manageMembers')
  const invites = useResource(`invites:${trip.id}:${owner}`, (signal) =>
    owner ? api.listInvites(trip.id, signal) : Promise.resolve({ invites: [] }),
  )
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)

  if (!owner) {
    return (
      <Card as="section" aria-labelledby="settings-invites">
        <Stack $gap="sm">
          <SectionTitle id="settings-invites">{t('members.invites.title')}</SectionTitle>
          <Note>{t('members.ownerOnly')}</Note>
        </Stack>
      </Card>
    )
  }

  async function create() {
    setBusy(true)
    try {
      const response = await api.createInvite(trip.id)
      setCreated(inviteUrl(response.inviteToken, window.location.origin))
      invites.reload()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  async function revoke(invite: Invite) {
    setBusy(true)
    try {
      await api.revokeInvite(trip.id, invite.id)
      toast.show(t('members.invites.revoked'), { tone: 'success' })
      invites.reload()
    } catch (error) {
      showError(error)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!created) return
    const ok = await copyText(
      created,
      document.getElementById(LINK_FIELD) as HTMLInputElement | null,
    )
    toast.show(ok ? t('members.invites.copied') : t('members.invites.copyManual'), {
      tone: ok ? 'success' : 'neutral',
    })
  }

  const dateOf = (invite: Invite) =>
    formatDate(new Date(invite.createdAt), t.locale, { timeZone: trip.tz, year: true })

  return (
    <Card as="section" aria-labelledby="settings-invites">
      <Stack $gap="md">
        <Row>
          <SectionTitle id="settings-invites">{t('members.invites.title')}</SectionTitle>
          <Button size="sm" variant="primary" onClick={create} disabled={busy || archived}>
            {busy && !created ? t('members.invites.creating') : t('settings.invite')}
          </Button>
        </Row>
        <Note>{archived ? t('members.archivedNote') : t('members.invites.body')}</Note>
        {invites.status === 'loading' && <Skeleton $height={40} />}
        {invites.status === 'ready' &&
          (invites.data.invites.length === 0 ? (
            <Note>{t('members.invites.empty')}</Note>
          ) : (
            <List aria-label={t('members.invites.title')}>
              {invites.data.invites.map((invite) => (
                <Item key={invite.id}>
                  <span>{t('members.invites.item', { date: dateOf(invite) })}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={t('members.invites.revokeLabel', { date: dateOf(invite) })}
                    onClick={() => revoke(invite)}
                  >
                    {t('members.invites.revoke')}
                  </Button>
                </Item>
              ))}
            </List>
          ))}
      </Stack>

      <Dialog
        open={created !== null}
        onClose={() => setCreated(null)}
        title={t('members.invites.createdTitle')}
        actions={
          <>
            <Button onClick={() => setCreated(null)}>{t('members.invites.done')}</Button>
            <Button variant="primary" onClick={copy}>
              {t('members.invites.copy')}
            </Button>
          </>
        }
      >
        <Stack $gap="md">
          <Note>{t('members.invites.once')}</Note>
          <Input
            id={LINK_FIELD}
            label={t('members.invites.link')}
            value={created ?? ''}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </Stack>
      </Dialog>
    </Card>
  )
}
