import styled from 'styled-components'
import { formatDistance, formatDuration } from '../../../shared/i18n/format.ts'
import { useT } from '../../lib/i18n.ts'
import type { DisplayLeg } from '../../lib/itinerary/legs.ts'
import { color, font, fontSize, radius, space } from '../../styles/tokens.ts'
import { LEG_MODE_LABEL } from './labels.ts'

// The thin line between two stops (DESIGN.md §3 LegRow): mode, time and distance; 「估」 when the
// values are a straight-line estimate. Changing the mode and overriding the time is e2-t05.

const Row = styled.p`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px ${space.sm}px;
  margin: 0;
  padding: 2px 0 ${space.sm + 2}px 2px;
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
`

const Num = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  color: ${color.ink};
`

const Badge = styled.abbr`
  padding: 0 ${space.xs + 2}px;
  border: 1px solid ${color.warning};
  border-radius: ${radius.pill}px;
  color: ${color.warning};
  font-size: ${fontSize.sm - 2}px;
  text-decoration: none;
  cursor: help;
`

export function LegRow({ leg }: { leg: DisplayLeg }) {
  const t = useT()
  return (
    <Row data-leg={`${leg.fromStopId}>${leg.toStopId}`}>
      <span>{t(LEG_MODE_LABEL[leg.mode])}</span>
      <Num>{formatDuration(leg.durationS / 60, t.locale)}</Num>
      <span aria-hidden="true">·</span>
      <Num>{formatDistance(leg.distanceM, t.locale)}</Num>
      {leg.estimated && (
        <Badge title={t('itinerary.leg.estimateHint')}>{t('itinerary.leg.estimate')}</Badge>
      )}
      {leg.source === 'manual' && <span>{t('itinerary.leg.manual')}</span>}
    </Row>
  )
}
