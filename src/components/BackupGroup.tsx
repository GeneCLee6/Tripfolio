import { useId, type ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { focusRing } from '../styles/mixins.ts'
import { color, duration, fontSize, fontWeight, media, radius, space } from '../styles/tokens.ts'
import { ChevronDownIcon } from './icons.tsx'

// The rainy-day group under a day's rail (e2-t07, E2 需求「備案」): a dashed box with a toggle that
// shows the count, the 「換上」 actions and the backup stops. Presentational: the itinerary page hands
// in the drop target ref (dnd-kit stays in the page's chunk) and the stops as children.

const Box = styled.section<{ $over: boolean }>`
  display: grid;
  gap: ${space.sm}px;
  padding: ${space.sm}px ${space.md}px;
  border: 1px dashed ${color.line};
  border-radius: ${radius.card - 2}px;
  background: ${color.paper};
  ${({ $over }) =>
    $over &&
    css`
      outline: 2px dashed ${color.fjord};
      outline-offset: 2px;
    `}
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.xs}px ${space.sm}px;
`

const Toggle = styled.button<{ $open: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs + 2}px;
  min-height: 40px;
  padding: 0 ${space.xs}px;
  border: 0;
  border-radius: ${radius.control}px;
  background: none;
  color: ${color.ink};
  font: inherit;
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  cursor: pointer;
  > svg {
    color: ${color.muted};
    transform: rotate(${({ $open }) => ($open ? 0 : -90)}deg);
    @media ${media.motion} {
      transition: transform ${duration.fast}ms ease;
    }
  }
  ${focusRing}
`

const Count = styled.span`
  min-width: 22px;
  padding: 0 ${space.xs + 2}px;
  border-radius: ${radius.pill}px;
  background: ${color.line};
  color: ${color.ink};
  font-size: ${fontSize.sm - 2}px;
  font-variant-numeric: tabular-nums;
  text-align: center;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px;
`

const Body = styled.div`
  display: grid;
  min-height: 32px;
`

const Empty = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

export interface BackupGroupProps {
  /** The group's name (already translated): 「雨天備案」 */
  title: string
  count: number
  open: boolean
  onToggle: () => void
  /** 「全部換上」／「只加入」 (shown next to the toggle) */
  actions?: ReactNode
  /** The drop target of the whole group (the page's drag library) */
  dropRef?: (node: HTMLElement | null) => void
  /** Something is held over the group */
  over?: boolean
  /** Shown in an open, empty group (already translated) */
  emptyText?: string
  /** The backup stops */
  children?: ReactNode
  /** For tests and the page: the day this group belongs to */
  dayId?: string
}

export function BackupGroup({
  title,
  count,
  open,
  onToggle,
  actions,
  dropRef,
  over = false,
  emptyText,
  children,
  dayId,
}: BackupGroupProps) {
  const bodyId = useId()
  return (
    <Box ref={dropRef} $over={over} aria-label={title} data-backup-group={dayId}>
      <Head>
        <Toggle
          type="button"
          $open={open}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
        >
          <ChevronDownIcon size={16} />
          {title}
          <Count>{count}</Count>
        </Toggle>
        {actions && <Actions>{actions}</Actions>}
      </Head>
      {open && (
        <Body id={bodyId}>{count === 0 && emptyText ? <Empty>{emptyText}</Empty> : children}</Body>
      )}
    </Box>
  )
}
