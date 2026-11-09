import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getLanguage, t } from '../shared/i18n/t.ts'
import { GlobalStyle } from '../src/styles/GlobalStyle.ts'
import { SharePage } from './SharePage.tsx'

document.documentElement.lang = getLanguage()
document.title = `${t('share.title')} · ${t('app.name')}`

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalStyle />
    <SharePage />
  </StrictMode>,
)
