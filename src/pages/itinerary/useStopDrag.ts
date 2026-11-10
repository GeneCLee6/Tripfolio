import {
  closestCorners,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DayWithStops } from '../../../shared/api/types.ts'
import { useT } from '../../lib/i18n.ts'
import {
  dayOfStop,
  isContainerDrop,
  isSameSectionPlace,
  previewMove,
  previewSectionMove,
  sectionOfDrop,
  sectionTarget,
  targetFromList,
  type SectionTarget,
} from '../../lib/itinerary/dnd.ts'
import type { MoveTarget } from '../../lib/itinerary/order.ts'
import { parsePocketDragId, type PocketSource } from '../../lib/itinerary/pocket.ts'

// Drag and drop of stops on the itinerary page (e2-t04, DESIGN.md §6). Mouse drags after a few
// pixels, touch after a 250 ms press, the keyboard with Space / arrows / Space (Esc cancels). While
// a stop moves across days the page renders a preview of the days; the drop sends one POST /move
// with the new neighbour above it. On phones (one day on screen) holding the stop over the top or
// bottom edge zone for 600 ms brings the previous / next day in.
// e2-t07: a day has two lists, the main rail and the rainy-day group; dragging a stop from one to
// the other flips its isBackup. Pocket-list entries (ids `pocket:item:…` / `pocket:place:…`) are
// dragged in from the side panel: no preview, the drop becomes a schedule / create request.

export const EDGE_PREV = 'edge:prev'
export const EDGE_NEXT = 'edge:next'
const EDGE_HOLD_MS = 600

const isEdge = (id: UniqueIdentifier) => id === EDGE_PREV || id === EDGE_NEXT

/**
 * Edge zones only by the pointer; stops by the closest corners (multi-list sorting). A pocket entry
 * lands only where it is let go (under the pointer, else where its overlay overlaps), so dropping
 * it back on the panel does nothing.
 */
const collision: CollisionDetection = (args) => {
  const edges = pointerWithin(args).filter((hit) => isEdge(hit.id))
  if (edges.length > 0) return edges
  const rest = {
    ...args,
    droppableContainers: args.droppableContainers.filter((container) => !isEdge(container.id)),
  }
  if (parsePocketDragId(String(args.active.id))) {
    const under = pointerWithin(rest)
    if (under.length > 0) return under
    return args.pointerCoordinates ? rectIntersection(rest) : closestCorners(rest)
  }
  return closestCorners(rest)
}

export const DRAG_MEASURING = { droppable: { strategy: MeasuringStrategy.Always } }

export interface StopDragOptions {
  days: readonly DayWithStops[]
  /** A label for a day in announcements (「Day 2」) */
  dayLabel: (day: DayWithStops) => string
  /** A stop's display name */
  stopLabel: (stopId: string) => string
  /** The day before / after the one on screen (phones), or null */
  neighbour: (direction: 'prev' | 'next') => DayWithStops | null
  /** Show another day (phones) */
  showDay: (dayId: string) => void
  onMove: (stopId: string, target: MoveTarget) => void
  /** A stop dragged into the other list of a day (rainy-day group and main rail) */
  onPlace: (stopId: string, target: MoveTarget, isBackup: boolean) => void
  /** A pocket-list entry let go over a day */
  onPocketDrop: (source: PocketSource, target: SectionTarget) => void
}

export function useStopDrag({
  days,
  dayLabel,
  stopLabel,
  neighbour,
  showDay,
  onMove,
  onPlace,
  onPocketDrop,
}: StopDragOptions) {
  const t = useT()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [preview, setPreview] = useState<DayWithStops[] | null>(null)
  const previewRef = useRef<DayWithStops[] | null>(null)
  const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const edgeId = useRef<UniqueIdentifier | null>(null)
  const options = useRef({
    days,
    dayLabel,
    stopLabel,
    neighbour,
    showDay,
    onMove,
    onPlace,
    onPocketDrop,
  })
  useLayoutEffect(() => {
    options.current = {
      days,
      dayLabel,
      stopLabel,
      neighbour,
      showDay,
      onMove,
      onPlace,
      onPocketDrop,
    }
  })

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const setDays = (next: DayWithStops[] | null) => {
    previewRef.current = next
    setPreview(next)
  }

  const clearEdge = () => {
    if (edgeTimer.current) clearTimeout(edgeTimer.current)
    edgeTimer.current = null
    edgeId.current = null
  }
  useEffect(() => clearEdge, [])

  const finish = () => {
    clearEdge()
    setActiveId(null)
    setDays(null)
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id))
    // A pocket entry is not in the days yet: nothing to preview
    if (!parsePocketDragId(String(active.id))) setDays([...options.current.days])
  }

  const onDragOver = ({ active, over }: DragOverEvent) => {
    const current = previewRef.current
    if (!current) return
    const id = String(active.id)
    if (over && isEdge(over.id)) {
      if (edgeId.current === over.id) return
      clearEdge()
      edgeId.current = over.id
      const direction = over.id === EDGE_PREV ? 'prev' : 'next'
      edgeTimer.current = setTimeout(() => {
        edgeTimer.current = null
        edgeId.current = null
        const day = options.current.neighbour(direction)
        const latest = previewRef.current
        if (!day || !latest) return
        const target = latest.find((item) => item.id === day.id)
        const index = direction === 'prev' ? (target?.stops.length ?? 0) : 0
        setDays(previewMove(latest, id, day.id, index))
        options.current.showDay(day.id)
      }, EDGE_HOLD_MS)
      return
    }
    clearEdge()
    if (!over) return
    const from = sectionOfDrop(current, id)
    const to = sectionOfDrop(current, String(over.id))
    if (!from || !to || (from.day.id === to.day.id && from.backup === to.backup)) return
    const list = to.day.stops.filter((stop) => stop.isBackup === to.backup && stop.id !== id)
    const overIndex = list.findIndex((stop) => stop.id === over.id)
    const translated = active.rect.current.translated
    const below = translated !== null && translated.top > over.rect.top + over.rect.height / 2
    const index = overIndex < 0 ? list.length : overIndex + (below ? 1 : 0)
    setDays(previewSectionMove(current, id, to.day.id, to.backup, index))
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const current = previewRef.current
    const id = String(active.id)
    finish()
    const pocket = parsePocketDragId(id)
    if (pocket) {
      if (!over || isEdge(over.id)) return
      const translated = active.rect.current.translated
      const below = translated !== null && translated.top > over.rect.top + over.rect.height / 2
      const target = sectionTarget(options.current.days, String(over.id), below)
      if (target) options.current.onPocketDrop(pocket, target)
      return
    }
    if (!current || !over) return
    const day = dayOfStop(current, id)
    const moving = day?.stops.find((stop) => stop.id === id)
    if (!day || !moving) return
    let list = day.stops.filter((stop) => stop.isBackup === moving.isBackup)
    if (!isEdge(over.id) && over.id !== active.id && !isContainerDrop(String(over.id))) {
      const from = list.findIndex((stop) => stop.id === id)
      const to = list.findIndex((stop) => stop.id === over.id)
      if (from >= 0 && to >= 0) list = arrayMove(list, from, to)
    }
    const target = targetFromList(day.id, list, id)
    const before = options.current.days.flatMap((d) => d.stops).find((stop) => stop.id === id)
    if (before && before.isBackup !== moving.isBackup) {
      options.current.onPlace(id, target, moving.isBackup)
      return
    }
    if (!isSameSectionPlace(options.current.days, id, target)) options.current.onMove(id, target)
  }

  const position = useCallback((stopId: string, overId: UniqueIdentifier | undefined) => {
    const current = previewRef.current ?? options.current.days
    const section = overId !== undefined ? sectionOfDrop(current, String(overId)) : undefined
    if (!section) return null
    const list = section.day.stops.filter((stop) => stop.isBackup === section.backup)
    const index = list.findIndex((stop) => stop.id === overId)
    const n = index >= 0 ? index + 1 : list.filter((stop) => stop.id !== stopId).length + 1
    return { day: options.current.dayLabel(section.day), n }
  }, [])

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: ({ active }) =>
        t('itinerary.drag.picked', { name: options.current.stopLabel(String(active.id)) }),
      onDragOver: ({ active, over }) => {
        const name = options.current.stopLabel(String(active.id))
        const at = over && !isEdge(over.id) ? position(String(active.id), over.id) : null
        return at
          ? t('itinerary.drag.over', { name, ...at })
          : t('itinerary.drag.overNone', { name })
      },
      onDragEnd: ({ active, over }) => {
        const name = options.current.stopLabel(String(active.id))
        const at = over && !isEdge(over.id) ? position(String(active.id), over.id) : null
        return at
          ? t('itinerary.drag.dropped', { name, ...at })
          : t('itinerary.drag.cancelled', { name })
      },
      onDragCancel: ({ active }) =>
        t('itinerary.drag.cancelled', { name: options.current.stopLabel(String(active.id)) }),
    }),
    [t, position],
  )

  return {
    activeId,
    /** The days to render: the drag preview while dragging, else the data */
    days: preview ?? days,
    context: {
      sensors,
      collisionDetection: collision,
      measuring: DRAG_MEASURING,
      onDragStart,
      onDragOver,
      onDragEnd,
      onDragCancel: finish,
      accessibility: {
        announcements,
        screenReaderInstructions: { draggable: t('itinerary.drag.instructions') },
      },
    },
  }
}
