import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, font, fontSize, fontWeight, radius, space } from '../styles/tokens.ts'
import { Avatar } from './Avatar.tsx'

// A transfer between two people (DESIGN.md §3 SettleCard, mockup Screen 4): "Jo → Kao NZD 312.40"
// with an action on the right (settle on a suggestion, delete in the log) and an optional meta line
// (date, method, note).

const Card = styled.li`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px ${space.md - 2}px;
  padding: ${space.md - 2}px ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card - 2}px;
  background: ${color.paper};
  min-width: 0;
`

const Party = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs + 2}px;
  min-width: 0;
  overflow-wrap: anywhere;
`

const Arrow = styled.span`
  color: ${color.muted};
`

const Amount = styled.span`
  margin-left: auto;
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-weight: ${fontWeight.medium};
  white-space: nowrap;
`

const Meta = styled.span`
  flex-basis: 100%;
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
  overflow-wrap: anywhere;
`

export interface SettlePerson {
  name: string
  colorIndex: number
}

export interface SettleCardProps {
  from: SettlePerson
  to: SettlePerson
  /** Formatted amount ("NZD 312.40") */
  amount: string
  /** Translated sentence for screen readers ("Jo pays Kao NZD 312.40") */
  label: string
  /** Translated extra line: date, method, note */
  meta?: string
  /** A button (settle, delete); omitted for viewers */
  action?: ReactNode
}

/** A list item: put it inside a <ul> */
export function SettleCard({ from, to, amount, label, meta, action }: SettleCardProps) {
  return (
    <Card aria-label={label}>
      <Party>
        <Avatar name={from.name} colorIndex={from.colorIndex} size="sm" />
        {from.name}
      </Party>
      <Arrow aria-hidden="true">→</Arrow>
      <Party>
        <Avatar name={to.name} colorIndex={to.colorIndex} size="sm" />
        {to.name}
      </Party>
      <Amount>{amount}</Amount>
      {action}
      {meta && <Meta>{meta}</Meta>}
    </Card>
  )
}
