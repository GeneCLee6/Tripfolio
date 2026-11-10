import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styled from 'styled-components'
import { color, fontSize, fontWeight, space } from '../../styles/tokens.ts'
import { focusRing } from '../../styles/mixins.ts'

// Small pieces the lifecycle screens share: a checkbox with a hint (the share dialog's look), a
// muted paragraph, a block heading and the link to the privacy page.

const OptionLabel = styled.label`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px ${space.sm}px;
  align-items: start;
  cursor: pointer;
  > input {
    grid-row: span 2;
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    accent-color: ${color.fjord};
  }
`

const OptionName = styled.span`
  font-size: ${fontSize.body}px;
  font-weight: ${fontWeight.medium};
`

const OptionHint = styled.span`
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

export function CheckOption({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <OptionLabel>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <OptionName>{label}</OptionName>
      {hint && <OptionHint>{hint}</OptionHint>}
    </OptionLabel>
  )
}

export const Options = styled.fieldset`
  display: grid;
  gap: ${space.md}px;
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
  > legend {
    margin-bottom: ${space.sm}px;
    padding: 0;
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.medium};
  }
`

export const Muted = styled.p`
  margin: 0;
  color: ${color.muted};
  font-size: ${fontSize.sm}px;
`

export const BlockTitle = styled.h3`
  margin: 0;
  font-size: ${fontSize.md}px;
  font-weight: ${fontWeight.bold};
`

export const Block = styled.div`
  display: grid;
  gap: ${space.sm}px;
  min-width: 0;
  padding-top: ${space.lg}px;
  border-top: 1px solid ${color.line};
`

export const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${space.sm}px;
  align-items: center;
`

export const ErrorText = styled.p`
  margin: 0;
  color: ${color.danger};
  font-size: ${fontSize.sm}px;
  overflow-wrap: anywhere;
`

const StyledLink = styled(Link)`
  color: ${color.fjord};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
  ${focusRing}
`

export function PrivacyLink({ children }: { children: ReactNode }) {
  return <StyledLink to="/privacy">{children}</StyledLink>
}
