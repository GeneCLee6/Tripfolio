import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'
import { LOCALES } from '../shared/i18n/t.ts'
import { SegmentedControl } from '../src/components/SegmentedControl.tsx'
import { Skeleton } from '../src/components/Skeleton.tsx'
import { useT } from '../src/lib/i18n.ts'
import { focusRing } from '../src/styles/mixins.ts'
import { color, font, fontSize, fontWeight, media, radius, space } from '../src/styles/tokens.ts'
import { loadShare, tokenFromPath, type ShareResult } from './api.ts'
import { Cover } from './components/Cover.tsx'
import { DayCard } from './components/DayCard.tsx'
import { Estimate } from './components/Estimate.tsx'
import { Picks } from './components/Picks.tsx'
import { RouteOverview } from './components/RouteOverview.tsx'
import { setShareLocale } from './locale.ts'

// The read-only share page (/s/<token>, e8-t01a, e8-t01b): cover, route overview, one card per day,
// the picks wall and the cost estimate. Its own bundle: it never loads the editor or the router,
// and MapLibre only lazily. The data comes already filtered by the Worker (CLAUDE.md rule 4): a
// section whose data is absent (no estimate with hideMoney) is simply not drawn.

const Page = styled.div`
  max-width: 880px;
  margin: 0 auto;
  padding: ${space.lg}px max(${space.lg}px, env(safe-area-inset-right, 0px))
    calc(${space.xxl}px + env(safe-area-inset-bottom, 0px))
    max(${space.lg}px, env(safe-area-inset-left, 0px));
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
  margin: 0 0 ${space.md}px;
  font-size: ${fontSize.lg}px;
`

const Days = styled.div`
  display: grid;
  gap: ${space.md}px;
  @media ${media.desktop} {
    gap: ${space.lg}px;
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
  }
  a:hover {
    color: ${color.ink};
  }
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

  const tripName = state.kind === 'ok' ? state.payload.trip.name : null
  useEffect(() => {
    document.title = `${tripName ?? t('share.title')} · ${t('app.name')}`
  }, [tripName, t])

  return (
    <Page>
      <Bar>
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
              <SectionTitle id="share-days">{t('share.days.heading')}</SectionTitle>
              <Days>
                {state.payload.days.map((day) => (
                  <DayCard key={day.index} day={day} trip={state.payload.trip} token={token} />
                ))}
              </Days>
            </Section>
            {state.payload.picks.length > 0 && (
              <Block>
                <Picks picks={state.payload.picks} token={token} />
              </Block>
            )}
            {state.payload.estimate && (
              <Block>
                <Estimate
                  estimate={state.payload.estimate}
                  people={state.payload.trip.memberCount}
                />
              </Block>
            )}
          </>
        )}
      </main>
      <Footer>
        <a href="/">{t('share.footer.madeWith')}</a>
      </Footer>
    </Page>
  )
}
