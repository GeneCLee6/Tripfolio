import styled from 'styled-components'
import { color, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'

// Styles the trip home's phase cards share (出發前 and 今日卡)

export const PhaseCard = styled.section`
  display: grid;
  gap: ${space.md}px;
  padding: ${space.lg}px;
  border: 1px solid ${color.line};
  border-left: 4px solid ${color.fjord};
  border-radius: ${radius.card}px;
  background: ${color.card};
  min-width: 0;
`

export const PhaseHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: ${space.xs}px ${space.md}px;
`

export const PhaseTitle = styled.h2`
  margin: 0;
  font-size: ${fontSize.lg}px;
  font-weight: ${fontWeight.bold};
  overflow-wrap: anywhere;
`

export const PhaseMeta = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  font-variant-numeric: tabular-nums;
`

export const Big = styled.p`
  margin: 0;
  color: ${color.fjordInk};
  font-size: ${fontSize.xl}px;
  font-weight: ${fontWeight.heavy};
  font-variant-numeric: tabular-nums;
`
