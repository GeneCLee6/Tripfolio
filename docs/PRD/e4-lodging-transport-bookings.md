---
title: E4 — 住宿、交通與預訂
date: 2026-11-09
status: planned
epic: E4
owner: GeneCLee6
milestones: [M1, M2]
depends_on: [E2, E3, E6]
---

## 背景

自由行最容易出包的地方是預訂：哪一晚住哪、幾點前要退房、班機幾點、租車幾點要還、哪一筆還沒付、哪一筆過了取消期限就不能退。這些資訊通常散在十封 email 裡。這個 epic 把它們收進旅程，而且**自動長成行程點**（航班＝那天第一個行程點、住宿＝當晚）。

## 目標

- M1：住宿、航班、租車（含露營車）、渡輪／鐵路／巴士的預訂卡；確認信附件；期限清單。
- M2：預訂總覽連記帳（誰先代墊 → 一鍵成為花費）。

## 非目標

- 接訂房網站 API、比價、下訂。
- 解析 email 自動匯入（手填就好；之後可考慮貼上文字由 AI 抽欄位）。

## 需求

- **住宿**：名稱、地點（E3）、入住日／退房日（多晚一筆）、入住／退房時間、房型與人數、訂房平台、訂房代號、價格與幣別、付款狀態（未付／訂金／已付全額）、取消期限、聯絡電話、備註、附件。日程頁每一天顯示「今晚住：…」，退房那天顯示「退房 10:00」。露營車型態多一個「營地類型」（假日公園／DOC 營地／自由露營；是否有電、水、傾倒站）。
- **航班**：航空公司、班號、出發／抵達機場與航站、兩地當地時間（各自時區）、訂位代號、票價、託運行李、備註；自動建立出發日與抵達日的行程點（跨日班機兩天都有）。
- **租車／露營車**：公司、車型、取車與還車（地點、日期、時間）、保險方案與自負額、押金、里程限制、價格、訂單號；自動建立取車與還車行程點；露營車另有「自炊設備認證（self-contained）」勾選。
- **渡輪／船班／鐵路／巴士**：起訖站、時間、訂位代號、價格；船班（海島跳島）多「船公司、碼頭、天候取消政策」。
- **包車（driver）**：司機姓名、電話、通訊軟體、車型、每日費用與幣別（含不含油、停車、過路）、包車日期範圍、每日接送點與時間；自動建立每天第一個「接送」行程點；包車費可一鍵成為 E7 花費（常由公基金付）。
- **附件**：確認信 PDF 或截圖，上傳到 R2（E6 通道）、卡片內預覽；分享頁依 E1 選項隱藏。
- **期限**：取消期限、付款期限、入住 check-in 截止；旅程首頁「即將到期」區塊列出 14 天內的項目；不做推播（朋友圈進站看就好，Email 是 M3 選用）。
- **時區**：旅程預設時區是目的地；航班顯示「出發地時間 → 抵達地時間」並標時區縮寫；行程點時間一律目的地時間。
- **預訂總覽**：表格（日期、類型、項目、金額、付款狀態、誰先付）；「誰先付」填了就可一鍵建立 E7 的花費（付款人＝那個人、分攤＝全員）。

## 設計方向

- `bookings` 一張表、`type` 欄位＋`details` JSON（依 type 的 zod schema 驗證）；住宿獨立 `lodgings` 表，因為日程頁每天都要查。
- 自動建立的行程點標 `source: 'booking'`、連 `bookingId`；改預訂會同步更新行程點時間與地點；刪預訂時問要不要留下行程點。
- 時區用 `Intl.DateTimeFormat` 與 IANA 名稱，存 UTC＋時區名；不存「本地時間字串」。
- **API 已有**（e4-t01，`#D3a`；`migrations/0006_bookings.sql`、`worker/trips/lodging.ts`、`worker/trips/bookings.ts`、`shared/schema/lodging.ts`、`shared/schema/booking.ts`，回應型別在 `shared/api/bookings.ts`）：成員 token；viewer 只能讀、editor 以上可寫；每次寫入都遞增旅程 `rev`。
  - **住宿**：`GET/POST /api/trips/:id/lodgings`、`PATCH/DELETE /api/trips/:id/lodgings/:lid`（軟刪除）。已分配、日期落在 `[checkIn, checkOut)` 的每一天 `days.lodgingId` 指向它；一天只有一個住宿，後寫的蓋過前面的，回應的 `conflicts` 列出原本指向別處的 dayId，`dayIds` 列出現在連到它的日子；改日期會重連、刪除會清掉。`cancelBy` 可送 UTC，或送 `cancelByLocal`（`YYYY-MM-DDTHH:mm`，旅程時區）。`PATCH /days/:dayId` 的 `lodgingId` 必須是本旅程、未刪除的住宿。
  - **日程**：`GET /api/trips/:id/days` 每天多 `lodging`（當晚住宿；當晚沒有住宿時改放當天早上退房的那間，`isCheckoutDay: true`）與 `checkout`（當天早上退房的住宿，換住處的日子也有）；型別 `DaysWithLodgingResponse`。
  - **預訂**：`GET/POST /api/trips/:id/bookings`、`PATCH/DELETE /api/trips/:id/bookings/:bid`。`type` ∈ flight／rental／driver／ferry／rail／bus／activity，`details` 依 type 驗證（錯了 422）；PATCH 的 `details` 疊在原值上再驗證，`type` 不能改。時間送 UTC（`startAt`／`endAt`），或送當地時間（`startLocal` 以 `startTz`、預設旅程時區；`endLocal` 以 `endTz`、預設同出發）。
  - **自動行程點**（`stops.source = 'booking'`、`bookingId`、`bookingSlot`；`booking: 'booked'`；依旅程時區的當地日期放到那一天，日內依時間插入）：航班 → 出發日一個 `transport`（抵達日不同時，抵達日再一個）；租車 → 取車、還車各一個；包車 → 範圍內每天一個，時間用 `details.pickupTime`、標題是司機名；渡輪／鐵路／巴士 → 一個；活動 → 一個 `other`、地點用集合地點。改預訂會同步時間、標題、地點（只有日期變了才移到別天，不動順序），新多出的日子補上、不再適用的刪掉；使用者自己刪掉的那個不會被補回來。旅程沒有那天時回 `skippedDates`。刪預訂一併刪行程點，`?keepStops=1` 改成保留並解除連結。從行程點 API 刪掉預訂的行程點就只是刪掉它，預訂還在。
  - **期限**：`GET /api/trips/:id/deadlines?withinDays=14`（0–366）→ `[now, now + N]` 內的 `{ kind, id, title, dueAt, type, bookingType }`，依時間排序（同時間：付款、取消、入住）。cancel＝`cancelBy`；payment＝有 `cancelBy` 且未付清（免費取消期限就是全額付款期限）；checkin＝住宿 `checkIn`＋`checkInTime`（沒填用 00:00，旅程時區）、活動 `startAt − checkInMinutesBefore`。

## 驗收條件

- [x] AC-4.1 — 住宿：多晚一筆、日程頁每日顯示今晚住宿與退房時間、付款狀態與取消期限；露營車欄位。（`e2e/bookings.spec.ts` 375／1440：從 Day 1「還沒安排住宿」加兩晚假日公園＋有電 → Day 1／2 今晚住、Day 3 退房 10:00；預訂總覽顯示未付與取消期限）
- [x] AC-4.2 — 交通預訂：航班／租車／渡輪／鐵路／巴士表單、自動行程點（跨日班機兩天）、改預訂同步行程點。（表單全做了；e2e 驗了跨日班機兩天各一個行程點、包車兩天兩個、刪除時保留行程點；租車／渡輪／鐵路／巴士表單只有 `tests/src/bookings/form.test.ts` 的 body 對應，改預訂同步只有 Worker 測試——補一段「編輯租車改日期 → 行程點跟著移」的 e2e 再勾）（#H1c 補上：`e2e/bookings.spec.ts` 375／1440 編輯租車，取車／還車日期各延一天 → `pickup`／`dropoff` 行程點從 Day 1／3 移到 Day 2／4）
- [x] AC-4.3 — 附件：上傳與預覽；分享頁可隱藏。（#F1c：住宿與預訂表單的「確認信／附件」區，走 E6 通道 `kind:'document'`＋`lodgingId`／`bookingId`，`GET /attachments?bookingId=|lodgingId=` 篩選；`AttachmentList` 列出類型／大小／日期，點開以 `fetchBlob` → object URL 開新分頁，可刪除；標示「不會出現在分享頁」。文件一律 members-only、分享頁 payload 不含（`e2e/bookings.spec.ts` 375／1440：上傳 PDF → 列出 → 開啟 → `/api/share/<token>` 沒有它的 id、`?s=` 讀不到 → 刪除）
- [x] AC-4.4 — 期限：取消／付款／入住截止在首頁「即將到期」列出，排序正確。（排序由 Worker 決定、`tests/worker/bookings.test.ts`；首頁 e2e 看到住宿的付款、取消期限、入住三列與「3 天後」；`includePast` 切換「顯示已過期」）
- [x] AC-4.5 — 時區：航班兩地時間並列且正確（含跨日）；有測試。（`tests/src/bookings/form.test.ts`：SYD→AKL 跨日、TPE→AKL、NZ 夏令結束；e2e：TPE 13:00 GMT+8 → 05:00 (+1 天) GMT+13，存的 UTC 相差 11 小時）

## Task 拆分

### M1

- [x] `e4-t01` schema `lodgings`、`bookings`（type＋details zod）、與 `attachments` 關聯；API · AC-4.1, 4.2 · S · ← e1-t01 · #D3a（附件關聯留給 `e4-t04`，等 E6 的 `attachments` 表）
  - 補（#H3b）：`GET /deadlines?includePast=1` 連已過期的項目一起回（排在最前、最舊的先；只接受 0／1，其他 422）；`PATCH /api/trips/:id` 改日期後會依住宿重算 `days.lodgingId`（`relinkTripLodgings`：仍涵蓋的保留，否則取最新建立的涵蓋住宿，未分配的天清空）；`Stop` 回應多 `source`（manual／booking）與 `bookingSlot`。
- [x] `e4-t02` 住宿卡與表單、多晚範圍、日程頁帶入今晚住宿與退房、露營車欄位 · AC-4.1 · M · ← e2-t02, e3-t02, e4-t01 · #D3b／#F1a
  - `src/pages/bookings/LodgingLine.tsx`（日程標頭：今晚住＋入住時間、營地類型與設施、價格、連住第幾晚；退房日「退房 10:00」；沒有就「今晚住：— · 還沒安排住宿」，點了開 `LodgingSheet`）；`src/lib/bookings/lodging-store.ts`（一趟一次 `GET /lodgings` 補設施等欄位；存檔後重讀 `/days` 覆蓋各天的 `lodging`／`checkout`，離開日程就丟掉——日程頁自己的資料不會被通知）；衝突以 toast 告知；預訂總覽 `/trips/:id/bookings` 住宿／交通／活動三組。
- [x] `e4-t03` 交通預訂表單（航班／租車／包車／渡輪與船班／鐵路／巴士）、自動行程點與同步、時區並列與測試 · AC-4.2, 4.5 · M · ← e2-t03, e4-t01 · #D3b／#F1a
  - `BookingSheet`（lazy；先選類型再依 type 給欄位；航班出發／抵達各自時區 Select、預設旅程時區，其他 type 用旅程時區；前端算好 UTC＋`startTz`／`endTz` 送出；`bookingCreateSchema` 驗證）；存檔 toast 列出建立的行程點（`stops[].slot`）與 `skippedDates`；刪除問「保留自動建立的行程點？」→ `?keepStops=1`；「誰先付」只顯示、一鍵記帳按鈕停用等 e4-t06；金額在有匯率時附主幣別約值。
- [x] `e4-t04` 附件上傳與預覽（走 E6 通道）、分享頁隱藏 · AC-4.3 · S · ← e6-t01, e4-t02 · #F1c（附件沒有存檔名，列表以「PDF 文件 N／圖片 N」稱呼；要檔名得加欄位）
- [x] `e4-t05` 期限清單與首頁「即將到期」 · AC-4.4 · S · ← e4-t02, e4-t03 · #D3b／#F1a
  - `DeadlinesBlock`：`/deadlines?withinDays=14`、「顯示已過期」加 `includePast=1`；每列類型圖示、取消期限／付款／入住 chip、`Intl.RelativeTimeFormat` 的「3 天後」／「已過 2 天」，點了到預訂總覽。

### M2

- [x] `e4-t06` 預訂總覽表與「誰先付 → 建立花費」 · AC-4.1 · S · ← e7-t02, e4-t03 · #H1c（每列「誰先付 → 記帳」：選成員或公基金 → 記一筆表單預填金額／幣別、類別（住宿 lodging、航班租車包車渡輪鐵路巴士 transport、活動 tickets）、說明＝標題、日期＝入住日或出發當地日、`bookingId`；住宿沒有自己的欄位，`bookingId` 放住宿 id。`GET /expenses` 沒有 bookingId 篩選，「已記帳」由前端從清單判斷。e2e 375／1440）

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 欄位太多沒人想填 | 表單只有名稱＋日期必填，其他摺疊在「更多」；貼上確認信文字之後可考慮 AI 抽欄位（未排程） |
| 時區算錯 | 全部 UTC＋IANA；測試涵蓋跨日、夏令時間（紐西蘭 9 月底～4 月初是 NZDT） |

## 未決問題

- [ ] **Q:** 期限要不要 Email 提醒？
      **A:** _(建議 M3 再看；需要寄信服務與 Email 收集，先用「進站看」)_
