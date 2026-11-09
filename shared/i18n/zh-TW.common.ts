// Keys both bundles use (RULES.md §2): the trip map (src/map/**), the formats in
// shared/i18n/format.ts, and the bits of glossary, chrome and language names that the share page
// or the map show. zh-TW.ts (the app) and share/catalog.ts (the share page) both take them from
// here, so each key is written once. `npm run check-i18n` fails on a key here that the share page
// does not use (it belongs in zh-TW.ts) and on a share-page key missing from here and from
// zh-TW.share.ts.
export const zhTWCommon = {
  // App name
  'app.name': '旅誌',

  // The trip map (src/map/**), shown on the share page and on /trips/:id/map
  'map.label': '旅程地圖',
  'map.loading': '地圖載入中…',
  'map.error': '地圖載入失敗，請檢查網路後重新整理。',
  'map.layer.itinerary': '日程',
  'map.layer.pocket': '口袋名單',
  'map.layer.lodging': '住宿',
  'map.layer.picks': '必吃必買',
  'map.layer.fuel': '加油與補給',
  'map.type.sight': '景點',
  'map.type.food': '吃',
  'map.type.shopping': '買',
  'map.type.lodging': '住宿',
  'map.type.transport': '交通',
  'map.type.fuel': '加油',
  'map.type.supplies': '補給',
  'map.type.nature': '自然',
  'map.type.other': '其他',
  'map.stopOrder': '第 {n} 站',
  'map.pinLabel': '{day} · 第 {n} 站 · {name}',
  'map.placeLabel': '{layer} · {name}',
  'map.pinList': '地圖上的地點',
  'map.action.schedule': '排進這天',
  'map.action.openGoogleMaps': '用 Google Maps 開啟',
  'map.fullscreenEnter': '全螢幕',
  'map.fullscreenExit': '離開全螢幕',
  'map.locate': '回到我的位置',
  'map.locateFailed': '無法取得目前位置',
  'map.zoomIn': '放大',
  'map.zoomOut': '縮小',
  'map.canvas': '地圖畫面（方向鍵移動、＋／－ 縮放）',

  // Glossary, chrome, formats and language names used by the share page or the map
  'term.drivingTime': '駕駛時間',
  'common.close': '關閉',
  'day.short': 'Day {n}',
  'language.label': '語言',
  'language.zh-TW': '中文',
  'language.en': 'EN',
  'format.money.withSecondary': '{primary}（≈ {secondary}）',
  'format.date.withWeekday': '{date}（{weekday}）',
  'format.duration.hoursMinutes': '{hours} 小時 {minutes} 分',
  'format.duration.hours': '{hours} 小時',
  'format.duration.minutes': '{minutes} 分',
  'format.distance.km': '{value} km',
  'format.distance.m': '{value} m',
} as const

export type CommonMessageKey = keyof typeof zhTWCommon
