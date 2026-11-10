// Keys only the /dev/ui page uses (RULES.md §2): they ship in its lazy chunk, not in the first
// screen. ./dev.ts registers them and src/dev/UiShowcase.tsx imports it.
// A file that can load without that page must not use them; `npm run check-i18n` names the key to
// move back to ../zh-TW.ts and ../en.ts.
export const devZhTW = {
  'dev.ui.title': '元件展示',
  'dev.ui.intro': '每個基礎元件在淺色與深色主題下的樣子；只在開發模式出現。',
  'dev.ui.buttons': '按鈕',
  'dev.ui.fields': '欄位',
  'dev.ui.surfaces': '卡片與抽屜',
  'dev.ui.navigation': '分頁與切換',
  'dev.ui.feedback': '回饋',
  'dev.ui.people': '成員與日子',
  'dev.ui.timeline': '日程線',
  'dev.ui.formats': '格式',
  'dev.ui.small': '小',
  'dev.ui.large': '大',
  'dev.ui.disabled': '不可用',
  'dev.ui.openSheet': '開啟抽屜',
  'dev.ui.openDialog': '開啟對話框',
  'dev.ui.showToast': '顯示通知',
  'dev.ui.toastMessage': '已記一筆',
  'dev.ui.sheetBody': '手機上是底部抽屜，桌機上是置中的對話框。按 Esc 關閉。',
  'dev.ui.dialogTitle': '刪除這筆花費？',
  'dev.ui.dialogBody': '刪除後所有人的餘額會重新計算。',
  'dev.ui.cardTitle': '皇后鎮',
  'dev.ui.cardBody': '湖邊散步、纜車上山看夕陽。',
  'dev.ui.placeName': '地點名稱',
  'dev.ui.placeHint': '輸入地名或貼上 Google 地圖連結',
  'dev.ui.placePlaceholder': '例如：蒂卡波湖',
  'dev.ui.category': '類別',
  'dev.ui.date': '日期',
  'dev.ui.time': '時間',
  'dev.ui.errorExample': '這個欄位必填',
  'dev.ui.emptyTitle': '還沒有花費',
  'dev.ui.emptyBody': '記下第一筆，大家的餘額會自動算好。',
  'dev.ui.stopA': '基督城機場取車',
  'dev.ui.stopB': '蒂卡波湖・好牧羊人教堂',
  'dev.ui.stopC': '庫克山 Hooker Valley 步道',
  'dev.ui.dayTitle': '湖區',
} as const

export type DevMessageKey = keyof typeof devZhTW
