---
title: E8 — 分享、輸出與回顧
date: 2026-11-09
status: planned
epic: E8
owner: GeneCLee6
milestones: [M0, M1, M3]
depends_on: [E1, E2, E3, E5, E6, E7]
---

## 背景

使用者說的「像旅行社官網釋出的行程介紹」就是這個 epic 的唯讀頁：封面大圖、一句話、路線總圖、每日一張卡、必吃必買精選、費用概算。它有三個讀者：一起去的朋友（看今天要幹嘛）、沒去的朋友（想抄行程）、家人（想知道我們在哪）。旅程結束後，同一頁翻面變成遊記。

## 目標

- M0：唯讀頁的基本版（每日卡、地圖），讓分享連結有東西看。
- M1：完整旅行社風格版、列印／PDF、ICS、範本複製。
- M3：回顧模式。

## 非目標

- 公開社群、探索、按讚、留言（朋友會在 LINE 講）。
- 排版編輯器（版面固定，好看就好）。

## 需求

- **唯讀總覽頁** `/s/<shareToken>`：封面（照片或色塊＋標題＋日期＋人數＋總天數）、一句話簡介、**路線總圖**（全程過夜連線＋每日色）、每日摘要卡（日色、標題、當晚住宿、3–5 個重點行程點、照片一張、駕駛時間）、點每日卡展開完整行程、必吃必買精選（有照片的優先）、費用概算（每人預估，依 E1 選項可隱藏）、語言切換（zh-TW／en）、`noindex`、載入 ≤ 2 秒（分享頁是獨立輕量 bundle，不載編輯器）。
- **列印／PDF**：`@media print` 版面：A4、封面一頁、每日一頁（行程表＋該日靜態地圖＋住宿與預訂資訊）、最後是預訂總表；瀏覽器列印成 PDF 即可。
- **範本與匯出**：旅程匯出 JSON（含地點、行程、住宿、清單；不含花費與照片 key，可選）；匯入 JSON 成新旅程；「複製為範本」與 E1 共用。
- **回顧模式**：旅程結束日之後，旅程首頁出現「切換回顧」：每日卡顯示實際照片牆（E6）、實際花費 vs 預估（E7）、每日回顧文字（成員可寫）；分享連結可選「顯示回顧」。
- **ICS**：匯出行事曆（行程點有時間者、住宿入住退房、航班與交通），含目的地時區；可訂閱 URL（share token 保護）。

## 設計方向

- 分享頁是獨立入口（`share.html`），只載 `TripReadOnly` 元件與 MapLibre；資料由 Worker 依 token 與隱藏選項**在伺服器端過濾**後回傳，不是前端隱藏。
- 視覺：E10 的「旅遊雜誌」調性在這一頁發揮到最滿：大襯線標題、留白、日色邊條。
- 靜態地圖：列印時由 MapLibre canvas `toDataURL` 產生，一天一張；不用外部靜態地圖 API。

## 驗收條件

- [ ] AC-8.1 — 唯讀總覽頁：封面、路線總圖、每日卡（可展開）、精選、概算、隱藏選項在伺服器端生效、zh／en 切換、noindex；Lighthouse 效能 ≥ 90（手機）。
  - 進度（#share，`e8-t01a`）：基本版完成——封面（封面色漸層＋等高線、目的地、標題、簡介、天數／日期／人數／總里程統計）、每日卡（日色邊條、Day N · 標題、日期、駕駛合計、前 4 個行程點，可展開看完整行程＋移動段與「估」標記＋當日備註）、`GET /api/share/:token` 在伺服器端依 hideMoney／hideAddresses 過濾（欄位直接不存在）、zh／en 切換（`tripfolio.share.locale` 獨立記憶）、noindex（meta＋`X-Robots-Tag`）、404「連結已失效」狀態；分享頁首屏 94.0 kB gzip。路線總圖、必吃必買精選、概算表（每人預估等 E9 預算）、每日照片、Lighthouse 是 `e8-t01b`。
  - 進度（#F2a，`e8-t01b`）：完整版完成——路線總圖（先畫靜態 SVG 示意圖：過夜地之間日色虛線＋圓點＋名稱，等距圓柱投影；讀者捲動後進入視窗才 lazy 掛 `TripMap`（`maplibre` chunk 與 app 共用），`mode: 'trip'`、過夜連線、行程點與住宿／精選針、關滾輪縮放、無 popup 按鈕；`prefers-reduced-data` 或沒捲動時只有「載入互動地圖」按鈕；列印時保留 SVG）＋日色圖例；每日卡加「今晚：住宿・營地類型」、「退房 HH:mm」、3 張照片條（`/api/media/:id/thumb?s=`）；封面照片；「必吃必買」卡片牆（CSS columns，有圖優先、再依想去人數，最多 24 張）；「費用概算」表（行程點費用＋住宿＋預訂價，依類別；主幣算合計與每人，其他幣別分開列、不換匯；附註）。`hideMoney` 時概算、精選價格、所有金額欄位都不送。分享頁首屏 109.7 kB gzip（無 maplibre、router、zod）。**Lighthouse（手機，本機 production build＋gzip 代理，5 次）效能 72–80、無障礙 100、最佳做法 100**：LCP 模擬 4.7–4.9 s（實測 LCP 0.2–0.7 s）——封面 H1 要等 JS 執行＋`/api/share` 回來才畫（客戶端渲染）以及 Google Fonts；未達 ≥ 90，AC-8.1 暫不勾。要達標需要把封面預先輸出在 HTML（Worker 端注入）或字型本地化，另開 task。
- [ ] AC-8.2 — 列印：Chrome 列印成 PDF，A4 每日一頁含靜態地圖與預訂；無截斷。
- [x] AC-8.3 — 範本與匯出：匯出 JSON → 匯入成新旅程 → 內容一致（測試）。 · #F3a（`tests/worker/export.test.ts`：Fake D1 上「匯出 → 匯入 → 再匯出」兩份檔案除 `exportedAt` 外完全相同（含花費、公基金、結算）；改 `startDate` 時所有日期與時間依各自時區平移、關聯（行程點→地點、願望↔行程點、Day→住宿、預訂→行程點、花費→成員）不變；本機 `npm run dev` 以 curl／fetch 跑過匯出 → 匯入 → ICS 下載）
  - **API**（`worker/trips/export.ts`；格式型別 `shared/api/export.ts`、zod `shared/schema/export.ts`）：`GET /api/trips/:id/export?include=expenses,photos`（editor 以上、封存也可；`Content-Disposition: attachment`）回 `TripExport` v1：`format: "tripfolio.trip"`、`version: 1`、`includes`、`trip`（不含 id、token、成員 email）、`members`（只有名字、顏色、角色、`removed`）、`days`、`places`、`stops`、`legOverrides`、`lodgings`、`bookings`（`details` 裡的地點 id 換成檔內編號）、`wishlist`（含 `votes`＝成員編號、`claims`）；`expenses`／`poolContributions`／`settlements` 只在 `include=expenses`（整數分＋幣別＋fxRate）；`attachments` 只在 `include=photos`、只有照片的中繼資料（沒有檔案與 R2 key）。所有 id 都是檔內各類別從 1 開始的流水號。清單（E9）還沒有表，之後加進同一格式。
  - `POST /api/import`（免驗證，同 `POST /api/trips`）：body＝匯出檔的欄位＋`owner: { name, color }`＋選填 `name`、`startDate`、`asMember`（呼叫者是檔中哪位成員，認領其投票與花費）、`keep: { members?, expenses? }`（預設都照檔案）；建立新旅程、回 `memberToken`（同 `POST /api/trips`）＋`skipped[]`。其他成員建成沒有 token 的「待認領」成員（可經邀請連結認領）；不保留成員時花費一併略過。422：格式、版本、欄位、檔內參照不存在、預訂 details 不合該類型；413：超過 5 MB。整批寫入是一個 D1 batch（`json_each` 一張表一個語句），失敗不留半套。
- [ ] AC-8.4 — 回顧模式：照片牆、實際 vs 預估、每日回顧文字；分享可選顯示。
- [ ] AC-8.5 — ICS：Google 日曆與 Apple 行事曆匯入後時間正確（含時區）。
  - 進度（#F2b，`e8-t05`）：檔案已產生並驗證（`tests/worker/ics.test.ts`：CRLF、75 octets 摺行不切斷 UTF-8、TEXT 跳脫、UTC 時間、全天事件、穩定 UID、分享選項；本機下載的檔案以 `ical.js` 解析通過、中文標題正確）。**還沒在真的 Google 日曆與 Apple 行事曆匯入／訂閱看過**，所以不勾。
  - **API**（`worker/trips/ics.ts`）：`GET /api/trips/:id/calendar.ics`（任何成員，Bearer）＝一次性下載；`GET /api/share/:token/calendar.ics`＝**訂閱 URL**（分享 token 保護，不需要標頭，Google 日曆「從網址新增」或 Apple 的 `webcal://` 會定期重抓；`REFRESH-INTERVAL`／`X-PUBLISHED-TTL` 6 小時，實際頻率由日曆服務決定，Google 約數小時到一天）。分享版依選項：`hideAddresses` 拿掉 LOCATION／GEO、地址、訂位代號、電話；`hideMoney` 拿掉所有價格；住宿與預訂的備註一律不進分享版。事件：有時間的行程點（UTC `…Z`，有 endAt 用 DTEND，否則 durationMin → DURATION）、每天一個全天「Day N · 標題」列出沒有時間的行程點、住宿（入住日到退房日的全天區間）、預訂（航班、租車取車／還車兩個事件、渡輪、鐵路、巴士、包車、活動，描述含 details 摘要）；備案行程點與由預訂／住宿產生的行程點不重複列。`X-WR-CALNAME`、`X-WR-TIMEZONE`＝旅程時區，UID `<類別>-<id>@tripfolio`、SEQUENCE＝列的 rev。標頭 `text/calendar; charset=utf-8`、`Content-Disposition: attachment`、`Cache-Control: private, no-store`（分享版另加 `X-Robots-Tag: noindex`）。事件文字目前是英文標籤（Check-in、Ref、Price…），沒有走 i18n。

## Task 拆分

### M0

- [x] `e8-t01a` 唯讀頁基本版：獨立入口、Worker 端依 token 過濾資料、封面、每日卡（可展開）、語言切換、noindex · AC-8.1 · M · ← e2-t03, e3-t03 · #share

### M1

- [x] `e8-t01b` 唯讀頁完整版：路線總圖、必吃必買精選、費用概算、每日照片、效能預算與 Lighthouse · AC-8.1 · M · ← e8-t01a, e5-t02, e6-t02, e3-t04 · #F2a
- [ ] `e8-t02` 列印樣式與 A4 版面、每日靜態地圖、預訂總表 · AC-8.2 · M · ← e8-t01b, e4-t03
- [x] `e8-t05` ICS 匯出與訂閱 URL · AC-8.5 · S · ← e4-t03 · #F2b（後端與檔案；設定頁的下載／複製訂閱網址按鈕待前端）
- [x] `e8-t03` 匯出／匯入 JSON（與 e1-t07 的複製共用序列化） · AC-8.3 · S · ← e1-t07 · #F3a（後端；設定頁的匯出／匯入介面待前端）

### M3

- [ ] `e8-t04` 回顧模式（每日回顧文字、照片牆、實際 vs 預估）與分享切換 · AC-8.4 · M · ← e6-t04, e7-t06

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 分享頁載入慢（地圖重） | 獨立 bundle、地圖 lazy、首屏先畫封面與每日卡 |
| 隱藏金額只做在前端被看穿 | 伺服器端過濾，AC-8.1 明寫 |

## 未決問題

- [ ] **Q:** 分享頁要不要支援自訂網址（例如 `/nz-2027`）？
      **A:** _(建議不要；token 連結就好，自訂網址等於公開索引)_
