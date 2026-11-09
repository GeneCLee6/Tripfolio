import { useId, useState, type CSSProperties } from 'react'
import styled, { css } from 'styled-components'
import type { ShareDay, ShareLeg, ShareStop, ShareTrip } from '../../shared/api/share.ts'
import {
  formatDate,
  formatDistance,
  formatDuration,
  formatMoney,
  formatTime,
} from '../../shared/i18n/format.ts'
import type { Locale } from '../../shared/i18n/core.ts'
import { useT, type Translate } from '../../src/lib/i18n.ts'
import { focusRing, visuallyHidden } from '../../src/styles/mixins.ts'
import {
  color,
  font,
  fontSize,
  fontWeight,
  media,
  radius,
  space,
  touchTarget,
} from '../../src/styles/tokens.ts'
import { mediaUrl } from '../api.ts'
import { colorOfDay } from '../colors.ts'
import { modeGlyph, stopGlyph } from '../glyphs.ts'

// One day of the share page (DESIGN.md §4 分享頁): a card with the day-colour bar, "Day N · title",
// the date, the driving total, a compact line of the first stops, and a button that opens the full
// list with the legs between stops. Read-only; everything shown is what the Worker sent.

/** How many stops the closed card names */
const PREVIEW_STOPS = 4
/** Shorter legs (two stops at one place) get no row */
const MIN_LEG_M = 50

const Card = styled.article`
  display: grid;
  grid-template-columns: 6px 1fr;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Bar = styled.div`
  background: var(--day);
`

const Body = styled.div`
  display: grid;
  gap: ${space.xs}px;
  min-width: 0;
  padding: ${space.md}px ${space.lg}px;
`

const Top = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: ${space.xs}px ${space.md}px;
`

const Heading = styled.h3`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.bold};
`

const mono = css`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const DateText = styled.span`
  ${mono};
  font-size: 12px;
  color: ${color.muted};
`

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px ${space.md}px;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

// Durations and distances mix digits with words (「3 小時 41 分」): tabular digits in the body face
// read better than a monospaced CJK run
const Num = styled.span`
  font-variant-numeric: tabular-nums;
  color: ${color.ink};
`

const Preview = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Toggle = styled.button`
  justify-self: start;
  min-height: 32px;
  margin-top: ${space.xs}px;
  padding: 0 ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.paper};
  color: ${color.ink};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
  cursor: pointer;
  &:hover {
    border-color: ${color.muted};
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
  ${focusRing}
`

const List = styled.ol`
  display: grid;
  gap: ${space.xs}px;
  margin: ${space.sm}px 0 0;
  padding: 0;
  list-style: none;
`

const StopBox = styled.div<{ $backup: boolean }>`
  display: grid;
  gap: 2px;
  padding: ${space.sm}px ${space.md}px;
  border: 1px ${({ $backup }) => ($backup ? 'dashed' : 'solid')} ${color.line};
  border-radius: 12px;
  background: ${color.paper};
`

const StopTop = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: ${space.sm}px;
  b {
    font-weight: ${fontWeight.semibold};
  }
`

const Small = styled.span`
  font-size: 12px;
  color: ${color.muted};
`

const SmallNum = styled(Small)`
  ${mono};
  white-space: nowrap;
`

const Tags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px;
`

const Tag = styled.span<{ $tone?: 'fjord' }>`
  padding: 0 ${space.sm}px;
  border: 1px solid ${({ $tone }) => ($tone ? color.fjord : color.line)};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  color: ${({ $tone }) => ($tone ? color.fjord : color.muted)};
  font-size: 11px;
`

const Note = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  white-space: pre-line;
`

const LegLine = styled.li`
  display: flex;
  align-items: center;
  gap: ${space.sm}px;
  padding: 0 0 0 ${space.md}px;
  font-size: 12px;
  color: ${color.muted};
`

const DayNote = styled.div`
  margin-top: ${space.sm}px;
  padding: ${space.sm}px ${space.md}px;
  border-radius: ${radius.control}px;
  background: ${color.paper};
  h4 {
    margin: 0 0 2px;
    font-size: ${fontSize.sm}px;
  }
`

const Photos = styled.ul`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${space.xs}px;
  max-width: 480px;
  margin: ${space.xs}px 0 0;
  padding: 0;
  list-style: none;
  img {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    border-radius: ${radius.control}px;
    background: ${color.paper};
  }
`

const Hidden = styled.span`
  ${visuallyHidden}
`

const Glyph = ({ children }: { children: string }) => <span aria-hidden="true">{children}</span>

/** The name to show: the place's English name in English when there is one */
const stopName = (stop: ShareStop, locale: Locale) =>
  locale === 'en' && stop.nameEn ? stop.nameEn : stop.name

function stopTime(stop: ShareStop, trip: ShareTrip, t: Translate): string | null {
  if (!stop.startAt) return null
  const at = (iso: string) => formatTime(new Date(iso), t.locale, { timeZone: trip.tz })
  return stop.endAt
    ? t('share.stop.timeRange', { start: at(stop.startAt), end: at(stop.endAt) })
    : at(stop.startAt)
}

function LegRow({ leg, t }: { leg: ShareLeg; t: Translate }) {
  const parts = {
    duration: formatDuration((leg.durationS ?? 0) / 60, t.locale),
    distance: formatDistance(leg.distanceM ?? 0, t.locale),
  }
  return (
    <LegLine>
      <Glyph>{modeGlyph[leg.mode]}</Glyph>
      <Hidden>{t(`share.mode.${leg.mode}`)}</Hidden>
      <Num>{t('share.leg.summary', parts)}</Num>
      {leg.source === 'estimate' && (
        <Tag title={t('share.leg.estimateHint')}>{t('share.leg.estimate')}</Tag>
      )}
      {leg.source === 'manual' && <Tag>{t('share.leg.manual')}</Tag>}
    </LegLine>
  )
}

function StopItem({ stop, trip, t }: { stop: ShareStop; trip: ShareTrip; t: Translate }) {
  const time = stopTime(stop, trip, t)
  const name = stopName(stop, t.locale)
  return (
    <li>
      <StopBox $backup={stop.isBackup}>
        <StopTop>
          <span>
            <Glyph>{stopGlyph[stop.type]}</Glyph>{' '}
            <Hidden>{t(`share.stopType.${stop.type}`)}</Hidden>
            <b>{name}</b>
          </span>
          {time && <SmallNum>{time}</SmallNum>}
        </StopTop>
        {stop.address && <Small>{stop.address}</Small>}
        {(stop.isBackup ||
          stop.booking !== 'none' ||
          stop.durationMin !== undefined ||
          stop.costMinor !== undefined) && (
          <Tags>
            {stop.isBackup && <Tag>{t('share.stop.backup')}</Tag>}
            {stop.booking === 'booked' && <Tag $tone="fjord">{t('share.stop.booked')}</Tag>}
            {stop.booking === 'todo' && <Tag>{t('share.stop.todo')}</Tag>}
            {stop.durationMin !== undefined && stop.durationMin > 0 && (
              <Tag>{formatDuration(stop.durationMin, t.locale)}</Tag>
            )}
            {stop.costMinor !== undefined && stop.currency && (
              <Tag>{formatMoney(stop.costMinor, stop.currency, t.locale)}</Tag>
            )}
          </Tags>
        )}
        {stop.note && <Note>{stop.note}</Note>}
      </StopBox>
    </li>
  )
}

export function DayCard({ day, trip, token }: { day: ShareDay; trip: ShareTrip; token: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const listId = useId()
  const dayLabel = t('day.short', { n: day.index })
  const heading = day.title ? t('share.day.heading', { day: dayLabel, title: day.title }) : dayLabel
  const main = day.stops.filter((stop) => !stop.isBackup)
  const preview = main.slice(0, PREVIEW_STOPS)
  const more = main.length - preview.length
  const legFrom = new Map(day.legs.map((leg) => [leg.fromOrder, leg]))
  const tripGlyph = modeGlyph[trip.style === 'campervan' ? 'campervan' : 'drive']
  const style = { '--day': colorOfDay(day.index, day.color) } as CSSProperties

  return (
    <Card style={style}>
      <Bar />
      <Body>
        <Top>
          <Heading>{heading}</Heading>
          {day.date && <DateText>{formatDate(day.date, t.locale)}</DateText>}
        </Top>
        {(day.lodgingName || day.checkoutTime || day.driveMinutes > 0) && (
          <Meta>
            {day.lodgingName && (
              <span>
                <Glyph>{stopGlyph.lodging}</Glyph>{' '}
                {t('share.day.lodging', { name: day.lodgingName })}
                {day.campType && <> · {t(`share.campType.${day.campType}`)}</>}
              </span>
            )}
            {day.checkoutTime && (
              <span>
                <Num>{t('share.day.checkout', { time: day.checkoutTime })}</Num>
              </span>
            )}
            {day.driveMinutes > 0 && (
              <span>
                <Glyph>{tripGlyph}</Glyph> <Hidden>{t('term.drivingTime')}</Hidden>
                <Num>
                  {t('share.day.drive', {
                    duration: formatDuration(day.driveMinutes, t.locale),
                    distance: formatDistance(day.distanceM, t.locale),
                  })}
                </Num>
              </span>
            )}
          </Meta>
        )}
        {day.photoIds.length > 0 && (
          <Photos aria-label={t('share.day.photos', { day: dayLabel })}>
            {day.photoIds.map((id, i) => (
              <li key={id}>
                <img
                  src={mediaUrl(id, token)}
                  alt={t('share.day.photoAlt', { day: dayLabel, n: i + 1 })}
                  loading="lazy"
                  decoding="async"
                />
              </li>
            ))}
          </Photos>
        )}
        {preview.length === 0 ? (
          <Preview>{t('share.day.empty')}</Preview>
        ) : (
          !open && (
            <Preview>
              {preview.map((stop, i) => {
                const time = stopTime(stop, trip, t)
                return (
                  <span key={stop.order}>
                    {i > 0 && ' · '}
                    <Glyph>{stopGlyph[stop.type]}</Glyph> {stopName(stop, t.locale)}
                    {time && (
                      <>
                        {' '}
                        <Num>{time}</Num>
                      </>
                    )}
                  </span>
                )
              })}
              {more > 0 && <> · {t.plural('share.day.more', more)}</>}
            </Preview>
          )
        )}
        {open && (
          <div id={listId}>
            <List>
              {day.stops.map((stop) => {
                const found = stop.isBackup ? undefined : legFrom.get(stop.order)
                // Two stops at the same place have nothing worth a leg row between them
                const leg = found && (found.distanceM ?? 0) >= MIN_LEG_M ? found : undefined
                return [
                  <StopItem key={`s${stop.order}`} stop={stop} trip={trip} t={t} />,
                  leg && <LegRow key={`l${stop.order}`} leg={leg} t={t} />,
                ]
              })}
            </List>
            {day.note && (
              <DayNote>
                <h4>{t('share.day.note')}</h4>
                <Note>{day.note}</Note>
              </DayNote>
            )}
          </div>
        )}
        {(day.stops.length > 0 || day.note) && (
          <Toggle
            type="button"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t('share.day.collapse') : t('share.day.expand')}
          </Toggle>
        )}
      </Body>
    </Card>
  )
}
