import styled from 'styled-components'
import type { PlaceRefsResponse } from '../../../shared/api/types.ts'
import { useT } from '../../lib/i18n.ts'
import { fontSize, space } from '../../styles/tokens.ts'

// What GET /places/:pid/refs listed, one line per item (the delete and merge dialogs)

const List = styled.ul`
  display: grid;
  gap: ${space.xs}px;
  margin: ${space.sm}px 0 0;
  padding-left: ${space.xl}px;
  font-size: ${fontSize.sm}px;
`

export function RefList({ refs }: { refs: PlaceRefsResponse }) {
  const t = useT()
  return (
    <List data-testid="ref-list">
      {refs.stops.map((stop) => (
        <li key={`s${stop.id}`}>{t('places.refs.stop', { title: stop.title })}</li>
      ))}
      {refs.wishlistItems.map((item) => (
        <li key={`w${item.id}`}>{t('places.refs.wishlist', { name: item.name })}</li>
      ))}
      {refs.lodgings.map((lodging) => (
        <li key={`l${lodging.id}`}>{t('places.refs.lodging', { name: lodging.name })}</li>
      ))}
      {refs.bookings.map((booking) => (
        <li key={`b${booking.id}`}>{t('places.refs.booking', { title: booking.title })}</li>
      ))}
    </List>
  )
}
