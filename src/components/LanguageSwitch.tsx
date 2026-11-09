import { LOCALES } from '../../shared/i18n/t.ts'
import { useLocale, useT } from '../lib/i18n.ts'
import { SegmentedControl } from './SegmentedControl.tsx'

/** 中文 / EN; the choice is remembered (src/lib/i18n.ts) */
export function LanguageSwitch({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const t = useT()
  const [locale, setLocale] = useLocale()
  return (
    <SegmentedControl
      label={t('language.label')}
      size={size}
      value={locale}
      onChange={setLocale}
      options={LOCALES.map((value) => ({ value, label: t(`language.${value}`), lang: value }))}
    />
  )
}
