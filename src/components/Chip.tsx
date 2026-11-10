import type { ReactNode } from 'react'
import styled, { css } from 'styled-components'
import { focusRing } from '../styles/mixins.ts'
import { color, fontSize, fontWeight, media, radius, space, touchTarget } from '../styles/tokens.ts'

export type ChipTone = 'neutral' | 'fjord' | 'tussock' | 'success' | 'warning' | 'danger'

const toneColor: Record<ChipTone, string> = {
  neutral: color.muted,
  fjord: color.fjord,
  tussock: color.tussockText,
  success: color.success,
  warning: color.warningText,
  danger: color.danger,
}

const chipStyle = css<{ $tone: ChipTone; $selected: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  min-height: 24px;
  padding: 0 ${space.sm + 2}px;
  border: 1px solid ${({ $tone }) => ($tone === 'neutral' ? color.line : toneColor[$tone])};
  border-radius: ${radius.pill}px;
  background: ${({ $selected, $tone }) => ($selected ? toneColor[$tone] : color.card)};
  color: ${({ $selected, $tone }) => ($selected ? color.card : toneColor[$tone])};
  font-size: ${fontSize.sm - 1}px;
  font-weight: ${fontWeight.medium};
  line-height: 1.2;
  white-space: nowrap;
`

const StaticChip = styled.span<{ $tone: ChipTone; $selected: boolean }>`
  ${chipStyle}
`

const ButtonChip = styled.button<{ $tone: ChipTone; $selected: boolean }>`
  ${chipStyle}
  min-height: 30px;
  cursor: pointer;
  &:hover {
    border-color: ${({ $tone }) => toneColor[$tone === 'neutral' ? 'fjord' : $tone]};
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
  ${focusRing}
`

export interface ChipProps {
  children: ReactNode
  /** Category, currency, status… (DESIGN.md §3) */
  tone?: ChipTone
  /** Filled; with onClick it is a toggle (aria-pressed) */
  selected?: boolean
  onClick?: () => void
}

/** A small label; clickable (a filter toggle) when given onClick */
export function Chip({ children, tone = 'neutral', selected = false, onClick }: ChipProps) {
  if (onClick) {
    return (
      <ButtonChip type="button" aria-pressed={selected} $tone={tone} $selected={selected} onClick={onClick}>
        {children}
      </ButtonChip>
    )
  }
  return (
    <StaticChip $tone={tone} $selected={selected}>
      {children}
    </StaticChip>
  )
}
