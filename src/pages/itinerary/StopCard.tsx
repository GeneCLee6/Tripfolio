import { useEffect, useId, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import type { Place, Stop } from '../../../shared/api/types.ts'
import { formatMoney } from '../../../shared/i18n/format.ts'
import { isCurrencyCode } from '../../../shared/money/currencies.ts'
import { IconButton, StopTypeIcon } from '../../components/index.ts'
import { useT } from '../../lib/i18n.ts'
import { focusRing } from '../../styles/mixins.ts'
import {
  color,
  font,
  fontSize,
  fontWeight,
  radius,
  space,
  touchTarget,
  zIndex,
} from '../../styles/tokens.ts'
import { BOOKING_LABEL, STOP_TYPE_LABEL, stopName, stopTimeText } from './labels.ts'

// One stop on the day's rail (e2-t03, mockup Screen 2): name and time, a one-line note, and tags for
// type, booking, cost and the rainy-day plan. The card opens the editor; the ⋯ menu moves it (the
// keyboard and touch alternative to the drag and drop of e2-t04).

const Card = styled.div<{ $backup: boolean; $pending: boolean }>`
  position: relative;
  display: grid;
  gap: ${space.xs}px;
  padding: ${space.sm + 2}px ${space.md}px;
  padding-right: ${touchTarget + space.xs}px;
  margin-bottom: ${space.sm}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card - 2}px;
  background: ${color.paper};
  ${({ $backup }) =>
    $backup &&
    css`
      border-style: dashed;
      opacity: 0.72;
    `}
  ${({ $pending }) =>
    $pending &&
    css`
      opacity: 0.6;
    `}
  &:hover {
    border-color: ${color.muted};
  }
`

/** The whole card is the button (stretched over it); the menu button sits above it */
const Open = styled.button`
  all: unset;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: ${space.xs}px ${space.sm}px;
  cursor: pointer;
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: ${radius.card - 2}px;
  }
  &:focus-visible::after {
    outline: 2px solid ${color.fjord};
    outline-offset: 2px;
  }
`

const Name = styled.span`
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const Time = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
  white-space: nowrap;
`

const Excerpt = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Tags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs + 2}px;
`

type TagTone = 'neutral' | 'warn' | 'fjord'

const Tag = styled.span<{ $tone?: TagTone }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  padding: 1px ${space.sm}px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === 'warn' ? color.warning : $tone === 'fjord' ? color.fjord : color.line};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  color: ${({ $tone }) =>
    $tone === 'warn' ? color.warning : $tone === 'fjord' ? color.fjord : color.muted};
  font-size: ${fontSize.sm - 2}px;
  line-height: 1.5;
  white-space: nowrap;
`

const MoneyTag = styled(Tag)`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const MenuAnchor = styled.div`
  position: absolute;
  top: ${space.xs}px;
  right: ${space.xs}px;
  z-index: 1;
`

const Menu = styled.div`
  position: absolute;
  top: calc(100% + ${space.xs}px);
  right: 0;
  z-index: ${zIndex.overlay - 1};
  display: grid;
  min-width: 168px;
  padding: ${space.xs}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.control}px;
  background: ${color.card};
  box-shadow: 0 8px 24px ${color.shadow};
`

const MenuItem = styled.button`
  min-height: 36px;
  padding: 0 ${space.md}px;
  border: 0;
  border-radius: ${radius.control - 4}px;
  background: transparent;
  color: ${color.ink};
  text-align: left;
  font: inherit;
  font-size: ${fontSize.sm}px;
  cursor: pointer;
  &:hover:not(:disabled) {
    background: ${color.paper};
  }
  &:disabled {
    color: ${color.muted};
    cursor: not-allowed;
  }
  ${focusRing}
`

const MoreIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
)

const EXCERPT_LENGTH = 120

export interface StopCardProps {
  stop: Stop
  place?: Place
  /** The trip's zone, for showing the stored UTC times */
  tz: string
  canMoveUp: boolean
  canMoveDown: boolean
  /** Not saved yet (a temporary id): no moving until it is */
  pending?: boolean
  onOpen: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onMoveToDay?: () => void
}

export function StopCard({
  stop,
  place,
  tz,
  canMoveUp,
  canMoveDown,
  pending = false,
  onOpen,
  onMoveUp,
  onMoveDown,
  onMoveToDay,
}: StopCardProps) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const name = stopName(stop, place, t)
  const time = stopTimeText(stop, tz, t)
  const note = stop.note.trim().replace(/\s+/g, ' ')

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof PointerEvent && anchor.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menuOpen])

  const pick = (action?: () => void) => () => {
    setMenuOpen(false)
    action?.()
  }

  return (
    <Card $backup={stop.isBackup} $pending={pending} data-stop-id={stop.id}>
      <Open type="button" onClick={onOpen} aria-label={t('itinerary.stop.open', { name })}>
        <Name>{name}</Name>
        {time && <Time>{time}</Time>}
      </Open>
      {note && (
        <Excerpt>
          {note.length > EXCERPT_LENGTH ? `${note.slice(0, EXCERPT_LENGTH)}…` : note}
        </Excerpt>
      )}
      <Tags>
        <Tag>
          <StopTypeIcon type={stop.type} size={12} />
          {t(STOP_TYPE_LABEL[stop.type])}
        </Tag>
        {stop.booking === 'todo' && <Tag $tone="warn">{t(BOOKING_LABEL.todo)}</Tag>}
        {stop.booking === 'booked' && <Tag $tone="fjord">{t(BOOKING_LABEL.booked)}</Tag>}
        {stop.costMinor !== null && stop.currency && isCurrencyCode(stop.currency) && (
          <MoneyTag>{formatMoney(stop.costMinor, stop.currency, t.locale)}</MoneyTag>
        )}
        {stop.isBackup && <Tag>{t('itinerary.stop.backup')}</Tag>}
      </Tags>
      <MenuAnchor ref={anchor}>
        <IconButton
          size="sm"
          label={t('itinerary.stop.more', { name })}
          icon={<MoreIcon />}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          disabled={pending}
          onClick={() => setMenuOpen((open) => !open)}
        />
        {menuOpen && (
          <Menu id={menuId} role="menu">
            <MenuItem role="menuitem" type="button" disabled={!canMoveUp} onClick={pick(onMoveUp)}>
              {t('itinerary.stop.moveUp')}
            </MenuItem>
            <MenuItem
              role="menuitem"
              type="button"
              disabled={!canMoveDown}
              onClick={pick(onMoveDown)}
            >
              {t('itinerary.stop.moveDown')}
            </MenuItem>
            <MenuItem role="menuitem" type="button" onClick={pick(onMoveToDay)}>
              {t('itinerary.stop.moveToDay')}
            </MenuItem>
          </Menu>
        )}
      </MenuAnchor>
    </Card>
  )
}
