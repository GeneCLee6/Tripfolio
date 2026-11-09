import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, space } from '../styles/tokens.ts'

/** The itinerary rail (DESIGN.md §4): a vertical line with one dot per stop, in the day's color */
export const Timeline = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
`

const Item = styled.li<{ $color: string }>`
  display: grid;
  grid-template-columns: 18px 1fr;
  column-gap: ${space.md}px;
  &:last-child > span > s {
    visibility: hidden;
  }
  > span {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  > span > i {
    flex: none;
    width: 12px;
    height: 12px;
    margin-top: 14px;
    border-radius: 50%;
    background: ${({ $color }) => $color};
    border: 2px solid ${color.card};
    box-shadow: 0 0 0 2px ${({ $color }) => $color};
  }
  > span > s {
    flex: 1;
    width: 2px;
    margin-top: 2px;
    background: ${color.line};
  }
  > div {
    min-width: 0;
    padding-bottom: ${space.sm}px;
  }
`

export interface TimelineItemProps {
  /** The day color (`dayColor(index)`) */
  color: string
  children: ReactNode
}

/** One stop on the rail; whatever goes between stops (a leg row) sits in its children */
export function TimelineItem({ color: dotColor, children }: TimelineItemProps) {
  return (
    <Item $color={dotColor}>
      <span aria-hidden="true">
        <i />
        <s />
      </span>
      <div>{children}</div>
    </Item>
  )
}
