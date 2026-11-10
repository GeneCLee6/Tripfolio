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
  protocol.ts           TripDO 協定（hello／resync／patch／ack／ping／pong／error、close code）
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
  trip-do.ts            TripDO（WebSocket、事件緩衝、廣播）
  sync.ts               notifyTrip（寫入後通知 TripDO）、GET /ws/trips/:id 驗證與轉交
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
- `TripDO`（e2-t08a 已做）：每旅程一個（`idFromName(tripId)`），**只廣播、不寫 D1**。流程：REST 寫入 → D1 batch（`writeWithRev` 把 `trips.rev` +1）→ handler 呼叫 `notifyTrip(env, tripId, change)`（`worker/sync.ts`，走 binding 的 RPC `notify()`，在請求的 `waitUntil` 裡跑；DO 失敗只記 log、不讓寫入失敗；`rev` 沒變的空 PATCH 不通知）→ DO 存進緩衝、廣播給已 hello 的連線。下面是實際協定（`shared/protocol.ts`）。
  - **連線**：`GET /ws/trips/:id`，memberToken 放第二個 subprotocol（`new WebSocket(url, ['tripfolio', token])`，伺服器回 `tripfolio`）或 `?token=`。Worker 驗 token（同 `authTrip` 的雜湊比對），再把 upgrade 轉給 DO，帶 `x-member-id`／`x-role`／`x-read-only` 標頭（token 不往下傳）。已封存、已軟刪除的旅程與 viewer 仍可連（`readOnly: true`，e2-t08b 寫入時用）。拒絕時先接受再關閉，讓瀏覽器拿得到 close code：`4401` token 無效／成員被移除（DO 收到 `member` 的 delete 事件會關掉該成員的連線）、`4404` 旅程已不存在、`4429` 超過每旅程 50 條連線、`4408` 心跳逾時。前兩個是終局，client 不重連；其他照退避重連。
  - **事件**：`{ rev, entity, id, action: 'upsert'|'delete', byMemberId, at }`，**不帶整列資料**，client 收到後自己重抓需要的東西（e2-t08b 再加欄位級 patch）。`entity` 是 `trip／day／stop／legOverride／place／member／lodging／booking／wishlist／expense／pool／settlement／share`；`legOverride` 的 id 是 `from:to`，`expense` 的 `'*'` 表示整批（套用匯率）、`'fx'` 表示匯率覆寫，`pool` 的 `'settings'` 是公基金設定；wishlist 的投票、認領都報 `wishlist` 該項。排入／移出日程一次報兩筆（wishlist＋stop，同一個 rev）。目前**不通知**：建立旅程、邀請、分享連結、附件／照片（`media.ts`）、匯入／複製／還原旅程——這些不經 `worker/trips/*` 的一般寫入或沒有人在線上，e2-t08b 視需要補。
  - **緩衝**：DO storage 存最近 200 筆事件（依 rev 排序；同 rev 可多筆；重複的同一變更忽略），加一個 `floor`：rev ≤ floor 的事件可能不在緩衝裡（被擠掉的最大 rev；第一次收到事件時設為該 rev − 1）。休眠或被逐出後從 storage 讀回。
  - **補差**：連上後 client 送 `hello { sinceRev }`（`revStore` 記的最後 rev；沒有就 `null`）。`sinceRev < floor` → 回 `resync { rev }`，client 全部重抓；否則回 `hello { memberId, readOnly, rev, events }`，`events` 是 rev > sinceRev 的緩衝事件（`sinceRev` 為 `null` 則空）。之後即時收到 `patch { events }`。只有 hello 過的連線收得到廣播。rev 不連號是正常的（沒通知的寫入也會 +1）。已知縫隙：兩個並行寫入的通知順序顛倒、且 client 剛好在兩者之間斷線，較小的那筆可能補不到；e2-t08b 的全量重抓（開頁、resync）會蓋過。
  - **心跳**：client 每 30 秒送 `{"type":"ping"}`，DO 用 `setWebSocketAutoResponse` 回 `{"type":"pong"}`（不喚醒）；DO 有連線時每 30 秒一個 alarm，65 秒（兩次沒 ping）沒聲音的連線用 4408 關掉。client 兩次 ping 沒任何回應也自己斷線重連。
  - **前端**（`src/lib/sync/`，尚未接到頁面）：`TripSocket`（退避 1、2、4、8、15、30 秒，之後每 30 秒；嘗試 10 秒沒 hello 算失敗；`online`／回到前景立刻重試；事件 `event`／`resync`／`status: connecting|online|offline`／`welcome`／`closed`）、`revStore`（每旅程最後看到的 rev，localStorage，只會往前）、`useTripSync(tripId, handler)` hook。頁面抓資料後應把回應的 `rev` 記進 `revStore`（e2-t08b）。
  - 實測（本機 dev，兩個成員）：A 的 `POST /stops` 到 B 的 socket 收到事件 32–38 ms（Node client，含 POST 來回）、44–48 ms（兩個 Chromium context）；B 斷線期間的兩筆寫入在重連的 hello 裡補回。
- e2-t08b 要做：`useTrip()` 本機快取（IndexedDB）、寫入先改本機、離線佇列與重送、欄位級「後寫的贏」（`ack`／`conflict`）、可能改成經 socket 寫入；把 itinerary 接上 `useTripSync`；兩台裝置實測後才勾 AC-2.6。
- Service Worker：app shell（precache）、`/api/trips/:id/*` 的 GET 用 stale-while-revalidate 存最近 3 個旅程、瓦片 cache-first（旅程外框、zoom 5–12、上限 150 MB）、Background Sync 不依賴（Safari 沒有），用 app 開啟時重送。

### 4.3 錢

- 全部整數分；`split()` 的餘數規則：先每人 floor，剩的分從付款人開始依成員順序各加 1 分（付款人不在分攤名單時從第一位開始）；說明頁與 `SPLIT-RULES.md` 寫同一段話。
- 匯率：`fxRates(date, base=TWD, quote)`；每筆存 `fxRate`（quote→base，6 位小數）與 `baseMinor`；手動覆寫只改該筆或批次改同幣別未結清的。
- 結算：`settle(balances)` 貪婪法，複雜度 O(n log n)，n ≤ 20。

### 4.4 照片（e6-t01 實作版，2026-11-09）

- 瀏覽器（`src/lib/upload/`）：`exif.ts` 小型 parser 只讀 `DateTimeOriginal` 與 GPS（可關閉）；`resize.ts` `createImageBitmap` → canvas → WebP 0.82（不支援時 JPEG），長邊 2048 ＋ 400 縮圖，重新編碼即去掉 EXIF；`upload.ts` 串起 sign → PUT（XHR 進度、重試 3 次退避）→ complete，`uploadQueue` 併發 3。
- **上傳走 Worker 代理，不用 presigned PUT**：免費方案沒有另外設 R2 S3 金鑰；代理讓驗權、型別、大小檢查集中一處；照片 ≤ 8 MB 成本可接受；同源所以不需要 R2 CORS。流程：`POST /api/trips/:id/attachments/sign`（建 `pending` 列、回 `uploadUrl`／`thumbUploadUrl`、15 分鐘內要完成）→ `PUT …/attachments/:aid/content`（Content-Length 必須等於宣告 bytes、Content-Type 相符、超過上限 413）→ `PUT …/thumb` → `POST …/complete`（head 確認物件存在、轉 `ready`）。
- Key：`<APP_ENV ?? production>/trips/<tripId>/<kind>/<uuid>.<ext>`，縮圖 `<uuid>.thumb`。
- 讀取：`GET /api/media/:aid`（與 `/thumb`）。**照片**：member Bearer 或同旅程的 `?s=<shareToken>`（且 visibility 為 `trip`），`Cache-Control: private, max-age=86400`＋ETag／304（因為要驗 token，不能 public immutable）；`<img>` 送不了 Bearer，app 內用 `mediaApi.fetchBlob` ＋ object URL，分享頁直接帶 `?s=`。**文件／收據**：只限成員、`private, no-store`、share token 一律 403、visibility 強制 `members-only`。
- 路徑是 `/api/media/*` 而非 `/media/*`，因為 `run_worker_first` 只涵蓋 `/api/*`、`/ws/*`、`/s/*`。
- `attachments` 對 placeId／stopId／dayId／wishlistItemId／bookingId／lodgingId **沒有外鍵**（避免刪地點／行程點時被照片擋住）；讀取端忽略指向不存在列的 id，清理交給 e6-t03 或 e11-t06。軟刪除的 R2 物件與逾時的 `pending` 列由 e11-t06 清。

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
| MapLibre chunk | 300 kB | 兩個入口共用；2026-11-09 由 250 調高：maplibre-gl 6.x（修 GHSA-jrc7-96c5-q579 XSS，5.x 無修正版）實測 287.7 kB gzip，安全優先 |
| 單頁 chunk | 60 kB | 日程、記帳、相簿各自 lazy |

## 7. 測試

- 純函式（`shared/`）：Vitest，覆蓋分帳、匯率、日出日落、時區、移動段、檢查、patch 合併。
- Worker：`unstable_dev` 跑 REST 與權限（哪個 token 能打哪個路由）、分享過濾。
- 前端：Playwright：日程拖曳（滑鼠與鍵盤）、記一筆 10 秒、分享頁 Lighthouse、axe；離線與同步在 PR 預覽用兩個瀏覽器 context 實測並記錄在 PR。
