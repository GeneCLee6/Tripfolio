import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styled from 'styled-components'
import { IconButton, LanguageSwitch, Sheet, ThemeSwitch } from '../components/index.ts'
import { useT } from '../lib/i18n.ts'
import { OfflineBadge, UpdatePrompt } from '../lib/offline/OfflineStatus.tsx'
import { focusRing } from '../styles/mixins.ts'
import {
  color,
  font,
  fontSize,
  fontWeight,
  media,
  radius,
  space,
  zIndex,
} from '../styles/tokens.ts'
import { PaletteIcon } from './icons.tsx'
import { LogoMark } from './Logo.tsx'

// The top bar on every page (DESIGN.md §4): the mark (home), the trip's name inside a trip, and the
// language and theme switches. On phones the two switches sit behind one button, in a Sheet.

const Bar = styled.header`
  position: sticky;
  top: 0;
  z-index: ${zIndex.sticky};
  padding-top: env(safe-area-inset-top, 0px);
  background: color-mix(in srgb, ${color.paper} 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid ${color.line};
`

const Inner = styled.div`
  display: flex;
  align-items: center;
  gap: ${space.md}px;
  min-height: 56px;
  padding: 0 max(${space.lg}px, env(safe-area-inset-right, 0px)) 0
    max(${space.lg}px, env(safe-area-inset-left, 0px));
`

const Brand = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm}px;
  flex: none;
  color: ${color.ink};
  text-decoration: none;
  font-family: ${font.display};
  font-weight: ${fontWeight.heavy};
  font-size: ${fontSize.md}px;
  letter-spacing: -0.01em;
  border-radius: ${radius.control}px;
  ${focusRing}
`

const BrandName = styled.span<{ $hideOnPhone: boolean }>`
  @media ${media.mobile} {
    display: ${({ $hideOnPhone }) => ($hideOnPhone ? 'none' : 'inline')};
  }
`

const TripName = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ${font.display};
  font-weight: ${fontWeight.bold};
  font-size: ${fontSize.md}px;
  &::before {
    content: '/';
    margin-right: ${space.md}px;
    color: ${color.line};
    @media ${media.mobile} {
      display: none;
    }
  }
`

const SkipLink = styled.a`
  position: absolute;
  left: ${space.lg}px;
  top: -100px;
  padding: ${space.sm}px ${space.md}px;
  border-radius: ${radius.control}px;
  background: ${color.ink};
  color: ${color.paper};
  z-index: ${zIndex.overlay};
  &:focus {
    top: ${space.sm}px;
  }
`

const Spacer = styled.div`
  flex: 1;
`

const Switches = styled.div`
  display: none;
  align-items: center;
  gap: ${space.sm}px;
  @media ${media.tablet} {
    display: flex;
  }
`

const PhoneOnly = styled.div`
  display: flex;
  align-items: center;
  gap: ${space.xs}px;
  @media ${media.tablet} {
    display: none;
  }
`

const SheetBody = styled.div`
  display: grid;
  gap: ${space.lg}px;
  justify-items: start;
`

export function TopBar({ tripName, trailing }: { tripName?: string; trailing?: ReactNode }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Bar>
      <SkipLink href="#main">{t('shell.skip')}</SkipLink>
      <Inner>
        <Brand to="/" aria-label={t('shell.home')}>
          <LogoMark />
          <BrandName $hideOnPhone={Boolean(tripName)}>{t('app.name')}</BrandName>
        </Brand>
        {tripName && <TripName>{tripName}</TripName>}
        <Spacer />
        <OfflineBadge />
        <Switches>
          <LanguageSwitch />
          <ThemeSwitch />
        </Switches>
        <PhoneOnly>
          {trailing}
          <IconButton
            label={t('shell.preferences')}
            icon={<PaletteIcon size={20} />}
            onClick={() => setOpen(true)}
          />
        </PhoneOnly>
      </Inner>
      <UpdatePrompt />
      <Sheet open={open} onClose={() => setOpen(false)} title={t('shell.preferences')}>
        <SheetBody>
          <LanguageSwitch size="md" />
          <ThemeSwitch size="md" />
        </SheetBody>
      </Sheet>
    </Bar>
  )
}

/** The page column for pages outside a trip (the list, forms, join) */
export const Page = styled.main.attrs({ id: 'main' })<{ $width?: number }>`
  width: 100%;
  max-width: ${({ $width = 1080 }) => $width}px;
  margin: 0 auto;
  padding: ${space.xl}px max(${space.lg}px, env(safe-area-inset-right, 0px))
    calc(${space.xxxl}px + env(safe-area-inset-bottom, 0px))
    max(${space.lg}px, env(safe-area-inset-left, 0px));
  @media ${media.tablet} {
    padding-top: ${space.xxl}px;
  }
`
