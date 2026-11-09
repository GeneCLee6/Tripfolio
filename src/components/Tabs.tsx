import styled from 'styled-components'
import { focusRing } from '../styles/mixins.ts'
import { color, duration, fontSize, fontWeight, media, space, touchTarget } from '../styles/tokens.ts'
import { rovingKeyDown } from './roving.ts'

const List = styled.div`
  display: flex;
  gap: ${space.xs}px;
  border-bottom: 1px solid ${color.line};
  overflow-x: auto;
  scrollbar-width: none;
`

const Tab = styled.button<{ $active: boolean }>`
  flex: none;
  min-height: 40px;
  padding: 0 ${space.md}px;
  border: 0;
  border-bottom: 2px solid ${({ $active }) => ($active ? color.fjord : 'transparent')};
  margin-bottom: -1px;
  background: transparent;
  color: ${({ $active }) => ($active ? color.ink : color.muted)};
  font-size: ${fontSize.body}px;
  font-weight: ${({ $active }) => ($active ? fontWeight.semibold : fontWeight.medium)};
  cursor: pointer;
  &:hover {
    color: ${color.ink};
  }
  @media ${media.motion} {
    transition:
      color ${duration.fast}ms ease,
      border-color ${duration.fast}ms ease;
  }
  @media ${media.coarse} {
    min-height: ${touchTarget}px;
  }
  ${focusRing}
`

export interface TabItem<T extends string> {
  value: T
  label: string
}

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name of the tab list (already translated) */
  label: string
  /** Prefix for ids: tab `${idPrefix}-tab-${value}` controls panel `${idPrefix}-panel-${value}` */
  idPrefix: string
}

/**
 * The tab row (WAI-ARIA tabs, automatic activation). Render the panel yourself with
 * `role="tabpanel"`, id `${idPrefix}-panel-${value}` and aria-labelledby `${idPrefix}-tab-${value}`.
 */
export function Tabs<T extends string>({ items, value, onChange, label, idPrefix }: TabsProps<T>) {
  const values = items.map((item) => item.value)
  return (
    <List role="tablist" aria-label={label} onKeyDown={(event) => rovingKeyDown(event, values, value, onChange)}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <Tab
            key={item.value}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.value}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${item.value}`}
            tabIndex={active ? 0 : -1}
            data-roving=""
            $active={active}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </Tab>
        )
      })}
    </List>
  )
}
