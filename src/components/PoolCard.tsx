import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, font, fontSize, fontWeight, radius, space } from '../styles/tokens.ts'

// The shared pool card in its gold soft background (DESIGN.md §2 tussockSoft, mockup Screen 4): a
// title with the pool's balance on the right, a summary line, then whatever the page puts inside
// (contributions, refund mode).

const Box = styled.section`
  display: grid;
  gap: ${space.md}px;
  padding: ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card - 2}px;
  background: ${color.tussockSoft};
  min-width: 0;
`

const Head = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: ${space.sm}px;
`

const Title = styled.h3`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.bold};
`

const Balance = styled.span<{ $negative: boolean }>`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.medium};
  color: ${({ $negative }) => ($negative ? color.danger : color.ink)};
`

const Summary = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

export interface PoolCardProps {
  /** Translated heading */
  title: string
  /** Formatted balance */
  balance: string
  /** Overdrawn: the balance is drawn as a warning (the summary should say so in words too) */
  negative?: boolean
  /** Translated summary line */
  summary?: string
  children?: ReactNode
}

export function PoolCard({ title, balance, negative = false, summary, children }: PoolCardProps) {
  return (
    <Box aria-label={title}>
      <Head>
        <Title>{title}</Title>
        <Balance $negative={negative}>{balance}</Balance>
      </Head>
      {summary && <Summary>{summary}</Summary>}
      {children}
    </Box>
  )
}
