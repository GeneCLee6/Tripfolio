import styled from 'styled-components'
import { t } from '../../shared/i18n/t.ts'
import { useHealth, type HealthState } from '../lib/health.ts'
import { color, fontSize, radius, space } from '../styles/tokens.ts'

const Main = styled.main`
  max-width: 640px;
  margin: 0 auto;
  padding: ${space.xxl}px ${space.lg}px;
`

const Title = styled.h1`
  margin: 0 0 ${space.sm}px;
  font-size: ${fontSize.xxl}px;
  line-height: 1.15;
  color: ${color.fjordInk};
`

const Tagline = styled.p`
  margin: 0 0 ${space.xl}px;
  color: ${color.muted};
`

const Status = styled.p<{ $tone: HealthState['status'] }>`
  display: inline-block;
  margin: 0;
  padding: ${space.sm}px ${space.md}px;
  border-radius: ${radius.control}px;
  background: ${color.card};
  border: 1px solid ${color.line};
  color: ${({ $tone }) =>
    $tone === 'ok' ? color.success : $tone === 'error' ? color.danger : color.muted};
  font-size: ${fontSize.sm}px;
`

function healthText(health: HealthState): string {
  if (health.status === 'ok') return t('health.ok', { version: health.version })
  return health.status === 'error' ? t('health.error') : t('health.checking')
}

/** Placeholder home page (e11-t01): the product name and whether the Worker answers */
export function HomePage() {
  const health = useHealth()
  return (
    <Main>
      <Title>{t('app.name')}</Title>
      <Tagline>{t('app.tagline')}</Tagline>
      <Status $tone={health.status} role="status">
        {healthText(health)}
      </Status>
    </Main>
  )
}
