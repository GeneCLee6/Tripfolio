import type { ReactNode, SVGProps } from 'react'

// Navigation icons for the shell, in the same Lucide style as src/components/icons.tsx (24 grid,
// 2 px stroke). Decorative: the link around them carries the label.

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 22, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const OverviewIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </Icon>
)

export const ItineraryIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2v4M16 2v4M7 13h4M7 17h7" />
  </Icon>
)

export const MapIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" />
    <path d="M9 3v15M15 6v15" />
  </Icon>
)

export const PicksIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
  </Icon>
)

export const ExpensesIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="6" width="20" height="14" rx="2" />
    <path d="M2 10h20M6 3h12M16 15h2" />
  </Icon>
)

export const SettingsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </Icon>
)

export const ArrowLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </Icon>
)

export const PaletteIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-.9 2-2 0-.7-.4-1.2-.4-1.9 0-1 .8-1.6 1.8-1.6H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9.5Z" />
    <circle cx="7.5" cy="11" r="1" fill="currentColor" />
    <circle cx="11" cy="7.5" r="1" fill="currentColor" />
    <circle cx="15.5" cy="8.5" r="1" fill="currentColor" />
  </Icon>
)
