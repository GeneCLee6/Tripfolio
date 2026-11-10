import { useState } from 'react'
import { Link } from 'react-router-dom'
import styled from 'styled-components'
import type { Deadline, DeadlineType } from '../../../shared/api/bookings.ts'
import type { Trip } from '../../../shared/api/types.ts'
import { formatDate, formatTime } from '../../../shared/i18n/format.ts'
import { BookingTypeIcon, Button, Chip, EmptyState, Skeleton, type ChipTone } from '../../components/index.ts'
import { tripPath } from '../../app/sections.ts'
import { bookingsApi } from '../../lib/bookings/api.ts'
import { relativeDue } from '../../lib/bookings/form.ts'
import { useNow, useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'

// The trip home's 「即將到期」 (e4-t05): cancel-by, payment and check-in deadlines due in the next
// 14 days, soonest first; 「顯示已過期」 adds the ones already past (listed first, oldest first).
// Each row says how far off it is and leads to the bookings page.

const WITHIN_DAYS = 14

const List = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const RowLink = styled(Link)<{ $past: boolean }>`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: ${space.xs}px ${space.md}px;
  padding: ${space.md}px;
  border: 1px solid ${({ $past }) => ($past ? color.danger : color.line)};
  border-radius: ${radius.card}px;
  background: ${color.card};
  color: ${color.ink};
  text-decoration: none;
  > svg {
    color: ${color.fjord};
  }
  &:hover {
    border-color: ${color.muted};
  }
  ${focusRing}
`

const Main = styled.span`
  display: grid;
  gap: 2px;
  min-width: 0;
`

const Title = styled.span`
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const When = styled.span`
  font-family: ${font.mono};
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Relative = styled.span<{ $past: boolean }>`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  color: ${({ $past }) => ($past ? color.danger : color.ink)};
  text-align: right;
`

const Bar = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: ${space.sm}px;
`

const AllLink = styled(Link)`
  color: ${color.fjord};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
  ${focusRing}
`

const typeTone: Record<DeadlineType, ChipTone> = { cancel: 'warning', payment: 'tussock', checkin: 'fjord' }

export function DeadlinesBlock({ trip }: { trip: Trip }) {
  const t = useT()
  const now = useNow()
  const [includePast, setIncludePast] = useState(false)
  const resource = useResource(`deadlines:${trip.id}:${includePast ? 1 : 0}`, (signal) =>
    bookingsApi.deadlines(trip.id, { withinDays: WITHIN_DAYS, includePast }, signal),
  )
  const toggle = (
    <Button size="sm" variant="ghost" aria-pressed={includePast} onClick={() => setIncludePast((v) => !v)}>
      {includePast ? t('bookings.deadlines.hidePast') : t('bookings.deadlines.showPast')}
    </Button>
  )

  if (resource.status === 'loading') return <Skeleton $height={72} />
  if (resource.status === 'error') {
    return (
      <EmptyState
        illustration="receipt"
        title={t('bookings.deadlines.error')}
        action={<Button onClick={resource.reload}>{t('bookings.retry')}</Button>}
      />
    )
  }
  const deadlines = resource.data.deadlines
  const bookingsLink = tripPath(trip.id, 'bookings')

  return (
    <>
      <Bar>
        <AllLink to={bookingsLink}>{t('bookings.deadlines.all')}</AllLink>
        {toggle}
      </Bar>
      {deadlines.length === 0 ? (
        <EmptyState
          illustration="receipt"
          title={t('tripHome.deadlinesEmpty.title')}
          body={t('bookings.deadlines.emptyBody', { days: WITHIN_DAYS })}
        />
      ) : (
        <List aria-label={t('tripHome.deadlines')}>
          {deadlines.map((deadline) => (
            <li key={`${deadline.kind}:${deadline.id}:${deadline.type}`}>
              <DeadlineRow deadline={deadline} tz={trip.tz} now={now} to={bookingsLink} />
            </li>
          ))}
        </List>
      )}
    </>
  )
}

function DeadlineRow({ deadline, tz, now, to }: { deadline: Deadline; tz: string; now: number; to: string }) {
  const t = useT()
  const due = Date.parse(deadline.dueAt)
  const rel = relativeDue(due, now, t.locale)
  const at = new Date(due)
  return (
    <RowLink to={to} $past={rel.past} data-deadline={deadline.type}>
      <BookingTypeIcon type={deadline.kind === 'lodging' ? 'lodging' : (deadline.bookingType ?? 'activity')} size={20} />
      <Main>
        <Title>{deadline.title}</Title>
        <span>
          <Chip tone={typeTone[deadline.type]}>{t(`bookings.deadlines.type.${deadline.type}`)}</Chip>{' '}
          <When>
            {formatDate(at, t.locale, { timeZone: tz })} {formatTime(at, t.locale, { timeZone: tz })}
          </When>
        </span>
      </Main>
      <Relative $past={rel.past}>
        {rel.past ? t('bookings.deadlines.overdue', { amount: rel.text }) : rel.text}
      </Relative>
    </RowLink>
  )
}
