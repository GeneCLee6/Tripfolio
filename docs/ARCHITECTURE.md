# ARCHITECTURE — 技術架構（規劃版，2026-11-09）

這份在 A1 之後會隨實作更新；現在是設計方向。原則：**能沿用淡江牌桌、LongTalk、TKU Arcade 的就沿用**（repo 骨架、CI、Worker 路由、D1 遷移、R2 備份、DO 的 WebSocket 與 patch）。新東西有四個：**地圖與外部 API 代理**、**照片管線（瀏覽器縮圖＋R2 直傳）**、**分帳引擎（整數分）**、**離線優先（PWA＋IndexedDB 佇列＋離線瓦片）**。

## 1. 總覽

```
瀏覽器（React 19 + TS + styled-components + Vite；PWA）
  ├─ app（/）            ─ 旅程清單、日程、地圖、清單、記帳、設定；useTrip() 本機快取＋離線佇列
  ├─ share（/s/<token>） ─ 獨立輕量入口：唯讀總覽頁、列印版、語言切換；不載編輯器
  ├─ MapLibre GL JS      ─ 獨立 chunk、lazy；OpenFreeMap 向量瓦片；離線時由 Service Worker 供瓦片
  └─ Service Worker      ─ app shell、最近 3 個旅程資料、旅程外框瓦片、離線佇列重送
            │ /api/*、/ws/trips/<id>
Cloudflare Worker（單一，帶靜態資產）
  ├─ auth          ─ memberToken／inviteToken／shareToken 驗證、角色中介層；Google OAuth（M2）
  ├─ trips/*       ─ 旅程、成員、日程、行程點、地點、住宿、預訂、清單、花費、附件 的 REST
  ├─ share         ─ 依 shareToken 與隱藏選項在伺服器端過濾後回傳唯讀資料
  ├─ proxy/*       ─ 外部 API 代理：geocode（Photon→Nominatim）、route（ORS）、fx（匯率）、og（連結預覽）
  │                  每個有快取鍵、TTL、速率、apiUsage 計數
  ├─ media         ─ R2 直傳 URL 簽發、公開照片讀取（長快取）、文件驗權讀取（no-store）
  ├─ TripDO        ─ 每旅程一個：WebSocket、patch 廣播、rev、短期緩衝（D1 仍是真相）
  ├─ D1            ─ 全部結構化資料（見 §3）
  ├─ R2            ─ media（照片 2048/400、文件、收據）、backups（D1 每日匯出）
  └─ cron          ─ D1 備份、apiUsage 日結、刪除逾 30 天的軟刪旅程與 R2 物件
外部：OpenFreeMap（瓦片）、Photon／Nominatim（搜尋）、OpenRouteService（路線）、open.er-api.com（匯率）、Google OAuth（M2 選用）
```

## 2. 資料夾（預定）

```
shared/                 前後端共用、純 TS、可在 Node 測
  protocol.ts           TripDO 協定（hello／snapshot／patch／ack／error）
  patch.ts              欄位級 patch 與合併（移植 LongTalk 的 diff，改成實體＋欄位）
  money/
    split.ts            split(expense) → shares[]（整數分、餘數規則）
    balances.ts         balances(expenses, pool, settlements) → 每人餘額
    settle.ts           最少轉帳建議（貪婪）
    fx.ts               匯率換算與四捨五入規則
  time/
    sun.ts              日出日落（NOAA 公式）
    tz.ts               時區工具（UTC＋IANA）
  itinerary/
    legs.ts             由相鄰 stops 推導移動段、每日合計、上限警示
    checks.ts           營業時間、預訂重疊、日落檢查
  schema/               zod：trip、member、day、stop、place、lodging、booking（依 type）、wishlist、expense、attachment
  templates/            清單範本 JSON（通用、自駕、露營車、城市、跳島、冬季）、目的地筆記（nz.json）；雙語
  i18n/                 zh-TW.ts（來源）、en.ts、t.ts
worker/
  index.ts              路由、靜態資產、/api、/ws、/s
  auth.ts               token 雜湊與驗證、角色中介層、Google OAuth
  trips/*.ts            各實體的 REST handler
  share.ts              伺服器端過濾
  proxy/geocode.ts      Photon→Nominatim，快取 7 天，每成員 30 次／分
  proxy/route.ts        ORS，快取永久（同起訖同方式），每旅程 300 次／日；直線後備
  proxy/fx.ts           匯率，每日一次拉全表存 fxRates
  proxy/og.ts           連結 og:title／og:image，只抓 meta
  media.ts              R2 直傳簽發、讀取
  trip-do.ts            TripDO
  backup.ts、cleanup.ts cron
src/
  app/                  路由、殼、底部導覽、三欄版面
  pages/                Trips、TripHome（今日卡）、Itinerary、Map、Wishlist、Bookings、Expenses、Balances、Stats、Checklists、Documents、Photos、Settings、Share
  components/           基礎元件（E10）
  map/                  MapLibre 封裝、圖層、圖示、靜態匯出
  lib/useTrip.ts        本機快取（IndexedDB）、patch 套用、離線佇列、WebSocket
  lib/upload.ts         縮圖、EXIF、直傳
  styles/tokens.ts
share/                  分享頁入口（獨立 bundle）
sw/                     Service Worker（Workbox 或手寫）：shell、資料、瓦片、佇列
```

## 3. 資料模型（D1）

| 表 | 主要欄位 | 備註 |
| --- | --- | --- |
| `trips` | id、name、destination、centerLat／Lng、startDate、endDate、tz、baseCurrency、localCurrencies、coverAttachmentId、coverColor、style、ownerMemberId、archivedAt、deletedAt | style ∈ roadtrip／campervan／private-driver／city／island／rail／other（A3b 實作；`shared/itinerary` 的 `TripStyle` 另收 self-drive、winter 當別名，對應上限同 roadtrip）；另有 secondaryCurrency（預設 TWD）、rev、driveLimitMin |
| `members` | id、tripId、name、color、email?、role、userId? | role ∈ owner／editor／viewer |
| `memberTokens`、`invites`、`shares` | tokenHash、tripId、memberId?、options JSON、revokedAt | token 128-bit，只存 SHA-256 |
| `days` | id、tripId、date、idx、title、color、note、lodgingId? | |
| `stops` | id、dayId、order（REAL）、type、placeId?、startAt?、endAt?、durationMin?、costMinor?、currency?、booking、note、links JSON、wishlistItemId?、bookingId?、isBackup、rev | |
| `legOverrides` | fromStopId、toStopId、mode、minutes? | |
| `places` | id、tripId、nameLocal、nameEn、lat、lng、address、category、source、hours JSON、links JSON | 被 stops／lodgings／wishlist 引用 |
| `lodgings` | id、tripId、placeId、name、checkIn、checkOut、checkInTime、checkOutTime、platform、ref、priceMinor、currency、payStatus、cancelBy、phone、campType?、note | |
| `bookings` | id、tripId、type、details JSON、priceMinor、currency、payStatus、payerMemberId?、cancelBy | type ∈ flight／rental／ferry／rail／bus／activity |
| `wishlistItems`、`wishlistVotes`、`wishlistClaims` | 見 E5 | |
| `attachments` | id、tripId、kind、r2Key、thumbKey、w、h、takenAt、lat、lng、placeId、stopId、dayId、bookingId、uploaderId、bytes、visibility | kind ∈ photo／document／receipt |
| `expenses`、`expenseShares`、`poolContributions`、`settlements`、`expenseHistory`、`fxRates` | 見 E7 | 金額一律 INTEGER（分） |
| `budgets`、`checklists`、`checklistItems`、`notes` | 見 E9 | |
| `apiUsage` | date、provider、count | 配額計數 |
| `routeCache` | key（from、to、mode）、distanceM、durationS、geometry | 永久 |

## 4. 關鍵機制

### 4.1 身分與權限

- 三種 token 都是 `crypto.getRandomValues` 16 bytes → base64url；D1 存 SHA-256；比對用常數時間。
- `memberToken` 綁（trip、member），放 localStorage；每個 `/api/trips/:id/*` 要求 `Authorization: Bearer <memberToken>`；中介層查出 member 與 role。
- `shareToken` 只能打 `/api/share/:token`，回傳**已過濾**的唯讀 JSON。
- Google 登入（M2）：Worker 端 code flow，`users` 表，session cookie HttpOnly；登入只用來「列出我的旅程」與「綁成員」，不取代 memberToken。

### 4.2 同步與離線

- `useTrip(tripId)`：IndexedDB 存旅程全部實體（一趟旅程幾千筆以內）；UI 讀本機；寫入先改本機再送 patch；未送出的 patch 在佇列，連線後依序送；伺服器回 `ack(rev)` 或 `conflict(entity, field, serverValue)`，欄位級「後寫的贏」，衝突時以伺服器為準並 toast。
- `TripDO`：收到 REST 寫入或 WebSocket patch → 寫 D1 → 廣播給其他連線；`rev` 每旅程遞增；重連帶 `sinceRev` 補差，差太多就全量 snapshot。
- Service Worker：app shell（precache）、`/api/trips/:id/*` 的 GET 用 stale-while-revalidate 存最近 3 個旅程、瓦片 cache-first（旅程外框、zoom 5–12、上限 150 MB）、Background Sync 不依賴（Safari 沒有），用 app 開啟時重送。

### 4.3 錢

- 全部整數分；`split()` 的餘數規則：先每人 floor，剩的分從付款人開始依成員順序各加 1 分（付款人不在分攤名單時從第一位開始）；說明頁與 `SPLIT-RULES.md` 寫同一段話。
- 匯率：`fxRates(date, base=TWD, quote)`；每筆存 `fxRate`（quote→base，6 位小數）與 `baseMinor`；手動覆寫只改該筆或批次改同幣別未結清的。
- 結算：`settle(balances)` 貪婪法，複雜度 O(n log n)，n ≤ 20。

### 4.4 照片

- 瀏覽器：`createImageBitmap(file, { resizeWidth })` → canvas → `toBlob('image/webp', 0.82)`；EXIF 用小型 parser 只讀 `DateTimeOriginal` 與 GPS；輸出不含 EXIF。
- 直傳：Worker 簽 R2 presigned PUT（5 分鐘、限 content-type 與大小）；完成後 `POST /attachments` 登記。
- 讀取：`photo` 經 Worker `/media/<key>` 帶 `Cache-Control: public, max-age=31536000, immutable`（key 含 uuid）；`document`／`receipt` 走 `/files/<id>` 驗 memberToken、`private, no-store`。

### 4.5 地圖

- MapLibre style 以 OpenFreeMap `liberty` 為底，覆寫配色（紙感底、低對比路網）；style JSON 放 repo（`src/map/style.ts`），瓦片 URL 是設定值。
- 圖示用 SVG sprite（程式產生），日色 10 色；叢集用 MapLibre 原生 `cluster`。
- 路線 geometry 存 `routeCache`，前端畫 `LineString`。

## 5. 外部服務與切換步驟

| 用途 | 首選 | 條件 | 後備 | 切換 |
| --- | --- | --- | --- | --- |
| 底圖瓦片 | OpenFreeMap（免費、無金鑰、公平使用） | 不保證 SLA | Protomaps pmtiles 自託管在 R2（一個國家約 1–3 GB），或 MapTiler 免費層（需金鑰、10 萬次／月） | 改 `MAP_TILES_URL`；pmtiles 要加 protocol 外掛 |
| 地點搜尋 | Photon（komoot，免費、多語） | 公平使用 | Nominatim（1 req/s、要 UA）；Google Places（付費，不打算用） | `proxy/geocode.ts` 的 provider 陣列順序 |
| 路線 | OpenRouteService（免費 2,000 次／日，要金鑰） | 配額 | 直線距離 × 係數（自駕 1.3、步行 1.2）並標「估」；OSRM 公開 demo 僅開發用 | `ROUTE_PROVIDER`；快取永久所以同一趟只算一次 |
| 匯率 | open.er-api.com（免費、含 TWD、每日） | 無金鑰、每日 1 次 | 手動輸入；旅程預設匯率 | `proxy/fx.ts` |
| 連結預覽 | 自己抓 og meta | 對方網站允許 | 不抓，只存連結 | — |
| 登入 | Google OAuth | 需 client id | 不登入（邀請連結模式） | — |

所有 provider 的呼叫都寫進 `apiUsage`，用量頁（E11）顯示今日用量與配額百分比。

## 6. 預算（bundle）

| 入口 | 上限（gzip） | 說明 |
| --- | --- | --- |
| app 首屏 | 180 kB | 不含 MapLibre 與各頁 lazy chunk |
| share 首屏 | 120 kB | 封面與每日卡先畫；地圖 lazy |
| MapLibre chunk | 250 kB | 兩個入口共用 |
| 單頁 chunk | 60 kB | 日程、記帳、相簿各自 lazy |

## 7. 測試

- 純函式（`shared/`）：Vitest，覆蓋分帳、匯率、日出日落、時區、移動段、檢查、patch 合併。
- Worker：`unstable_dev` 跑 REST 與權限（哪個 token 能打哪個路由）、分享過濾。
- 前端：Playwright：日程拖曳（滑鼠與鍵盤）、記一筆 10 秒、分享頁 Lighthouse、axe；離線與同步在 PR 預覽用兩個瀏覽器 context 實測並記錄在 PR。
