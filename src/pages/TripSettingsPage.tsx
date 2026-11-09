import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { formatDateRange } from '../../shared/i18n/format.ts'
import { Avatar, Button, Card, Chip, Dialog, useToast } from '../components/index.ts'
import { tripPath } from '../app/sections.ts'
import { useTripContext } from '../app/trip-context.ts'
import { api } from '../lib/api.ts'
import { paletteIndex } from '../lib/colors.ts'
import { errorMessageKey } from '../lib/errors.ts'
import { useMediaQuery } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.ts'
import { color, font, fontSize, fontWeight, media, space } from '../styles/tokens.ts'
import { Count, PageHeading, SectionTitle, Stack } from './parts.tsx'
import { TripFormDialog } from './trip-form/TripFormDialog.tsx'

// /trips/:id/settings — the trip's details (edit), the travellers (read-only until e1-t03 brings
// invites and member management), and archiving (owner only).

const Facts = styled.dl`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: ${space.sm}px ${space.lg}px;
  margin: 0;
  font-size: ${fontSize.sm}px;
  dt {
    color: ${color.muted};
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
`

const Mono = styled.span`
  font-family: ${font.mono};
`

const Members = styled.ul`
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  > li + li {
    border-top: 1px solid ${color.line};
  }
`

const MemberRow = styled.li`
  display: flex;
  align-items: center;
  gap: ${space.md}px;
  padding: ${space.md}px 0;
`

const MemberName = styled.span`
  flex: 1;
  min-width: 0;
  font-weight: ${fontWeight.medium};
  overflow-wrap: anywhere;
`

const Note = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.md}px;
`

export default function TripSettingsPage() {
  const t = useT()
  const toast = useToast()
  const navigate = useNavigate()
  const wide = useMediaQuery(media.tablet)
  const { trip, me, members, setTrip } = useTripContext()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const isOwner = me.role === 'owner'
  const archived = Boolean(trip.archivedAt)

  async function setArchived(next: boolean) {
    setBusy(true)
    try {
      const response = await api.patchTrip(trip.id, { archived: next })
      setTrip(response.trip)
      toast.show(next ? t('settings.archived') : t('settings.unarchived'), { tone: 'success' })
      setConfirming(false)
    } catch (error) {
      const { key, code } = errorMessageKey(error)
      toast.show(t(key, { code }), { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const currencies = [trip.baseCurrency, trip.secondaryCurrency].filter(Boolean).join(' / ')
  return (
    <Stack>
      <PageHeading title={t('settings.title')} eyebrow={trip.name} />

      <Card as="section" aria-labelledby="settings-details">
        <Stack $gap="lg">
          <Row>
            <SectionTitle id="settings-details">{t('settings.details')}</SectionTitle>
            {me.role !== 'viewer' && (
              <Button
                size="sm"
                disabled={archived}
                onClick={() => (wide ? setEditing(true) : navigate(`${tripPath(trip.id)}/edit`))}
              >
                {t('tripForm.editTitle')}
              </Button>
            )}
          </Row>
          <Facts>
            <dt>{t('tripForm.name')}</dt>
            <dd>{trip.name}</dd>
            <dt>{t('tripForm.destination')}</dt>
            <dd>{trip.destination || t('trips.noDestination')}</dd>
            <dt>{t('settings.dates')}</dt>
            <dd>{formatDateRange(trip.startDate, trip.endDate, t.locale)}</dd>
            <dt>{t('tripForm.tz')}</dt>
            <dd>
              <Mono>{trip.tz}</Mono>
            </dd>
            <dt>{t('tripForm.money')}</dt>
            <dd>
              <Mono>{currencies}</Mono>
              {trip.localCurrencies.length > 0 && <Mono> · {trip.localCurrencies.join(', ')}</Mono>}
            </dd>
            <dt>{t('tripForm.style')}</dt>
            <dd>{t(`tripStyle.${trip.style}`)}</dd>
          </Facts>
        </Stack>
      </Card>

      <Card as="section" aria-labelledby="settings-members">
        <Stack $gap="md">
          <Row>
            <SectionTitle id="settings-members">
              {t('settings.members')}
              <Count>{members.length}</Count>
            </SectionTitle>
            <Button size="sm" disabled aria-describedby="settings-invite-note">
              {t('settings.invite')}
            </Button>
          </Row>
          <Members>
            {members.map((member) => (
              <MemberRow key={member.id}>
                <Avatar name={member.name} colorIndex={paletteIndex(member.color, member.id)} />
                <MemberName>
                  {member.name}
                  {member.id === me.id && <Note as="span"> · {t('member.you')}</Note>}
                </MemberName>
                <Chip tone={member.role === 'owner' ? 'fjord' : 'neutral'}>
                  {t(`role.${member.role}`)}
                </Chip>
              </MemberRow>
            ))}
          </Members>
          <Note id="settings-invite-note">{t('settings.inviteSoon')}</Note>
        </Stack>
      </Card>

      <Card as="section" aria-labelledby="settings-archive">
        <Stack $gap="md">
          <SectionTitle id="settings-archive">{t('settings.archiveTitle')}</SectionTitle>
          <Note>{archived ? t('settings.archivedBody') : t('settings.archiveBody')}</Note>
          {isOwner ? (
            <div>
              {archived ? (
                <Button onClick={() => setArchived(false)} disabled={busy}>
                  {t('settings.unarchive')}
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setConfirming(true)} disabled={busy}>
                  {t('settings.archive')}
                </Button>
              )}
            </div>
          ) : (
            <Note>{t('settings.ownerOnly')}</Note>
          )}
        </Stack>
      </Card>

      {isOwner && (
        <Dialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title={t('settings.archive')}
          actions={
            <>
              <Button onClick={() => setConfirming(false)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={() => setArchived(true)} disabled={busy}>
                {t('settings.archive')}
              </Button>
            </>
          }
        >
          <Note>{t('settings.archiveBody')}</Note>
        </Dialog>
      )}

      {me.role !== 'viewer' && (
        <TripFormDialog
          open={editing}
          trip={trip}
          onClose={() => setEditing(false)}
          onDone={(saved) => {
            setTrip(saved)
            setEditing(false)
          }}
        />
      )}
    </Stack>
  )
}
