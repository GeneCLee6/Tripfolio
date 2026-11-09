import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../shared/i18n/t.ts'
import {
  Avatar,
  Button,
  DayChip,
  Dialog,
  IconButton,
  Input,
  LanguageSwitch,
  MoneyField,
  SegmentedControl,
  Tabs,
  ThemeSwitch,
  amountText,
  initialOf,
  parseAmount,
} from '../../src/components/index.ts'
import { PlusIcon } from '../../src/components/icons.tsx'
import { dayColor, dayColors } from '../../src/styles/tokens.ts'

// Server-rendered smoke tests (no DOM needed): markup, ARIA wiring and i18n of the base components.
// Interaction (Esc, focus trap, arrow keys) is covered by the e2e walkthroughs.

const html = (node: React.ReactElement) => renderToStaticMarkup(node)
const noop = () => {}

afterEach(() => setLocale('zh-TW'))

describe('parseAmount / amountText', () => {
  it('turns typed text into integer minor units without float math', () => {
    expect(parseAmount('12.5', 2)).toBe(1250)
    expect(parseAmount('0.07', 2)).toBe(7)
    expect(parseAmount('1,234.56', 2)).toBe(123456)
    expect(parseAmount('.5', 2)).toBe(50)
    expect(parseAmount('15000', 0)).toBe(15000)
    expect(parseAmount('', 2)).toBeNull()
  })

  it('rejects too many decimals and non-numbers', () => {
    expect(parseAmount('1.234', 2)).toBe('invalid')
    expect(parseAmount('1.5', 0)).toBe('invalid')
    expect(parseAmount('abc', 2)).toBe('invalid')
    expect(parseAmount('-3', 2)).toBe('invalid')
    expect(parseAmount('.', 2)).toBe('invalid')
  })

  it('round-trips', () => {
    expect(amountText(1250, 2)).toBe('12.50')
    expect(amountText(7, 2)).toBe('0.07')
    expect(amountText(15000, 0)).toBe('15000')
    expect(amountText(null, 2)).toBe('')
    expect(parseAmount(amountText(98765, 2), 2)).toBe(98765)
  })
})

describe('initialOf', () => {
  it('takes the first grapheme, upper-cased', () => {
    expect(initialOf('gene')).toBe('G')
    expect(initialOf('  mia ')).toBe('M')
    expect(initialOf('王小明')).toBe('王')
    expect(initialOf('')).toBe('?')
  })
})

describe('tokens', () => {
  it('has ten day colors that cycle', () => {
    expect(dayColors).toHaveLength(10)
    expect(dayColor(10)).toBe(dayColor(0))
    expect(dayColor(-1)).toBe(dayColor(9))
  })
})

describe('components', () => {
  it('Button defaults to type=button', () => {
    expect(html(<Button variant="primary">x</Button>)).toContain('type="button"')
  })

  it('IconButton names itself with its label', () => {
    const markup = html(<IconButton label="Add" icon={<PlusIcon />} />)
    expect(markup).toContain('aria-label="Add"')
    expect(markup).toContain('aria-hidden="true"')
  })

  it('Input wires label, hint and error', () => {
    const markup = html(<Input id="f" label="Name" error="Required" />)
    expect(markup).toContain('for="f"')
    expect(markup).toContain('aria-describedby="f-message"')
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).toContain('Required')
  })

  it('MoneyField shows the amount in the currency decimals with a decimal keypad', () => {
    const aud = html(<MoneyField id="m" label="Amount" value={4250} currency="AUD" onChange={noop} />)
    expect(aud).toContain('value="42.50"')
    expect(aud).toContain('inputMode="decimal"')
    const idr = html(<MoneyField id="m" label="Amount" value={15000} currency="IDR" onChange={noop} />)
    expect(idr).toContain('value="15000"')
    expect(idr).toContain('inputMode="numeric"')
  })

  it('Tabs and SegmentedControl expose roles and the selection', () => {
    const tabs = html(
      <Tabs label="T" idPrefix="p" value="b" onChange={noop} items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />,
    )
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toContain('id="p-tab-b" aria-selected="true"')
    const segments = html(
      <SegmentedControl label="S" value="a" onChange={noop} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />,
    )
    expect(segments).toContain('role="radiogroup"')
    expect(segments).toContain('aria-checked="true"')
  })

  it('Avatar and DayChip use the day palette', () => {
    expect(html(<Avatar name="gene" colorIndex={1} />)).toContain('aria-label="gene"')
    expect(html(<DayChip index={2} selected />)).toContain('Day 3')
  })

  it('Dialog renders closed with its accessible name and a translated close button', () => {
    const markup = html(<Dialog open={false} onClose={noop} title="Delete?" />)
    expect(markup).toContain('<dialog')
    expect(markup).toContain('aria-labelledby')
    expect(markup).toContain('aria-label="關閉"')
  })

  it('switches render in the current language', () => {
    expect(html(<LanguageSwitch />)).toContain('lang="en"')
    setLocale('en')
    expect(html(<ThemeSwitch />)).toContain('System')
    expect(html(<Dialog open={false} onClose={noop} title="x" />)).toContain('aria-label="Close"')
  })
})
