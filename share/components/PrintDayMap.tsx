import styled from 'styled-components'
import type { ShareDay, SharePoint } from '../../shared/api/share.ts'
import { color, font } from '../../src/styles/tokens.ts'
import { buildDaySketch } from '../daySketch.ts'

// A day's static map for print (e8-t02): an inline SVG from share/daySketch.ts, a light grid,
// lines between the stops in the day colour (dashed for straight-line estimates) and numbered pins
// matching the printed stops table. The pins are white with a day-colour ring and dark numbers, so
// the map still reads in black and white; nothing depends on the colour alone.

export const DAY_MAP_WIDTH = 640
export const DAY_MAP_HEIGHT = 300
const PADDING = 28

const Svg = styled.svg`
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid ${color.line};
  border-radius: 8px;
`

export interface PrintDayMapProps {
  day: Pick<ShareDay, 'stops' | 'legs'>
  /** Tonight's lodging, when it has a place */
  lodging?: SharePoint
  dayColor: string
  label: string
}

export function PrintDayMap({ day, lodging, dayColor, label }: PrintDayMapProps) {
  const sketch = buildDaySketch(
    day,
    { width: DAY_MAP_WIDTH, height: DAY_MAP_HEIGHT, padding: PADDING },
    lodging,
  )
  if (!sketch) return null
  return (
    <Svg
      viewBox={`0 0 ${sketch.width} ${sketch.height}`}
      role="img"
      aria-label={label}
      data-testid="print-day-map"
    >
      <g style={{ stroke: color.line }} strokeWidth="1">
        {sketch.gridX.map((x) => (
          <line key={`x${x}`} x1={x} y1={0} x2={x} y2={sketch.height} />
        ))}
        {sketch.gridY.map((y) => (
          <line key={`y${y}`} x1={0} y1={y} x2={sketch.width} y2={y} />
        ))}
      </g>
      <g fill="none" strokeWidth="3" strokeLinecap="round" style={{ stroke: dayColor }}>
        {sketch.lines.map((line, i) => (
          <line
            key={i}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            strokeDasharray={line.estimate || line.mode === 'flight' ? '7 6' : undefined}
          />
        ))}
      </g>
      <g
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="13"
        fontWeight="700"
        style={{ fontFamily: font.mono }}
      >
        {sketch.pins.map((pin) => (
          <g key={pin.n}>
            <circle
              cx={pin.x}
              cy={pin.y}
              r="12"
              strokeWidth="3"
              style={{ fill: color.card, stroke: dayColor }}
            />
            <text x={pin.x} y={pin.y} style={{ fill: color.ink }}>
              {pin.n}
            </text>
          </g>
        ))}
      </g>
      {sketch.lodging && (
        // A badge up and right of the point, so a stop at the lodging keeps its number visible
        <rect
          x={sketch.lodging.x + 6}
          y={sketch.lodging.y - 22}
          width="16"
          height="16"
          rx="3"
          strokeWidth="2.5"
          style={{ fill: color.ink, stroke: color.card }}
        />
      )}
    </Svg>
  )
}
