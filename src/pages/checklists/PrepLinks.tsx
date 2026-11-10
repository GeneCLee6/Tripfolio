import { Link } from 'react-router-dom'
import styled from 'styled-components'
import type { MessageKey } from '../../../shared/i18n/t.ts'
import { tripPath } from '../../app/sections.ts'
import { useT } from '../../lib/i18n.ts'
import { focusRing } from '../../styles/mixins.ts'
import { color, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'

// The four pre-trip prep pages as cards (E9). For the trip home (TripHomePage, another batch):
// `<PrepLinks tripId={trip.id} />`. Static import is fine: no zod, no page code.

const LINKS: { path: string; label: MessageKey; body: MessageKey }[] = [
  { path: 'checklists', label: 'prep.links.checklists', body: 'prep.links.checklistsBody' },
  { path: 'budget', label: 'prep.links.budget', body: 'prep.links.budgetBody' },
  { path: 'documents', label: 'prep.links.documents', body: 'prep.links.documentsBody' },
  { path: 'notes', label: 'prep.links.notes', body: 'prep.links.notesBody' },
]

const Nav = styled.nav`
  display: grid;
  gap: ${space.sm}px;
`

const Heading = styled.h2`
  margin: 0;
  font-size: ${fontSize.lg}px;
  font-weight: ${fontWeight.bold};
`

const Grid = styled.ul`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Card = styled(Link)`
  display: grid;
  gap: 2px;
  height: 100%;
  padding: ${space.md}px ${space.lg}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  color: ${color.ink};
  text-decoration: none;
  &:hover {
    border-color: ${color.fjord};
  }
  ${focusRing}
  > strong {
    font-size: ${fontSize.body}px;
    color: ${color.fjordInk};
  }
  > span {
    font-size: ${fontSize.sm}px;
    color: ${color.muted};
  }
`

export function PrepLinks({ tripId, heading = true }: { tripId: string; heading?: boolean }) {
  const t = useT()
  return (
    <Nav aria-label={t('prep.links.title')}>
      {heading && <Heading>{t('prep.links.title')}</Heading>}
      <Grid>
        {LINKS.map((link) => (
          <li key={link.path}>
            <Card to={tripPath(tripId, link.path)} data-prep-link={link.path}>
              <strong>{t(link.label)}</strong>
              <span>{t(link.body)}</span>
            </Card>
          </li>
        ))}
      </Grid>
    </Nav>
  )
}
