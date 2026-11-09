// Web fonts (docs/ASSETS.md): one Google Fonts CSS2 stylesheet. The CSS2 API answers with
// unicode-range subsets, so the browser only downloads the slices of Noto Sans TC (about a hundred)
// that a page actually uses. `display=swap` shows the fallback stack from tokens.ts until they load.

export const FONT_STYLESHEET =
  'https://fonts.googleapis.com/css2' +
  '?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800' +
  '&family=IBM+Plex+Sans:wght@400;500;600' +
  '&family=IBM+Plex+Mono:wght@400;500' +
  '&family=Noto+Sans+TC:wght@400;500;700' +
  '&display=swap'

const ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']

/** Adds the preconnects and the stylesheet to <head> once; safe to call more than once */
export function loadFonts(doc: Document = document): void {
  const already = [...doc.querySelectorAll('link[rel="stylesheet"]')].some(
    (link) => link.getAttribute('href') === FONT_STYLESHEET,
  )
  if (already) return
  for (const origin of ORIGINS) {
    const preconnect = doc.createElement('link')
    preconnect.rel = 'preconnect'
    preconnect.href = origin
    if (origin.includes('gstatic')) preconnect.crossOrigin = 'anonymous'
    doc.head.append(preconnect)
  }
  const stylesheet = doc.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = FONT_STYLESHEET
  doc.head.append(stylesheet)
}
