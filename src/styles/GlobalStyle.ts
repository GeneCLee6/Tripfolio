import { createGlobalStyle } from 'styled-components'
import { color, colorVariables, font, fontSize, fontWeight, lineHeight, media, touchTarget } from './tokens.ts'

// Shared by the app and the share page. The theme follows the system unless <html data-theme> fixes
// it (src/styles/theme.ts). Any element can carry data-theme too, which scopes the variables to its
// subtree: /dev/ui uses that to show both themes side by side.
export const GlobalStyle = createGlobalStyle`
  :root {
    color-scheme: light;
    ${colorVariables('light')}
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
      color-scheme: dark;
      ${colorVariables('dark')}
    }
  }
  [data-theme='light'] {
    color-scheme: light;
    ${colorVariables('light')}
  }
  [data-theme='dark'] {
    color-scheme: dark;
    ${colorVariables('dark')}
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    background: ${color.paper};
    color: ${color.ink};
    font-family: ${font.body};
    font-size: ${fontSize.body}px;
    line-height: ${lineHeight.body};
    -webkit-font-smoothing: antialiased;
    text-size-adjust: 100%;
  }
  h1, h2, h3, h4 {
    font-family: ${font.display};
    font-weight: ${fontWeight.bold};
    line-height: ${lineHeight.heading};
    text-wrap: balance;
  }
  button, input, select, textarea { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid ${color.fjord}; outline-offset: 2px; }
  /* Touch targets (DESIGN.md §6, AC-10.5): on a coarse pointer every control that is not inline text
     is at least 44 px. Inline links in running text keep their line (min-* skips inline boxes); a
     component that sets its own min-height raises it under media.coarse itself. */
  @media ${media.coarse} {
    a, button, select, summary, [role='button'], [role='tab'], [role='radio'], [role='checkbox'] {
      min-height: ${touchTarget}px;
      min-width: ${touchTarget}px;
    }
    .maplibregl-ctrl.maplibregl-ctrl-group button {
      width: ${touchTarget}px;
      height: ${touchTarget}px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
`
