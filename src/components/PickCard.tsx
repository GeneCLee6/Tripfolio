import type { ReactNode } from 'react'
import styled, { css } from 'styled-components'
import type { WishlistItemView } from '../../shared/api/types.ts'
import { formatMoney } from '../../shared/i18n/format.ts'
import type { WishlistCategory } from '../../shared/schema/index.ts'
import { paletteIndex } from '../lib/colors.ts'
import { useT } from '../lib/i18n.ts'
import { focusRing } from '../styles/mixins.ts'
import { color, duration, font, fontSize, fontWeight, media, radius, space } from '../styles/tokens.ts'
import { Avatar } from './Avatar.tsx'
import { CategoryChip, CategoryGlyph } from './CategoryChip.tsx'

// A card of the picks wall (DESIGN.md §4 必吃必買, mockup Screen 3): the picture on top (photo, the
// source link's image, or a category-coloured placeholder), the category chip over it, the name,
// a line of note, the price in tussock gold, the recommender, then tags (Day N, the claim summary of
// a must-buy, done or dropped) and the 「想去」 slot. The page hands in the picture and the slots.

const Article = styled.article<{ $muted: boolean }>`
  position: relative;
  display: grid;
  break-inside: avoid;
  margin: 0 0 ${space.md + 2}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
  opacity: ${({ $muted }) => ($muted ? 0.62 : 1)};
  /* Above the next cards while a menu or the voters popover is open */
  &:hover,
  &:focus-within {
    z-index: 2;
  }
  @media ${media.motion} {
    transition:
      transform ${duration.fast}ms ease,
      box-shadow ${duration.fast}ms ease;
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 18px ${color.shadow};
    }
  }
`

const placeholderTone: Record<WishlistCategory, ReturnType<typeof css>> = {
  eat: css`
    background: ${color.tussockSoft};
    color: ${color.tussockText};
  `,
  buy: css`
    background: ${color.glacier};
    color: ${color.fjord};
  `,
  see: css`
    background: ${color.paper};
    color: ${color.fjordInk};
  `,
  experience: css`
    background: ${color.tussockSoft};
    color: ${color.warningText};
  `,
}

const Picture = styled.button<{ $category: WishlistCategory }>`
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 4 / 3;
  padding: 0;
  border: 0;
  ${({ $category }) => placeholderTone[$category]}
  border-radius: ${radius.card - 1}px ${radius.card - 1}px 0 0;
  cursor: pointer;
  overflow: hidden;
  > img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  ${focusRing}
`

const ChipSpot = styled.span`
  position: absolute;
  left: ${space.sm + 2}px;
  top: ${space.sm + 2}px;
  pointer-events: none;
`

const MenuSpot = styled.div`
  position: absolute;
  right: ${space.sm}px;
  top: ${space.sm}px;
`

const Body = styled.div`
  display: grid;
  gap: ${space.sm - 2}px;
  padding: ${space.md}px ${space.md + 2}px ${space.md + 2}px;
  min-width: 0;
`

const Name = styled.h3`
  margin: 0;
  font-family: ${font.display};
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.bold};
  line-height: 1.25;
  overflow-wrap: anywhere;
  > button {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    ${focusRing}
  }
`

const Note = styled.p`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

const Foot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${space.sm}px;
  min-height: 24px;
  font-size: ${fontSize.sm}px;
`

const Price = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-weight: ${fontWeight.medium};
  color: ${color.tussockText};
`

const Recommender = styled.span`
  display: inline-flex;
`

const Tags = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.xs + 2}px;
`

export type TagTone = 'neutral' | 'fjord' | 'success' | 'muted'

const Tag = styled.span<{ $tone: TagTone }>`
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 ${space.sm}px;
  border: 1px solid ${({ $tone }) => ($tone === 'fjord' ? color.fjord : $tone === 'success' ? color.success : color.line)};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  color: ${({ $tone }) => ($tone === 'fjord' ? color.fjord : $tone === 'success' ? color.success : color.muted)};
  font-size: ${fontSize.sm - 2}px;
  white-space: nowrap;
  font-style: ${({ $tone }) => ($tone === 'muted' ? 'italic' : 'normal')};
`

export interface PickTag {
  key: string
  label: string
  tone?: TagTone
}

export interface PickCardProps {
  item: WishlistItemView
  /** What to draw on top: an object URL or the source image; null draws the placeholder */
  imageUrl: string | null
  recommender: { id: string; name: string; color: string } | null
  tags: readonly PickTag[]
  /** The 「想去」 control (VoteButton) */
  vote: ReactNode
  /** The card's menu button, for those who can edit */
  menu?: ReactNode
  onOpen: () => void
}

export function PickCard({ item, imageUrl, recommender, tags, vote, menu, onOpen }: PickCardProps) {
  const t = useT()
  const price =
    item.estMinor === null || !item.currency
      ? null
      : item.estMinor === 0
        ? t('picks.free')
        : formatMoney(item.estMinor, item.currency, t.locale)
  return (
    <Article $muted={item.status === 'dropped'} data-pick-id={item.id} aria-label={item.name}>
      <Picture
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        $category={item.category}
        onClick={onOpen}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <CategoryGlyph category={item.category} size={56} />
        )}
      </Picture>
      <ChipSpot>
        <CategoryChip category={item.category} overlay />
      </ChipSpot>
      {menu && <MenuSpot>{menu}</MenuSpot>}
      <Body>
        <Name>
          <button type="button" onClick={onOpen}>
            {item.name}
          </button>
        </Name>
        {item.note.trim() && <Note>{item.note}</Note>}
        {(price || recommender) && (
          <Foot>
            {price ? <Price>{price}</Price> : <span />}
            {recommender && (
              <Recommender title={t('picks.recommendedBy', { name: recommender.name })}>
                <Avatar
                  name={recommender.name}
                  colorIndex={paletteIndex(recommender.color, recommender.id)}
                  size="sm"
                />
              </Recommender>
            )}
          </Foot>
        )}
        <Tags>
          {vote}
          {tags.map((tag) => (
            <Tag key={tag.key} $tone={tag.tone ?? 'neutral'}>
              {tag.label}
            </Tag>
          ))}
        </Tags>
      </Body>
    </Article>
  )
}
