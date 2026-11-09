import type { ReactNode } from 'react'
import styled from 'styled-components'
import type { Member } from '../../shared/api/types.ts'
import { Avatar } from '../components/index.ts'
import { paletteIndex } from '../lib/colors.ts'
import { useT } from '../lib/i18n.ts'
import { color, font, fontSize, fontWeight, media, radius, space } from '../styles/tokens.ts'

// Pieces several pages share

const Head = styled.header`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: ${space.md}px ${space.lg}px;
`

const Titles = styled.div`
  display: grid;
  gap: ${space.xs}px;
  min-width: 0;
`

const Eyebrow = styled.p`
  margin: 0;
  font-family: ${font.mono};
  font-size: ${fontSize.sm - 1}px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${color.muted};
`

const Title = styled.h1`
  margin: 0;
  font-size: ${fontSize.xl}px;
  font-weight: ${fontWeight.bold};
  overflow-wrap: anywhere;
  @media ${media.tablet} {
    font-size: ${fontSize.xxl}px;
  }
`

const Lead = styled.p`
  margin: 0;
  color: ${color.muted};
  max-width: 60ch;
`

/** The page's h1, with an optional line above (eyebrow) and below (lead), and actions on the right */
export function PageHeading({
  title,
  eyebrow,
  lead,
  actions,
}: {
  title: string
  eyebrow?: string
  lead?: string
  actions?: ReactNode
}) {
  return (
    <Head>
      <Titles>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Title>{title}</Title>
        {lead && <Lead>{lead}</Lead>}
      </Titles>
      {actions}
    </Head>
  )
}

export const SectionTitle = styled.h2`
  margin: 0;
  font-size: ${fontSize.lg}px;
  font-weight: ${fontWeight.bold};
  display: flex;
  align-items: baseline;
  gap: ${space.sm}px;
`

export const Count = styled.span`
  font-family: ${font.mono};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.regular};
  color: ${color.muted};
`

export const Stack = styled.div<{ $gap?: keyof typeof space }>`
  display: grid;
  gap: ${({ $gap = 'xl' }) => space[$gap]}px;
  min-width: 0;
`

const MemberPill = styled.li`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm}px;
  padding: ${space.xs}px ${space.md}px ${space.xs}px ${space.xs}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.card};
  font-size: ${fontSize.sm}px;
`

const MemberRow = styled.ul`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Muted = styled.span`
  color: ${color.muted};
`

/** Members as avatar chips; "you" is marked */
export function MemberChips({ members, meId }: { members: readonly Member[]; meId?: string }) {
  const t = useT()
  return (
    <MemberRow>
      {members.map((member) => (
        <MemberPill key={member.id}>
          <Avatar name={member.name} colorIndex={paletteIndex(member.color, member.id)} size="sm" />
          <span>{member.name}</span>
          {member.id === meId && <Muted>· {t('member.you')}</Muted>}
        </MemberPill>
      ))}
    </MemberRow>
  )
}
