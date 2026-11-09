import styled from 'styled-components'
import { color, font, fontSize, fontWeight, space } from '../styles/tokens.ts'
import { Avatar } from './Avatar.tsx'

// One person's balance (DESIGN.md §3 BalanceRow, mockup Screen 4): avatar, name, a sub-line
// ("paid X · share Y") and the signed net amount with its word (gets back / owes), so the state is
// never carried by colour alone (DESIGN.md §6).

export type BalanceTone = 'gets' | 'owes' | 'even'

const toneColor: Record<BalanceTone, string> = {
  gets: color.success,
  owes: color.danger,
  even: color.muted,
}

const Row = styled.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space.md}px;
  padding: ${space.md - 2}px 0;
  border-top: 1px solid ${color.line};
  &:first-child {
    border-top: 0;
  }
`

const Who = styled.div`
  display: flex;
  align-items: center;
  gap: ${space.md - 2}px;
  min-width: 0;
`

const Names = styled.div`
  display: grid;
  min-width: 0;
`

const Name = styled.span<{ $removed: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: ${space.xs + 2}px;
  font-weight: ${fontWeight.medium};
  overflow-wrap: anywhere;
  color: ${({ $removed }) => ($removed ? color.muted : color.ink)};
`

const Badge = styled.span`
  font-size: ${fontSize.sm - 1}px;
  font-weight: ${fontWeight.regular};
  color: ${color.muted};
`

const Detail = styled.span`
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
  font-variant-numeric: tabular-nums;
`

const Figure = styled.div`
  display: grid;
  justify-items: end;
  flex: none;
  text-align: right;
`

const Amount = styled.span<{ $tone: BalanceTone }>`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-weight: ${fontWeight.medium};
  color: ${({ $tone }) => toneColor[$tone]};
  white-space: nowrap;
`

const ToneWord = styled.span`
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
`

export interface BalanceRowProps {
  /** The member's name (user content), or a translated stand-in for a removed member */
  name: string
  colorIndex: number
  /** Translated sub-line: what they paid and their share */
  detail?: string
  /** The signed amount, already formatted ("+A$12.34") */
  amount: string
  tone: BalanceTone
  /** The translated word for the tone ("gets back", "owes", "settled") */
  toneLabel: string
  /** Translated marks after the name ("you", "removed") */
  badges?: readonly string[]
  /** Removed members are drawn muted */
  removed?: boolean
}

/** A list item: put it inside a <ul> */
export function BalanceRow({
  name,
  colorIndex,
  detail,
  amount,
  tone,
  toneLabel,
  badges = [],
  removed = false,
}: BalanceRowProps) {
  return (
    <Row>
      <Who>
        <Avatar name={name} colorIndex={colorIndex} />
        <Names>
          <Name $removed={removed}>
            {name}
            {badges.map((badge) => (
              <Badge key={badge}>· {badge}</Badge>
            ))}
          </Name>
          {detail && <Detail>{detail}</Detail>}
        </Names>
      </Who>
      <Figure>
        <Amount $tone={tone}>{amount}</Amount>
        <ToneWord>{toneLabel}</ToneWord>
      </Figure>
    </Row>
  )
}
