import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { t } from '../shared/i18n/t.ts'
import { loadFonts } from '../src/styles/fonts.ts'
import { GlobalStyle } from '../src/styles/GlobalStyle.ts'
import { initShareLocale } from './locale.ts'
import { SharePage } from './SharePage.tsx'

// The theme follows the system (no stored preference on the share page); the language is the
// share page's own choice, else the browser's (DESIGN.md §5.8).
initShareLocale()
loadFonts()
document.title = `${t('share.title')} · ${t('app.name')}`

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalStyle />
    <SharePage />
  </StrictMode>,
)
