import type { ReactNode } from 'react'
import styled from 'styled-components'
import { color, font, fontSize, fontWeight, radius, space } from '../styles/tokens.ts'

// Horizontal bars with their labels and values (e7-t06; the 依類別 view). One accent hue: the bar
// only shows magnitude, identity is in the label (and the optional icon). Bars are drawn against
// the largest item, thin, with a rounded data end; values and labels stay in text colours and use
// tabular figures. The list is plain text for screen readers; the bars are decoration.

const List = styled.ul`
  display: grid;
  gap: ${space.md}px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Item = styled.li`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas:
    'icon label value'
    'icon bar bar';
  align-items: center;
  gap: ${space.xs}px ${space.md}px;
`

const Icon = styled.span`
  grid-area: icon;
  display: inline-flex;
`

const Label = styled.span`
  grid-area: label;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: ${fontWeight.medium};
`

const Value = styled.span`
  grid-area: value;
  display: inline-flex;
  align-items: baseline;
  gap: ${space.sm}px;
  font-family: ${font.mono};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

const Detail = styled.span`
  min-width: 4ch;
  text-align: right;
  font-size: ${fontSize.sm}px;
  color: ${color.muted};
`

const Track = styled.span`
  grid-area: bar;
  display: block;
  height: 8px;
  border-radius: ${radius.pill}px;
  background: color-mix(in srgb, ${color.line} 55%, transparent);
  overflow: hidden;
`

const Fill = styled.span<{ $share: number }>`
  display: block;
  height: 100%;
  width: ${({ $share }) => $share * 100}%;
  min-width: ${({ $share }) => ($share > 0 ? 4 : 0)}px;
  border-radius: 0 4px 4px 0;
  background: ${color.fjord};
`

export interface BarListItem {
  key: string
  label: string
  /** Drawn left of the label (a category tile) */
  icon?: ReactNode
  /** The magnitude the bar is drawn from (negative counts as zero) */
  value: number
  /** The value as text (an amount) */
  valueText: string
  /** Secondary text after the value (a percentage) */
  detail?: string
}

export interface BarListProps {
  items: readonly BarListItem[]
  /** Accessible name of the list (already translated) */
  label: string
  /** The value a full bar stands for; defaults to the largest item */
  max?: number
}

/** The share of the track a value fills: 0…1 against `max` */
const barShare = (value: number, max: number): number =>
  max > 0 ? Math.min(1, Math.max(0, value) / max) : 0

/** A ranked list of labelled horizontal bars */
export function BarList({ items, label, max }: BarListProps) {
  const top = max ?? Math.max(0, ...items.map((item) => item.value))
  return (
    <List aria-label={label}>
      {items.map((item) => (
        <Item key={item.key} data-bar={item.key}>
          {item.icon ? <Icon aria-hidden="true">{item.icon}</Icon> : null}
          <Label>{item.label}</Label>
          <Value>
            <span>{item.valueText}</span>
            {item.detail ? <Detail>{item.detail}</Detail> : null}
          </Value>
          <Track aria-hidden="true">
            <Fill data-share={barShare(item.value, top)} $share={barShare(item.value, top)} />
          </Track>
        </Item>
      ))}
    </List>
  )
}
