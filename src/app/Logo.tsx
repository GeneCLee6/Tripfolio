import { color, dayColor } from '../styles/tokens.ts'

/**
 * The mark from docs/design/logo/logo.svg, simplified for 28 px: the paper card with its folded
 * corner, the dotted route from the start dot to the pin, and the two ledger lines. Colours come
 * from the tokens so it follows the theme.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <rect
        x="20"
        y="20"
        width="216"
        height="216"
        rx="48"
        fill={color.card}
        stroke={color.line}
        strokeWidth="8"
      />
      <path d="M168 20h20a48 48 0 0 1 48 48v20Z" fill={color.tussockSoft} />
      <path
        d="M64 176 C 92 150, 100 120, 128 112 S 176 96, 192 72"
        fill="none"
        stroke={color.fjord}
        strokeWidth="14"
        strokeLinecap="round"
        strokeDasharray="1 26"
      />
      <circle cx="64" cy="176" r="16" fill={color.fjord} />
      <path
        d="M192 40c-18 0-33 15-33 33 0 25 33 58 33 58s33-33 33-58c0-18-15-33-33-33Z"
        fill={dayColor(1)}
      />
      <circle cx="192" cy="73" r="12" fill={color.card} />
      <rect x="64" y="200" width="72" height="12" rx="6" fill={color.ink} />
      <rect x="148" y="200" width="44" height="12" rx="6" fill={dayColor(1)} />
    </svg>
  )
}
