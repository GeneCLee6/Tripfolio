import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { formatDateRange } from '../../shared/i18n/format.ts'
import { Button, Chip, EmptyState, MemberAvatarRow } from '../components/index.ts'
import { SECTIONS, tripPath } from '../app/sections.ts'
import { useTripContext } from '../app/trip-context.ts'
import { safeColor } from '../lib/colors.ts'
import { useMediaQuery, useNow } from '../lib/hooks.ts'
import { useT, type Translate } from '../lib/i18n.ts'
import { sortMembers } from '../lib/members.ts'
import { useCan } from '../lib/role.ts'
import { countdown, tripLength, type Countdown } from '../lib/trip-groups.ts'
import { focusRing } from '../styles/mixins.ts'
import {
  color,
  duration,
  fontSize,
  fontWeight,
  media,
  onDayColor,
  radius,
  space,
} from '../styles/tokens.ts'
import { SectionTitle, Stack } from './parts.tsx'
import { TripFormDialog } from './trip-form/TripFormDialog.tsx'

// /trips/:id — the trip's overview until the itinerary and today card arrive: the cover, who is
// coming, what is coming due (empty until bookings exist), and a way into every section.

const Hero = styled.header<{ $color: string }>`
  display: grid;
  gap: ${space.sm}px;
  min-height: 180px;
  align-content: end;
  padding: ${space.xl}px;
  border-radius: ${radius.cover}px;
  background: ${({ $color }) => $color};
  color: ${onDayColor};
`

const HeroTitle = styled.h1`
  margin: 0;
  font-size: ${fontSize.xl}px;
  font-weight: ${fontWeight.heavy};
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
  @media ${media.tablet} {
    font-size: ${fontSize.xxl}px;
  }
`

const HeroLine = styled.p`
  margin: 0;
  font-size: ${fontSize.body}px;
  opacity: 0.92;
`

const HeroMeta = styled.p`
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px ${space.md}px;
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.sm}px;
`

const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
`

const SectionGrid = styled.ul`
  display: grid;
  gap: ${space.md}px;
  margin: 0;
  padding: 0;
  list-style: none;
  @media ${media.tablet} {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`

const SectionLink = styled(Link)`
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: ${space.xs}px ${space.md}px;
  height: 100%;
  padding: ${space.md}px ${space.lg}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  color: ${color.ink};
  text-decoration: none;
  > svg {
    grid-row: span 2;
    color: ${color.fjord};
  }
  &:hover {
    border-color: ${color.muted};
  }
  @media ${media.motion} {
    transition: border-color ${duration.fast}ms ease;
  }
  ${focusRing}
`

const MembersLink = styled(Link)`
  display: inline-flex;
  padding: ${space.xs}px ${space.md}px ${space.xs}px ${space.xs}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  color: ${color.ink};
  text-decoration: none;
  &:hover {
    border-color: ${color.muted};
  }
  ${focusRing}
`

const SectionName = styled.span`
  font-weight: ${fontWeight.semibold};
`

const SectionBody = styled.span`
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

function countdownText(t: Translate, value: Countdown): string {
  if (value.kind === 'upcoming') return t.plural('count.daysToGo', value.days)
  if (value.kind === 'ongoing') return t('trips.dayOf', { day: value.day, total: value.of })
  return value.kind === 'archived' ? t('trips.archived') : t('trips.ended')
}

export default function TripHomePage() {
  const t = useT()
  const navigate = useNavigate()
  const wide = useMediaQuery(media.tablet)
  const { trip, members, setTrip } = useTripContext()
  const can = useCan()
  const [editing, setEditing] = useState(false)
  const nowMs = useNow()
  const canEdit = can('editContent')

  return (
    <Stack>
      <Hero $color={safeColor(trip.coverColor, trip.id)}>
        <HeroMeta>
          <span>{countdownText(t, countdown(trip, nowMs))}</span>
          <span>{formatDateRange(trip.startDate, trip.endDate, t.locale)}</span>
          <span>{t.plural('count.days', tripLength(trip))}</span>
        </HeroMeta>
        <HeroTitle>{trip.name}</HeroTitle>
        {(trip.summary || trip.destination) && (
          <HeroLine>{trip.summary || trip.destination}</HeroLine>
        )}
      </Hero>

      <Row>
        <div>
          {trip.destination && trip.summary && <Chip>{trip.destination}</Chip>}{' '}
          <Chip tone="fjord">{t(`tripStyle.${trip.style}`)}</Chip>{' '}
          {trip.archivedAt && <Chip tone="warning">{t('trips.archived')}</Chip>}
        </div>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => (wide ? setEditing(true) : navigate(`${tripPath(trip.id)}/edit`))}
          >
            {t('tripForm.editTitle')}
          </Button>
        )}
      </Row>

      <Stack as="section" $gap="md" aria-labelledby="home-members">
        <SectionTitle id="home-members">{t('tripHome.members')}</SectionTitle>
        <div>
          <MembersLink to={tripPath(trip.id, 'settings')} title={t('members.manage')}>
            <MemberAvatarRow members={sortMembers(members)} />
          </MembersLink>
        </div>
      </Stack>

      <Stack as="section" $gap="md" aria-labelledby="home-deadlines">
        <SectionTitle id="home-deadlines">{t('tripHome.deadlines')}</SectionTitle>
        <EmptyState
          illustration="receipt"
          title={t('tripHome.deadlinesEmpty.title')}
          body={t('tripHome.deadlinesEmpty.body')}
        />
      </Stack>

      <Stack as="section" $gap="md" aria-labelledby="home-sections">
        <SectionTitle id="home-sections">{t('tripHome.sections')}</SectionTitle>
        <SectionGrid>
          {SECTIONS.filter((section) => section.body).map((section) => (
            <li key={section.id}>
              <SectionLink to={tripPath(trip.id, section)}>
                <section.icon size={24} />
                <SectionName>{t(section.label)}</SectionName>
                <SectionBody>{section.body && t(section.body)}</SectionBody>
              </SectionLink>
            </li>
          ))}
        </SectionGrid>
      </Stack>

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
