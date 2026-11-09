import { forwardRef } from 'react'
import styled from 'styled-components'
import type { DayWithStops, Place, Stop, Trip } from '../../../shared/api/types.ts'
import { formatDate, formatDistance, formatDuration } from '../../../shared/i18n/format.ts'
import { Button, Chip, Timeline, TimelineItem } from '../../components/index.ts'
import { PaletteIcon } from '../../app/icons.tsx'
import { useT } from '../../lib/i18n.ts'
import type { DayLegs } from '../../lib/itinerary/legs.ts'
import { moveDownTarget, moveUpTarget, type MoveTarget } from '../../lib/itinerary/order.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { LegRow } from './LegRow.tsx'
import { StopCard } from './StopCard.tsx'
import { isTempId } from './useItinerary.ts'

// One day of the itinerary (DESIGN.md §4, mockup Screen 2 left pane): header with the number, title,
// date and driving total, tonight's lodging, the rail of stops with legs between them, and the
// dashed 「＋加行程點」.

const Section = styled.section<{ $color: string; $muted: boolean }>`
  display: grid;
  gap: ${space.sm}px;
  padding: ${space.lg}px;
  border: 1px solid ${color.line};
  border-left: 4px solid ${({ $color, $muted }) => ($muted ? color.line : $color)};
  border-radius: ${radius.card}px;
  background: ${color.card};
  scroll-margin-top: 120px;
`

const Head = styled.header`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: ${space.xs}px ${space.md}px;
`

const Title = styled.h2`
  margin: 0;
  font-size: ${fontSize.lg}px;
  font-weight: ${fontWeight.bold};
  overflow-wrap: anywhere;
`

const Untitled = styled.span`
  color: ${color.muted};
  font-weight: ${fontWeight.medium};
`

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px ${space.sm}px;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Num = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const Note = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  white-space: pre-line;
`

const Lodge = styled.p`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px ${space.sm}px;
  margin: 0 0 ${space.sm}px;
  padding: ${space.sm}px ${space.md - 2}px;
  border-radius: ${radius.control}px;
  background: ${color.paper};
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Faint = styled.span`
  opacity: 0.8;
`

const Empty = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const AddStop = styled.button`
  width: 100%;
  min-height: 44px;
  padding: ${space.sm + 2}px;
  border: 1px dashed ${color.line};
  border-radius: ${radius.card - 2}px;
  background: transparent;
  color: ${color.muted};
  font: inherit;
  font-size: ${fontSize.sm}px;
  cursor: pointer;
  &:hover {
    border-color: ${color.fjord};
    color: ${color.fjord};
  }
  ${focusRing}
`

export interface DayBlockProps {
  day: DayWithStops
  /** The day's colour (its own or the palette slot of its number) */
  dayColor: string
  trip: Trip
  legs: DayLegs | undefined
  places: ReadonlyMap<string, Place>
  onEditDay: () => void
  onAddStop: () => void
  onOpenStop: (stop: Stop) => void
  onMove: (stop: Stop, target: MoveTarget) => void
  onMoveToDay: (stop: Stop) => void
}

export const DayBlock = forwardRef<HTMLElement, DayBlockProps>(function DayBlock(
  { day, dayColor, trip, legs, places, onEditDay, onAddStop, onOpenStop, onMove, onMoveToDay },
  ref,
) {
  const t = useT()
  const unassigned = day.idx === null
  const headingId = `day-${day.id}-heading`
  const summary = legs?.summary
  const legFrom = new Map((legs?.legs ?? []).map((leg) => [leg.fromStopId, leg]))
  const hasLegs = (legs?.legs.length ?? 0) > 0

  let heading: string
  if (unassigned) {
    heading = day.date
      ? t('itinerary.unassigned.heading', { date: formatDate(day.date, t.locale) })
      : t('itinerary.unassigned.headingNoDate')
  } else {
    heading = day.title
      ? t('itinerary.day.heading', { n: day.idx!, title: day.title })
      : t('day.short', { n: day.idx! })
  }

  return (
    <Section
      ref={ref}
      id={`day-${day.id}`}
      aria-labelledby={headingId}
      data-day-id={day.id}
      $color={dayColor}
      $muted={unassigned}
    >
      <Head>
        <Title id={headingId}>
          {heading}
          {!unassigned && !day.title && (
            <>
              {' '}
              <Untitled>· {t('itinerary.day.untitled')}</Untitled>
            </>
          )}
        </Title>
        <Button size="sm" variant="ghost" onClick={onEditDay} aria-label={t('itinerary.day.edit')}>
          <PaletteIcon size={16} />
          {t('common.edit')}
        </Button>
      </Head>
      <Meta>
        {!unassigned && day.date && <Num>{formatDate(day.date, t.locale)}</Num>}
        {summary && hasLegs && (
          <Num>
            {summary.label === 'ride'
              ? t('itinerary.summary.ride', {
                  duration: formatDuration(summary.driveMinutes, t.locale),
                  distance: formatDistance(summary.distanceM, t.locale),
                })
              : t('itinerary.summary.drive', {
                  duration: formatDuration(summary.driveMinutes, t.locale),
                  distance: formatDistance(summary.distanceM, t.locale),
                })}
          </Num>
        )}
        {summary?.overLimit && summary.limitMinutes !== null && (
          <Chip tone="warning">
            {t('itinerary.summary.overLimit', {
              limit: formatDuration(summary.limitMinutes, t.locale),
            })}
          </Chip>
        )}
      </Meta>
      {unassigned && <Note>{t('itinerary.unassigned.hint')}</Note>}
      {day.note && <Note>{day.note}</Note>}
      {!unassigned && (
        <Lodge>
          <span>{t('itinerary.lodging.empty')}</span>
          <Faint>{t('itinerary.lodging.hint')}</Faint>
        </Lodge>
      )}
      {day.stops.length === 0 ? (
        <Empty>{t('itinerary.emptyDay')}</Empty>
      ) : (
        <Timeline aria-label={heading}>
          {day.stops.map((stop, index) => {
            const leg = legFrom.get(stop.id)
            const pending = isTempId(stop.id)
            return (
              <TimelineItem key={stop.id} color={stop.isBackup ? color.line : dayColor}>
                <StopCard
                  stop={stop}
                  place={stop.placeId ? places.get(stop.placeId) : undefined}
                  tz={trip.tz}
                  pending={pending}
                  canMoveUp={index > 0}
                  canMoveDown={index < day.stops.length - 1}
                  onOpen={() => onOpenStop(stop)}
                  onMoveUp={() => {
                    const target = moveUpTarget(day.stops, stop.id)
                    if (target) onMove(stop, target)
                  }}
                  onMoveDown={() => {
                    const target = moveDownTarget(day.stops, stop.id)
                    if (target) onMove(stop, target)
                  }}
                  onMoveToDay={() => onMoveToDay(stop)}
                />
                {leg && <LegRow leg={leg} />}
              </TimelineItem>
            )
          })}
        </Timeline>
      )}
      <AddStop type="button" onClick={onAddStop}>
        {t('itinerary.addStop')}
      </AddStop>
    </Section>
  )
})
