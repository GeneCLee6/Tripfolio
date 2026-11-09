---
title: E10 — 介面、i18n 與 PWA
date: 2026-11-09
status: planned
epic: E10
owner: GeneCLee6
milestones: [M0, M2]
depends_on: []
---

## 背景

使用者要「UI 設計好看一點」且「至少中文英文」。好看的方向是**旅遊雜誌**：米白紙感底色、深墨綠與珊瑚橘的點綴、襯線標題（Noto Serif TC／Fraunces）、照片大、留白多；不是儀表板。語言：繁中是來源（規劃內容本來就是中文寫的）、英文是翻譯，介面預設繁中、第一次依瀏覽器語言切英文。手機是主要使用情境（旅途中），桌機是規劃情境（三欄）。

## 目標

- M0：token、基礎元件、i18n、app 殼、格式工具。
- M2：PWA 與離線、無障礙走查。

## 非目標

- 多於兩種語言（結構支援，內容不做）。
- 使用者自訂主題。

## 需求

- **Token**（`src/styles/tokens.ts`）：顏色（paper、ink、muted、line、accent 墨綠、accent2 珊瑚、sand、success、warning、danger；深色一組）、十個日色、間距 4 的倍數、圓角 10／16／24、字級 13／15／17／20／26／34、字型（標題 Fraunces＋Noto Serif TC；內文 Inter＋Noto Sans TC；數字 tabular）。
- **元件**：Button、IconButton、Input、Select、DateField、TimeField、MoneyField（幣別＋數字鍵盤）、Card、Sheet（手機底部抽屜）、Dialog、Tabs、Chip、Toast、Avatar、EmptyState、Skeleton、SegmentedControl、Timeline（日程左側的線與點）、MapFrame。
- **i18n**：`t('key')`；`zh-TW.ts` 來源、`en.ts` 翻譯；JSX 不得裸字串；`check-i18n` 擋缺漏；語言切換在頂欄與分享頁；第一次依 `navigator.languages`（非 `zh*` → en），之後以使用者為準。
- **版面**：手機（< 768）單欄＋底部導覽（總覽／日程／地圖／清單／記帳）；桌機三欄（左：Day 導覽與日程；中：地圖；右：細節抽屜）；平板兩欄。
- **格式**：`Intl` 做金額（幣別符號與小數位）、日期（繁中「11月9日（日）」、英文「Sun, Nov 9」）、時長（「3 小時 20 分」）、距離（km，一位小數）、時區縮寫。
- **PWA**：manifest、圖示、安裝提示（旅程出發前 7 天提示安裝）、Service Worker：app shell 快取、最近 3 個旅程的資料快取、離線佇列（記帳、勾選、文字編輯）、新版本提示。
- **無障礙**：鍵盤可達、焦點可見、對比 AA、拖曳有鍵盤替代（E2）、`prefers-reduced-motion`、觸控目標 44 px、axe 無 serious。

## 設計方向

- 視覺稿在 `docs/design/mockup.html`，token 以它為準。
- styled-components，樣式 prop 加 `$`；顏色只從 token。
- 字型 self-host 子集（Fraunces 只拉丁、Noto Serif TC 與 Noto Sans TC 用 Google Fonts 的 unicode-range 子集）；登記 `docs/ASSETS.md`。

## 驗收條件

- [x] AC-10.1 — Token 與基礎元件：深淺色、字型、全部元件有 Storybook 式展示頁（`/dev/ui`，production 不含）。 · #A2（Playwright 開 `/dev/ui` 確認淺深兩欄並排、Sheet 開啟與 Esc 關閉；production build 不含展示頁 chunk）
- [ ] AC-10.2 — i18n：zh-TW 來源、en 完整；偵測與切換；`check-i18n` 進 CI；英文與繁中走查各一次。
      _進度（A2）：zh-TW 來源與 en 同步、`navigator.languages` 偵測（非 `zh*` → en）、切換並存 localStorage、`check-i18n` 在 CI 擋缺漏／多餘 key 與裸字串，皆已完成；剩兩語走查（C2，e10-t07）。_
- [ ] AC-10.3 — 版面：375 px 全功能可用、底部導覽；桌機三欄；平板兩欄。
- [ ] AC-10.4 — PWA：可安裝、離線開啟最近旅程、離線佇列重送、更新提示（實體手機實測）。
- [ ] AC-10.5 — 無障礙：axe 無 serious／critical；鍵盤走查；reduced motion。
- [x] AC-10.6 — 格式：金額／日期／時長／距離／時區依語言正確（測試）。 · #A2（`tests/shared/i18n/format.test.ts`）

## Task 拆分

### M0

- [x] `e10-t01` token、字型子集、基礎元件、深淺色、`/dev/ui` 展示頁 · AC-10.1 · M · #A2
- [x] `e10-t02` i18n `t()`、zh-TW 來源與 en、語言偵測與切換、`check-i18n` 腳本 · AC-10.2 · S · #A2
- [x] `e10-t04` `Intl` 格式工具（金額、日期、時長、距離、時區）與測試 · AC-10.6 · S · #A2
- [ ] `e10-t03` App 殼：路由、三欄／兩欄／單欄版面、底部導覽、頂欄、空狀態 · AC-10.3 · M · ← e10-t01

### M0 收尾

- [ ] `e10-t06` 無障礙走查、axe e2e、拖曳鍵盤替代驗證、reduced motion · AC-10.5 · S · ← e2-t04
- [ ] `e10-t07` 英文走查與繁中語感複查、旅遊術語表定稿 · AC-10.2 · S · ← e10-t02

### M2

- [ ] `e10-t05` PWA：manifest、圖示、安裝提示、Service Worker（shell＋旅程資料）、離線佇列基礎、更新提示 · AC-10.4 · M · ← e10-t03

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 襯線中文字型檔太大 | unicode-range 子集、只標題用；內文 Noto Sans TC 走系統字型後備 |
| 離線佇列與即時同步互相打架 | 同一條 `useTrip()` 管線（E2 e2-t08b），佇列只是「還沒送出去的 patch」 |

## 未決問題

- [ ] **Q:** 預設語言繁中、來源語言繁中（與 TKU Arcade 相反）？
      **A:** _(建議是：使用者與同行朋友都是台灣人、內容是中文寫的；英文介面給分享頁的外國朋友；見總 PRD Q1b)_
