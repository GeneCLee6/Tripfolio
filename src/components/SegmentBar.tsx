import styled from 'styled-components'
import { color, dayColor, font, fontSize, radius, space } from '../styles/tokens.ts'

// One stacked bar of parts of a whole, with a legend (e7-t06; each member's share of the costs).
// Segments take the member's own palette colour (the colour their avatar wears everywhere) and are
// separated by a 2px surface gap; identity is never colour alone: the legend names every part
// with its percentage. Hovering a segment shows its label as a native tooltip.

const Wrap = styled.figure`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  min-width: 0;
`

const Bar = styled.div`
  display: flex;
  gap: 2px;
  height: 14px;
  border-radius: ${radius.pill}px;
  overflow: hidden;
`

const Part = styled.span<{ $share: number; $color: string }>`
  flex: ${({ $share }) => $share} 1 0;
  min-width: 2px;
  background: ${({ $color }) => $color};
`

const Empty = styled.span`
  flex: 1;
  background: color-mix(in srgb, ${color.line} 55%, transparent);
`

const Legend = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px ${space.md}px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: ${fontSize.sm}px;
`

const Key = styled.li`
  display: inline-flex;
  align-items: center;
  gap: ${space.xs + 2}px;
  min-width: 0;
  > b {
    font-weight: inherit;
    font-family: ${font.mono};
    font-variant-numeric: tabular-nums;
    color: ${color.muted};
  }
`

const Swatch = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: ${({ $color }) => $color};
  flex: none;
`

export interface Segment {
  key: string
  label: string
  value: number
  /** A slot of the ten day colours (members' colours) */
  colorIndex: number
  /** Shown after the label in the legend (a percentage) */
  detail?: string
}

export interface SegmentBarProps {
  segments: readonly Segment[]
  /** Accessible name (already translated) */
  label: string
}

/** A stacked bar with a legend; zero and negative parts stay out of the bar but keep a legend entry */
export function SegmentBar({ segments, label }: SegmentBarProps) {
  const drawn = segments.filter((segment) => segment.value > 0)
  return (
    <Wrap aria-label={label}>
      <Bar aria-hidden="true">
        {drawn.length === 0 ? (
          <Empty />
        ) : (
          drawn.map((segment) => (
            <Part
              key={segment.key}
              data-segment={segment.key}
              title={segment.detail ? `${segment.label} ${segment.detail}` : segment.label}
              $share={segment.value}
              $color={dayColor(segment.colorIndex)}
            />
          ))
        )}
      </Bar>
      <Legend>
        {segments.map((segment) => (
          <Key key={segment.key}>
            <Swatch aria-hidden="true" $color={dayColor(segment.colorIndex)} />
            <span>{segment.label}</span>
            {segment.detail ? <b>{segment.detail}</b> : null}
          </Key>
        ))}
      </Legend>
    </Wrap>
  )
}
