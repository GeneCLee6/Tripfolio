import styled from 'styled-components'
import { color } from '../styles/tokens.ts'

// A tiny trend line with no axes (e7-t06; the 每日平均 tile). One 2px accent line with a dot on
// the last value; the tile next to it carries the numbers, so this is an image with a name.

const Svg = styled.svg`
  display: block;
  overflow: visible;
`

export interface SparklineProps {
  values: readonly number[]
  /** Accessible name (already translated) */
  label: string
  width?: number
  height?: number
}

/** The points of a sparkline in a width × height box (2px inset so the line is not clipped) */
function sparkPoints(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0
  return values
    .map((value, index) => {
      const x = 2 + index * step
      const y = 2 + (height - 4) * (1 - (value - min) / span)
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
    })
    .join(' ')
}

/** A trend line of `values` */
export function Sparkline({ values, label, width = 96, height = 28 }: SparklineProps) {
  const points = sparkPoints(values, width, height)
  const last = points ? points.split(' ').pop()?.split(',').map(Number) : undefined
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
    >
      {values.length > 1 && (
        <polyline
          points={points}
          fill="none"
          stroke={color.fjord}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {last && last.length === 2 && <circle cx={last[0]} cy={last[1]} r={3} fill={color.fjord} />}
    </Svg>
  )
}
