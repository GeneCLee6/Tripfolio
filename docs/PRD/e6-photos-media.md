---
title: E6 — 照片與媒體
date: 2026-11-09
status: planned
epic: E6
owner: GeneCLee6
milestones: [M1, M3]
depends_on: [E1, E11]
---

## 背景

照片有兩個用途：規劃時「這個地方長這樣」（從網路或朋友存的圖），旅途中與旅途後「我們去了」（手機拍的）。後者的量大、要省空間（R2 免費 10 GB），而且手機照片的 GPS 與時間可以自動掛到行程點，讓回顧模式（E8）幾乎不用手動整理。

## 目標

- M1：上傳、縮圖、封面、相簿。
- M3：GPS／時間自動配對、容量管理。

## 非目標

- 原圖備份（這不是 Google 相簿；只存長邊 2048 的版本，說清楚）。
- 影片（先不做；可以貼 YouTube／Drive 連結）。
- 臉部辨識、AI 整理。

## 需求

- **上傳**：多選、拖放、手機相機；瀏覽器端縮成長邊 2048 的 WebP（品質 0.82）＋ 400 的縮圖；讀 EXIF 的拍攝時間與 GPS 供配對後**移除所有 EXIF**（隱私）；使用者可關閉「使用照片位置」；R2 直傳（Worker 簽短效上傳 URL）；進度、失敗重試、同時最多 3 個。
- **配對**：上傳到旅程相簿的照片，依 GPS 找最近且同一天的行程點（500 m 內）自動掛上，否則依時間掛到當日；可手動搬。
- **相簿**：每日相簿、全程相簿、封面設定（旅程封面、每日封面）；燈箱（滑動、鍵盤、關閉、顯示拍攝時間與地點）。
- **容量**：每旅程用量顯示；旅程超過 1.5 GB 警示；全站超過 8 GB 警示給擁有者（E11）。
- **附件通道**：E4 的確認信、E9 的文件也走同一條上傳通道（`attachments` 表、`kind` 區分），但文件不縮圖、不公開。

## 設計方向

- `attachments`（tripId、kind: photo|document|receipt、r2Key、thumbKey、width、height、takenAt、lat、lng、placeId、stopId、dayId、uploaderId、bytes、visibility）。
- R2 key 用 `trips/<tripId>/<kind>/<uuid>.webp`；公開照片經 Worker 讀取時帶長快取；文件類一律經 Worker 驗權才回傳（E11 AC-11.4）。
- 縮圖用 `createImageBitmap` ＋ canvas，Safari 的 HEIC 由瀏覽器自行解；不支援的格式提示轉檔。

## 驗收條件

- [ ] AC-6.1 — 上傳：多選／拖放／相機、瀏覽器端縮圖與去 EXIF、R2 直傳、進度與重試；10 張照片在手機 4G 下 1 分鐘內完成。
  - 進度（#D1a，e6-t01）：管線已完成，介面（e6-t02）與手機 4G 實測還沒做，所以不勾。
    - **資料**：遷移 `0005_attachments.sql`；`placeId`／`stopId`／`dayId`／`wishlistItemId` 刻意**不設外鍵**（刪地點、行程點、日不能因為有照片而失敗；讀取端忽略懸空 id），`bookingId`／`lodgingId` 等 E4 建表。
    - **上傳改由 Worker 代理，不用 R2 presigned PUT**（偏離 ARCHITECTURE §4.4 原設計）：presigned URL 要 R2 的 S3 API 金鑰（另建 access key、放 secret），免費方案目前沒有這套設定；代理讓 memberToken 驗權、型別與大小限制集中在一處；照片縮過後 ≤ 8 MB，經 Worker 的 CPU 與請求數都在免費額度內。流程：`POST /api/trips/:id/attachments/sign` 建 `pending` 列 → `PUT …/:aid/content`（Bearer、`Content-Length` 必須等於簽發時宣告的大小、`Content-Type` 必須相符，串流寫進 R2，寫完再核對大小）→ 照片 `PUT …/:aid/thumb`（WebP，Safari 舊版退 JPEG，≤ 1 MB）→ `POST …/:aid/complete`（R2 `head` 確認後轉 `ready`）。簽發後 15 分鐘內要傳完；每成員每分鐘最多簽 60 次。**因此不需要設定 R2 CORS**（瀏覽器只打同源的 Worker），`DEPLOY.md` 不用改。
    - **R2 key**：`<APP_ENV 或 production>/trips/<tripId>/<kind>/<uuid>.<ext>`，縮圖 `<uuid>.thumb`；預覽環境（`APP_ENV=preview`）自然落在 `preview/` 前綴（`DEPLOY.md` §2）。
    - **讀取**：`GET /api/media/:aid`、`/api/media/:aid/thumb`（放在 `/api/` 下，因為 `run_worker_first` 只有 `/api/*`、`/ws/*`、`/s/*`，`/media/*` 會被 SPA 接走）。照片：成員（Bearer）或同旅程且 `visibility = trip` 的分享 token（`?s=`）；`Cache-Control: private, max-age=86400`＋ETag／304。**取捨**：原設計是 `public, immutable` 一年，但照片要驗 token 才能讀，公開快取會讓 CDN 或共用快取把它交給沒有 token 的人，所以只放瀏覽器私有快取一天，之後靠 ETag 重新驗證（304 不回內容）。文件／收據：只有成員、`private, no-store`、分享 token 一律 403，`visibility` 強制 `members-only`（CLAUDE.md 規則 5）。pending／已刪除回 404。
    - **其他 API**：`GET /api/trips/:id/attachments?kind=&dayId=&stopId=`（只列 ready）、`PATCH …/:aid`（搬移、改可見度）、`DELETE …/:aid`（軟刪除；同時清掉指向它的旅程封面與心願照片；**R2 物件留給 e11-t06 的清理工作刪**）、`GET …/attachments/usage` → `{ bytes, count, warnAtBytes: 1.5 GB }`（含縮圖，給 e6-t05）。
    - **瀏覽器工具** `src/lib/upload/`：`exif.ts`（JPEG APP1／TIFF，IFD0＋Exif IFD＋GPS IFD；`DateTimeOriginal`＋`OffsetTimeOriginal`、GPS；有時差就轉 UTC，沒有就存不帶時區的當地時間，按旅程時區讀）、`resize.ts`（`createImageBitmap`＋canvas → WebP，不支援就 JPEG；重新編碼即去除全部 EXIF）、`upload.ts`（`uploadAttachment`：EXIF → 2048／400 → sign → XHR PUT 帶進度、失敗重試 3 次指數退避 → complete；可關「使用照片位置」；`uploadQueue` 並發 3）、`api.ts`（型別化呼叫與 `fetchBlob`，`<img>` 帶不了 Bearer，成員端用 blob URL）。`resize.ts` 需要真瀏覽器，單元測試只測它的尺寸計算，留給 e6-t02 的 Playwright。
    - 測試：`tests/worker/media.test.ts`（簽發驗證、上傳大小／型別／上傳者、complete、列表／搬移／刪除、用量、`/api/media` 權限矩陣、各類快取標頭、ETag 304、`APP_ENV` 前綴）、`tests/src/upload/`（手做含 GPS IFD 的 JPEG 位元組、管線與重試、佇列並發）。本機 `vite dev` 以 curl 走過 sign → PUT → complete → `/api/media` → 304。
- [ ] AC-6.2 — 配對：GPS 500 m 內掛最近行程點、否則掛當日；可手動搬；有測試。
- [ ] AC-6.3 — 相簿：每日／全程相簿、封面、燈箱（鍵盤可用）。
- [ ] AC-6.4 — 容量：旅程與全站用量顯示與警示。

## Task 拆分

### M1

- [x] `e6-t01` `attachments` schema、Worker 簽發 R2 直傳 URL、瀏覽器縮圖與 EXIF 讀取／移除工具（純函式有測試） · AC-6.1 · M · ← e1-t01
- [ ] `e6-t02` 上傳元件（多選、拖放、相機、進度、重試、並發 3）與封面設定 · AC-6.1, 6.3 · M · ← e6-t01, e10-t01
- [ ] `e6-t05` 容量統計與警示（旅程頁、擁有者用量頁） · AC-6.4 · S · ← e6-t01

### M3

- [ ] `e6-t03` GPS／時間配對與手動搬移 · AC-6.2 · S · ← e6-t02, e2-t03
- [ ] `e6-t04` 相簿頁與燈箱 · AC-6.3 · S · ← e6-t02

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| R2 10 GB 免費額度用完 | 只存 2048 版；容量警示；最舊的已封存旅程可「匯出後清除照片」 |
| 手機瀏覽器縮圖慢或當掉 | 一次處理一張、用 `createImageBitmap` 的 `resizeWidth`；超過 50 MB 的檔先拒絕 |

## 未決問題

- [ ] **Q:** 分享頁的照片要不要加浮水印或限制下載？
      **A:** _(建議不要；朋友圈不需要，分享連結可撤銷)_
