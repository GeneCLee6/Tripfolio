import styled from 'styled-components'
import { t } from '../shared/i18n/t.ts'
import { color, fontSize, radius, space } from '../src/styles/tokens.ts'

const Main = styled.main`
  max-width: 640px;
  margin: 0 auto;
  padding: ${space.xxl}px ${space.lg}px;
`

const Cover = styled.header`
  padding: ${space.xl}px;
  border-radius: ${radius.cover}px;
  background: ${color.fjordInk};
  color: ${color.paper};
`

const Title = styled.h1`
  margin: 0;
  font-size: ${fontSize.xl}px;
  line-height: 1.15;
`

const Note = styled.p`
  margin: ${space.lg}px 0 0;
  color: ${color.muted};
`

/**
 * Placeholder read-only share page (/s/<token>). Its own bundle: it never loads the editor. The
 * data, already filtered by the Worker (CLAUDE.md rule 4), comes with E8.
 */
export function SharePage() {
  return (
    <Main>
      <Cover>
        <Title>{t('share.title')}</Title>
      </Cover>
      <Note>{t('share.placeholder')}</Note>
    </Main>
  )
}
