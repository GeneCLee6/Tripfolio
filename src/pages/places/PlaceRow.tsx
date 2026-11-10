import styled from 'styled-components'
import type { Place } from '../../../shared/api/types.ts'
import { Chip, StopTypeIcon } from '../../components/index.ts'
import { useT } from '../../lib/i18n.ts'
import { coordsText, displayName, placeCategory } from '../../lib/places/library.ts'
import { color, font, fontSize, fontWeight, radius, space } from '../../styles/tokens.ts'
import { CATEGORY_LABEL, SOURCE_LABEL, glyphOf } from './labels.ts'
import { RowMenu, type MenuAction } from './RowMenu.tsx'

// One place in the library list (e3-t05): glyph and category, the name in the UI language with the
// other name under it, address, coordinates, how many items use it (or 「未使用」), where it came
// from, and the ⋯ menu.

const Item = styled.li`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: ${space.md}px;
  align-items: start;
  padding: ${space.md}px ${space.lg}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Glyph = styled.span`
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: ${radius.pill}px;
  background: ${color.glacier};
  color: ${color.fjord};
`

const Body = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
`

const Name = styled.h3`
  margin: 0;
  font-size: ${fontSize.body}px;
  font-weight: ${fontWeight.semibold};
  overflow-wrap: anywhere;
`

const Sub = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
  overflow-wrap: anywhere;
`

const Mono = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
`

const Tags = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs}px ${space.sm}px;
  margin-top: ${space.xs}px;
  font-size: ${fontSize.sm}px;
`

export interface PlaceRowProps {
  place: Place
  /** Items that point at it */
  refs: number
  /** The ⋯ menu's actions (none: no menu) */
  actions: readonly MenuAction[]
}

export function PlaceRow({ place, refs, actions }: PlaceRowProps) {
  const t = useT()
  const name = displayName(place, t.locale)
  const other = name === place.nameLocal ? place.nameEn : place.nameLocal
  const category = placeCategory(place.category)
  const source = SOURCE_LABEL[place.source]
  return (
    <Item data-place-id={place.id} data-refs={refs}>
      <Glyph title={t(CATEGORY_LABEL[category])}>
        <StopTypeIcon type={glyphOf(category)} size={18} />
      </Glyph>
      <Body>
        <Name>{name}</Name>
        {other && other !== name && <Sub lang={other === place.nameEn ? 'en' : undefined}>{other}</Sub>}
        <Sub>{place.address || t('places.noAddress')}</Sub>
        <Sub>
          <Mono>{coordsText(place)}</Mono>
        </Sub>
        <Tags>
          <Chip tone="neutral">{t(CATEGORY_LABEL[category])}</Chip>
          {refs > 0 ? (
            <span>{t.plural('places.refs', refs)}</span>
          ) : (
            <Chip tone="warning">{t('places.unused')}</Chip>
          )}
          {source && (
            <Chip tone="fjord">
              <span title={t('places.sourceLabel', { source: t(source) })}>{t(source)}</span>
            </Chip>
          )}
        </Tags>
      </Body>
      {actions.length > 0 && (
        <RowMenu label={t('places.menu.label', { name })} actions={actions} />
      )}
    </Item>
  )
}
