import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from '../pages/HomePage.tsx'

// The component showcase exists only in development: with DEV false the import below is dead code
// and the bundler drops the whole module from production builds (AC-10.1)
const UiShowcase = import.meta.env.DEV ? lazy(() => import('../dev/UiShowcase.tsx')) : null

/** The app's routes; the shell, layout and real pages come with A3 (e10-t03) */
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
