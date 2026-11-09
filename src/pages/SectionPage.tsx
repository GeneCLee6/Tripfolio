import styled from 'styled-components'
import { EmptyState } from '../components/index.ts'
import { useT } from '../lib/i18n.ts'
import { SECTIONS, type PlaceholderSectionId } from '../app/sections.ts'
import { space } from '../styles/tokens.ts'
import { PageHeading } from './parts.tsx'

const illustrations = {
  itinerary: 'suitcase',
  map: 'pin',
  picks: 'suitcase',
  expenses: 'receipt',
} as const

const Wrapper = styled.div`
  display: grid;
  gap: ${space.lg}px;
`

/** Itinerary, map, lists and expenses until their batches fill them: a designed empty state */
export default function SectionPage({ section }: { section: PlaceholderSectionId }) {
  const t = useT()
  const meta = SECTIONS.find((item) => item.id === section)!
  const label = t(meta.label)
  return (
    <Wrapper>
      <PageHeading title={label} />
      <EmptyState
        illustration={illustrations[section]}
        title={t('section.soon.title', { section: label })}
        body={meta.body ? `${t(meta.body)} · ${t('section.soon.body')}` : t('section.soon.body')}
      />
    </Wrapper>
  )
}
