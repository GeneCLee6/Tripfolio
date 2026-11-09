import type { CurrencyCode } from '../../shared/money/currencies.ts'

// Defaults the trip form fills in from the destination text (E1 需求 旅程): the time zone and the
// local currencies. Pure, so it is unit-tested; the form only applies them while the person has not
// picked a value by hand. The keyword lists hold place names in both languages, which is data
// rather than interface text, so those lines carry i18n-ignore.

interface DestinationRule {
  keywords: readonly string[]
  /** null when the place spans several zones (Europe, Australia) */
  tz: string | null
  currencies: readonly CurrencyCode[]
}

// The table reads best one place per line, and each line must carry its i18n-ignore
// prettier-ignore
const RULES: readonly DestinationRule[] = [
  { keywords: ['峇里', '巴里島', 'bali', 'ubud', '烏布'], tz: 'Asia/Makassar', currencies: ['IDR'] }, // i18n-ignore
  { keywords: ['印尼', 'indonesia', 'jakarta', '雅加達'], tz: 'Asia/Jakarta', currencies: ['IDR'] }, // i18n-ignore
  { keywords: ['紐西蘭', 'new zealand', 'aotearoa', 'auckland', '奧克蘭', 'queenstown', '皇后鎮', 'christchurch', '基督城'], tz: 'Pacific/Auckland', currencies: ['NZD'] }, // i18n-ignore
  { keywords: ['泰國', 'thailand', '曼谷', 'bangkok', '清邁', 'chiang mai', '普吉', 'phuket'], tz: 'Asia/Bangkok', currencies: ['THB'] }, // i18n-ignore
  { keywords: ['斐濟', 'fiji'], tz: 'Pacific/Fiji', currencies: ['FJD'] }, // i18n-ignore
  { keywords: ['帛琉', 'palau'], tz: 'Pacific/Palau', currencies: ['USD'] }, // i18n-ignore
  { keywords: ['日本', 'japan', '東京', 'tokyo', '大阪', 'osaka', '京都', 'kyoto', '北海道', 'hokkaido'], tz: 'Asia/Tokyo', currencies: ['JPY'] }, // i18n-ignore
  { keywords: ['韓國', 'korea', '首爾', 'seoul', '釜山', 'busan'], tz: 'Asia/Seoul', currencies: ['KRW'] }, // i18n-ignore
  { keywords: ['越南', 'vietnam', 'viet nam', '河內', 'hanoi', '胡志明', 'ho chi minh'], tz: 'Asia/Ho_Chi_Minh', currencies: ['VND'] }, // i18n-ignore
  { keywords: ['新加坡', 'singapore'], tz: 'Asia/Singapore', currencies: ['SGD'] }, // i18n-ignore
  { keywords: ['馬來西亞', 'malaysia', '吉隆坡', 'kuala lumpur'], tz: 'Asia/Kuala_Lumpur', currencies: ['MYR'] }, // i18n-ignore
  { keywords: ['香港', 'hong kong'], tz: 'Asia/Hong_Kong', currencies: ['HKD'] }, // i18n-ignore
  { keywords: ['台灣', '臺灣', 'taiwan', '台北', '臺北', 'taipei'], tz: 'Asia/Taipei', currencies: [] }, // i18n-ignore
  { keywords: ['英國', 'united kingdom', 'england', 'scotland', '倫敦', 'london', '蘇格蘭'], tz: 'Europe/London', currencies: ['GBP'] }, // i18n-ignore
  { keywords: ['瑞士', 'switzerland', '蘇黎世', 'zurich', 'zürich'], tz: 'Europe/Zurich', currencies: ['CHF'] }, // i18n-ignore
  { keywords: ['捷克', 'czech', '布拉格', 'prague'], tz: 'Europe/Prague', currencies: ['CZK'] }, // i18n-ignore
  { keywords: ['法國', 'france', '巴黎', 'paris'], tz: 'Europe/Paris', currencies: ['EUR'] }, // i18n-ignore
  { keywords: ['義大利', 'italy', '羅馬', 'rome', '米蘭', 'milan'], tz: 'Europe/Rome', currencies: ['EUR'] }, // i18n-ignore
  { keywords: ['德國', 'germany', '柏林', 'berlin', '慕尼黑', 'munich'], tz: 'Europe/Berlin', currencies: ['EUR'] }, // i18n-ignore
  { keywords: ['西班牙', 'spain', '巴塞隆納', 'barcelona', '馬德里', 'madrid'], tz: 'Europe/Madrid', currencies: ['EUR'] }, // i18n-ignore
  { keywords: ['荷蘭', 'netherlands', '阿姆斯特丹', 'amsterdam'], tz: 'Europe/Amsterdam', currencies: ['EUR'] }, // i18n-ignore
  { keywords: ['奧地利', 'austria', '維也納', 'vienna'], tz: 'Europe/Vienna', currencies: ['EUR'] }, // i18n-ignore
  { keywords: ['希臘', 'greece', '雅典', 'athens'], tz: 'Europe/Athens', currencies: ['EUR'] }, // i18n-ignore
  { keywords: ['歐洲', 'europe'], tz: null, currencies: ['EUR'] }, // i18n-ignore
  { keywords: ['雪梨', 'sydney'], tz: 'Australia/Sydney', currencies: [] }, // i18n-ignore
  { keywords: ['墨爾本', 'melbourne'], tz: 'Australia/Melbourne', currencies: [] }, // i18n-ignore
  { keywords: ['布里斯本', 'brisbane'], tz: 'Australia/Brisbane', currencies: [] }, // i18n-ignore
  { keywords: ['伯斯', 'perth'], tz: 'Australia/Perth', currencies: [] }, // i18n-ignore
  { keywords: ['塔斯馬尼亞', 'tasmania', 'hobart'], tz: 'Australia/Hobart', currencies: [] }, // i18n-ignore
]

export interface DestinationGuess {
  /** The destination's IANA zone, or null when the text names none we are sure of */
  tz: string | null
  /** Local currencies in the order the places appear in the text */
  localCurrencies: CurrencyCode[]
}

/**
 * Reads place names out of the destination text. Several places add their currencies (Paris and
 * Prague give EUR, CZK); the zone is the first place's that has one.
 */
export function guessFromDestination(destination: string): DestinationGuess {
  const text = destination.toLowerCase()
  const matches: { at: number; rule: DestinationRule }[] = []
  for (const rule of RULES) {
    let at = -1
    for (const keyword of rule.keywords) {
      const index = text.indexOf(keyword)
      if (index >= 0 && (at < 0 || index < at)) at = index
    }
    if (at >= 0) matches.push({ at, rule })
  }
  matches.sort((a, b) => a.at - b.at)
  const localCurrencies: CurrencyCode[] = []
  for (const { rule } of matches) {
    for (const code of rule.currencies)
      if (!localCurrencies.includes(code)) localCurrencies.push(code)
  }
  return { tz: matches.find((match) => match.rule.tz)?.rule.tz ?? null, localCurrencies }
}

/** The time zones the form offers (E1: the owner's planned trips plus the usual places) */
export const TIME_ZONES: readonly string[] = [
  'Pacific/Auckland',
  'Pacific/Fiji',
  'Pacific/Palau',
  'Pacific/Guam',
  'Pacific/Tahiti',
  'Pacific/Honolulu',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Darwin',
  'Australia/Hobart',
  'Australia/Perth',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Manila',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Makassar',
  'Asia/Jakarta',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Indian/Maldives',
  'Asia/Dubai',
  'Europe/Istanbul',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Budapest',
  'Europe/Vienna',
  'Europe/Prague',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Lisbon',
  'Europe/Oslo',
  'Europe/London',
  'Europe/Dublin',
  'Atlantic/Reykjavik',
  'America/New_York',
  'America/Vancouver',
  'America/Los_Angeles',
  'UTC',
]

/** The browser's own zone, or Asia/Taipei when the platform does not say */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei'
  } catch {
    return 'Asia/Taipei'
  }
}

/** TIME_ZONES, with the `extra` zones (the browser's, a trip's current one) first when missing */
export function timeZoneOptions(...extra: string[]): string[] {
  const out = [...TIME_ZONES]
  for (const zone of [...extra].reverse()) if (zone && !out.includes(zone)) out.unshift(zone)
  return out
}
