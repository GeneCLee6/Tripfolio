import type { ReactNode } from 'react'
import styled, { css } from 'styled-components'
import type { StopType, WishlistCategory } from '../../shared/schema/index.ts'
import { useT } from '../lib/i18n.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../styles/tokens.ts'
import { Button } from './Button.tsx'
import { CategoryChip } from './CategoryChip.tsx'
import { StopTypeIcon } from './StopTypeIcon.tsx'

// The pocket list (e2-t07, E2 需求「口袋名單」, DESIGN.md §4 日程頁): picks still wished for and
// places no stop uses yet. On desktop it sits beside the days and every entry has a grip to drag it
// into a day; on phones it is the body of a Sheet and 「排進…」 is the way in. Presentational: the
// itinerary page hands in the grips (dnd-kit stays in its chunk) and what 「排進…」 does.

const Wrap = styled.div`
  display: grid;
  gap: ${space.md}px;
  min-width: 0;
`

const Hint = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Group = styled.section`
  display: grid;
  gap: ${space.xs}px;
`

const GroupTitle = styled.h3`
  margin: 0;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  color: ${color.muted};
`

const List = styled.ul`
  display: grid;
  gap: ${space.xs}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Entry = styled.li<{ $dragging: boolean }>`
  display: flex;
  align-items: center;
  gap: ${space.xs}px;
  min-width: 0;
  padding: ${space.xs}px ${space.xs}px ${space.xs}px ${space.sm}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card - 2}px;
  background: ${color.card};
  ${({ $dragging }) =>
    $dragging &&
    css`
      opacity: 0.45;
    `}
`

const Text = styled.div`
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
`

const Name = styled.span`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Meta = styled.span`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px;
  font-size: ${fontSize.sm - 2}px;
  color: ${color.muted};
`

const Price = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const PlaceType = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
`

export interface PocketEntry {
  /** The drag id (`pocket:item:…` / `pocket:place:…`) */
  key: string
  kind: 'item' | 'place'
  name: string
  /** An item's pick category */
  category?: WishlistCategory
  /** A place: the stop type it becomes, and that type's label (already translated) */
  stopType?: StopType
  typeLabel?: string
  /** An item's estimated price, formatted */
  price?: string
}

export interface PocketPanelProps {
  entries: readonly PocketEntry[]
  /** Still loading: a short note instead of the empty state */
  loading?: boolean
  /** The grip that drags an entry into a day (desktop), from the page */
  renderHandle?: (entry: PocketEntry) => ReactNode
  /** 「排進…」: pick a day for the entry; omitted for viewers */
  onSchedule?: (entry: PocketEntry) => void
  /** The key of the entry being dragged (drawn faded where it was) */
  draggingKey?: string | null
}

export function PocketPanel({
  entries,
  loading = false,
  renderHandle,
  onSchedule,
  draggingKey = null,
}: PocketPanelProps) {
  const t = useT()
  const items = entries.filter((entry) => entry.kind === 'item')
  const places = entries.filter((entry) => entry.kind === 'place')

  const row = (entry: PocketEntry) => (
    <Entry key={entry.key} $dragging={draggingKey === entry.key} data-pocket-entry={entry.key}>
      {renderHandle?.(entry)}
      <Text>
        <Name title={entry.name}>{entry.name}</Name>
        <Meta>
          {entry.category && <CategoryChip category={entry.category} />}
          {entry.stopType && (
            <PlaceType>
              <StopTypeIcon type={entry.stopType} size={12} />
              {entry.typeLabel}
            </PlaceType>
          )}
          {entry.price && <Price>{entry.price}</Price>}
        </Meta>
      </Text>
      {onSchedule && (
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('itinerary.pocket.scheduleNamed', { name: entry.name })}
          onClick={() => onSchedule(entry)}
        >
          {t('itinerary.pocket.schedule')}
        </Button>
      )}
    </Entry>
  )

  if (entries.length === 0) {
    return (
      <Wrap>
        <Hint>{loading ? t('itinerary.pocket.loading') : t('itinerary.pocket.empty')}</Hint>
      </Wrap>
    )
  }

  return (
    <Wrap>
      {onSchedule && (
        <Hint>{renderHandle ? t('itinerary.pocket.hintDrag') : t('itinerary.pocket.hintTap')}</Hint>
      )}
      {items.length > 0 && (
        <Group aria-label={t('itinerary.pocket.items')}>
          <GroupTitle>{t('itinerary.pocket.items')}</GroupTitle>
          <List>{items.map(row)}</List>
        </Group>
      )}
      {places.length > 0 && (
        <Group aria-label={t('itinerary.pocket.places')}>
          <GroupTitle>{t('itinerary.pocket.places')}</GroupTitle>
          <List>{places.map(row)}</List>
        </Group>
      )}
    </Wrap>
  )
}
