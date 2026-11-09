import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Avatar, Button, Card, Dialog } from '../../components/index.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { paletteIndex } from '../../lib/colors.ts'
import { useT } from '../../lib/i18n.ts'
import { rememberedInvite } from '../../lib/members.ts'
import { SectionTitle, Stack } from '../parts.tsx'
import { Note, Row } from './MembersSection.tsx'

// Settings → 我是誰 (e1-t03). A device holds one memberToken per trip, so "switching" is joining
// again through the invite link and picking the right person (POST /api/join replaces the token
// on this device; the old identity is untouched). The tab that joined keeps that link in
// sessionStorage, which gives a one-tap way back to the "who are you" screen; otherwise the owner
// has to send the link again. The owner cannot hand over the owner identity this way.

export function IdentitySection() {
  const t = useT()
  const navigate = useNavigate()
  const { trip, me } = useTripContext()
  const [open, setOpen] = useState(false)
  const [invite, setInvite] = useState<string | null>(null)
  const isOwner = me.role === 'owner'

  return (
    <Card as="section" aria-labelledby="settings-identity">
      <Stack $gap="md">
        <SectionTitle id="settings-identity">{t('members.identity.title')}</SectionTitle>
        <Row>
          <Row as="span">
            <Avatar name={me.name} colorIndex={paletteIndex(me.color, me.id)} size="lg" />
            <Note as="span">{t('members.identity.current', { name: me.name })}</Note>
          </Row>
          {!isOwner && (
            <Button
              size="sm"
              onClick={() => {
                setInvite(rememberedInvite(trip.id))
                setOpen(true)
              }}
            >
              {t('members.identity.notMe')}
            </Button>
          )}
        </Row>
        {isOwner && <Note>{t('members.identity.ownerNote')}</Note>}
      </Stack>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('members.identity.dialogTitle')}
        actions={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            {invite && (
              <Button
                variant="primary"
                onClick={() => navigate(`/join/${encodeURIComponent(invite)}`)}
              >
                {t('members.identity.reopen')}
              </Button>
            )}
          </>
        }
      >
        <Stack $gap="md">
          <Note>{t('members.identity.explain')}</Note>
          {!invite && <Note>{t('members.identity.askOwner')}</Note>}
        </Stack>
      </Dialog>
    </Card>
  )
}
