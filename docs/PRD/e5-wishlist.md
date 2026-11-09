---
title: E5 — 必吃必買與口袋名單
date: 2026-11-09
status: planned
epic: E5
owner: GeneCLee6
milestones: [M0, M1, M2]
depends_on: [E1, E3, E6]
---

## 背景

旅行社的行程頁最吸引人的部分是「必吃」「必買」「必看」：一張圖、一句話、一個價錢。對自由行來說，這也是朋友們最會貢獻內容的地方：有人丟一家餐廳、有人想買某牌奶粉。這個 epic 讓這些零散的想法有地方放、能投票、能排進日程、買到了能記帳。

## 目標

- M0：資料結構與口袋名單（給 E2 拖曳用）。
- M1：卡片牆、分組、地圖層、投票與認領。
- M2：完成即記帳。

## 非目標

- 從部落格或 Google Maps 清單自動匯入（貼連結放針就夠）。
- 評分與評論系統。

## 需求

- **項目**：類別（必吃／必買／必看／體驗）、名稱、照片（E6）、地點（E3，可無，例如「任何超市」）、預估價格與幣別、來源連結、推薦人（成員）、備註、狀態（想去／已排入／已完成／放棄）。
- **檢視**：卡片牆（圖在上、名稱、價格 chip、推薦人頭像、投票數）；依類別、地區（最近的住宿城市）、所屬日程分組；地圖層（E3）。
- **投票**：成員按「想去」，顯示誰想去；排序可依票數。
- **認領**：購物項目可填「誰買」「幫誰帶」與數量（幫家人帶伴手禮很常見）。
- **排進日程**：從卡片或口袋名單拖進某一天 → 建立行程點並保留連結；在行程點那邊勾「完成」會同步狀態。
- **一鍵記帳**：完成時可帶出 E7 的記帳表單（金額預填預估價、分攤預填「只有我」或「全員」依類別）。

## 設計方向

- `wishlistItems`（tripId、category、name、placeId、photoId、estPrice、currency、sourceUrl、recommenderId、note、status、stopId）、`wishlistVotes`（itemId、memberId）、`wishlistClaims`（itemId、buyerId、forName、qty）。
- **API 已有**（e5-t01，`#C1w`；`migrations/0004_wishlist.sql`、`worker/trips/wishlist.ts`、`shared/schema/wishlist.ts`）：成員 token；viewer 只能讀、editor 以上可寫；每次寫入都遞增旅程 `rev`。
  - `GET /api/trips/:id/wishlist?status=&category=`：未刪除的項目依 `order`，每筆帶 `votes`（現任成員 id）、`claims[]`、`place`（id、nameLocal、nameEn、lat、lng）。
  - `POST /api/trips/:id/wishlist`（新項目一律 `wish`，`order` 省略就排最後）、`PATCH`／`DELETE /api/trips/:id/wishlist/:wid`（軟刪除；已排入的行程點留著、`wishlistItemId` 清空）。
  - `POST`／`DELETE /api/trips/:id/wishlist/:wid/vote`：呼叫者自己的「想去」，重複按不會重複算。
  - `POST /api/trips/:id/wishlist/:wid/claims`、`PATCH`／`DELETE …/claims/:cid`：誰買（成員，可空）、幫誰帶（自由文字）、數量、買到了沒；目前不限類別。
  - `POST /api/trips/:id/wishlist/:wid/schedule` `{ dayId, afterStopId? }`：建立行程點（名稱、地點、預估價、備註帶過去），`stops.wishlistItemId` 與 `wishlistItems.stopId` 互指，狀態變 `scheduled`。類別對行程點類型：必吃 eat→`food`、必買 buy→`shopping`、必看 see→`sight`、體驗 experience→`other`（`shared/schema/wishlist.ts` 的 `wishlistStopType`）。
  - `POST /api/trips/:id/wishlist/:wid/unschedule`：直接刪掉那個行程點（在行程點上改過的內容一併丟掉）與相關的移動段覆寫，狀態回 `wish`。
  - 從行程點 API 刪掉行程點（`DELETE /stops/:sid`）：項目的 `stopId` 清空，`scheduled` 回 `wish`，`done` 維持 `done`。
  - 狀態規則：`wish`／`dropped` 沒有行程點；`scheduled` 一定有；`done` 可有可無。PATCH 不能直接改成 `scheduled`（走 /schedule），已排入時不能改成 `wish`／`dropped`（先 /unschedule）。
  - `GET /api/trips/:id/pocket`：口袋名單＝狀態 `wish` 的項目，加上沒有任何行程點、也沒有任何（未刪除）項目引用的地點。
  - 地點：`GET /places/:pid/refs` 多回 `wishlistItems`；`merge-into` 也會把項目的 `placeId` 改指過去（`repointed.wishlistItems`）；刪地點時項目的 `placeId` 清空。
- 卡片牆的視覺是「旅遊雜誌」：大圖、襯線標題（E10 token），這一頁是分享頁（E8）的精選區來源。

## 驗收條件

- [ ] AC-5.1 — 項目：所有欄位可編、照片與地點可選、狀態流轉正確。
- [ ] AC-5.2 — 檢視：卡片牆、依類別／地區／日程分組、地圖層。
- [ ] AC-5.3 — 投票與認領：按想去顯示誰想去、可依票數排序；購物項目可認領與填數量。
- [ ] AC-5.4 — 排進日程與記帳：拖入日程建行程點並保留連結；完成可一鍵帶出記帳表單。

## Task 拆分

### M0

- [x] `e5-t01` schema `wishlistItems`、`wishlistVotes`、`wishlistClaims`；API；口袋名單查詢 · AC-5.1 · S · ← e1-t01

### M1

- [ ] `e5-t02` 卡片牆與表單（照片、地點、價格、來源連結、推薦人、狀態） · AC-5.1, 5.2 · M · ← e6-t02, e3-t02, e5-t01
- [ ] `e5-t03` 分組（類別／地區／日程）、篩選、地圖層接線 · AC-5.2 · S · ← e5-t02, e3-t05
- [ ] `e5-t04` 投票、認領與數量、依票數排序 · AC-5.3 · S · ← e5-t02

### M2

- [ ] `e5-t05` 排進日程的狀態同步與完成一鍵記帳 · AC-5.4 · S · ← e2-t07, e7-t02

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 朋友只丟連結不填欄位 | 貼連結時自動抓標題與 og:image（Worker 代理、只抓 meta），名稱與圖就有了 |

## 未決問題

- [ ] **Q:** 要不要抓連結的 og:image 當照片？
      **A:** _(建議要，放在 e5-t02；只存縮圖到 R2、標來源)_
