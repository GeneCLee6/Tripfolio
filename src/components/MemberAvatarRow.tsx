import styled from 'styled-components'
import { paletteIndex } from '../lib/colors.ts'
import { useT } from '../lib/i18n.ts'
import { color, font, fontSize, space } from '../styles/tokens.ts'
import { Avatar, AvatarGroup, type AvatarSize } from './Avatar.tsx'

// Stacked avatars and the head count (trip home, e1-t03). No router here: wrap it in a link where
// it should lead somewhere (components/index.ts is shared with the share page).

const Row = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm}px;
`

const More = styled.span`
  display: inline-grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  padding: 0 ${space.xs}px;
  border: 2px solid ${color.card};
  border-radius: 15px;
  background: ${color.line};
  color: ${color.ink};
  font-size: ${fontSize.sm - 1}px;
`

const Count = styled.span`
  font-family: ${font.mono};
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

export interface MemberAvatarRowProps {
  members: readonly { id: string; name: string; color: string }[]
  /** Avatars drawn before the rest become "+N" */
  max?: number
  size?: AvatarSize
}

export function MemberAvatarRow({ members, max = 5, size = 'md' }: MemberAvatarRowProps) {
  const t = useT()
  const shown = members.slice(0, max)
  const rest = members.length - shown.length
  return (
    <Row>
      <AvatarGroup>
        {shown.map((member) => (
          <Avatar
            key={member.id}
            name={member.name}
            colorIndex={paletteIndex(member.color, member.id)}
            size={size}
          />
        ))}
        {rest > 0 && <More aria-hidden="true">+{rest}</More>}
      </AvatarGroup>
      <Count>{t.plural('members.count', members.length)}</Count>
    </Row>
  )
}
