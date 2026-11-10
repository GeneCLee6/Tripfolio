// Generates the PWA icons in public/icons/ from docs/design/logo/logo.svg (e10-t05, docs/ASSETS.md).
// Run by hand when the logo changes: `node sw/make-icons.mjs` (needs `sharp`, which is installed
// as a transitive dependency; not part of the build).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const OUT = 'public/icons'
// Background of the full-bleed icons: the light theme's paper token (src/styles/tokens.ts)
const PAPER = '#EDEFEA'
const logo = readFileSync('docs/design/logo/logo.svg', 'utf8')
const inner = logo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

// Maskable: the logo inside the 80 % safe zone on a full-bleed paper background
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" fill="${PAPER}"/>
  <g transform="translate(25.6 25.6) scale(0.8)">${inner}</g>
</svg>
`
// Apple touch icon: iOS rounds the corners itself and shows transparency as black
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <rect width="256" height="256" fill="${PAPER}"/>
  <g transform="translate(12.8 12.8) scale(0.9)">${inner}</g>
</svg>
`

mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/icon.svg`, logo)
writeFileSync(`${OUT}/icon-maskable.svg`, maskable)

const png = (svg, size, file) =>
  sharp(Buffer.from(svg), { density: (72 * size) / 256 * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${file}`)

await Promise.all([
  png(logo, 192, 'icon-192.png'),
  png(logo, 512, 'icon-512.png'),
  png(maskable, 192, 'icon-maskable-192.png'),
  png(maskable, 512, 'icon-maskable-512.png'),
  png(apple, 180, 'apple-touch-icon.png'),
])
console.log(`icons written to ${OUT}/`)
