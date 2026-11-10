import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { forwardRef, useState, type ReactNode } from 'react'
import styled, { css } from 'styled-components'
import type { DayWithStops, Place, Stop, Trip } from '../../../shared/api/types.ts'
import { formatDate, formatDistance, formatDuration } from '../../../shared/i18n/format.ts'
import type { Warning } from '../../../shared/itinerary/checks.ts'
import {
  BackupGroup,
  Button,
  Chip,
  DragHandle,
  Timeline,
  TimelineItem,
  WarningList,
  type WarningItem,
} from '../../components/index.ts'
import { PaletteIcon } from '../../app/icons.tsx'
import { useT } from '../../lib/i18n.ts'
import { warnedStops } from '../../lib/itinerary/checks.ts'
import { backupDropId, splitBackup } from '../../lib/itinerary/backup.ts'
import { dayDropId } from '../../lib/itinerary/dnd.ts'
import type { DayLegs, DisplayLeg } from '../../lib/itinerary/legs.ts'
import { moveDownTarget, moveUpTarget, type MoveTarget } from '../../lib/itinerary/order.ts'
import { focusRing } from '../../styles/mixins.ts'
import { LodgingLine } from '../bookings/LodgingLine.tsx'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { stopName, warningText } from './labels.ts'
import { LegRow } from './LegRow.tsx'
import { StopCard, type StopPick } from './StopCard.tsx'
import { isTempId } from './useItinerary.ts'

// One day of the itinerary (DESIGN.md §4, mockup Screen 2 left pane): header with the number, title,
// date and driving total against the daily limit, the day's time warnings (e2-t06), tonight's
// lodging, the rail of stops with legs between them, and the dashed 「＋加行程點」. The rail is a
// sortable list and the whole day a drop area (e2-t04; the drag context lives on the page).
// Under the rail, the rainy-day group (e2-t07): its own sortable list, left out of the totals, with
// 「全部換上」／「只加入」; dragging a stop between the two lists flips its backup flag.

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

// Muted already; an opacity on top fell below AA (AC-10.5)
const Faint = styled.span`
  color: ${color.muted};
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

const DropArea = styled.div<{ $over: boolean }>`
  min-height: 44px;
  border-radius: ${radius.card - 2}px;
  ${({ $over }) =>
    $over &&
    css`
      outline: 2px dashed ${color.fjord};
      outline-offset: 4px;
    `}
`

const SortableBox = styled.div<{ $dragging: boolean }>`
  position: relative;
  ${({ $dragging }) =>
    $dragging &&
    css`
      z-index: 2;
      opacity: 0.85;
    `}
`

interface SortableStopProps {
  stop: Stop
  /** Drag turned off (a viewer, or a stop not saved yet) */
  disabled: boolean
  /** Animate the shuffle (off with prefers-reduced-motion) */
  motion: boolean
  handleLabel: string
  children: (handle: ReactNode) => ReactNode
}

function SortableStop({ stop, disabled, motion, handleLabel, children }: SortableStopProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stop.id, disabled })
  const handle = disabled ? undefined : (
    <DragHandle
      ref={setActivatorNodeRef}
      label={handleLabel}
      dragging={isDragging}
      {...attributes}
      {...listeners}
    />
  )
  return (
    <SortableBox
      ref={setNodeRef}
      $dragging={isDragging}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: motion ? transition : undefined,
      }}
    >
      {children(handle)}
    </SortableBox>
  )
}

export interface DayBlockProps {
  day: DayWithStops
  /** The day's colour (its own or the palette slot of its number) */
  dayColor: string
  trip: Trip
  legs: DayLegs | undefined
  places: ReadonlyMap<string, Place>
  /** The day's time warnings (e2-t06) */
  warnings?: readonly Warning[]
  /** May change things (drag, leg editor); viewers see the same day without them */
  editable?: boolean
  /** Animate the shuffle while dragging (false with prefers-reduced-motion) */
  motion?: boolean
  /** The stop being dragged, if any (its leg is hidden while it moves) */
  draggingId?: string | null
  /** The stop picked from a warning, outlined for a moment */
  highlightedId?: string | null
  onEditDay: () => void
  onAddStop: () => void
  onOpenStop: (stop: Stop) => void
  onMove: (stop: Stop, target: MoveTarget) => void
  onMoveToDay: (stop: Stop) => void
  onEditLeg?: (leg: DisplayLeg) => void
  onJumpToStop?: (stopId: string) => void
  /** Into / out of the rainy-day group (the card's menu) */
  onToggleBackup?: (stop: Stop) => void
  /** 「全部換上」 (swap) or 「只加入」 (add) the day's backups */
  onSwapBackup?: (mode: 'swap' | 'add') => void
  /** A stop that came from a pick: the pick's link and whether it is done (e5-t05) */
  pickOf?: (stop: Stop) => StopPick | undefined
}

export const DayBlock = forwardRef<HTMLElement, DayBlockProps>(function DayBlock(
  {
    day,
    dayColor,
    trip,
    legs,
    places,
    warnings = [],
    editable = true,
    motion = true,
    draggingId = null,
    highlightedId = null,
    onEditDay,
    onAddStop,
    onOpenStop,
    onMove,
    onMoveToDay,
    onEditLeg,
    onJumpToStop,
    onToggleBackup,
    onSwapBackup,
    pickOf,
  },
  ref,
) {
  const t = useT()
  const { main, backup } = splitBackup(day.stops)
  const [backupOpen, setBackupOpen] = useState(true)
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dayDropId(day.id),
    // Only an empty rail is a target of its own; otherwise the stops are (multi-list sorting)
    disabled: !editable || main.length > 0,
  })
  const { setNodeRef: setBackupDropRef, isOver: isOverBackup } = useDroppable({
    id: backupDropId(day.id),
    disabled: !editable || (backup.length > 0 && backupOpen),
  })
  // The group is there when it has stops, or while something is dragged (to drop into it)
  const showBackup = backup.length > 0 || (editable && draggingId !== null)
  const unassigned = day.idx === null
  const headingId = `day-${day.id}-heading`
  const summary = legs?.summary
  const legFrom = new Map((legs?.legs ?? []).map((leg) => [leg.fromStopId, leg]))
  const hasLegs = (legs?.legs.length ?? 0) > 0
  const names = new Map(
    day.stops.map((stop) => [
      stop.id,
      stopName(stop, stop.placeId ? places.get(stop.placeId) : undefined, t),
    ]),
  )
  const warned = warnedStops(warnings)
  const warningItems: WarningItem[] = warnings.map((warning, index) => {
    const target = warning.kind === 'no-buffer' ? undefined : warning.stopIds[0]
    return {
      key: `${warning.kind}:${warning.stopIds.join(',')}:${index}`,
      text: warningText(warning, names, t),
      onSelect: target && onJumpToStop ? () => onJumpToStop(target) : undefined,
    }
  })

  const renderStop = (stop: Stop, index: number, list: readonly Stop[]) => {
    const leg = legFrom.get(stop.id)
    const pending = isTempId(stop.id)
    return (
      <TimelineItem key={stop.id} color={stop.isBackup ? color.line : dayColor}>
        <SortableStop
          stop={stop}
          disabled={!editable || pending}
          motion={motion}
          handleLabel={t('itinerary.drag.handle', { name: names.get(stop.id) ?? '' })}
        >
          {(handle) => (
            <>
              <StopCard
                stop={stop}
                place={stop.placeId ? places.get(stop.placeId) : undefined}
                tz={trip.tz}
                pending={pending}
                canMoveUp={index > 0}
                canMoveDown={index < list.length - 1}
                handle={handle}
                warned={warned.has(stop.id)}
                highlighted={highlightedId === stop.id}
                pick={pickOf?.(stop)}
                onOpen={() => onOpenStop(stop)}
                onMoveUp={() => {
                  const target = moveUpTarget(list, stop.id)
                  if (target) onMove(stop, target)
                }}
                onMoveDown={() => {
                  const target = moveDownTarget(list, stop.id)
                  if (target) onMove(stop, target)
                }}
                onMoveToDay={() => onMoveToDay(stop)}
                onToggleBackup={editable && onToggleBackup ? () => onToggleBackup(stop) : undefined}
              />
              {leg && draggingId !== stop.id && (
                <LegRow
                  leg={leg}
                  onEdit={editable && onEditLeg ? () => onEditLeg(leg) : undefined}
                />
              )}
            </>
          )}
        </SortableStop>
      </TimelineItem>
    )
  }

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
          <Num data-day-total="">
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
        {summary && hasLegs && summary.limitMinutes !== null && (
          <Faint>
            {summary.overLimit
              ? t('itinerary.summary.limitHint')
              : t('itinerary.summary.limit', {
                  limit: formatDuration(summary.limitMinutes, t.locale),
                })}
          </Faint>
        )}
      </Meta>
      <WarningList label={t('itinerary.check.label')} items={warningItems} />
      {unassigned && <Note>{t('itinerary.unassigned.hint')}</Note>}
      {day.note && <Note>{day.note}</Note>}
      {/* Tonight's lodging and the morning's checkout (e4-t02; `lodging` / `checkout` ride on the day) */}
      <LodgingLine day={day} trip={trip} editable={editable} />
      <DropArea ref={setDropRef} $over={isOver && main.length === 0} data-day-drop={day.id}>
        {main.length === 0 ? (
          <Empty>{t('itinerary.emptyDay')}</Empty>
        ) : (
          <SortableContext
            id={day.id}
            items={main.map((stop) => stop.id)}
            strategy={verticalListSortingStrategy}
          >
            <Timeline aria-label={heading}>
              {main.map((stop, index) => renderStop(stop, index, main))}
            </Timeline>
          </SortableContext>
        )}
      </DropArea>
      {showBackup && (
        <BackupGroup
          title={t('itinerary.backup.title')}
          count={backup.length}
          open={backupOpen}
          onToggle={() => setBackupOpen((open) => !open)}
          dropRef={setBackupDropRef}
          over={isOverBackup}
          emptyText={t('itinerary.backup.empty')}
          dayId={day.id}
          actions={
            editable && onSwapBackup && backup.length > 0 ? (
              <>
                <Button size="sm" onClick={() => onSwapBackup('swap')}>
                  {t('itinerary.backup.swap')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onSwapBackup('add')}>
                  {t('itinerary.backup.add')}
                </Button>
              </>
            ) : undefined
          }
        >
          <SortableContext
            id={backupDropId(day.id)}
            items={backup.map((stop) => stop.id)}
            strategy={verticalListSortingStrategy}
          >
            <Timeline aria-label={t('itinerary.backup.listLabel', { day: heading })}>
              {backup.map((stop, index) => renderStop(stop, index, backup))}
            </Timeline>
          </SortableContext>
        </BackupGroup>
      )}
      <AddStop type="button" onClick={onAddStop}>
        {t('itinerary.addStop')}
      </AddStop>
    </Section>
  )
})
