import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { t } from '../shared/i18n/t.ts'
import { App } from './app/App.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { initLocale } from './lib/i18n.ts'
import { loadFonts } from './styles/fonts.ts'
import { GlobalStyle } from './styles/GlobalStyle.ts'
import { initTheme } from './styles/theme.ts'

// Before the first render: language (stored choice or browser), theme, fonts
initLocale()
initTheme()
loadFonts()
document.title = t('app.name')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalStyle />
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
)
