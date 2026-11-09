import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getLanguage, t } from '../shared/i18n/t.ts'
import { App } from './app/App.tsx'
import { GlobalStyle } from './styles/GlobalStyle.ts'

document.documentElement.lang = getLanguage()
document.title = t('app.name')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalStyle />
    <App />
  </StrictMode>,
)
