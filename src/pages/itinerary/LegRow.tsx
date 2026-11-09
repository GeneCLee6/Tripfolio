import styled, { css } from 'styled-components'
import { formatDistance, formatDuration } from '../../../shared/i18n/format.ts'
import { useT } from '../../lib/i18n.ts'
import type { DisplayLeg } from '../../lib/itinerary/legs.ts'
import { focusRing, visuallyHidden } from '../../styles/mixins.ts'
import { color, font, fontSize, radius, space } from '../../styles/tokens.ts'
import { LEG_MODE_LABEL } from './labels.ts'

// The thin line between two stops (DESIGN.md §3 LegRow): mode, time and distance; 「估」 when the
// values are a straight-line estimate, 「手動」 when the mode or time was set by hand, nothing for
// a routed leg. Tapping it opens the leg editor (e2-t05) for editors.

const row = css`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px ${space.sm}px;
  margin: 0;
  padding: 2px 0 ${space.sm + 2}px 2px;
  font-size: ${fontSize.sm - 1}px;
  color: ${color.muted};
`

const Row = styled.p`
  ${row}
`

const RowButton = styled.button`
  ${row}
  width: 100%;
  min-height: 32px;
  border: 0;
  border-radius: ${radius.control}px;
  background: transparent;
  font: inherit;
  font-size: ${fontSize.sm - 1}px;
  text-align: left;
  cursor: pointer;
  &:hover {
    background: ${color.paper};
  }
  ${focusRing}
`

const Hidden = styled.span`
  ${visuallyHidden}
`

const Num = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  color: ${color.ink};
`

const Badge = styled.abbr<{ $tone: 'warning' | 'fjord' }>`
  padding: 0 ${space.xs + 2}px;
  border: 1px solid ${({ $tone }) => ($tone === 'warning' ? color.warning : color.fjord)};
  border-radius: ${radius.pill}px;
  color: ${({ $tone }) => ($tone === 'warning' ? color.warning : color.fjord)};
  font-size: ${fontSize.sm - 2}px;
  text-decoration: none;
  cursor: help;
`

export interface LegRowProps {
  leg: DisplayLeg
  /** Open the leg editor; without it the row is plain text (viewers) */
  onEdit?: () => void
}

export function LegRow({ leg, onEdit }: LegRowProps) {
  const t = useT()
  const content = (
    <>
      <span>{t(LEG_MODE_LABEL[leg.mode])}</span>
      <Num>{formatDuration(leg.durationS / 60, t.locale)}</Num>
      <span aria-hidden="true">·</span>
      <Num>{formatDistance(leg.distanceM, t.locale)}</Num>
      {leg.overridden && (
        <Badge $tone="fjord" title={t('itinerary.leg.manualHint')}>
          {t('itinerary.leg.manual')}
        </Badge>
      )}
      {leg.estimated && (
        <Badge $tone="warning" title={t('itinerary.leg.estimateHint')}>
          {t('itinerary.leg.estimate')}
        </Badge>
      )}
    </>
  )
  const key = `${leg.fromStopId}>${leg.toStopId}`
  if (!onEdit) return <Row data-leg={key}>{content}</Row>
  return (
    <RowButton type="button" data-leg={key} onClick={onEdit} title={t('itinerary.leg.edit')}>
      <Hidden>{t('itinerary.leg.edit')}</Hidden>
      {content}
    </RowButton>
  )
}
