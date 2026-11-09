import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import styled, { css } from 'styled-components'
import { useT } from '../lib/i18n.ts'
import { color, font, fontSize, fontWeight, space } from '../styles/tokens.ts'
import { ChevronDownIcon } from './icons.tsx'
import { controlBox } from './styles.ts'

const Wrapper = styled.div`
  display: grid;
  gap: ${space.xs}px;
  min-width: 0;
`

const Label = styled.label`
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
  color: ${color.ink};
`

const Optional = styled.span`
  margin-left: ${space.xs}px;
  color: ${color.muted};
  font-weight: ${fontWeight.regular};
`

const Message = styled.p<{ $error: boolean }>`
  margin: 0;
  font-size: ${fontSize.sm}px;
  color: ${({ $error }) => ($error ? color.danger : color.muted)};
`

export interface FieldChrome {
  /** Visible label (already translated) */
  label: string
  /** A help line under the control */
  hint?: string
  /** An error line; also marks the control invalid */
  error?: string
  optional?: boolean
}

export interface ControlIds {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/** Label, control, and hint or error, wired together with ids */
export function FieldShell({ label, hint, error, optional, id, children }: FieldChrome & { id?: string; children: (ids: ControlIds) => ReactNode }) {
  const t = useT()
  const generated = useId()
  const controlId = id ?? generated
  const messageId = `${controlId}-message`
  const message = error ?? hint
  return (
    <Wrapper>
      <Label htmlFor={controlId}>
        {label}
        {optional && <Optional>{t('common.optional')}</Optional>}
      </Label>
      {children({
        id: controlId,
        'aria-describedby': message ? messageId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {message && (
        <Message id={messageId} $error={Boolean(error)}>
          {message}
        </Message>
      )}
    </Wrapper>
  )
}

const StyledInput = styled.input<{ $mono?: boolean }>`
  ${controlBox}
  ${({ $mono }) =>
    $mono &&
    css`
      font-family: ${font.mono};
      font-variant-numeric: tabular-nums;
    `}
`

export type InputProps = FieldChrome & Omit<InputHTMLAttributes<HTMLInputElement>, 'children'>

export function Input({ label, hint, error, optional, id, ...rest }: InputProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} id={id}>
      {(ids) => <StyledInput {...ids} {...rest} />}
    </FieldShell>
  )
}

/** A calendar date (value is YYYY-MM-DD, the stored form) */
export function DateField({ label, hint, error, optional, id, ...rest }: Omit<InputProps, 'type'>) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} id={id}>
      {(ids) => <StyledInput type="date" $mono {...ids} {...rest} />}
    </FieldShell>
  )
}

/** A wall-clock time (value is HH:mm, 24-hour) */
export function TimeField({ label, hint, error, optional, id, ...rest }: Omit<InputProps, 'type'>) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} id={id}>
      {(ids) => <StyledInput type="time" step={60} $mono {...ids} {...rest} />}
    </FieldShell>
  )
}

const SelectBox = styled.div`
  position: relative;
  display: grid;
  > svg {
    position: absolute;
    right: ${space.md}px;
    top: 50%;
    transform: translateY(-50%);
    color: ${color.muted};
    pointer-events: none;
  }
`

const StyledSelect = styled.select`
  ${controlBox}
  appearance: none;
  padding-right: ${space.xxl + space.sm}px;
  cursor: pointer;
`

export type SelectProps = FieldChrome & SelectHTMLAttributes<HTMLSelectElement>

/** A native select (best on phones) styled like the other controls; pass <option>s as children */
export function Select({ label, hint, error, optional, id, children, ...rest }: SelectProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} id={id}>
      {(ids) => (
        <SelectBox>
          <StyledSelect {...ids} {...rest}>
            {children}
          </StyledSelect>
          <ChevronDownIcon size={18} />
        </SelectBox>
      )}
    </FieldShell>
  )
}
