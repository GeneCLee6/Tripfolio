import styled from 'styled-components'
import { usageRatio, usageTone, type UsageTone } from '../lib/upload/storage.ts'
import { color, fontSize, fontWeight, radius, space } from '../styles/tokens.ts'
import { WarningIcon } from './WarningList.tsx'

// A single ratio against a limit (e11-t05 usage page; StorageMeter's look): label and "used / limit"
// on one line, a thin bar, and from 80 % a status line with an icon, so the state is never carried
// by the bar's colour alone. The fill turns amber at 80 % and red once over the limit; the track is
// the neutral line colour. Every text arrives translated.

const toneColor = { ok: color.fjord, warning: color.warning, danger: color.danger } as const

const Wrap = styled.div`
  display: grid;
  gap: ${space.xs}px;
  min-width: 0;
  font-size: ${fontSize.sm}px;
`

const Line = styled.p`
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: ${space.xs}px ${space.sm}px;
  color: ${color.muted};
  font-variant-numeric: tabular-nums;
  > strong {
    color: ${color.ink};
    font-weight: ${fontWeight.semibold};
  }
`

const Track = styled.div`
  height: 6px;
  border-radius: ${radius.pill}px;
  background: ${color.line};
  overflow: hidden;
`

const Fill = styled.div<{ $tone: UsageTone; $ratio: number }>`
  height: 100%;
  width: ${({ $ratio }) => ($ratio <= 0 ? 0 : Math.min(100, Math.max(2, $ratio * 100))).toFixed(1)}%;
  border-radius: ${radius.pill}px;
  background: ${({ $tone }) => toneColor[$tone]};
`

const Note = styled.p<{ $tone: UsageTone }>`
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  color: ${({ $tone }) => ($tone === 'danger' ? color.danger : color.ink)};
  > svg {
    flex: none;
    color: ${({ $tone }) => toneColor[$tone]};
  }
`

export interface MeterProps {
  /** What is measured (also the bar's accessible name); omit in a table row that names it */
  label?: string
  /** Accessible name when there is no visible label */
  ariaLabel?: string
  value: number
  limit: number
  /** "used / limit" as shown, already formatted */
  valueText: string
  /** Shown from 80 % */
  nearText: string
  /** Shown over 100 % */
  overText: string
}

export function Meter({
  label,
  ariaLabel,
  value,
  limit,
  valueText,
  nearText,
  overText,
}: MeterProps) {
  const ratio = usageRatio(value, limit)
  const tone = usageTone(value, limit)
  return (
    <Wrap data-tone={tone}>
      <Line>
        {label && <strong>{label}</strong>}
        <span>{valueText}</span>
      </Line>
      <Track
        role="meter"
        aria-label={label ?? ariaLabel}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(Math.max(0, value), limit)}
        aria-valuetext={valueText}
      >
        <Fill $tone={tone} $ratio={ratio} />
      </Track>
      {tone !== 'ok' && (
        <Note $tone={tone}>
          <WarningIcon />
          {tone === 'danger' ? overText : nearText}
        </Note>
      )}
    </Wrap>
  )
}
