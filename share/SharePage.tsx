import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import styled from 'styled-components'
import { LOCALES } from '../shared/i18n/core.ts'
import { SegmentedControl } from '../src/components/SegmentedControl.tsx'
import { Skeleton } from '../src/components/Skeleton.tsx'
import { useT } from '../src/lib/i18n.ts'
import { coarseLink, focusRing } from '../src/styles/mixins.ts'
import {
  color,
  font,
  fontSize,
  fontWeight,
  media,
  radius,
  space,
  touchTarget,
} from '../src/styles/tokens.ts'
import { loadShare, tokenFromPath, type ShareResult } from './api.ts'
import { BookingsTable } from './components/BookingsTable.tsx'
import { Cover } from './components/Cover.tsx'
import { DayCard } from './components/DayCard.tsx'
import { Estimate } from './components/Estimate.tsx'
import { Picks } from './components/Picks.tsx'
import { Recap } from './components/Recap.tsx'
import { RouteOverview } from './components/RouteOverview.tsx'
import { setShareLocale } from './locale.ts'
import { PrintStyle } from './print.ts'

// The read-only share page (/s/<token>, e8-t01a, e8-t01b): cover, route overview, one card per day,
// the picks wall and the cost estimate. Its own bundle: it never loads the editor or the router,
// and MapLibre only lazily. The data comes already filtered by the Worker (CLAUDE.md rule 4): a
// section whose data is absent (no estimate with hideMoney) is simply not drawn.
// Print (e8-t02, share/print.ts): 「列印／存成 PDF」 (or the browser's own print, through
// `beforeprint`) first renders the print-only parts — each day's static map and stops table, the
// bookings summary — synchronously, then prints: cover and route overview, a page per day, then the
// bookings and the estimate. The picks wall and the controls stay off paper.
// Recap (e8-t04): with showRecap after the end date, a 「回顧」 section of recap texts and photos
// follows the days (screen only).

const Page = styled.div`
  max-width: 880px;
  margin: 0 auto;
  padding: ${space.lg}px max(${space.lg}px, env(safe-area-inset-right, 0px))
    calc(${space.xxl}px + env(safe-area-inset-bottom, 0px))
    max(${space.lg}px, env(safe-area-inset-left, 0px));
  @media print {
    max-width: none;
    padding: 0;
  }
`

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space.md}px;
  margin-bottom: ${space.lg}px;
`

const Brand = styled.a`
  font-family: ${font.display};
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.heavy};
  color: ${color.ink};
  text-decoration: none;
  ${focusRing}
`

const Section = styled.section`
  margin-top: ${space.xl}px;
`

// Spacing around the sections that bring their own <section>
const Block = styled.div`
  margin-top: ${space.xl}px;
  &:empty {
    display: none;
  }
`

const SectionTitle = styled.h2`
  margin: 0;
  font-size: ${fontSize.lg}px;
`

const SectionHead = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px ${space.md}px;
  margin: 0 0 ${space.md}px;
`

const PrintButton = styled.button`
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
  ${focusRing}
`

const Days = styled.div`
  display: grid;
  gap: ${space.md}px;
  @media ${media.desktop} {
    gap: ${space.lg}px;
  }
  @media print {
    display: block;
  }
`

const Message = styled.div`
  display: grid;
  gap: ${space.md}px;
  justify-items: start;
  margin-top: ${space.xxl}px;
  padding: ${space.xl}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  h1 {
    margin: 0;
    font-size: ${fontSize.xl}px;
  }
  p {
    margin: 0;
    color: ${color.muted};
  }
`

const Retry = styled.button`
  min-height: 40px;
  padding: 0 ${space.lg}px;
  border: 1px solid ${color.fjord};
  border-radius: ${radius.control}px;
  background: ${color.fjord};
  color: ${color.onFjord};
  font-weight: ${fontWeight.semibold};
  cursor: pointer;
  ${focusRing}
`

const Footer = styled.footer`
  margin-top: ${space.xxxl}px;
  text-align: center;
  font-size: ${fontSize.sm}px;
  a {
    color: ${color.muted};
    ${coarseLink}
  }
  a:hover {
    color: ${color.ink};
  }
`

const PrintOnly = styled.div`
  margin-top: ${space.xl}px;
`

const Loading = styled.div`
  display: grid;
  gap: ${space.md}px;
`

type State = { kind: 'loading' } | ShareResult

function LoadingView({ label }: { label: string }) {
  return (
    <Loading aria-busy="true" aria-label={label} role="status">
      <Skeleton $height={320} $radius="cover" />
      <Skeleton $width="40%" $height={20} />
      <Skeleton $height={96} $radius="card" />
      <Skeleton $height={96} $radius="card" />
      <Skeleton $height={96} $radius="card" />
    </Loading>
  )
}

export function SharePage() {
  const t = useT()
  const [token] = useState(() => tokenFromPath(window.location.pathname) ?? '')
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setState({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadShare(token || null, controller.signal).then(
      setState,
      () => {}, // aborted: the page is going away or loading again
    )
    return () => controller.abort()
  }, [attempt, token])

  // Print-only parts render once the page prepares to print, and stay (hidden on screen)
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true))
    window.addEventListener('beforeprint', before)
    return () => window.removeEventListener('beforeprint', before)
  }, [])
  const print = useCallback(() => {
    flushSync(() => setPrinting(true))
    window.print()
  }, [])

  const tripName = state.kind === 'ok' ? state.payload.trip.name : null
  useEffect(() => {
    document.title = `${tripName ?? t('share.title')} · ${t('app.name')}`
  }, [tripName, t])

  return (
    <Page>
      <PrintStyle />
      <Bar data-print="hide">
        <Brand href="/">{t('app.name')}</Brand>
        <SegmentedControl
          label={t('language.label')}
          size="sm"
          value={t.locale}
          onChange={setShareLocale}
          options={LOCALES.map((value) => ({ value, label: t(`language.${value}`), lang: value }))}
        />
      </Bar>
      <main>
        {state.kind === 'loading' && <LoadingView label={t('share.loading')} />}
        {state.kind === 'notFound' && (
          <Message role="alert">
            <h1>{t('share.notFound.title')}</h1>
            <p>{t('share.notFound.body')}</p>
          </Message>
        )}
        {state.kind === 'error' && (
          <Message role="alert">
            <h1>{t('share.error.title')}</h1>
            <p>{t('share.error.body')}</p>
            <Retry type="button" onClick={retry}>
              {t('share.error.retry')}
            </Retry>
          </Message>
        )}
        {state.kind === 'ok' && (
          <>
            <Cover payload={state.payload} token={token} />
            <Block>
              <RouteOverview payload={state.payload} />
            </Block>
            <Section aria-labelledby="share-days">
              <SectionHead data-print="hide">
                <SectionTitle id="share-days">{t('share.days.heading')}</SectionTitle>
                <PrintButton type="button" onClick={print} data-testid="share-print">
                  {t('share.print.button')}
                </PrintButton>
              </SectionHead>
              <Days>
                {state.payload.days.map((day) => {
                  const night = state.payload.overnight.find(
                    (line) => line.dayIndex === day.index && line.toLodging,
                  )
                  return (
                    <DayCard
                      key={day.index}
                      day={day}
                      trip={state.payload.trip}
                      token={token}
                      printing={printing}
                      lodgingPoint={night?.to}
                      bookings={state.payload.bookings.filter(
                        (b) => b.kind !== 'lodging' && !!day.date && b.startDate === day.date,
                      )}
                    />
                  )
                })}
              </Days>
            </Section>
            <Block>
              <Recap days={state.payload.days} token={token} />
            </Block>
            {printing && state.payload.bookings.length > 0 && (
              <PrintOnly data-print="only" data-print-break="before">
                <BookingsTable bookings={state.payload.bookings} options={state.payload.options} />
              </PrintOnly>
            )}
            {state.payload.picks.length > 0 && (
              <Block data-print="hide">
                <Picks picks={state.payload.picks} token={token} />
              </Block>
            )}
            {state.payload.estimate && (
              <Block data-print-break={state.payload.bookings.length === 0 ? 'before' : undefined}>
                <Estimate
                  estimate={state.payload.estimate}
                  people={state.payload.trip.memberCount}
                />
              </Block>
            )}
          </>
        )}
      </main>
      <Footer data-print="hide">
        <a href="/">{t('share.footer.madeWith')}</a>
      </Footer>
    </Page>
  )
}
