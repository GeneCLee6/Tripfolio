import { useT } from '../lib/i18n.ts'
import { THEME_PREFERENCES, useThemePreference } from '../styles/theme.ts'
import { SegmentedControl } from './SegmentedControl.tsx'

/** System / light / dark; the choice is remembered (src/styles/theme.ts) */
export function ThemeSwitch({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const t = useT()
  const [preference, setPreference] = useThemePreference()
  return (
    <SegmentedControl
      label={t('theme.label')}
      size={size}
      value={preference}
      onChange={setPreference}
      options={THEME_PREFERENCES.map((value) => ({ value, label: t(`theme.${value}`) }))}
    />
  )
}
