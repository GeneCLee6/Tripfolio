import { useState } from 'react'
import styled from 'styled-components'
import {
  CURRENCY_CODES,
  minorUnitsOf,
  type CurrencyCode,
} from '../../shared/money/currencies.ts'
import { useT } from '../lib/i18n.ts'
import { color, font, fontSize, fontWeight, media, radius, space, touchTarget } from '../styles/tokens.ts'
import { amountText, parseAmount } from './text.ts'
import { FieldShell, type FieldChrome } from './Field.tsx'
import { controlBox } from './styles.ts'

const Row = styled.div<{ $invalid: boolean }>`
  ${controlBox}
  display: flex;
  align-items: center;
  gap: ${space.sm}px;
  padding: 0 ${space.md}px 0 ${space.xs}px;
  border-color: ${({ $invalid }) => ($invalid ? color.danger : color.line)};
  &:focus-within {
    outline: 2px solid ${color.fjord};
    outline-offset: 1px;
    border-color: ${color.fjord};
  }
`

const CurrencyChip = styled.select`
  flex: none;
  appearance: none;
  height: 30px;
  padding: 0 ${space.sm + 2}px;
  border: 1px solid ${color.line};
  border-radius: ${radius.pill}px;
  background: ${color.paper};
  color: ${color.ink};
  font-family: ${font.mono};
  font-size: ${fontSize.sm}px;
  font-weight: ${fontWeight.medium};
  cursor: pointer;
  &:focus-visible {
    outline: 2px solid ${color.fjord};
    outline-offset: 1px;
  }
  @media ${media.coarse} {
    height: 36px;
  }
`

const AmountInput = styled.input`
  flex: 1;
  min-width: 0;
  min-height: 38px;
  border: 0;
  background: transparent;
  color: ${color.ink};
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  font-size: ${fontSize.md}px;
  text-align: right;
  &:focus {
    outline: none;
  }
  &::placeholder {
    color: ${color.muted};
  }
  @media ${media.coarse} {
    min-height: ${touchTarget - 2}px;
  }
`

export interface MoneyFieldProps extends FieldChrome {
  /** Integer minor units, or null when empty */
  value: number | null
  currency: CurrencyCode
  onChange: (minor: number | null) => void
  onCurrencyChange?: (currency: CurrencyCode) => void
  /** Currencies offered in the chip (default: every one in shared/money/currencies.ts) */
  currencies?: readonly CurrencyCode[]
  id?: string
  disabled?: boolean
}

/**
 * An amount with its currency chip. Works in integer minor units with the currency's decimals from
 * shared/money/currencies.ts; opens the decimal keypad on phones (numeric for 0-decimal currencies).
 */
export function MoneyField({
  label,
  hint,
  error,
  optional,
  value,
  currency,
  onChange,
  onCurrencyChange,
  currencies = CURRENCY_CODES,
  id,
  disabled,
}: MoneyFieldProps) {
  const t = useT()
  const digits = minorUnitsOf(currency)
  const [text, setText] = useState(() => amountText(value, digits))
  // Follow outside changes (a reset, a currency switch) without fighting what is being typed
  const [seen, setSeen] = useState({ value, digits })
  if (seen.value !== value || seen.digits !== digits) {
    setSeen({ value, digits })
    if (parseAmount(text, digits) !== value) setText(amountText(value, digits))
  }
  const parsed = parseAmount(text, digits)
  const invalid = parsed === 'invalid'

  const shownError = error ?? (invalid ? t('money.invalid', { digits }) : undefined)

  return (
    <FieldShell label={label} hint={hint} error={shownError} optional={optional} id={id}>
      {(ids) => (
        <Row $invalid={Boolean(shownError)}>
          <CurrencyChip
            aria-label={t('money.currency')}
            value={currency}
            disabled={disabled || !onCurrencyChange}
            onChange={(event) => onCurrencyChange?.(event.target.value as CurrencyCode)}
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </CurrencyChip>
          <AmountInput
            {...ids}
            type="text"
            inputMode={digits === 0 ? 'numeric' : 'decimal'}
            autoComplete="off"
            placeholder={amountText(0, digits)}
            value={text}
            disabled={disabled}
            onChange={(event) => {
              setText(event.target.value)
              const next = parseAmount(event.target.value, digits)
              if (next !== 'invalid') onChange(next)
            }}
          />
        </Row>
      )}
    </FieldShell>
  )
}
