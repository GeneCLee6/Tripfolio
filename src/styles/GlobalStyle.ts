import { createGlobalStyle } from 'styled-components'
import { color, colorVariables, fontSize } from './tokens.ts'

// Shared by the app and the share page. Light by default, dark when the system asks for it; the
// in-app switch comes with A2.
export const GlobalStyle = createGlobalStyle`
  :root {
    color-scheme: light dark;
    ${colorVariables('light')}
  }
  @media (prefers-color-scheme: dark) {
    :root {
      ${colorVariables('dark')}
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    background: ${color.paper};
    color: ${color.ink};
    font-family: system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', sans-serif;
    font-size: ${fontSize.body}px;
    line-height: 1.55;
  }
`
