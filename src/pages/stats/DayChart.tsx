import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { formatDate, formatMoney } from '../../../shared/i18n/format.ts'
import { chartMax, type DayPoint } from '../../lib/stats/aggregate.ts'
import { useT } from '../../lib/i18n.ts'
import { color, dayColor, font, fontSize, space } from '../../styles/tokens.ts'

// The 依日 view (e7-t06): one vertical bar per day in that day's colour (the accent outside the
// trip's days), anchored to a baseline, rounded at the data end, with a dashed average line. The
// readout above the chart shows the total, or the hovered / focused day's amount; every bar is
// focusable, so the values are reachable from the keyboard. Numbers wear text colours.

const HEIGHT = 168
const TOP = 12
const BOTTOM = 24
const MIN_SLOT = 22
const MAX_BAR = 40

const Wrap = styled.figure`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  min-width: 0;
`

const Readout = styled.p`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: ${space.xs}px ${space.md}px;
  margin: 0;
  min-height: 1.55em;
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.sm}px;
  > span:last-child {
    color: ${color.muted};
  }
`

const Scroll = styled.div`
  overflow-x: auto;
  min-width: 0;
`

const Bar = styled.g`
  cursor: default;
  outline: none;
  &:focus-visible rect[data-hit] {
    stroke: ${color.fjord};
    stroke-width: 2;
  }
`

const Hint = styled.figcaption`
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

/** A rounded-top bar path from the baseline (4px data-end radius) */
function barPath(x: number, y: number, width: number, height: number): string {
  if (height <= 0) return ''
  const r = Math.min(4, width / 2, height)
  const base = y + height
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${
    x + width
  },${y + r}V${base}Z`
}

export interface DayChartProps {
  days: readonly DayPoint[]
  totalMinor: number
  averageMinor: number
  currency: string
}

export function DayChart({ days, totalMinor, averageMinor, currency }: DayChartProps) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const slot = Math.max(MIN_SLOT, width / Math.max(1, days.length))
  const chartWidth = Math.max(width, slot * days.length)
  const barWidth = Math.min(MAX_BAR, Math.max(6, slot - 6))
  const plot = HEIGHT - TOP - BOTTOM
  const max = chartMax(days.map((day) => day.baseMinor))
  const y = (value: number) => TOP + plot * (1 - Math.max(0, value) / max)
  const labelEvery = Math.ceil((days.length * 44) / chartWidth) || 1
  const short = new Intl.DateTimeFormat(t.locale, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
  const shortDate = (date: string) => short.format(new Date(`${date}T00:00:00Z`))
  const money = (minor: number) => formatMoney(minor, currency, t.locale)
  const pointText = (day: DayPoint) =>
    t('stats.day.point', {
      date: formatDate(day.date, t.locale),
      amount: money(day.baseMinor),
      count: t.plural('expenses.count', day.count),
    })
  const shown = active !== null ? days[active] : null

  return (
    <Wrap aria-label={t('stats.day.chart')}>
      <Readout aria-live="polite">
        <span>{shown ? pointText(shown) : t('stats.day.total', { amount: money(totalMinor) })}</span>
        <span>{t('stats.day.average', { amount: money(averageMinor) })}</span>
      </Readout>
      <Scroll ref={ref}>
        <svg
          width={chartWidth}
          height={HEIGHT}
          viewBox={`0 0 ${chartWidth} ${HEIGHT}`}
          role="group"
          aria-label={t('stats.day.chart')}
          onMouseLeave={() => setActive(null)}
        >
          <line
            x1={0}
            x2={chartWidth}
            y1={TOP + plot}
            y2={TOP + plot}
            stroke={color.line}
            strokeWidth={1}
          />
          {days.map((day, index) => {
            const x = index * slot + (slot - barWidth) / 2
            const top = y(day.baseMinor)
            const fill = day.dayIndex === null ? color.fjord : dayColor(day.dayIndex)
            return (
              <Bar
                key={day.date}
                tabIndex={0}
                role="img"
                aria-label={pointText(day)}
                data-day={day.date}
                data-amount={day.baseMinor}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <rect
                  data-hit=""
                  x={index * slot + 1}
                  y={TOP}
                  width={slot - 2}
                  height={plot}
                  rx={4}
                  fill={active === index ? color.glacier : 'transparent'}
                  opacity={active === index ? 0.6 : 1}
                />
                <path d={barPath(x, top, barWidth, TOP + plot - top)} fill={fill} />
                {index % labelEvery === 0 && (
                  <text
                    x={index * slot + slot / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    fontSize={11}
                    fill={color.muted}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {shortDate(day.date)}
                  </text>
                )}
              </Bar>
            )
          })}
          {averageMinor > 0 && (
            <line
              x1={0}
              x2={chartWidth}
              y1={y(averageMinor)}
              y2={y(averageMinor)}
              stroke={color.muted}
              strokeWidth={1}
              strokeDasharray="4 4"
              pointerEvents="none"
            />
          )}
        </svg>
      </Scroll>
      <Hint>{t('stats.day.hint')}</Hint>
    </Wrap>
  )
}
