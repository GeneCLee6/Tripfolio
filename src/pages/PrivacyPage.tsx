import { Link } from 'react-router-dom'
import styled from 'styled-components'
import type { MessageKey } from '../../shared/i18n/t.ts'
import { Page } from '../app/TopBar.tsx'
import { useT } from '../lib/i18n.ts'
import { focusRing } from '../styles/mixins.ts'
import { color, fontSize, fontWeight, space } from '../styles/tokens.ts'
import { PageHeading, Stack } from './parts.tsx'

// /privacy (e11-t06, PRD §9 安全與隱私, principle 8): what is stored, who sees it, photos and
// documents, share links, deleting and the 30 days, outside services, contact. Plain text from the
// catalog (zh-TW source, en translation); the language switch in the top bar changes it. Linked
// from the bottom of the trip list and from trip settings.

interface PrivacySection {
  id: string
  title: MessageKey
  paragraphs: MessageKey[]
  list?: MessageKey[]
  after?: MessageKey[]
}

const SECTIONS: PrivacySection[] = [
  {
    id: 'stored',
    title: 'privacy.stored.title',
    paragraphs: ['privacy.stored.p1', 'privacy.stored.p2', 'privacy.stored.p3', 'privacy.stored.p4'],
  },
  {
    id: 'who',
    title: 'privacy.who.title',
    paragraphs: ['privacy.who.p1', 'privacy.who.p2', 'privacy.who.p3'],
  },
  {
    id: 'media',
    title: 'privacy.media.title',
    paragraphs: ['privacy.media.p1', 'privacy.media.p2'],
  },
  {
    id: 'share',
    title: 'privacy.share.title',
    paragraphs: ['privacy.share.p1', 'privacy.share.p2'],
  },
  {
    id: 'delete',
    title: 'privacy.delete.title',
    paragraphs: ['privacy.delete.p1', 'privacy.delete.p2', 'privacy.delete.p3', 'privacy.delete.p4'],
  },
  {
    id: 'services',
    title: 'privacy.services.title',
    paragraphs: ['privacy.services.p1'],
    list: [
      'privacy.services.maps',
      'privacy.services.search',
      'privacy.services.routes',
      'privacy.services.fx',
    ],
    after: ['privacy.services.p2'],
  },
  {
    id: 'contact',
    title: 'privacy.contact.title',
    paragraphs: ['privacy.contact.p1'],
  },
]

const Article = styled.article`
  display: grid;
  gap: ${space.xxl}px;
  max-width: 68ch;
  line-height: 1.7;
`

const Toc = styled.nav`
  ol {
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px ${space.lg}px;
    margin: ${space.sm}px 0 0;
    padding: 0;
    list-style: none;
    font-size: ${fontSize.sm}px;
  }
  a {
    color: ${color.fjord};
    ${focusRing}
  }
`

const TocTitle = styled.h2`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
`

const Heading = styled.h2`
  margin: 0;
  font-size: ${fontSize.lg}px;
  font-weight: ${fontWeight.bold};
  scroll-margin-top: ${space.xxl * 2}px;
`

const Paragraph = styled.p`
  margin: 0;
`

const List = styled.ul`
  display: grid;
  gap: ${space.sm}px;
  margin: 0;
  padding-left: ${space.xl}px;
`

const Updated = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Back = styled(Link)`
  color: ${color.fjord};
  font-weight: ${fontWeight.medium};
  ${focusRing}
`

export default function PrivacyPage() {
  const t = useT()
  return (
    <Page $width={760}>
      <Article>
        <Stack $gap="sm">
          <PageHeading title={t('privacy.title')} lead={t('privacy.lead')} />
          <Updated>{t('privacy.updated')}</Updated>
        </Stack>
        <Toc aria-labelledby="privacy-toc">
          <TocTitle id="privacy-toc">{t('privacy.toc')}</TocTitle>
          <ol>
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#privacy-${section.id}`}>{t(section.title)}</a>
              </li>
            ))}
          </ol>
        </Toc>
        {SECTIONS.map((section) => (
          <Stack as="section" $gap="md" key={section.id} aria-labelledby={`privacy-${section.id}`}>
            <Heading id={`privacy-${section.id}`}>{t(section.title)}</Heading>
            {section.paragraphs.map((key) => (
              <Paragraph key={key}>{t(key)}</Paragraph>
            ))}
            {section.list && (
              <List>
                {section.list.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </List>
            )}
            {section.after?.map((key) => (
              <Paragraph key={key}>{t(key)}</Paragraph>
            ))}
          </Stack>
        ))}
        <div>
          <Back to="/">{t('privacy.back')}</Back>
        </div>
      </Article>
    </Page>
  )
}
