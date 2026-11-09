import type { CSSProperties } from 'react'
import styled from 'styled-components'
import type { SharePayload } from '../../shared/api/share.ts'
import {
  formatDateRange,
  formatDistance,
  formatDuration,
  formatMoney,
  formatTzAbbrev,
} from '../../shared/i18n/format.ts'
import { useT } from '../../src/lib/i18n.ts'
import {
  font,
  fontSize,
  fontWeight,
  media,
  onDayColor,
  palette,
  radius,
  space,
} from '../../src/styles/tokens.ts'
import { colorOfCover } from '../colors.ts'

// The cover (docs/design/mockup.html Screen 1): the trip's colour as a deep gradient with contour
// lines, the destination as an eyebrow, the title, the one-line summary and the stat chips. The
// cover is always dark, in both themes, so its text is white (onDayColor) on any cover colour.

const Hero = styled.header`
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  min-height: 340px;
  border-radius: ${radius.cover}px;
  color: ${onDayColor};
  background: linear-gradient(
    155deg,
    var(--cover) 0%,
    color-mix(in srgb, var(--cover) 62%, ${palette.light.ink}) 100%
  );
  @media ${media.mobile} {
    min-height: 300px;
    border-radius: ${radius.card}px;
  }
`

const Topo = styled.svg`
  position: absolute;
  inset: 0;
  z-index: -1;
  width: 100%;
  height: 100%;
  opacity: 0.5;
`

const Shade = styled.div`
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(
    180deg,
    transparent 20%,
    color-mix(in srgb, ${palette.light.ink} 70%, transparent) 100%
  );
`

const Inner = styled.div`
  display: grid;
  gap: ${space.md}px;
  width: 100%;
  padding: ${space.xxl}px;
  @media ${media.mobile} {
    padding: ${space.xl}px ${space.lg}px;
  }
`

const Eyebrow = styled.span`
  font-family: ${font.mono};
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: color-mix(in srgb, ${onDayColor} 78%, transparent);
`

const Title = styled.h1`
  margin: 0;
  font-size: clamp(30px, 6vw, 56px);
  font-weight: ${fontWeight.heavy};
  letter-spacing: -0.02em;
`

const Summary = styled.p`
  margin: 0;
  max-width: 60ch;
  font-size: ${fontSize.md}px;
  color: color-mix(in srgb, ${onDayColor} 86%, transparent);
`

const Stats = styled.dl`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
  margin: ${space.xs}px 0 0;
`

const Stat = styled.div`
  display: flex;
  flex-direction: column-reverse;
  min-width: 104px;
  padding: ${space.sm}px ${space.md}px;
  border: 1px solid color-mix(in srgb, ${onDayColor} 24%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, ${onDayColor} 12%, transparent);
  dt {
    font-size: 12px;
    color: color-mix(in srgb, ${onDayColor} 80%, transparent);
  }
  dd {
    margin: 0;
    font-family: ${font.mono};
    font-size: ${fontSize.lg}px;
    font-weight: ${fontWeight.medium};
    font-variant-numeric: tabular-nums;
  }
  @media ${media.mobile} {
    min-width: 0;
    flex: 1 1 calc(50% - ${space.sm}px);
    dd {
      font-size: ${fontSize.md}px;
    }
  }
`

/** Contour lines after the mockup's hero; stroked in glacier on the dark cover */
function Contours() {
  return (
    <Topo viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke={palette.light.glacier} strokeWidth="1.2" opacity=".7">
        <path d="M-20 300C120 240 200 340 340 290S560 200 700 260 900 240 900 240" />
        <path d="M-20 330C120 270 210 370 350 320S570 230 710 290 900 270 900 270" />
        <path d="M-20 360C120 300 220 400 360 350S580 260 720 320 900 300 900 300" />
        <path d="M-20 270C110 210 190 310 330 260S550 170 690 230 900 210 900 210" />
        <path d="M-20 240C100 180 180 280 320 230S540 140 680 200 900 180 900 180" />
        <path d="M-20 210C90 150 170 250 310 200S530 110 670 170 900 150 900 150" />
        <path d="M100 60C200 20 300 90 400 60S600 10 700 50 900 40 900 40" />
        <path d="M60 90C180 50 280 120 400 90S620 40 720 80 900 70 900 70" />
        <path d="M20 120C160 80 260 150 400 120S640 70 740 110 900 100 900 100" />
      </g>
    </Topo>
  )
}

export function Cover({ payload }: { payload: SharePayload }) {
  const t = useT()
  const { trip, days } = payload
  const locale = t.locale
  const nights = Math.max(0, trip.dayCount - 1)
  const distanceM = days.reduce((sum, day) => sum + day.distanceM, 0)
  const driveMinutes = days.reduce((sum, day) => sum + day.driveMinutes, 0)
  const average = days.length > 0 ? driveMinutes / days.length : 0
  const tz = formatTzAbbrev(trip.tz, locale, new Date(`${trip.startDate}T12:00:00Z`))
  const style = { '--cover': colorOfCover(trip.coverColor) } as CSSProperties

  return (
    <Hero style={style} aria-label={t('share.cover.label')}>
      <Contours />
      <Shade />
      <Inner>
        {trip.destination && <Eyebrow>{trip.destination}</Eyebrow>}
        <Title>{trip.name}</Title>
        {trip.summary && <Summary>{trip.summary}</Summary>}
        <Stats aria-label={t('share.stats.label')}>
          <Stat>
            <dt>
              {t('share.stat.daysNights', {
                days: t.plural('share.stat.days', trip.dayCount),
                nights: t.plural('share.stat.nights', nights),
              })}
            </dt>
            <dd>{new Intl.NumberFormat(locale).format(trip.dayCount)}</dd>
          </Stat>
          <Stat>
            <dt>{t('share.stat.dates', { tz })}</dt>
            <dd>{formatDateRange(trip.startDate, trip.endDate, locale)}</dd>
          </Stat>
          <Stat>
            <dt>{t.plural('share.stat.members', trip.memberCount)}</dt>
            <dd>{new Intl.NumberFormat(locale).format(trip.memberCount)}</dd>
          </Stat>
          {distanceM > 0 && (
            <Stat>
              <dt>{t('share.stat.distance', { average: formatDuration(average, locale) })}</dt>
              <dd>{formatDistance(distanceM, locale)}</dd>
            </Stat>
          )}
          {trip.estimatedPerPersonMinor !== undefined && trip.baseCurrency && (
            <Stat>
              <dt>{t('share.stat.perPerson')}</dt>
              <dd>{formatMoney(trip.estimatedPerPersonMinor, trip.baseCurrency, locale)}</dd>
            </Stat>
          )}
        </Stats>
      </Inner>
    </Hero>
  )
}
