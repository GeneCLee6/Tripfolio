import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../shared/i18n/t.ts'
import { Lightbox, PhotoGrid } from '../../src/components/index.ts'

// e6-t04: the lightbox and grid markup (server rendering: no showModal, no fetches).

afterEach(() => setLocale('zh-TW'))

const photos = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]

const lightbox = (extra: Partial<Parameters<typeof Lightbox>[0]> = {}) =>
  renderToStaticMarkup(
    <Lightbox
      open
      photos={photos}
      index={1}
      onIndexChange={() => {}}
      onClose={() => {}}
      tripId="trip1"
      altFor={(i) => `photo ${i + 1}`}
      info={<p>info here</p>}
      {...extra}
    />,
  )

describe('Lightbox', () => {
  it('is a dialog named by its position, announced politely', () => {
    const html = lightbox()
    const labelledBy = /<dialog[^>]*aria-labelledby="([^"]+)"/.exec(html)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(html).toMatch(new RegExp(`<h2 id="${labelledBy}"[^>]*>第 2／3 張</h2>`))
    expect(html).toMatch(/aria-live="polite"[^>]*>第 2／3 張</)
  })

  it('has close, previous and next buttons and the info panel', () => {
    const html = lightbox()
    expect(html).toContain('aria-label="關閉"')
    expect(html).toContain('aria-label="上一張"')
    expect(html).toContain('aria-label="下一張"')
    expect(html).toMatch(/<aside aria-label="照片資訊"[^>]*>.*info here/)
  })

  it('has no stepping buttons for one photo, and speaks English', () => {
    setLocale('en')
    const html = lightbox({ photos: [{ id: 'a1' }], index: 0 })
    expect(html).not.toContain('Previous')
    expect(html).toContain('>Photo 1 of 1</h2>')
  })

  it('announces nothing and loads no photo while closed', () => {
    const html = lightbox({ open: false })
    expect(html).toMatch(/aria-live="polite"[^>]*><\/p>/)
    expect(html).not.toContain('height:100%')
  })
})

describe('PhotoGrid', () => {
  it('renders one labelled button per photo with badges', () => {
    const html = renderToStaticMarkup(
      <PhotoGrid
        photos={photos}
        tripId="trip1"
        onOpen={() => {}}
        labelFor={(i) => `open ${i + 1}`}
        altFor={(i) => `photo ${i + 1}`}
        badge={(p) => (p.id === 'a2' ? <b>cover</b> : null)}
        data-testid="grid"
      />,
    )
    expect(html).toContain('data-testid="grid"')
    expect(html.match(/<button type="button"/g)).toHaveLength(3)
    expect(html).toContain('aria-label="open 3"')
    expect(html).toContain('<b>cover</b>')
  })
})
