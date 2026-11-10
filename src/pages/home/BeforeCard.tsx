import { Link } from 'react-router-dom'
import styled from 'styled-components'
import type { Trip } from '../../../shared/api/types.ts'
import { formatDate } from '../../../shared/i18n/format.ts'
import { tripPath } from '../../app/sections.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { checklistsApi } from '../../lib/prep/api.ts'
import { pretripProgress } from '../../lib/today/today.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, fontSize, radius, space } from '../../styles/tokens.ts'
import { PrepLinks } from '../checklists/PrepLinks.tsx'
import { Countdown } from './Countdown.tsx'
import { Big, PhaseCard, PhaseHead, PhaseMeta, PhaseTitle } from './parts.ts'

// The trip home before departure (e9-t06): the countdown, how far the pre-trip checklist is, and
// the four prep pages. A missing or failed checklist load just leaves the progress out.

const Track = styled.div`
  height: 8px;
  border-radius: ${radius.pill}px;
  background: ${color.line};
  overflow: hidden;
`

const Fill = styled.div<{ $ratio: number }>`
  height: 100%;
  width: ${({ $ratio }) => Math.round($ratio * 100)}%;
  background: ${color.success};
`

const Progress = styled(Link)`
  display: grid;
  gap: ${space.xs}px;
  color: ${color.ink};
  font-size: ${fontSize.sm}px;
  text-decoration: none;
  border-radius: ${radius.control}px;
  ${focusRing}
`

export function BeforeCard({ trip, nowMs }: { trip: Trip; nowMs: number }) {
  const t = useT()
  const lists = useResource(`home-checklists:${trip.id}`, (signal) =>
    checklistsApi.list(trip.id, signal),
  )
  const progress = lists.status === 'ready' ? pretripProgress(lists.data.checklists) : null
  return (
    <PhaseCard aria-labelledby="home-before" data-phase-card="before">
      <PhaseHead>
        <PhaseTitle id="home-before">{t('tripHome.before.title')}</PhaseTitle>
        <PhaseMeta>{formatDate(trip.startDate, t.locale)}</PhaseMeta>
      </PhaseHead>
      <Big>
        <Countdown trip={trip} nowMs={nowMs} />
      </Big>
      {progress && (
        <Progress to={tripPath(trip.id, 'checklists')} data-pretrip-progress="">
          <span>
            {progress.total > 0
              ? t('tripHome.before.progress', progress)
              : t('tripHome.before.noList')}
          </span>
          {progress.total > 0 && (
            <Track
              role="progressbar"
              aria-label={t('tripHome.before.progress', progress)}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
            >
              <Fill $ratio={progress.done / progress.total} />
            </Track>
          )}
        </Progress>
      )}
      <PrepLinks tripId={trip.id} heading={false} />
    </PhaseCard>
  )
}
