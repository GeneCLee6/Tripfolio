import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import styled from 'styled-components'
import type { ChecklistsResponse } from '../../../shared/api/prep.ts'
import type { DaysResponse, Place, Trip } from '../../../shared/api/types.ts'
import { formatDate, formatDuration, formatTime } from '../../../shared/i18n/format.ts'
import { tripPath } from '../../app/sections.ts'
import { useTripContext } from '../../app/trip-context.ts'
import { Button, Skeleton, StopTypeIcon, WarningIcon, useToast } from '../../components/index.ts'
import { ButtonLink } from '../../components/ButtonLink.tsx'
import { PlusIcon } from '../../components/icons.tsx'
import { itineraryApi } from '../../lib/api.ts'
import { useResource } from '../../lib/hooks.ts'
import { useT } from '../../lib/i18n.ts'
import { assembleDay, overridesByKey, toItineraryStops } from '../../lib/itinerary/legs.ts'
import { checklistsApi } from '../../lib/prep/api.ts'
import { useCan } from '../../lib/role.ts'
import {
  dayFor,
  todayStops,
  todayTodos,
  tripToday,
  weatherPoint,
  weatherUrl,
} from '../../lib/today/today.ts'
import { focusRing, visuallyHidden } from '../../styles/mixins.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { LodgingLine } from '../bookings/LodgingLine.tsx'
import { PhaseCard, PhaseHead, PhaseMeta, PhaseTitle } from './parts.ts'

// 今日卡 (e9-t06, AC-9.5): what a tour leader tells you each morning — today's day and first
// stops with their times, tonight's lodging, how long the drive is (against the daily limit), the
// to-dos due today, a weather link and 記一筆. A lazy chunk: only an ongoing trip loads it.
// Driving times are estimates from the stops' coordinates (the home makes no routing calls), so
// they can differ a little from the itinerary page once its legs are routed.

// The same 記一筆 sheet as TripLayout's floating button, loaded on the first tap
const ExpenseFormSheet = lazy(() => import('../expenses/ExpenseFormSheet.tsx'))

const Stops = styled.ol`
  display: grid;
  gap: ${space.xs}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const StopRow = styled.li`
  display: grid;
  grid-template-columns: 48px auto 1fr;
  align-items: center;
  gap: ${space.sm}px;
  min-height: 32px;
  > svg {
    color: ${color.fjord};
  }
`

const Time = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const StopName = styled.span`
  overflow-wrap: anywhere;
`

const Hidden = styled.span`
  ${visuallyHidden}
`

const Note = styled.p<{ $warn?: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px ${space.sm}px;
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${({ $warn }) => ($warn ? color.warningText : color.muted)};
`

const Small = styled(Link)`
  justify-self: start;
  color: ${color.fjord};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.semibold};
  border-radius: ${radius.control}px;
  ${focusRing}
`

const Block = styled.div`
  display: grid;
  gap: ${space.xs}px;
`

const SubTitle = styled.h3`
  margin: 0;
  font-size: ${fontSize.body}px;
  font-weight: ${fontWeight.semibold};
`

const Todos = styled.ul`
  display: grid;
  gap: ${space.xs}px;
  margin: 0;
  padding: 0 0 0 ${space.lg}px;
  > li > span {
    margin-left: ${space.sm}px;
    font-size: ${fontSize.sm}px;
    color: ${color.muted};
  }
  > li > strong {
    margin-left: ${space.sm}px;
    font-size: ${fontSize.sm}px;
    color: ${color.danger};
  }
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
`

interface TodayData {
  days: DaysResponse
  places: Place[]
  checklists: ChecklistsResponse | null
}

export default function TodayCard({ trip, nowMs }: { trip: Trip; nowMs: number }) {
  const t = useT()
  const toast = useToast()
  const { me } = useTripContext()
  const canEdit = useCan()('editContent')
  const [expense, setExpense] = useState({ loaded: false, open: false })
  const today = tripToday(trip, nowMs)

  const data = useResource<TodayData>(`home-today:${trip.id}:${today}`, async (signal) => {
    const [days, places, checklists] = await Promise.all([
      itineraryApi.listDays(trip.id, signal),
      itineraryApi.listPlaces(trip.id, signal).catch(() => ({ places: [] as Place[] })),
      checklistsApi.list(trip.id, signal).catch(() => null),
    ])
    return { days, places: places.places, checklists }
  })

  const view = useMemo(() => {
    if (data.status !== 'ready') return null
    const day = dayFor(data.data.days.days, today)
    const places = new Map(data.data.places.map((place) => [place.id, place]))
    const stops = day ? todayStops(day.stops) : null
    const summary = stops
      ? assembleDay(stops.all, places, {
          style: trip.style,
          limitMinutes: trip.driveLimitMin,
          overrides: overridesByKey(data.data.days.legs, trip.style),
          cache: new Map(),
        }).summary
      : null
    const first = stops ? toItineraryStops(stops.all, places).find((s) => s.lat != null && s.lng != null) : null
    const point = weatherPoint(trip, first ?? null)
    const todos = data.data.checklists
      ? todayTodos(data.data.checklists.checklists, today, me.id)
      : []
    return { day, stops, summary, point, todos }
  }, [data.status, data.data, today, trip, me.id])

  const logExpense = () =>
    canEdit ? setExpense({ loaded: true, open: true }) : toast.show(t('expenses.readOnly'))

  const day = view?.day ?? null
  const summary = view?.summary ?? null

  return (
    <PhaseCard aria-labelledby="home-today" data-phase-card="today">
      <PhaseHead>
        <PhaseTitle id="home-today">
          {t('tripHome.today.title')}
          {day?.idx != null && ` · ${t('tripHome.today.day', { day: day.idx })}`}
          {day?.title && ` · ${day.title}`}
        </PhaseTitle>
        <PhaseMeta>{formatDate(today, t.locale)}</PhaseMeta>
      </PhaseHead>

      {data.status === 'loading' && (
        <div aria-busy="true">
          <Skeleton $height={96} />
        </div>
      )}

      {day && view?.stops && (
        <>
          {view.stops.shown.length === 0 ? (
            <Note>{t('tripHome.today.noStops')}</Note>
          ) : (
            <Stops data-today-stops="">
              {view.stops.shown.map((stop) => (
                <StopRow key={stop.id} data-stop={stop.id}>
                  <Time>
                    {stop.startAt
                      ? formatTime(new Date(stop.startAt), t.locale, { timeZone: trip.tz })
                      : ''}
                  </Time>
                  <StopTypeIcon type={stop.type} size={18} />
                  <StopName>
                    <Hidden>{t(`itinerary.stopType.${stop.type}`)} </Hidden>
                    {stop.title}
                  </StopName>
                </StopRow>
              ))}
            </Stops>
          )}
          <Small to={tripPath(trip.id, 'itinerary')}>
            {view.stops.more > 0
              ? t('tripHome.today.more', { count: view.stops.more })
              : t('tripHome.today.allStops')}
          </Small>
          <LodgingLine day={day} trip={trip} />
          {summary && summary.driveMinutes > 0 && (
            <Note $warn={summary.overLimit} data-today-drive="">
              {summary.overLimit && <WarningIcon />}
              <span>
                {t(summary.label === 'ride' ? 'tripHome.today.ride' : 'tripHome.today.drive', {
                  time: formatDuration(summary.driveMinutes, t.locale),
                })}
              </span>
              {summary.overLimit && summary.limitMinutes !== null && (
                <span>
                  {t('tripHome.today.overLimit', {
                    limit: formatDuration(summary.limitMinutes, t.locale),
                  })}
                </span>
              )}
            </Note>
          )}
        </>
      )}

      {view && view.todos.length > 0 && (
        <Block data-today-todos="">
          <SubTitle>{t('tripHome.today.todos')}</SubTitle>
          <Todos>
            {view.todos.map(({ item, listTitle, overdue }) => (
              <li key={item.id}>
                {item.text}
                <span>{listTitle}</span>
                {overdue && <strong>{t('tripHome.today.overdue')}</strong>}
              </li>
            ))}
          </Todos>
          <Small to={tripPath(trip.id, 'checklists')}>{t('prep.links.checklists')}</Small>
        </Block>
      )}

      <Actions>
        <Button variant="primary" onClick={logExpense} data-today-log="">
          <PlusIcon size={16} />
          {t('term.logExpense')}
        </Button>
        {view?.point && (
          <ButtonLink
            to={weatherUrl(view.point)}
            target="_blank"
            rel="noopener noreferrer"
            reloadDocument
            data-today-weather=""
          >
            {t('tripHome.today.weather')}
          </ButtonLink>
        )}
      </Actions>

      {expense.loaded && (
        <Suspense fallback={null}>
          <ExpenseFormSheet
            open={expense.open}
            onClose={() => setExpense({ loaded: true, open: false })}
          />
        </Suspense>
      )}
    </PhaseCard>
  )
}
