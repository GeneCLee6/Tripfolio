import styled from 'styled-components'
import type { ShareOvernight } from '../../shared/api/share.ts'
import { color, font } from '../../src/styles/tokens.ts'
import { fitProjection, type GeoPoint } from '../projection.ts'

// The route sketch (e8-t01b, mockup Screen 1): one dashed line per day in its colour between where
// it starts and where it sleeps, a dot at every night. Plain SVG from the payload, so it shows at
// once, before MapLibre (which is lazy) loads, without JavaScript-heavy maps, and in print.

export const SKETCH_WIDTH = 600
export const SKETCH_HEIGHT = 360
const PADDING = 36
/** Above this many nights the names would collide: dots only */
const MAX_LABELS = 8

const Svg = styled.svg`
  display: block;
  width: 100%;
  height: 100%;
`

export interface StaticRouteProps {
  overnight: readonly ShareOvernight[]
  /** Located stops, for trips without a single night line (one day, or one place) */
  extraPoints: readonly GeoPoint[]
  /** The colour of a 1-based day */
  dayColor: (dayIndex: number) => string
  label: string
}

export function StaticRoute({ overnight, extraPoints, dayColor, label }: StaticRouteProps) {
  const points: GeoPoint[] = overnight.flatMap((line) => [line.from, line.to])
  const all = points.length > 0 ? points : [...extraPoints]
  const project = fitProjection(all, {
    width: SKETCH_WIDTH,
    height: SKETCH_HEIGHT,
    padding: PADDING,
  })
  const labels = overnight.length <= MAX_LABELS
  const start = overnight[0]
  // Two nights at one place get one label
  const labelled = new Set<string>()
  const firstLabel = (line: ShareOvernight) => {
    const key = `${line.to.lat},${line.to.lng}`
    if (labelled.has(key)) return false
    labelled.add(key)
    return true
  }
  return (
    <Svg
      viewBox={`0 0 ${SKETCH_WIDTH} ${SKETCH_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      <g fill="none" strokeWidth="3" strokeDasharray="6 5" strokeLinecap="round">
        {overnight.map((line, i) => {
          const a = project(line.from)
          const b = project(line.to)
          return (
            <line
              key={`l${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              style={{ stroke: dayColor(line.dayIndex) }}
            />
          )
        })}
      </g>
      {overnight.length === 0 &&
        extraPoints.map((p, i) => {
          const at = project(p)
          return (
            <circle
              key={`p${i}`}
              cx={at.x}
              cy={at.y}
              r="5"
              style={{ fill: dayColor(1), stroke: color.card }}
              strokeWidth="2"
            />
          )
        })}
      {start && (
        <circle
          cx={project(start.from).x}
          cy={project(start.from).y}
          r="6"
          style={{ fill: color.card, stroke: dayColor(start.dayIndex) }}
          strokeWidth="3"
        />
      )}
      <g style={{ fontFamily: font.mono, fill: color.ink }} fontSize="16">
        {overnight.map((line, i) => {
          const at = project(line.to)
          const right = at.x < SKETCH_WIDTH * 0.66
          return (
            <g key={`n${i}`}>
              <circle
                cx={at.x}
                cy={at.y}
                r="9"
                style={{ fill: dayColor(line.dayIndex), stroke: color.card }}
                strokeWidth="2"
              />
              {labels && firstLabel(line) && (
                <text
                  x={right ? at.x + 14 : at.x - 14}
                  y={at.y - 10}
                  textAnchor={right ? 'start' : 'end'}
                >
                  {line.toName}
                </text>
              )}
            </g>
          )
        })}
      </g>
    </Svg>
  )
}
