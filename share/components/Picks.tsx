import styled from 'styled-components'
import type { SharePick } from '../../shared/api/share.ts'
import { formatMoney } from '../../shared/i18n/format.ts'
import type { WishlistCategory } from '../../shared/schema/wishlist.ts'
import { useT } from '../../src/lib/i18n.ts'
import { color, font, fontSize, fontWeight, palette, radius, space } from '../../src/styles/tokens.ts'
import { mediaUrl } from '../api.ts'

// 必吃必買 highlights (e8-t01b, mockup Screen 3's card wall): a CSS-columns masonry of cards with
// the image (a shared photo, the link preview's image, or a placeholder), the category, the name,
// the price when the share shows money, how many want to go and the day it is planned on.

const categoryGlyph: Record<WishlistCategory, string> = {
  eat: '🍽',
  buy: '🛍',
  see: '🏞',
  experience: '✨',
}

const Wall = styled.div`
  columns: 4 160px;
  column-gap: ${space.md}px;
`

const Card = styled.article`
  break-inside: avoid;
  margin-bottom: ${space.md}px;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Picture = styled.div`
  position: relative;
  aspect-ratio: 4 / 3;
  background: ${color.glacier};
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

const Placeholder = styled.span`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 44px;
`

// The chip sits on a photo: light in both themes, like the mockup
const Category = styled.span`
  position: absolute;
  left: ${space.sm}px;
  top: ${space.sm}px;
  padding: 2px 9px;
  border-radius: ${radius.pill}px;
  background: ${palette.light.card};
  color: ${palette.light.ink};
  font-size: 11px;
  font-weight: ${fontWeight.semibold};
`

const Body = styled.div`
  display: grid;
  gap: 6px;
  padding: ${space.md}px ${space.lg}px;
  h3 {
    margin: 0;
    font-size: ${fontSize.md}px;
    font-weight: ${fontWeight.bold};
  }
`

const Price = styled.span`
  font-family: ${font.mono};
  font-weight: ${fontWeight.medium};
  color: ${color.ink};
`

const Tags = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.xs}px;
`

const Tag = styled.span`
  padding: 0 ${space.sm}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  font-size: 11px;
  color: ${color.muted};
`

function PickImage({ pick, token }: { pick: SharePick; token: string }) {
  const src = pick.photoAttachmentId ? mediaUrl(pick.photoAttachmentId, token) : pick.sourceImageUrl
  if (!src) return <Placeholder aria-hidden="true">{categoryGlyph[pick.category]}</Placeholder>
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      // Another site's image must not learn which trip linked it
      referrerPolicy="no-referrer"
    />
  )
}

export function Picks({ picks, token }: { picks: readonly SharePick[]; token: string }) {
  const t = useT()
  if (picks.length === 0) return null
  return (
    <section aria-labelledby="share-picks" data-testid="share-picks">
      <SectionHeading id="share-picks">{t('share.picks.heading')}</SectionHeading>
      <Wall>
        {picks.map((pick, i) => (
          <Card key={i}>
            <Picture>
              <PickImage pick={pick} token={token} />
              <Category>{t(`share.picks.category.${pick.category}`)}</Category>
            </Picture>
            <Body>
              <h3>{t.locale === 'en' && pick.nameEn ? pick.nameEn : pick.name}</h3>
              {pick.estMinor !== undefined && pick.currency && (
                <Price>{formatMoney(pick.estMinor, pick.currency, t.locale)}</Price>
              )}
              {(pick.votes > 0 || pick.dayIndex) && (
                <Tags>
                  {pick.dayIndex && <Tag>{t('day.short', { n: pick.dayIndex })}</Tag>}
                  {pick.votes > 0 && <Tag>{t.plural('share.picks.votes', pick.votes)}</Tag>}
                </Tags>
              )}
            </Body>
          </Card>
        ))}
      </Wall>
    </section>
  )
}

const SectionHeading = styled.h2`
  margin: 0 0 ${space.md}px;
  font-size: ${fontSize.lg}px;
`
