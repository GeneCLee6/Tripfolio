import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { Skeleton } from '../components/index.ts'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { Page, TopBar } from './TopBar.tsx'
import { TripLayout } from './TripLayout.tsx'

// The app's routes (e10-t03). Every page is its own lazy chunk so the first screen stays small
// (RULES.md §6); the shell (top bar, trip layout, navigation) loads with the entry.

const TripListPage = lazy(() => import('../pages/TripListPage.tsx'))
const TripFormPage = lazy(() => import('../pages/TripFormPage.tsx'))
const TripHomePage = lazy(() => import('../pages/TripHomePage.tsx'))
const SectionPage = lazy(() => import('../pages/SectionPage.tsx'))
const TripSettingsPage = lazy(() => import('../pages/TripSettingsPage.tsx'))
const PhotosPage = lazy(() => import('../pages/photos/PhotosPage.tsx'))
const PlacesPage = lazy(() => import('../pages/places/PlacesPage.tsx'))
const BalancesPage = lazy(() => import('../pages/balances/BalancesPage.tsx'))
const JoinPage = lazy(() => import('../pages/JoinPage.tsx'))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage.tsx'))

// The component showcase exists only in development: with DEV false the import below is dead code
// and the bundler drops the whole module from production builds (AC-10.1)
const UiShowcase = import.meta.env.DEV ? lazy(() => import('../dev/UiShowcase.tsx')) : null

const Loading = () => (
  <Page $width={720} aria-busy="true">
    <Skeleton $height={160} />
  </Page>
)

/** Pages outside a trip: the top bar, then the page */
function Plain({ children }: { children: ReactNode }) {
  return (
    <>
      <TopBar />
      <Suspense fallback={<Loading />}>{children}</Suspense>
    </>
  )
}

function AppRoutes() {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary resetKey={pathname}>
      <Routes>
        <Route
          path="/"
          element={
            <Plain>
              <TripListPage />
            </Plain>
          }
        />
        <Route
          path="/trips/new"
          element={
            <Plain>
              <TripFormPage />
            </Plain>
          }
        />
        <Route
          path="/trips/:id/edit"
          element={
            <Plain>
              <TripFormPage />
            </Plain>
          }
        />
        <Route
          path="/join/:token"
          element={
            <Plain>
              <JoinPage />
            </Plain>
          }
        />
        <Route path="/trips/:id" element={<TripLayout />}>
          <Route index element={<TripHomePage />} />
          <Route path="itinerary" element={<SectionPage section="itinerary" />} />
          <Route path="map" element={<SectionPage section="map" />} />
          <Route path="picks" element={<SectionPage section="picks" />} />
          <Route path="expenses" element={<SectionPage section="expenses" />} />
          <Route path="settings" element={<TripSettingsPage />} />
          <Route path="photos" element={<PhotosPage />} />
          <Route path="places" element={<PlacesPage />} />
          <Route path="expenses/balances" element={<BalancesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        {UiShowcase && (
          <Route
            path="/dev/ui"
            element={
              <Suspense>
                <UiShowcase />
              </Suspense>
            }
          />
        )}
        <Route
          path="*"
          element={
            <Plain>
              <NotFoundPage />
            </Plain>
          }
        />
      </Routes>
    </ErrorBoundary>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
