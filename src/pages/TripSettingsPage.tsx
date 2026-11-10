import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { formatDateRange } from '../../shared/i18n/format.ts'
import '../../shared/i18n/pages/settings.ts'
import { Button, Card, Dialog, useToast } from '../components/index.ts'
import { tripPath } from '../app/sections.ts'
import { useTripContext } from '../app/trip-context.ts'
import { api } from '../lib/api.ts'
import { useMediaQuery } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.ts'
import { useApiErrorToast, useCan } from '../lib/role.ts'
import { color, font, fontSize, media, space } from '../styles/tokens.ts'
import { IdentitySection } from './members/IdentitySection.tsx'
import { InvitesSection } from './members/InvitesSection.tsx'
import { MembersSection } from './members/MembersSection.tsx'
import { PageHeading, SectionTitle, Stack } from './parts.tsx'
import { SharesSection } from './shares/SharesSection.tsx'
import { TripFormDialog } from './trip-form/TripFormDialog.tsx'

// /trips/:id/settings — the trip's details (edit), the travellers and invite links (e1-t03), share
// links (e1-t05),
// "who am I" on this device, and archiving (owner only). What shows follows useCan() (e1-t04).

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
  const { trip, setTrip } = useTripContext()
  const can = useCan()
  const showError = useApiErrorToast()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const isOwner = can('archive')
  const canEdit = can('editContent')
  const archived = Boolean(trip.archivedAt)

  async function setArchived(next: boolean) {
    setBusy(true)
    try {
      const response = await api.patchTrip(trip.id, { archived: next })
      setTrip(response.trip)
      toast.show(next ? t('settings.archived') : t('settings.unarchived'), { tone: 'success' })
      setConfirming(false)
    } catch (error) {
      showError(error)
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
            {canEdit && (
              <Button
                size="sm"
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

      <MembersSection />
      <InvitesSection />
      <SharesSection />
      <IdentitySection />

      <Card as="section" aria-labelledby="settings-tools">
        <Stack $gap="md">
          <SectionTitle id="settings-tools">{t('places.settings.tools')}</SectionTitle>
          <Row>
            <Note>{t('places.settings.libraryBody')}</Note>
            <Button size="sm" onClick={() => navigate(`${tripPath(trip.id)}/places`)}>
              {t('places.settings.library')}
            </Button>
          </Row>
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

      {canEdit && (
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
