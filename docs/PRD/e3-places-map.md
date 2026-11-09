---
title: E3 — 地點與地圖
date: 2026-11-09
status: planned
epic: E3
owner: GeneCLee6
milestones: [M0, M1, M2]
depends_on: [E10, E11]
---

## 背景

旅行規劃沒有地圖就是一張 Excel。這個 epic 負責：找地點、放針、畫每天的路線、把所有東西（行程點、住宿、必吃必買）放在同一張地圖上看，以及露營車在沒有訊號的地方也能看到地圖。全部用免費、不用信用卡的服務：MapLibre GL JS（底圖渲染）＋ OpenFreeMap（向量瓦片）＋ Photon／Nominatim（地點搜尋）＋ OpenRouteService（路線，擁有者的免費金鑰放 Worker）。

## 目標

- M0：搜尋地點、放針、看地圖、每日路線與移動時間。
- M1：圖層開關、地點庫。
- M2：離線瓦片。

## 非目標

- 自建瓦片伺服器、自建路線引擎。
- 即時導航（開車時用 Google Maps／Apple Maps；我們提供「用 Google Maps 開啟」按鈕）。
- 大眾運輸時刻表（交通方式「大眾運輸」只用直線估時）。

## 需求

- **地點搜尋**：輸入名稱（多語）→ 候選列表（名稱、類別、地址、距離旅程中心）；貼 Google Maps 分享連結或 `lat, lng` 直接解析成座標；地圖上長按手動放針；地點存名稱（當地語＋英文，缺就同一個）、座標、地址、類別、來源、營業時間（手填或來源帶入）、外部連結（官網、Google Maps）。
- **地圖**：MapLibre；全程／單日切換；行程點依類型圖示、依日期上色、編號依當日順序；點擊看卡片（名稱、時間、一句備註、「排進這天」或「開地圖 App」）；多點叢集；手機全螢幕與「回到我的位置」。
- **路線**：單日路線依交通方式向 Worker 要路線（`/api/route`），畫線並回傳距離與時間給 E2；全程檢視只畫每晚住宿之間的連線（過夜地連線，依日色）；結果快取 D1；配額耗盡用直線估算並標示。
- **圖層**：日程／口袋名單／住宿／必吃必買／加油與補給，各自開關；地點庫頁列出旅程所有地點，可找出重複並合併。
- **離線**：使用者按「下載離線地圖」時，依旅程所有地點的外框（加 20 km）快取 zoom 5–12 的瓦片（上限 150 MB，顯示大小）與路線 JSON；離線時地圖可看、可定位、不可搜尋。

## 設計方向

- 所有外部 API 都經 Worker 代理：加 `User-Agent`、快取、速率限制、金鑰不落前端。Photon 優先（快、多語），Nominatim 後備（1 req/s 限制要遵守）。
- `places` 是被引用的獨立實體：行程點、住宿、必吃必買、文件都用 `placeId` 參照；同一個地點改名一次到處生效。
- 地圖 style：OpenFreeMap 的 `liberty` 為底，調成本專案的配色（淡色底、路網低對比），讓針與路線跳出來。
- 日色：每日一色，從 E10 的 10 色循環；針上的編號是當日順序。
- 靜態地圖（E8 列印用）由同一個 MapLibre canvas 匯出 PNG。
- **API 已有**（#A3b，`worker/trips/places.ts`）：`GET/POST /api/trips/:id/places`、`PATCH/DELETE /api/trips/:id/places/:pid`（刪除時引用它的 stops 改為無地點）、`GET /api/trips/:id/places/:pid/refs`（目前只有 stops；住宿、口袋名單之後加）、`POST /api/trips/:id/places/:pid/merge-into/:targetId`（改指向後刪除重複的那筆，回 `repointed`）。
- **API 已有**（#proxy，`worker/proxy/*`，型別在 `shared/api/geo.ts`；任何成員角色皆可呼叫，用量頁限擁有者）：
  - `GET /api/trips/:id/geo/search?q=&lat=&lng=&lang=`：Photon 優先、失敗或查無結果改 Nominatim（帶 `User-Agent`／`Referer`，經 D1 `providerThrottle` 全域限 1 次／秒）；回 `{ results: GeoResult[], source, cached }`，`GeoResult` 為 `nameLocal、nameEn、lat、lng、address、category、source、externalId`，類別對到 `sight／food／shopping／lodging／transport／fuel／supplies／nature／other`。Photon 公開站只接受 en／de／fr，其他語言送 `default`（當地名稱），此時 `nameEn` 為空字串。
  - `POST /api/trips/:id/geo/parse` `{ text }`：解析 `lat, lng`、Google Maps 長網址（`!3d…!4d…`、`/@lat,lng,`、`?q=lat,lng`）與 `maps.app.goo.gl` 短網址（Worker 端跟轉址，最多 2 跳、共 3 秒、只跟到 Google 網域）；回 `{ lat, lng, name?, source: 'coords'|'link' }`，找不到座標回 422 `no_coordinates`。
  - `POST /api/trips/:id/geo/route` `{ from, to, mode: drive|walk|cycle }` → `{ distanceM, durationS, geometry（GeoJSON LineString，≤ 200 點）, source: 'ors'|'estimate', cached, fallbackReason? }`；`POST /api/trips/:id/geo/routes` `{ legs }`（最多 30 段，依序回 `{ routes }`，重複段只算一次）。沒有金鑰、配額用完、ORS 回 429／403 或失敗時，回 `estimateLeg` 與直線（`source: 'estimate'`，前端標「估」）。露營車送 `drive`；大眾運輸／飛機／渡輪由前端直接 `estimateLeg`。
  - `GET /api/trips/:id/geo/usage`（擁有者）：今日（UTC）本旅程與全部旅程的 photon／nominatim／ors 呼叫數與限制值。
  - 快取與計數（`migrations/0003_proxy.sql`）：`geoCache`（provider＋語言＋正規化查詢＋偏好座標取 0.1°，7 天）、`routeCache`（方式＋起訖座標取 5 位小數，永久，只存 ORS 結果）、`apiUsage(date, provider, tripId, count)`（只算實際呼叫，快取命中不算）、`rateLimits`（每成員搜尋＋解析 30 次／分，固定一分鐘窗，盡力而為，e11-t04 再強化）、`providerThrottle`。
  - 限制：ORS 每旅程每日 300 次、全部旅程每日 2,000 次（免費金鑰的配額）；429 後該 isolate 暫停 ORS 1 分鐘、403 暫停 10 分鐘。超過速率回 429 `rate_limited`（`details.retryAfterS`＋`Retry-After` 標頭）。
  - Provider 網址是 `wrangler.jsonc` 的 vars（`PHOTON_URL`、`NOMINATIM_URL`、`ORS_URL`，正式與 preview 各一份）；ORS 金鑰是 secret：`npx wrangler secret put ORS_API_KEY`（preview 再加 `--env preview`），沒設定時所有路線都是估算。

## 驗收條件

- [ ] AC-3.1 — 地點搜尋：名稱搜尋、Google Maps 連結與座標解析、手動放針三種方式都能建立地點（含中英名、座標、地址、類別）。
  - 進度（#B1）：名稱搜尋（Playwright 以 mock 的 `/geo/search` 驗證，結果建立 `places` 並以 OSM 連結去重）與貼座標／連結（真的 `/geo/parse`）都能建立地點。**未勾**：「手動放針」目前只交出 `{ manual: true }` 回呼，地圖長按放針在 B2 接上後再勾。
- [ ] AC-3.2 — 地圖：全程／單日切換、類型圖示與日色、點卡、叢集、手機全螢幕；地圖頁 JS gzip ≤ 300 kB（MapLibre 獨立 chunk；2026-11-09 由 250 調高，安全版本優先）。
  - **#map 驗證（元件層，`/dev/ui` 的「地圖」區，Playwright chromium）**：OpenFreeMap style 與瓦片請求皆 200；全程檢視顯示叢集（數字圈）與依日色虛線的過夜連線；切到 Day 8 會重新框到皇后鎮、日色編號針與路線；點畫布上的針與鍵盤（隱藏清單＋Enter）都會開點卡（名稱、Day／第幾站、類型、座標與時間、「排進這天」「用 Google Maps 開啟」），Esc 關閉；全螢幕在 1280 與 375 px（手機模擬）都鋪滿視窗；深色主題底圖與針環即時換色。
  - **尚未達成、所以不勾**：MapLibre chunk 實測 **287.7 kB gzip > 250 kB**（maplibre-gl 6.16.0 主執行緒 ESM；另有 worker 檔 ≈147 kB gzip 以資產載入，預算腳本不計）；5.x 較小但有 critical XSS 公告（GHSA-jrc7-96c5-q579，≤ 6.4.0），不能用。要調預算上限或接受差額，待擁有者決定。另外地圖頁本身（e2-t05／B1）尚未接上元件，全程／單日切換的頁面版與實機手機也還沒驗。
  - **#B2m 地圖頁實測（2026-11-09）**：`/trips/:id/map` 接上 `LazyTripMap` 後 `npm run budget` 第一次量到 `maplibre` chunk：**287.7 kB／300 kB gzip（通過）**；地圖頁自己的 chunk 另有 `MapPage` 10.1 kB、`TripMap` 5.7 kB gzip（vite 報表），app 首屏 121.6 kB／180 不受影響（地圖全部 lazy）。全程／單日切換、Day 重新框景、點卡、手機（375 px 填滿頂欄與底部導覽之間）與桌機（1440 px 中欄）都在 Playwright 看過；實體手機仍未測，所以這條還不勾。
- [x] AC-3.3 — 路線：單日路線線與全程過夜連線；路線快取命中不再打外部 API；配額耗盡有直線後備並標示。
  - **#proxy＋#B2m 驗證**：伺服器端 `routeCache`（D1，永久）與 `estimateLeg` 後備見 #proxy 的 worker 測試；地圖頁（`e2e/map.spec.ts`，375／1440 px，`page.route` 模擬 `/geo/routes` 回一段 ORS 與一段估算）：全程只畫過夜連線（`tf-lines` 只有 `overnight`）、不送路線請求；Day 1 畫出一條實線（ORS）與一條點線（估算），左上出現「估 · 直線估算」；切 Day 2 再切回 Day 1 **不再發請求**（前端 session 快取，鍵同 Worker：方式＋起訖 5 位小數）；請求失敗或 429 時以直線點線估算並跳非阻斷提示。過夜連線目前以「當天最後一個行程點 → 隔天第一個行程點」代替住宿（E4 之後改用住宿）。
- [ ] AC-3.4 — 圖層與地點庫：五個圖層可開關；地點庫可合併重複。
- [ ] AC-3.5 — 離線：關掉網路後能開啟最近旅程的地圖、看到所有針與路線（實體手機實測）。

## Task 拆分

### M0

- [x] `e3-t01` schema `places`（nameLocal、nameEn、lat、lng、address、category、source、hours JSON、links）與引用；`/api/places` · AC-3.1, 3.4 · S · ← e1-t01 · #A3b
  - 補（#H3b，0008）：`places.externalId`（搜尋結果的 `osm:N…`）；`POST /places` 帶已存在的 externalId 時回 **200** 與既有地點（`existing: true`，rev 不變），新建才 201，前端可不再用 OSM 連結比對。`GET /places/:pid/refs` 多回 `lodgings`（id、name、checkIn）與 `bookings`（id、title、type、`fields`＝指到它的 details 欄位）；刪除／合併地點也處理 `lodgings.placeId`、`attachments.placeId`、`bookings.details` 的 `pickupPlaceId`／`dropoffPlaceId`／`meetingPlaceId`（刪除時移除該鍵）；合併的 `repointed` 多 `lodgings`、`attachments`、`bookings`，目標地點沒有 externalId 時繼承重複者的。

- [ ] `e3-t02` 地點搜尋元件：Worker 代理 Photon／Nominatim（快取、速率、UA）、Google Maps 連結與座標解析、手動放針 · AC-3.1 · M · ← e3-t01 · 後端部分完成（#proxy）
- [x] `e3-t03` 地圖元件：MapLibre＋OpenFreeMap style 客製、類型圖示、日色、叢集、點卡、手機全螢幕、獨立 chunk · AC-3.2 · M · ← e10-t01 · #map（元件與 `/dev/ui` 展示；真正的地圖頁由 `e2-t05`／B1 接上）
- [x] `e3-t04` 路線服務：Worker 代理 OpenRouteService（自駕／步行／單車）、D1 快取、直線後備；每日線與全程過夜連線 · AC-3.3 · M · ← e3-t03 · #proxy（後端）＋ #B2m（前端：`src/lib/map/`、`src/pages/map/MapPage.tsx`；路線一次 `POST /geo/routes` ≤ 30 段、略過 50 m 以下與雨天備案、session 記憶體快取；大眾運輸／飛機／渡輪／其他畫直線點線＝估算）

### M1

- [ ] `e3-t05` 圖層面板與地點庫頁（列表、搜尋、重複合併） · AC-3.4 · S · ← e3-t03, e5-t01, e4-t01 · 圖層面板完成（#B2m：五個開關，沒有資料的圖層停用並說明；口袋名單＝沒被行程點引用的地點，長按／右鍵放針會加進來；加油補給＝類型 fuel／supplies 的行程點；住宿與必吃必買等 E4／E5）；**地點庫頁（列表、搜尋、合併）未做**，所以不勾

### M2

- [ ] `e3-t06` 離線瓦片：Service Worker 依旅程外框快取 zoom 5–12（上限 150 MB）、路線 JSON；下載進度與清除 · AC-3.5 · M · ← e10-t05

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| OpenFreeMap 或 Photon 停止服務／改條款 | style 與 provider 都是設定值；後備 Protomaps（自託管 pmtiles 在 R2）與 Nominatim；在 `ARCHITECTURE.md` §5 留切換步驟 |
| 離線瓦片太大 | 限 zoom 12、限 150 MB、只快取旅程外框；超過就提示縮小範圍 |
| 地點名稱在紐西蘭是英文、在日本是日文，英文介面看不懂 | `nameLocal` 與 `nameEn` 都存；介面語言切英文時顯示 `nameEn`，沒有就顯示 `nameLocal` |

## 未決問題

- [ ] **Q:** 路線服務用 OpenRouteService（免費 2,000 次／日，要註冊金鑰）還是 OSRM 公開 demo（不保證可用、不可商用）？
      **A:** _(建議 ORS；金鑰是擁有者的，放 Worker secret；見總 PRD Q3)_
