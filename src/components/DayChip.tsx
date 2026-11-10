import styled from 'styled-components'
import { useT } from '../lib/i18n.ts'
import { focusRing } from '../styles/mixins.ts'
import { color, dayColor, duration, font, fontSize, fontWeight, media, onDayColor, radius, space, touchTarget } from '../styles/tokens.ts'

const Chip = styled.button<{ $color: string; $active: boolean }>`
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: ${space.sm - 2}px;
  min-height: 32px;
  padding: 0 ${space.md - 1}px;
  border: 1px solid ${({ $active, $color }) => ($active ? $color : color.line)};
  border-radius: ${radius.pill}px;
  background: ${({ $active, $color }) => ($active ? $color : color.paper)};
  color: ${({ $active }) => ($active ? onDayColor : color.muted)};
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
    font-variant-numeric: tabular-nums;
  }
  &:hover {
    border-color: ${({ $color }) => $color};
  }
  @media ${media.motion} {
    transition: background-color ${duration.fast}ms ease;
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
  ${focusRing}
`

export interface DayChipProps {
  /** 0-based day index: picks the day color and shows "Day n+1" */
  index: number
  /** The date, already formatted (formatDate) */
  date?: string
  /** The day's title (user content) */
  title?: string
  selected?: boolean
  onClick?: () => void
}

/** A day in the horizontal day strip: day color, number, date and title */
export function DayChip({ index, date, title, selected = false, onClick }: DayChipProps) {
  const t = useT()
  return (
    <Chip type="button" aria-pressed={selected} $color={dayColor(index)} $active={selected} onClick={onClick}>
      <b>{t('day.short', { n: index + 1 })}</b>
      {date && <span>{date}</span>}
      {title && <span>{title}</span>}
    </Chip>
  )
}
