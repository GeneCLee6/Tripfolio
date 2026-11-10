import type { CSSProperties } from 'react'
import styled from 'styled-components'
import type { ShareDay } from '../../shared/api/share.ts'
import { formatDate } from '../../shared/i18n/format.ts'
import { useT } from '../../src/lib/i18n.ts'
import { paragraphs } from '../../src/lib/recap/compare.ts'
import { focusRing } from '../../src/styles/mixins.ts'
import { color, font, fontSize, fontWeight, media, radius, space } from '../../src/styles/tokens.ts'
import { mediaUrl } from '../api.ts'
import { colorOfDay } from '../colors.ts'

// 「回顧」 on the share page (e8-t04): with the share option showRecap, once the trip has ended, the
// Worker adds each day's recap text and up to 9 shareable photos (days[].recapBody,
// recapPhotoIds). Nothing about money: recap amounts stay in the app. Days with neither are left
// out; the whole section only exists when some day has something.

const List = styled.div`
  display: grid;
  gap: ${space.md}px;
  @media ${media.desktop} {
    gap: ${space.lg}px;
  }
`

const Day = styled.article`
  display: grid;
  grid-template-columns: 6px 1fr;
  overflow: hidden;
  border: 1px solid ${color.line};
  border-radius: ${radius.card}px;
  background: ${color.card};
`

const Bar = styled.div`
  background: var(--day);
`

const Body = styled.div`
  display: grid;
  gap: ${space.sm}px;
  min-width: 0;
  padding: ${space.md}px ${space.lg}px;
`

const Top = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: ${space.xs}px ${space.md}px;
  h3 {
    margin: 0;
    font-size: ${fontSize.md}px;
    font-weight: ${fontWeight.bold};
  }
`

const DateText = styled.span`
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: ${color.muted};
`

const Text = styled.div`
  display: grid;
  gap: ${space.sm}px;
  overflow-wrap: anywhere;
  p {
    margin: 0;
    line-height: 1.7;
  }
`

const Photos = styled.ul`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${space.xs}px;
  margin: 0;
  padding: 0;
  list-style: none;
  a {
    display: block;
    border-radius: ${radius.control}px;
    ${focusRing}
  }
  img {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: ${radius.control}px;
    background: ${color.paper};
  }
`

const Lead = styled.p`
  margin: 0 0 ${space.md}px;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

const Heading = styled.h2`
  margin: 0 0 ${space.xs}px;
  font-size: ${fontSize.lg}px;
`

const hasRecap = (day: ShareDay) => !!day.recapBody || (day.recapPhotoIds?.length ?? 0) > 0

export function Recap({ days, token }: { days: readonly ShareDay[]; token: string }) {
  const t = useT()
  const shown = days.filter(hasRecap)
  if (shown.length === 0) return null
  return (
    <section aria-labelledby="share-recap" data-testid="share-recap" data-print="hide">
      <Heading id="share-recap">{t('share.recap.heading')}</Heading>
      <Lead>{t('share.recap.lead')}</Lead>
      <List>
        {shown.map((day) => {
          const dayLabel = t('day.short', { n: day.index })
          const heading = day.title
            ? t('share.day.heading', { day: dayLabel, title: day.title })
            : dayLabel
          const style = { '--day': colorOfDay(day.index, day.color) } as CSSProperties
          const photos = day.recapPhotoIds ?? []
          return (
            <Day key={day.index} style={style} data-testid="share-recap-day">
              <Bar aria-hidden="true" />
              <Body>
                <Top>
                  <h3>{heading}</h3>
                  {day.date && <DateText>{formatDate(day.date, t.locale)}</DateText>}
                </Top>
                {day.recapBody && (
                  <Text>
                    {paragraphs(day.recapBody).map((lines, i) => (
                      <p key={i}>
                        {lines.map((line, j) => (
                          <span key={j}>
                            {j > 0 && <br />}
                            {line}
                          </span>
                        ))}
                      </p>
                    ))}
                  </Text>
                )}
                {photos.length > 0 && (
                  <Photos aria-label={t('share.recap.photos', { day: dayLabel })}>
                    {photos.map((id, i) => (
                      <li key={id}>
                        <a href={mediaUrl(id, token, 'full')} target="_blank" rel="noopener">
                          <img
                            src={mediaUrl(id, token)}
                            alt={t('share.recap.photoAlt', { day: dayLabel, n: i + 1 })}
                            loading="lazy"
                            decoding="async"
                          />
                        </a>
                      </li>
                    ))}
                  </Photos>
                )}
              </Body>
            </Day>
          )
        })}
      </List>
    </section>
  )
}
