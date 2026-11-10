import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import styled from 'styled-components'
import type { SharePayload } from '../../shared/api/share.ts'
import type { MapPlace, MapStop, OvernightLink } from '../../src/map/types.ts'
import { useT } from '../../src/lib/i18n.ts'
import { focusRing } from '../../src/styles/mixins.ts'
import {
  color,
  fontSize,
  fontWeight,
  media,
  radius,
  space,
  touchTarget,
} from '../../src/styles/tokens.ts'
import { colorOfDay } from '../colors.ts'
import { StaticRoute } from './StaticRoute.tsx'

// The route overview (e8-t01b, AC-8.1): the whole trip's nights joined in day colours. The static
// sketch renders at once; the MapLibre map (the lazy `maplibre` chunk the app also uses) mounts only
// once the reader scrolls and the section comes into view, or on the button, so the first screen
// never loads it. With prefers-reduced-data, or without IntersectionObserver, only the button
// loads it. In print the sketch stays and the live map is hidden.

const TripMap = lazy(() => import('../../src/map/TripMap.tsx'))

const LAYERS = { itinerary: true, pocket: false, lodging: true, picks: true, fuel: false }

const Frame = styled.div`
  position: relative;
  height: 380px;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  @media ${media.mobile} {
    height: 300px;
  }
  @media print {
    height: 100mm;
    break-inside: avoid;
  }
`

const Live = styled.div`
  position: absolute;
  inset: 0;
  @media print {
    display: none;
  }
`

const LoadButton = styled.button`
  position: absolute;
  right: ${space.md}px;
  top: ${space.md}px;
  min-height: 32px;
  padding: 0 ${space.md}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.card};
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
  @media print {
    display: none;
  }
  ${focusRing}
`

const Legend = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px;
  margin: ${space.sm}px 0 0;
  padding: 0;
  list-style: none;
`

const LegendItem = styled.li`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px ${space.sm}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  font-size: 12px;
  &::before {
    content: '';
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--day);
  }
`

const prefersReducedData = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-data: reduce)').matches

/** True once the reader has scrolled and the element is (nearly) in view */
function useLoadOnScroll(ref: RefObject<HTMLElement | null>): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined' || prefersReducedData()) return
    let observer: IntersectionObserver | null = null
    const arm = () => {
      if (observer) return
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setShow(true)
            observer?.disconnect()
          }
        },
        { rootMargin: '200px 0px' },
      )
      observer.observe(element)
    }
    // Armed on the first scroll: a section already on screen at load does not count, so the
    // first screen (and a Lighthouse run) never loads MapLibre
    window.addEventListener('scroll', arm, { passive: true, once: true })
    return () => {
      window.removeEventListener('scroll', arm)
      observer?.disconnect()
    }
  }, [ref])
  return show
}

export function RouteOverview({ payload }: { payload: SharePayload }) {
  const t = useT()
  const frameRef = useRef<HTMLDivElement>(null)
  const scrolled = useLoadOnScroll(frameRef)
  const [asked, setAsked] = useState(false)
  const live = scrolled || asked
  const { days, overnight, picks } = payload
  const dayColor = (index: number) =>
    colorOfDay(index, days.find((d) => d.index === index)?.color ?? null)

  const stops = useMemo(
    () =>
      days.flatMap((day) =>
        day.stops
          .filter((s) => !s.isBackup && s.lat !== undefined && s.lng !== undefined)
          .map(
            (s, i): MapStop => ({
              id: `d${day.index}s${i}`,
              dayIndex: day.index - 1,
              order: i + 1,
              lat: s.lat ?? 0,
              lng: s.lng ?? 0,
              type: s.type,
              name: t.locale === 'en' && s.nameEn ? s.nameEn : s.name,
            }),
          ),
      ),
    [days, t.locale],
  )
  const links = useMemo(
    () =>
      overnight.map(
        (line): OvernightLink => ({ dayIndex: line.dayIndex - 1, from: line.from, to: line.to }),
      ),
    [overnight],
  )
  const lodging = useMemo(
    () =>
      overnight
        .filter((line) => line.toLodging)
        .map(
          (line, i): MapPlace => ({
            id: `n${i}`,
            lat: line.to.lat,
            lng: line.to.lng,
            name: line.toName,
            type: 'lodging',
            dayIndex: line.dayIndex - 1,
          }),
        ),
    [overnight],
  )
  const pickPlaces = useMemo(
    () =>
      picks.flatMap((pick, i): MapPlace[] =>
        pick.place
          ? [
              {
                id: `p${i}`,
                lat: pick.place.lat,
                lng: pick.place.lng,
                name: t.locale === 'en' && pick.nameEn ? pick.nameEn : pick.name,
                ...(pick.dayIndex ? { dayIndex: pick.dayIndex - 1 } : {}),
              },
            ]
          : [],
      ),
    [picks, t.locale],
  )

  if (stops.length === 0 && overnight.length === 0) return null
  const legendDays = days.filter((d) => overnight.some((line) => line.dayIndex === d.index))

  return (
    <section aria-labelledby="share-map">
      <SectionHeading id="share-map">{t('share.map.heading')}</SectionHeading>
      <Frame ref={frameRef} data-testid="share-map">
        <StaticRoute
          overnight={overnight}
          extraPoints={stops}
          dayColor={dayColor}
          label={t('share.map.label')}
        />
        {live ? (
          <Live role="region" aria-label={t('share.map.region')} data-testid="share-live-map">
            <Suspense fallback={null}>
              <TripMap
                stops={stops}
                overnightLinks={links}
                lodging={lodging}
                picks={pickPlaces}
                mode="trip"
                layers={LAYERS}
                height="100%"
                onReady={(map) => map.scrollZoom.disable()}
              />
            </Suspense>
          </Live>
        ) : (
          <LoadButton type="button" onClick={() => setAsked(true)}>
            {t('share.map.load')}
          </LoadButton>
        )}
      </Frame>
      {legendDays.length > 0 && (
        <Legend aria-label={t('share.map.legend')}>
          {legendDays.map((day) => (
            <LegendItem
              key={day.index}
              style={{ '--day': dayColor(day.index) } as CSSProperties}
            >
              {t('day.short', { n: day.index })}
            </LegendItem>
          ))}
        </Legend>
      )}
    </section>
  )
}

const SectionHeading = styled.h2`
  margin: 0 0 ${space.md}px;
  font-size: ${fontSize.lg}px;
`
