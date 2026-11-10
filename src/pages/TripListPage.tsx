import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import type { Trip } from '../../shared/api/types.ts'
import { formatDateRange } from '../../shared/i18n/format.ts'
import { Button, EmptyState, Skeleton } from '../components/index.ts'
import { PlusIcon } from '../components/icons.tsx'
import { Page } from '../app/TopBar.tsx'
import { tripPath } from '../app/sections.ts'
import { api } from '../lib/api.ts'
import { AccountBar } from '../lib/auth/AccountBar.tsx'
import { syncAuthTrips } from '../lib/auth/auth.ts'
import { safeColor } from '../lib/colors.ts'
import { errorMessageKey } from '../lib/errors.ts'
import { useMediaQuery, useNow, useResource } from '../lib/hooks.ts'
import { useT, type Translate } from '../lib/i18n.ts'
import {
  countdown,
  groupTrips,
  tripLength,
  TRIP_PHASES,
  type Countdown,
} from '../lib/trip-groups.ts'
import { focusRing } from '../styles/mixins.ts'
import { color, duration, fontSize, fontWeight, media, radius, space } from '../styles/tokens.ts'
import { Count, PageHeading, SectionTitle, Stack } from './parts.tsx'
import { TripFormDialog } from './trip-form/TripFormDialog.tsx'
import { TripListLifecycle } from './lifecycle/DeletedTrips.tsx'

// The app's home (E1 設計方向): the trips this device holds a memberToken for, on three shelves —
// coming up (with a countdown), on the road, past (archived ones too). No accounts: the list is
// whatever GET /api/trips answers for the stored tokens.

const Grid = styled.ul`
  display: grid;
  gap: ${space.lg}px;
  margin: 0;
  padding: 0;
  list-style: none;
  @media ${media.tablet} {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  @media ${media.desktop} {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
`

const CardLink = styled(Link)`
  display: grid;
  height: 100%;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  color: ${color.ink};
  text-decoration: none;
  &:hover {
    box-shadow: 0 6px 20px ${color.shadow};
  }
  @media ${media.motion} {
    transition:
      transform ${duration.fast}ms ease,
      box-shadow ${duration.fast}ms ease;
    &:hover {
      transform: translateY(-2px);
    }
  }
  ${focusRing}
`

const Band = styled.div<{ $color: string; $muted: boolean }>`
  display: flex;
  align-items: flex-end;
  min-height: 84px;
  padding: ${space.md}px;
  background: ${({ $color }) => $color};
  opacity: ${({ $muted }) => ($muted ? 0.7 : 1)};
`

const CountdownPill = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 ${space.sm + 2}px;
  border-radius: ${radius.pill}px;
  background: ${color.card};
  color: ${color.ink};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.sm - 1}px;
  font-weight: ${fontWeight.medium};
`

const Body = styled.div`
  display: grid;
  align-content: start;
  gap: ${space.xs}px;
  padding: ${space.md}px ${space.lg}px ${space.lg}px;
`

const Name = styled.h3`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.bold};
  overflow-wrap: anywhere;
`

const Line = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Meta = styled.p`
  margin: ${space.xs}px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px ${space.md}px;
  font-size: ${fontSize.sm}px;
  color: ${color.ink};
`

function countdownText(t: Translate, value: Countdown): string {
  switch (value.kind) {
    case 'upcoming':
      return t.plural('count.daysToGo', value.days)
    case 'ongoing':
      return t('trips.dayOf', { day: value.day, total: value.of })
    case 'archived':
      return t('trips.archived')
    default:
      return t('trips.ended')
  }
}

/** Members are not in the list response; each card asks for its trip (a handful of trips per device) */
function MemberCount({ tripId }: { tripId: string }) {
  const t = useT()
  const resource = useResource(`members:${tripId}`, (signal) => api.getTrip(tripId, signal))
  if (resource.status !== 'ready') return null
  return <span>{t.plural('count.members', resource.data.members.length)}</span>
}

function TripCard({ trip, nowMs }: { trip: Trip; nowMs: number }) {
  const t = useT()
  const value = countdown(trip, nowMs)
  return (
    <CardLink to={tripPath(trip.id)} aria-label={t('trips.open', { name: trip.name })}>
      <Band
        $color={safeColor(trip.coverColor, trip.id)}
        $muted={value.kind === 'past' || value.kind === 'archived'}
      >
        <CountdownPill>{countdownText(t, value)}</CountdownPill>
      </Band>
      <Body>
        <Name>{trip.name}</Name>
        <Line>{trip.destination || t('trips.noDestination')}</Line>
        <Meta>
          <span>{formatDateRange(trip.startDate, trip.endDate, t.locale)}</span>
          <span>{t.plural('count.days', tripLength(trip))}</span>
          <MemberCount tripId={trip.id} />
          <span>{t(`tripStyle.${trip.style}`)}</span>
        </Meta>
      </Body>
    </CardLink>
  )
}

const GROUP_TITLES = {
  upcoming: 'trips.group.upcoming',
  ongoing: 'trips.group.ongoing',
  past: 'trips.group.past',
} as const

export default function TripListPage() {
  const t = useT()
  const navigate = useNavigate()
  const wide = useMediaQuery(media.tablet)
  const [creating, setCreating] = useState(false)
  // Signed in with Google (e1-t06): first store the tokens minted for the account's linked trips
  const resource = useResource('trips', (signal) =>
    syncAuthTrips().then(() => api.listTrips(signal)),
  )
  const nowMs = useNow()

  const startCreate = () => (wide ? setCreating(true) : navigate('/trips/new'))
  const newButton = (
    <Button variant="primary" onClick={startCreate}>
      <PlusIcon size={18} />
      {t('trips.new')}
    </Button>
  )

  let content
  if (resource.status === 'loading') {
    content = (
      <Grid aria-busy="true">
        {[0, 1, 2].map((n) => (
          <li key={n}>
            <Skeleton $height={180} />
          </li>
        ))}
      </Grid>
    )
  } else if (resource.status === 'error') {
    const { key, code } = errorMessageKey(resource.error)
    content = (
      <EmptyState
        illustration="pin"
        title={t('trips.loadError')}
        body={t(key, { code })}
        action={<Button onClick={resource.reload}>{t('error.retry')}</Button>}
      />
    )
  } else if (resource.data.trips.length === 0) {
    content = (
      <EmptyState
        illustration="suitcase"
        title={t('trips.empty.title')}
        body={t('trips.empty.body')}
        action={newButton}
      />
    )
  } else {
    const groups = groupTrips(resource.data.trips, (entry) => entry.trip, nowMs)
    content = TRIP_PHASES.filter((phase) => groups[phase].length > 0).map((phase) => (
      <Stack as="section" $gap="md" key={phase} aria-labelledby={`trips-${phase}`}>
        <SectionTitle id={`trips-${phase}`}>
          {t(GROUP_TITLES[phase])}
          <Count>{groups[phase].length}</Count>
        </SectionTitle>
        <Grid>
          {groups[phase].map((entry) => (
            <li key={entry.trip.id}>
              <TripCard trip={entry.trip} nowMs={nowMs} />
            </li>
          ))}
        </Grid>
      </Stack>
    ))
  }

  const hasTrips = resource.status === 'ready' && resource.data.trips.length > 0
  return (
    <Page>
      <Stack $gap="xxl">
        <PageHeading
          title={t('trips.title')}
          lead={t('trips.intro')}
          actions={hasTrips ? newButton : undefined}
        />
        <AccountBar />
        {content}
        <TripListLifecycle onChange={resource.reload} />
      </Stack>
      <TripFormDialog
        open={creating}
        onClose={() => setCreating(false)}
        onDone={(trip) => {
          setCreating(false)
          navigate(tripPath(trip.id))
        }}
      />
    </Page>
  )
}
