import { useState } from 'react'
import styled from 'styled-components'
import { Button } from '../../components/index.ts'
import { color, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { useT } from '../i18n.ts'
import { todayIn } from '../trip-groups.ts'
import {
  dismissInstall,
  inInstallWindow,
  isInstallDismissed,
  promptInstall,
  useInstallMode,
} from './install.ts'

// On the trip home, the week before departure (e10-t05): 「把旅誌加到主畫面」 with 安裝 (Chromium's
// own prompt) or, on iOS, the 分享 → 加入主畫面 hint. Dismissed per trip.

const Banner = styled.aside`
  display: grid;
  gap: ${space.sm}px;
  margin-bottom: ${space.lg}px;
  padding: ${space.md}px ${space.lg}px;
  border: 1px solid ${color.line};
  border-left: 4px solid ${color.fjord};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Title = styled.h2`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.semibold};
`

const Text = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
`

export interface InstallBannerProps {
  tripId: string
  startDate: string
  endDate: string
  tz: string
}

export function InstallBanner({ tripId, startDate, endDate, tz }: InstallBannerProps) {
  const t = useT()
  const { mode } = useInstallMode()
  // The day it was mounted is close enough: the window is a week wide
  const [today] = useState(() => todayIn(tz, Date.now()))
  if (!mode || isInstallDismissed(tripId)) return null
  if (!inInstallWindow(startDate, endDate, today)) return null
  return (
    <Banner aria-label={t('offline.install.title')} data-testid="install-banner">
      <Title>{t('offline.install.title')}</Title>
      <Text>{t('offline.install.body')}</Text>
      {mode === 'ios' && <Text>{t('offline.install.ios')}</Text>}
      <Actions>
        {mode === 'prompt' && (
          <Button size="sm" variant="primary" onClick={() => void promptInstall()}>
            {t('offline.install.action')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => dismissInstall(tripId)}>
          {t('offline.install.dismiss')}
        </Button>
      </Actions>
    </Banner>
  )
}
