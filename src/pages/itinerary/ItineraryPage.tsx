import { DndContext, useDroppable } from '@dnd-kit/core'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import type { GeoPoint } from '../../../shared/api/geo.ts'
import type { DayWithStops, Stop } from '../../../shared/api/types.ts'
import type { Warning } from '../../../shared/itinerary/checks.ts'
import { formatDate } from '../../../shared/i18n/format.ts'
import { Button, Dialog, EmptyState, Skeleton, useToast } from '../../components/index.ts'
import { useDetailPane, useTripContext } from '../../app/trip-context.ts'
import { errorMessageKey } from '../../lib/errors.ts'
import { useMediaQuery } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { checkItineraryDay } from '../../lib/itinerary/checks.ts'
import type { DisplayLeg } from '../../lib/itinerary/legs.ts'
import { useCan } from '../../lib/role.ts'
import { moveToDayTarget, type MoveTarget } from '../../lib/itinerary/order.ts'
import { focusRing } from '../../styles/mixins.ts'
import {
  color,
  duration,
  font,
  fontSize,
  fontWeight,
  media,
  onDayColor,
  radius,
  space,
  zIndex,
} from '../../styles/tokens.ts'
import { PageHeading, Stack } from '../parts.tsx'
import { DayBlock } from './DayBlock.tsx'
import { DayEditor } from './DayEditor.tsx'
import { LegEditor } from './LegEditor.tsx'
import { colorOfDay, stopName } from './labels.ts'
import { StopEditor } from './StopEditor.tsx'
import { isTempId, useItinerary } from './useItinerary.ts'
import { EDGE_NEXT, EDGE_PREV, useStopDrag } from './useStopDrag.ts'

// /trips/:id/itinerary (e2-t02, DESIGN.md §4 日程頁): a sticky strip of day chips, then the days.
// Phones show one day at a time with previous / next; wider screens scroll through every day and
// the chip of the day in view lights up. Unassigned days (outside the trip's dates) come last, muted.

const TOP_BAR = 56
/** The trip layout's bottom navigation on phones (src/app/TripLayout.tsx) */
const BOTTOM_NAV = 64
const HIGHLIGHT_MS = 2400

/** One column that never grows past the page: the chip strip scrolls inside it */
const Column = styled(Stack)`
  grid-template-columns: minmax(0, 1fr);
`

const Strip = styled.nav`
  position: sticky;
  top: ${TOP_BAR}px;
  z-index: ${zIndex.sticky - 1};
  margin: 0 -${space.lg}px;
  padding: ${space.sm}px ${space.lg}px;
  background: ${color.paper};
  border-bottom: 1px solid ${color.line};
  @media ${media.tablet} {
    margin: 0;
    padding: ${space.sm}px 0;
  }
`

const Chips = styled.ul`
  display: flex;
  gap: ${space.sm - 2}px;
  margin: 0;
  padding: 2px;
  list-style: none;
  overflow-x: auto;
  scrollbar-width: thin;
`

const Divider = styled.li`
  flex: none;
  align-self: center;
  padding: 0 ${space.xs}px;
  color: ${color.muted};
  font-size: ${fontSize.sm - 1}px;
  white-space: nowrap;
`

const DayChipButton = styled.button<{ $color: string; $active: boolean; $muted: boolean }>`
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: ${space.xs + 2}px;
  min-height: 34px;
  padding: 0 ${space.md - 1}px;
  border: 1px solid ${({ $active, $color }) => ($active ? $color : color.line)};
  border-radius: ${radius.pill}px;
  background: ${({ $active, $color }) => ($active ? $color : color.card)};
  color: ${({ $active }) => ($active ? onDayColor : color.muted)};
  opacity: ${({ $muted, $active }) => ($muted && !$active ? 0.7 : 1)};
  border-style: ${({ $muted }) => ($muted ? 'dashed' : 'solid')};
  font: inherit;
  font-size: ${fontSize.sm}px;
  white-space: nowrap;
  cursor: pointer;
  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${({ $active, $color }) => ($active ? onDayColor : $color)};
  }
  > b {
    font-family: ${font.mono};
    font-weight: ${fontWeight.medium};
  }
  > span {
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media ${media.motion} {
    transition: background-color ${duration.fast}ms ease;
  }
  ${focusRing}
`

const Pager = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Days = styled.div`
  display: grid;
  gap: ${space.lg}px;
`

const EdgeBox = styled.div<{ $side: 'top' | 'bottom'; $over: boolean }>`
  position: fixed;
  left: ${space.md}px;
  right: ${space.md}px;
  ${({ $side }) =>
    $side === 'top'
      ? css`
          top: ${TOP_BAR + space.xs}px;
        `
      : css`
          bottom: calc(${BOTTOM_NAV + space.xs}px + env(safe-area-inset-bottom, 0px));
        `}
  z-index: ${zIndex.overlay - 2};
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: ${space.sm}px;
  border: 2px dashed ${color.fjord};
  border-radius: ${radius.card}px;
  background: ${({ $over }) => ($over ? color.glacier : color.card)};
  color: ${color.fjord};
  font-size: ${fontSize.sm}px;
  text-align: center;
  pointer-events: none;
`

/** Phones: hold a dragged stop here to bring the previous / next day in */
function EdgeZone({ id, side, label }: { id: string; side: 'top' | 'bottom'; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <EdgeBox ref={setNodeRef} $side={side} $over={isOver} data-edge={side}>
      {label}
    </EdgeBox>
  )
}

const DayList = styled.div`
  display: grid;
  gap: ${space.sm}px;
`

export default function ItineraryPage() {
  const t = useT()
  const { trip } = useTripContext()
  const { setDetail } = useDetailPane()
  const toast = useToast()
  const itinerary = useItinerary(trip)
  const { data, resource, dayLegs, placesById } = itinerary
  const wide = useMediaQuery(media.tablet)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inViewId, setInViewId] = useState<string | null>(null)
  const [moving, setMoving] = useState<Stop | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const sections = useRef(new Map<string, HTMLElement>())
  const can = useCan()
  const editable = can('editContent')
  const motion = useMediaQuery(media.motion)

  const dataDays = useMemo(() => data?.days ?? [], [data?.days])
  const nameOf = (stop: Stop) =>
    stopName(stop, stop.placeId ? placesById.get(stop.placeId) : undefined, t)
  const dayLabelOf = (day: DayWithStops) =>
    day.idx !== null ? t('day.short', { n: day.idx }) : t('itinerary.unassigned.headingNoDate')
  const dataOrdered = [
    ...dataDays.filter((day) => day.idx !== null),
    ...dataDays.filter((day) => day.idx === null),
  ]
  const shownId = selectedId ?? dataOrdered[0]?.id ?? null
  const drag = useStopDrag({
    days: dataDays,
    dayLabel: dayLabelOf,
    stopLabel: (stopId) => {
      const stop = dataDays.flatMap((day) => day.stops).find((item) => item.id === stopId)
      return stop ? nameOf(stop) : ''
    },
    neighbour: (direction) => {
      const index = dataOrdered.findIndex((day) => day.id === shownId)
      if (index < 0) return null
      return dataOrdered[direction === 'prev' ? index - 1 : index + 1] ?? null
    },
    showDay: (dayId) => setSelectedId(dayId),
    onMove: (stopId, target) => void itinerary.moveStop(stopId, target),
  })

  // Time checks per day (e2-t06): pure, from the saved data
  const warnings = useMemo(() => {
    const out = new Map<string, Warning[]>()
    for (const day of dataDays) {
      out.set(day.id, checkItineraryDay(day, trip, placesById, dayLegs.get(day.id)?.legs ?? []))
    }
    return out
  }, [dataDays, trip, placesById, dayLegs])

  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
    },
    [],
  )
  const jumpToStop = (stopId: string) => {
    const card = document.querySelector<HTMLElement>(`[data-stop-id="${CSS.escape(stopId)}"]`)
    card?.scrollIntoView({ block: 'center', behavior: motion ? 'smooth' : 'auto' })
    card?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    setHighlightedId(stopId)
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS)
  }

  const days = drag.days
  const assigned = days.filter((day) => day.idx !== null)
  const unassigned = days.filter((day) => day.idx === null)
  const ordered = [...assigned, ...unassigned]
  const selected =
    ordered.find((day) => day.id === selectedId) ?? ordered[0] ?? (null as DayWithStops | null)
  const activeId = wide ? (inViewId ?? selected?.id ?? null) : (selected?.id ?? null)
  const colors = new Map(ordered.map((day, index) => [day.id, colorOfDay(day, index)]))

  // Wide screens: the chip follows the day in view
  useEffect(() => {
    if (!wide || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const id = (visible[0]?.target as HTMLElement | undefined)?.dataset.dayId
        if (id) setInViewId(id)
      },
      { rootMargin: `-${TOP_BAR + 60}px 0px -55% 0px` },
    )
    for (const element of sections.current.values()) observer.observe(element)
    return () => observer.disconnect()
  }, [wide, days.length])

  const choose = (day: DayWithStops) => {
    setSelectedId(day.id)
    if (wide) {
      setInViewId(day.id)
      sections.current.get(day.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // The editor lives in the detail pane, outside this tree: hand it the latest actions
  const actions = useRef(itinerary)
  useLayoutEffect(() => {
    actions.current = itinerary
  })

  const biasFor = useCallback(
    (day: DayWithStops, before: Stop | null): GeoPoint | null => {
      const list = before ? day.stops.slice(0, day.stops.indexOf(before)) : day.stops
      for (let i = list.length - 1; i >= 0; i--) {
        const place = list[i].placeId ? placesById.get(list[i].placeId!) : undefined
        if (place) return { lat: place.lat, lng: place.lng }
      }
      return trip.centerLat !== null && trip.centerLng !== null
        ? { lat: trip.centerLat, lng: trip.centerLng }
        : null
    },
    [placesById, trip.centerLat, trip.centerLng],
  )

  const openStop = (day: DayWithStops, stop: Stop | null) => {
    if (stop && isTempId(stop.id)) return
    const close = () => setDetail(null)
    setDetail({
      title: stop ? t('itinerary.editor.edit') : t('itinerary.editor.new'),
      content: (
        <StopEditor
          key={stop?.id ?? `new:${day.id}`}
          trip={trip}
          date={day.date ?? trip.startDate}
          stop={stop}
          places={data?.places ?? []}
          bias={biasFor(day, stop)}
          onSubmit={(values) => actions.current.saveStop(day.id, stop?.id ?? null, values)}
          onDelete={
            stop
              ? () =>
                  actions.current.deleteStop(
                    stop.id,
                    stopName(stop, stop.placeId ? placesById.get(stop.placeId) : undefined, t),
                  )
              : undefined
          }
          onPlaceCreated={(place) => actions.current.addPlace(place)}
          onClose={close}
        />
      ),
    })
  }

  const editDay = (day: DayWithStops) => {
    setDetail({
      title:
        day.idx !== null ? t('itinerary.day.editTitle', { n: day.idx }) : t('itinerary.day.edit'),
      content: (
        <DayEditor
          key={day.id}
          day={day}
          shownColor={colors.get(day.id) ?? ''}
          onSubmit={(patch) => actions.current.patchDay(day.id, patch)}
          onClose={() => setDetail(null)}
        />
      ),
    })
  }

  const move = (stop: Stop, target: MoveTarget) => void itinerary.moveStop(stop.id, target)

  const editLeg = (day: DayWithStops, leg: DisplayLeg) => {
    const from = day.stops.find((stop) => stop.id === leg.fromStopId)
    const to = day.stops.find((stop) => stop.id === leg.toStopId)
    setDetail({
      title: t('itinerary.leg.editTitle'),
      content: (
        <LegEditor
          key={`${leg.fromStopId}>${leg.toStopId}`}
          leg={leg}
          fromName={from ? nameOf(from) : ''}
          toName={to ? nameOf(to) : ''}
          style={trip.style}
          onSave={(mode, minutes) =>
            actions.current.setLeg(leg.fromStopId, leg.toStopId, mode, minutes)
          }
          onReset={() => actions.current.resetLeg(leg.fromStopId, leg.toStopId)}
          onClose={() => setDetail(null)}
        />
      ),
    })
  }

  if (resource.status === 'error') {
    const { key, code } = errorMessageKey(resource.error)
    return (
      <Stack>
        <PageHeading title={t('nav.itinerary')} />
        <EmptyState
          illustration="pin"
          title={t('error.title')}
          body={t(key, { code })}
          action={
            <Button variant="primary" onClick={resource.reload}>
              {t('error.retry')}
            </Button>
          }
        />
      </Stack>
    )
  }

  if (!data) {
    return (
      <Stack aria-busy="true">
        <PageHeading title={t('nav.itinerary')} />
        <Skeleton $height={40} />
        <Skeleton $height={220} />
      </Stack>
    )
  }

  const shownDays = wide ? ordered : selected ? [selected] : []
  const position = selected ? ordered.indexOf(selected) : -1

  const renderChip = (day: DayWithStops) => (
    <li key={day.id}>
      <DayChipButton
        type="button"
        aria-pressed={day.id === activeId}
        $color={colors.get(day.id)!}
        $active={day.id === activeId}
        $muted={day.idx === null}
        onClick={() => choose(day)}
      >
        {day.idx !== null && <b>{t('itinerary.day.chip', { n: day.idx })}</b>}
        {day.date && <span>{formatDate(day.date, t.locale)}</span>}
        {day.title && <span>{day.title}</span>}
      </DayChipButton>
    </li>
  )

  return (
    <Column $gap="lg">
      <PageHeading title={t('nav.itinerary')} />
      {ordered.length === 0 ? (
        <EmptyState illustration="suitcase" title={t('itinerary.noDays')} />
      ) : (
        <>
          <Strip aria-label={t('itinerary.days.label')}>
            <Chips>
              {assigned.map(renderChip)}
              {unassigned.length > 0 && (
                <Divider aria-hidden="true">{t('itinerary.unassigned.group')}</Divider>
              )}
              {unassigned.map(renderChip)}
            </Chips>
          </Strip>
          {!wide && selected && (
            <Pager>
              <Button
                size="sm"
                variant="ghost"
                disabled={position <= 0}
                onClick={() => setSelectedId(ordered[position - 1].id)}
              >
                {t('itinerary.nav.prev')}
              </Button>
              <span>{t('itinerary.nav.position', { n: position + 1, total: ordered.length })}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={position >= ordered.length - 1}
                onClick={() => setSelectedId(ordered[position + 1].id)}
              >
                {t('itinerary.nav.next')}
              </Button>
            </Pager>
          )}
          <DndContext {...drag.context}>
            <Days>
              {shownDays.map((day) => (
                <DayBlock
                  key={day.id}
                  ref={(element) => {
                    if (element) sections.current.set(day.id, element)
                    else sections.current.delete(day.id)
                  }}
                  day={day}
                  dayColor={colors.get(day.id)!}
                  trip={trip}
                  legs={dayLegs.get(day.id)}
                  places={placesById}
                  onEditDay={() => editDay(day)}
                  onAddStop={() => openStop(day, null)}
                  onOpenStop={(stop) => openStop(day, stop)}
                  onMove={move}
                  onMoveToDay={(stop) => setMoving(stop)}
                  warnings={warnings.get(day.id)}
                  editable={editable}
                  motion={motion}
                  draggingId={drag.activeId}
                  highlightedId={highlightedId}
                  onEditLeg={(leg) => editLeg(day, leg)}
                  onJumpToStop={jumpToStop}
                />
              ))}
            </Days>
            {!wide && drag.activeId && position > 0 && (
              <EdgeZone id={EDGE_PREV} side="top" label={t('itinerary.drag.prevDay')} />
            )}
            {!wide && drag.activeId && position >= 0 && position < ordered.length - 1 && (
              <EdgeZone id={EDGE_NEXT} side="bottom" label={t('itinerary.drag.nextDay')} />
            )}
          </DndContext>
        </>
      )}
      <Dialog
        open={Boolean(moving)}
        onClose={() => setMoving(null)}
        title={
          moving
            ? t('itinerary.stop.moveDialog', {
                name: stopName(
                  moving,
                  moving.placeId ? placesById.get(moving.placeId) : undefined,
                  t,
                ),
              })
            : ''
        }
      >
        <DayList>
          {moving &&
            ordered
              .filter((day) => day.id !== moving.dayId)
              .map((day) => {
                const label =
                  day.idx !== null
                    ? `${t('day.short', { n: day.idx })}${day.title ? ` · ${day.title}` : ''}`
                    : t('itinerary.unassigned.headingNoDate')
                return (
                  <Button
                    key={day.id}
                    block
                    onClick={async () => {
                      const stop = moving
                      setMoving(null)
                      const ok = await itinerary.moveStop(
                        stop.id,
                        moveToDayTarget(day.id, day.stops),
                      )
                      if (!ok) return
                      if (!wide) setSelectedId(day.id)
                      toast.show(t('itinerary.stop.moved', { day: label }))
                    }}
                  >
                    {label}
                    {day.date ? ` · ${formatDate(day.date, t.locale)}` : ''}
                  </Button>
                )
              })}
        </DayList>
      </Dialog>
    </Column>
  )
}
