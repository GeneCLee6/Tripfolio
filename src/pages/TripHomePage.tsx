import { lazy, Suspense, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { formatDateRange } from '../../shared/i18n/format.ts'
import {
  Button,
  Chip,
  MemberAvatarRow,
  PhotoThumb,
  Skeleton,
  StorageMeter,
} from '../components/index.ts'
import { ButtonLink } from '../components/ButtonLink.tsx'
import { SECTIONS, tripPath } from '../app/sections.ts'
import { useTripContext } from '../app/trip-context.ts'
import { safeColor } from '../lib/colors.ts'
import { useMediaQuery, useNow } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.ts'
import { sortMembers } from '../lib/members.ts'
import { useCan } from '../lib/role.ts'
import { homePhase } from '../lib/today/today.ts'
import { tripLength } from '../lib/trip-groups.ts'
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
import { DeadlinesBlock } from './bookings/DeadlinesBlock.tsx'
import { PrepLinks } from './checklists/PrepLinks.tsx'
import { BeforeCard } from './home/BeforeCard.tsx'
import { Countdown } from './home/Countdown.tsx'
import { SectionTitle, Stack } from './parts.tsx'
import { TripFormDialog } from './trip-form/TripFormDialog.tsx'

// /trips/:id — the trip's overview: the cover with the countdown, then the phase card (e9-t06:
// 出發前 with the prep pages before departure, the lazy 今日卡 while the trip runs, nothing after),
// who is coming, what is coming due, and a way into every section.

// Only an ongoing trip loads the today card's chunk (first-screen budget)
const TodayCard = lazy(() => import('./home/TodayCard.tsx'))

const Hero = styled.header<{ $color: string }>`
  display: grid;
  gap: ${space.sm}px;
  min-height: 180px;
  align-content: end;
  padding: ${space.xl}px;
  border-radius: ${radius.cover}px;
  background: ${({ $color }) => $color};
  color: ${onDayColor};
  position: relative;
  overflow: hidden;
  isolation: isolate;
`

/** The cover photo behind the hero text, darkened at the bottom so the text stays readable */
const HeroPhoto = styled.div`
  position: absolute;
  inset: 0;
  z-index: -1;
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, ${color.scrim}, transparent 75%);
  }
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

export default function TripHomePage() {
  const t = useT()
  const navigate = useNavigate()
  const wide = useMediaQuery(media.tablet)
  const { trip, members, setTrip } = useTripContext()
  const can = useCan()
  const [editing, setEditing] = useState(false)
  const nowMs = useNow()
  const canEdit = can('editContent')
  const phase = homePhase(trip, nowMs)

  return (
    <Stack>
      <Hero $color={safeColor(trip.coverColor, trip.id)}>
        {trip.coverAttachmentId && (
          <HeroPhoto>
            <PhotoThumb
              attachmentId={trip.coverAttachmentId}
              tripId={trip.id}
              variant="full"
              alt={t('photos.cover.alt', { name: trip.name })}
            />
          </HeroPhoto>
        )}
        <HeroMeta>
          {/* Before departure the 出發前 card shows the countdown instead */}
          {phase !== 'before' && <Countdown trip={trip} nowMs={nowMs} />}
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
        <Row>
          {phase === 'after' && (
            <ButtonLink to={tripPath(trip.id, 'recap')} variant="primary">
              {t('tripHome.recapLink')}
            </ButtonLink>
          )}
          <ButtonLink to={tripPath(trip.id, 'bookings')}>{t('bookings.homeLink')}</ButtonLink>
          <ButtonLink to={tripPath(trip.id, 'photos')}>
            {canEdit && !trip.coverAttachmentId ? t('photos.cover.homeSet') : t('photos.title')}
          </ButtonLink>
          {canEdit && (
            <Button
              size="sm"
              onClick={() => (wide ? setEditing(true) : navigate(`${tripPath(trip.id)}/edit`))}
            >
              {t('tripForm.editTitle')}
            </Button>
          )}
        </Row>
      </Row>

      <StorageMeter tripId={trip.id} compact showFrom={0.5} />

      {phase === 'before' && <BeforeCard trip={trip} nowMs={nowMs} />}
      {phase === 'today' && (
        <Suspense fallback={<Skeleton $height={220} />}>
          <TodayCard trip={trip} nowMs={nowMs} />
        </Suspense>
      )}

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
        <DeadlinesBlock trip={trip} />
      </Stack>

      {phase !== 'before' && <PrepLinks tripId={trip.id} />}

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
