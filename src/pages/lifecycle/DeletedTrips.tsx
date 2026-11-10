import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { formatDate, formatDateRange } from '../../../shared/i18n/format.ts'
import { Button, useToast } from '../../components/index.ts'
import { tripPath } from '../../app/sections.ts'
import { safeColor } from '../../lib/colors.ts'
import { useNow, useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { lifecycleApi, type DeletedTrip } from '../../lib/lifecycle/api.ts'
import { daysUntilPurge } from '../../lib/lifecycle/files.ts'
import { useApiErrorToast } from '../../lib/role.ts'
import { color, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { Count, SectionTitle, Stack } from '../parts.tsx'
import { ImportSheet } from './ImportSheet.tsx'
import { Actions, Muted, PrivacyLink } from './parts.tsx'

// The bottom of the trip list (e1-t07, e8-t03, e11-t06): 「匯入旅程檔」, the trips this device
// deleted (or that were deleted elsewhere) with the purge countdown and 「還原」 for the owner, and
// the link to the privacy page. Restoring or importing calls `onChange` so the list reloads.

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

const Rows = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Row = styled.li`
  display: grid;
  grid-template-columns: 8px 1fr auto;
  gap: ${space.md}px;
  align-items: center;
  padding: ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Swatch = styled.span<{ $color: string }>`
  align-self: stretch;
  border-radius: ${radius.pill}px;
  background: ${({ $color }) => $color};
  opacity: 0.6;
`

const Info = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
`

const Name = styled.span`
  font-weight: ${fontWeight.bold};
  overflow-wrap: anywhere;
`

const Line = styled.span`
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Purge = styled.span`
  color: ${color.danger};
  font-size: ${fontSize.sm}px;
  font-variant-numeric: tabular-nums;
`

const Footer = styled.footer`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px ${space.lg}px;
  align-items: center;
  padding-top: ${space.lg}px;
  border-top: 1px solid ${color.line};
`

function DeletedRow({ entry, nowMs, onRestored }: { entry: DeletedTrip; nowMs: number; onRestored: () => void }) {
  const t = useT()
  const toast = useToast()
  const showError = useApiErrorToast()
  const [busy, setBusy] = useState(false)
  const left = daysUntilPurge(entry.purgeAt, nowMs)

  async function restore() {
    setBusy(true)
    try {
      await lifecycleApi.restore(entry.trip.id, entry.token)
      toast.show(t('lifecycle.deleted.restored', { name: entry.trip.name }), { tone: 'success' })
      onRestored()
    } catch (error) {
      showError(error)
      setBusy(false)
    }
  }

  return (
    <Row>
      <Swatch $color={safeColor(entry.trip.coverColor, entry.trip.id)} aria-hidden="true" />
      <Info>
        <Name>{entry.trip.name}</Name>
        <Line>
          {formatDateRange(entry.trip.startDate, entry.trip.endDate, t.locale)}
          {' · '}
          {t('lifecycle.deleted.deletedOn', {
            date: formatDate(new Date(entry.deletedAt), t.locale, { year: true, timeZone: localZone() }),
          })}
        </Line>
        <Purge>
          {t('lifecycle.deleted.purgeOn', {
            date: formatDate(new Date(entry.purgeAt), t.locale, { year: true, timeZone: localZone() }),
          })}
          {' · '}
          {left > 0 ? t.plural('lifecycle.deleted.left', left) : t('lifecycle.deleted.due')}
        </Purge>
      </Info>
      {entry.canRestore ? (
        <Button
          size="sm"
          onClick={restore}
          disabled={busy}
          aria-label={t('lifecycle.deleted.restoreLabel', { name: entry.trip.name })}
        >
          {busy ? t('lifecycle.deleted.restoring') : t('lifecycle.deleted.restore')}
        </Button>
      ) : (
        <Line>{t('lifecycle.deleted.ownerOnly')}</Line>
      )}
    </Row>
  )
}

/** The deleted-trips shelf; renders nothing while loading, on error or when there are none */
export function DeletedTrips({ onRestored }: { onRestored: () => void }) {
  const t = useT()
  const nowMs = useNow()
  const resource = useResource('deletedTrips', (signal) => lifecycleApi.listDeleted(signal))
  if (resource.status !== 'ready' || resource.data.trips.length === 0) return null
  const trips = resource.data.trips
  return (
    <Stack as="section" $gap="md" aria-labelledby="trips-deleted">
      <SectionTitle id="trips-deleted">
        {t('lifecycle.deleted.title')}
        <Count>{trips.length}</Count>
      </SectionTitle>
      <Muted>{t('lifecycle.deleted.body')}</Muted>
      <Rows>
        {trips.map((entry) => (
          <DeletedRow
            key={entry.trip.id}
            entry={entry}
            nowMs={nowMs}
            onRestored={() => {
              resource.reload()
              onRestored()
            }}
          />
        ))}
      </Rows>
    </Stack>
  )
}

/** Everything the lifecycle work adds to the bottom of the trip list */
export function TripListLifecycle({ onChange }: { onChange: () => void }) {
  const t = useT()
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  return (
    <>
      <DeletedTrips onRestored={onChange} />
      <Footer>
        <Actions>
          <Button size="sm" onClick={() => setImporting(true)}>
            {t('lifecycle.import.open')}
          </Button>
        </Actions>
        <PrivacyLink>{t('lifecycle.footer.privacy')}</PrivacyLink>
      </Footer>
      {importing && (
        <ImportSheet
          onClose={() => setImporting(false)}
          onDone={(trip) => {
            setImporting(false)
            onChange()
            navigate(tripPath(trip.id))
          }}
        />
      )}
    </>
  )
}
