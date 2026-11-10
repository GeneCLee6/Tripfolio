import { createGlobalStyle } from 'styled-components'
import { colorVariables } from '../src/styles/tokens.ts'

// The share page's print layout (e8-t02, AC-8.2): A4 with 14 mm margins, always the light colours
// (a dark system theme would print light text on white paper, since browsers drop backgrounds), and
// two attributes the components use instead of print-only state:
//   data-print="hide"   on screen only (controls, the language switch, the picks wall)
//   data-print="only"   in print only (day maps, stops tables, the bookings summary)
//   data-print-break="before"   starts a new page in print
// The page order in print: cover and route overview, one page per day (DayCard breaks before
// itself), then the bookings summary and the estimate.

export const PrintStyle = createGlobalStyle`
  [data-print='only'] {
    display: none;
  }
  @media print {
    @page {
      size: A4;
      margin: 14mm;
    }
    html:root:not([data-print-theme]) {
      color-scheme: light;
      ${colorVariables('light')}
    }
    body {
      background: none;
      font-size: 10pt;
    }
    [data-print='hide'] {
      display: none !important;
    }
    [data-print='only'] {
      display: block;
    }
    [data-print-break='before'] {
      break-before: page;
    }
  }
`
