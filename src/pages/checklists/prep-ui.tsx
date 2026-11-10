import styled from 'styled-components'
import { coarseTarget, focusRing, visuallyHidden } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'

// Small styled pieces the four prep pages (checklists, budget, documents, notes) share.

export const Panel = styled.section`
  display: grid;
  gap: ${space.md}px;
  padding: ${space.lg}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  min-width: 0;
`

export const PanelHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
  min-width: 0;
`

export const PanelTitle = styled.h2`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.bold};
  overflow-wrap: anywhere;
`

export const Muted = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

export const Row = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm}px;
  min-width: 0;
`

export const Mono = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

export const Hidden = styled.span`
  ${visuallyHidden}
`

/** A thin progress track; `$ratio` 0..1, `$tone` danger when over */
export const Track = styled.div`
  height: 8px;
  border-radius: ${radius.pill}px;
  background: color-mix(in srgb, ${color.line} 70%, transparent);
  overflow: hidden;
`

export const Fill = styled.div<{ $ratio: number; $tone?: 'ok' | 'danger' }>`
  height: 100%;
  width: ${({ $ratio }) => Math.max(0, Math.min(1, $ratio)) * 100}%;
  border-radius: inherit;
  background: ${({ $tone }) => ($tone === 'danger' ? color.danger : color.fjord)};
`

/** Around a Check: the whole 44 px square toggles it on a coarse pointer (DESIGN.md §6) */
export const CheckHit = styled.label`
  display: inline-grid;
  flex: none;
  place-items: center;
  cursor: pointer;
  ${coarseTarget}
`

export const Check = styled.input.attrs({ type: 'checkbox' })`
  flex: none;
  width: 22px;
  height: 22px;
  margin: 0;
  accent-color: ${color.fjord};
  cursor: pointer;
  ${focusRing}
`

export const Switch = styled.label`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm}px;
  min-height: 40px;
  ${coarseTarget}
  font-size: ${fontSize.sm}px;
  cursor: pointer;
  > input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: ${color.fjord};
    ${focusRing}
  }
`

export const Notice = styled.div<{ $tone?: 'info' | 'warning' }>`
  display: grid;
  gap: ${space.xs}px;
  padding: ${space.md}px ${space.lg}px;
  border-radius: ${radius.card}px;
  border: 1px solid
    ${({ $tone }) => ($tone === 'warning' ? color.tussock : color.fjord)};
  background: ${({ $tone }) => ($tone === 'warning' ? color.tussockSoft : color.glacier)};
  color: ${color.ink};
  > strong {
    font-size: ${fontSize.body}px;
  }
  > p {
    margin: 0;
    font-size: ${fontSize.sm}px;
  }
`
