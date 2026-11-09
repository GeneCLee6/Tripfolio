import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import styled from 'styled-components'
import type { TripDetailResponse } from '../../shared/api/types.ts'
import { formatDateRange } from '../../shared/i18n/format.ts'
import { Button, Chip, EmptyState, Sheet, Skeleton, useToast } from '../components/index.ts'
import { ButtonLink } from '../components/ButtonLink.tsx'
import { PlusIcon } from '../components/icons.tsx'
import { api, isApiError } from '../lib/api.ts'
import { safeColor } from '../lib/colors.ts'
import { errorMessageKey, isAccessError } from '../lib/errors.ts'
import { useMediaQuery, useResource } from '../lib/hooks.ts'
import { useT } from '../lib/i18n.ts'
import { useCan } from '../lib/role.ts'
import { removeToken } from '../lib/tokens.ts'
import { focusRing } from '../styles/mixins.ts'
import {
  color,
  duration,
  font,
  fontSize,
  fontWeight,
  media,
  radius,
  space,
  touchTarget,
  zIndex,
} from '../styles/tokens.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { SettingsIcon } from './icons.tsx'
import { SECTIONS, tripPath } from './sections.ts'
import { Page, TopBar } from './TopBar.tsx'
import {
  DetailPaneContext,
  TripContext,
  type Detail,
  type TripContextValue,
} from './trip-context.ts'

// The frame around everything inside a trip (DESIGN.md §4, e10-t03):
//   phone (< 768)        one column, bottom navigation with five tabs and the floating 記一筆 button
//   tablet (768–1199)    two columns: trip summary and navigation | the page
//   desktop (≥ 1200)     three columns: navigation 360 px | the page | detail pane 400 px
// Pages fill the detail pane through useDetailPane(); below desktop it opens as a Sheet.

const BOTTOM_NAV_HEIGHT = 64
const SIDE_WIDTH = { tablet: 280, desktop: 360 }
const DETAIL_WIDTH = 400

const Frame = styled.div`
  @media ${media.tablet} {
    display: grid;
    grid-template-columns: ${SIDE_WIDTH.tablet}px minmax(0, 1fr);
    gap: ${space.xl}px;
    padding: ${space.xl}px max(${space.xl}px, env(safe-area-inset-right, 0px)) ${space.xxxl}px
      max(${space.xl}px, env(safe-area-inset-left, 0px));
    max-width: 1200px;
    margin: 0 auto;
  }
  @media ${media.desktop} {
    grid-template-columns: ${SIDE_WIDTH.desktop}px minmax(0, 1fr) ${DETAIL_WIDTH}px;
    max-width: none;
  }
`

const Side = styled.aside`
  display: none;
  @media ${media.tablet} {
    display: grid;
    align-content: start;
    gap: ${space.lg}px;
    position: sticky;
    top: ${56 + space.xl}px;
    max-height: calc(100dvh - ${56 + space.xl * 2}px);
    overflow-y: auto;
  }
`

const Main = styled.main`
  min-width: 0;
  padding: ${space.lg}px max(${space.lg}px, env(safe-area-inset-right, 0px))
    calc(${BOTTOM_NAV_HEIGHT + 72}px + env(safe-area-inset-bottom, 0px))
    max(${space.lg}px, env(safe-area-inset-left, 0px));
  @media ${media.tablet} {
    padding: 0;
  }
`

const DetailColumn = styled.aside`
  display: none;
  @media ${media.desktop} {
    display: block;
    position: sticky;
    top: ${56 + space.xl}px;
    align-self: start;
    max-height: calc(100dvh - ${56 + space.xl * 2}px);
    overflow-y: auto;
    padding: ${space.lg}px ${space.xl}px;
    border: 1px solid ${color.line};
    border-radius: ${radius.card}px;
    background: ${color.card};
  }
`

const DetailTitle = styled.h2`
  margin: 0 0 ${space.md}px;
  font-size: ${fontSize.md}px;
`

const DetailHint = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Summary = styled.section`
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Cover = styled.div<{ $color: string }>`
  height: 56px;
  background: ${({ $color }) => $color};
`

const SummaryBody = styled.div`
  display: grid;
  gap: ${space.xs}px;
  padding: ${space.md}px ${space.lg}px ${space.lg}px;
`

const SummaryName = styled.h2`
  margin: 0;
  font-size: ${fontSize.lg}px;
  overflow-wrap: anywhere;
`

const SummaryMeta = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const SideNav = styled.nav`
  display: grid;
  gap: 2px;
`

const SideLink = styled(NavLink)`
  display: flex;
  align-items: center;
  gap: ${space.md}px;
  min-height: 40px;
  padding: 0 ${space.md}px;
  border-radius: ${radius.control}px;
  color: ${color.muted};
  text-decoration: none;
  font-weight: ${fontWeight.medium};
  &:hover {
    color: ${color.ink};
    background: ${color.card};
  }
  &.active {
    color: ${color.fjordInk};
    background: ${color.glacier};
    font-weight: ${fontWeight.semibold};
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
  ${focusRing}
`

const BottomBar = styled.nav`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: ${zIndex.sticky};
  padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px)
    env(safe-area-inset-left, 0px);
  background: ${color.card};
  border-top: 1px solid ${color.line};
  @media ${media.tablet} {
    display: none;
  }
`

const BottomList = styled.ul`
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  height: ${BOTTOM_NAV_HEIGHT}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const BottomLink = styled(NavLink)`
  display: grid;
  place-items: center;
  align-content: center;
  gap: 2px;
  height: 100%;
  color: ${color.muted};
  text-decoration: none;
  font-size: ${fontSize.sm - 1}px;
  font-weight: ${fontWeight.medium};
  -webkit-tap-highlight-color: transparent;
  &.active {
    color: ${color.fjord};
    font-weight: ${fontWeight.semibold};
  }
  ${focusRing}
`

const Fab = styled.button`
  position: absolute;
  left: 50%;
  bottom: calc(100% + ${space.md}px);
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: ${space.xs}px;
  min-height: 48px;
  padding: 0 ${space.xl}px;
  border: 0;
  border-radius: ${radius.pill}px;
  background: ${color.fjord};
  color: ${color.onFjord};
  font-family: ${font.body};
  font-weight: ${fontWeight.semibold};
  box-shadow: 0 8px 24px ${color.shadow};
  cursor: pointer;
  &[aria-disabled='true'] {
    opacity: 0.6;
    cursor: not-allowed;
  }
  @media ${media.motion} {
    transition: transform ${duration.fast}ms ease;
  }
  ${focusRing}
`

const TopBarLink = styled(Link)`
  display: inline-grid;
  place-items: center;
  width: ${touchTarget}px;
  height: ${touchTarget}px;
  border-radius: ${radius.control}px;
  color: ${color.muted};
  ${focusRing}
`

const Stack = styled.div`
  display: grid;
  gap: ${space.md}px;
`

function DetailSurface({
  detail,
  onClose,
  inline,
}: {
  detail: Detail | null
  onClose: () => void
  inline: boolean
}) {
  const t = useT()
  if (inline) {
    return (
      <DetailColumn aria-label={t('shell.detailLabel')}>
        {detail ? (
          <>
            <DetailTitle>{detail.title}</DetailTitle>
            {detail.content}
          </>
        ) : (
          <DetailHint>{t('shell.detailEmpty')}</DetailHint>
        )}
      </DetailColumn>
    )
  }
  return (
    <Sheet open={Boolean(detail)} onClose={onClose} title={detail?.title ?? t('shell.detailLabel')}>
      {detail?.content}
    </Sheet>
  )
}

function TripSummary({ data }: { data: TripDetailResponse }) {
  const t = useT()
  const { trip } = data
  return (
    <Summary>
      <Cover $color={safeColor(trip.coverColor, trip.id)} />
      <SummaryBody>
        <SummaryName>{trip.name}</SummaryName>
        <SummaryMeta>{formatDateRange(trip.startDate, trip.endDate, t.locale)}</SummaryMeta>
        {trip.destination && <SummaryMeta>{trip.destination}</SummaryMeta>}
        {trip.archivedAt && (
          <div>
            <Chip tone="warning">{t('trips.archived')}</Chip>
          </div>
        )}
      </SummaryBody>
    </Summary>
  )
}

// The 記一筆 sheet loads on the first tap (e7-t02), so it costs the first screen nothing
const ExpenseFormSheet = lazy(() => import('../pages/expenses/ExpenseFormSheet.tsx'))

function BottomNav({ tripId }: { tripId: string }) {
  const t = useT()
  const toast = useToast()
  const canEdit = useCan()('editContent')
  const [expense, setExpense] = useState({ loaded: false, open: false })
  return (
    <BottomBar aria-label={t('nav.label')}>
      <Fab
        type="button"
        aria-disabled={!canEdit}
        onClick={() =>
          canEdit ? setExpense({ loaded: true, open: true }) : toast.show(t('expenses.readOnly'))
        }
      >
        <PlusIcon size={18} />
        {t('term.logExpense')}
      </Fab>
      {expense.loaded && (
        <Suspense fallback={null}>
          <ExpenseFormSheet
            open={expense.open}
            onClose={() => setExpense({ loaded: true, open: false })}
          />
        </Suspense>
      )}
      <BottomList>
        {SECTIONS.filter((section) => section.inBottomNav).map((section) => (
          <li key={section.id}>
            <BottomLink to={tripPath(tripId, section)} end={section.path === ''}>
              <section.icon size={22} />
              {t(section.label)}
            </BottomLink>
          </li>
        ))}
      </BottomList>
    </BottomBar>
  )
}

function LoadState({ error, onRetry }: { error?: unknown; onRetry: () => void }) {
  const t = useT()
  if (!error) {
    return (
      <Page $width={720} aria-busy="true">
        <Stack>
          <Skeleton $height={120} />
          <Skeleton $height={20} $width="60%" />
          <Skeleton $height={20} $width="40%" />
        </Stack>
      </Page>
    )
  }
  const access = isAccessError(error)
  const { key, code } = errorMessageKey(error)
  return (
    <Page $width={720}>
      <EmptyState
        illustration="pin"
        title={access ? t('tripAccess.title') : t('error.title')}
        body={access ? t('tripAccess.body') : t(key, { code })}
        action={
          access ? (
            <ButtonLink to="/" variant="primary">
              {t('shell.home')}
            </ButtonLink>
          ) : (
            <Button variant="primary" onClick={onRetry}>
              {t('error.retry')}
            </Button>
          )
        }
      />
    </Page>
  )
}

export function TripLayout() {
  const t = useT()
  const { id = '' } = useParams()
  const { pathname } = useLocation()
  const resource = useResource(`trip:${id}`, (signal) => api.getTrip(id, signal))
  // The pane belongs to the page that filled it: moving to another page closes it
  const [shown, setShown] = useState<{ path: string; detail: Detail | null }>({
    path: pathname,
    detail: null,
  })
  const detail = shown.path === pathname ? shown.detail : null
  const setDetail = useCallback(
    (next: Detail | null) => setShown({ path: pathname, detail: next }),
    [pathname],
  )
  const isDesktop = useMediaQuery(media.desktop)

  // A token the server no longer accepts is of no use on this device
  const error = resource.status === 'error' ? resource.error : null
  useEffect(() => {
    if (isApiError(error) && error.status === 401) removeToken(id)
  }, [error, id])

  const { status, data, reload, set } = resource
  const context = useMemo<TripContextValue | null>(
    () =>
      status === 'ready' && data
        ? {
            trip: data.trip,
            me: data.me,
            members: data.members,
            reload,
            setTrip: (trip) => set({ ...data, trip }),
          }
        : null,
    [status, data, reload, set],
  )
  const pane = useMemo(() => ({ detail, setDetail }), [detail, setDetail])

  if (!context || !data) {
    return (
      <>
        <TopBar />
        <LoadState
          error={resource.status === 'error' ? resource.error : undefined}
          onRetry={reload}
        />
      </>
    )
  }

  return (
    <TripContext.Provider value={context}>
      <DetailPaneContext.Provider value={pane}>
        <TopBar
          tripName={context.trip.name}
          trailing={
            <TopBarLink to={tripPath(id, 'settings')} aria-label={t('nav.settings')}>
              <SettingsIcon size={20} />
            </TopBarLink>
          }
        />
        <Frame>
          <Side>
            <TripSummary data={data} />
            <SideNav aria-label={t('nav.label')}>
              {SECTIONS.map((section) => (
                <SideLink key={section.id} to={tripPath(id, section)} end={section.path === ''}>
                  <section.icon size={20} />
                  {t(section.label)}
                </SideLink>
              ))}
            </SideNav>
          </Side>
          <Main id="main">
            <ErrorBoundary resetKey={pathname}>
              <Suspense fallback={<Skeleton $height={160} />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </Main>
          <DetailSurface detail={detail} onClose={() => setDetail(null)} inline={isDesktop} />
        </Frame>
        <BottomNav tripId={id} />
      </DetailPaneContext.Provider>
    </TripContext.Provider>
  )
}
