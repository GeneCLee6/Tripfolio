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

- [x] AC-6.1 — 上傳：多選／拖放／相機、瀏覽器端縮圖與去 EXIF、R2 直傳、進度與重試；10 張照片在手機 4G 下 1 分鐘內完成。
  - 進度（#D1a，e6-t01）：管線已完成，介面（e6-t02）與手機 4G 實測還沒做，所以不勾。
    - **資料**：遷移 `0005_attachments.sql`；`placeId`／`stopId`／`dayId`／`wishlistItemId` 刻意**不設外鍵**（刪地點、行程點、日不能因為有照片而失敗；讀取端忽略懸空 id），`bookingId`／`lodgingId` 等 E4 建表。
    - **上傳改由 Worker 代理，不用 R2 presigned PUT**（偏離 ARCHITECTURE §4.4 原設計）：presigned URL 要 R2 的 S3 API 金鑰（另建 access key、放 secret），免費方案目前沒有這套設定；代理讓 memberToken 驗權、型別與大小限制集中在一處；照片縮過後 ≤ 8 MB，經 Worker 的 CPU 與請求數都在免費額度內。流程：`POST /api/trips/:id/attachments/sign` 建 `pending` 列 → `PUT …/:aid/content`（Bearer、`Content-Length` 必須等於簽發時宣告的大小、`Content-Type` 必須相符，串流寫進 R2，寫完再核對大小）→ 照片 `PUT …/:aid/thumb`（WebP，Safari 舊版退 JPEG，≤ 1 MB）→ `POST …/:aid/complete`（R2 `head` 確認後轉 `ready`）。簽發後 15 分鐘內要傳完；每成員每分鐘最多簽 60 次。**因此不需要設定 R2 CORS**（瀏覽器只打同源的 Worker），`DEPLOY.md` 不用改。
    - **R2 key**：`<APP_ENV 或 production>/trips/<tripId>/<kind>/<uuid>.<ext>`，縮圖 `<uuid>.thumb`；預覽環境（`APP_ENV=preview`）自然落在 `preview/` 前綴（`DEPLOY.md` §2）。
    - **讀取**：`GET /api/media/:aid`、`/api/media/:aid/thumb`（放在 `/api/` 下，因為 `run_worker_first` 只有 `/api/*`、`/ws/*`、`/s/*`，`/media/*` 會被 SPA 接走）。照片：成員（Bearer）或同旅程且 `visibility = trip` 的分享 token（`?s=`）；`Cache-Control: private, max-age=86400`＋ETag／304。**取捨**：原設計是 `public, immutable` 一年，但照片要驗 token 才能讀，公開快取會讓 CDN 或共用快取把它交給沒有 token 的人，所以只放瀏覽器私有快取一天，之後靠 ETag 重新驗證（304 不回內容）。文件／收據：只有成員、`private, no-store`、分享 token 一律 403，`visibility` 強制 `members-only`（CLAUDE.md 規則 5）。pending／已刪除回 404。
    - **其他 API**：`GET /api/trips/:id/attachments?kind=&dayId=&stopId=`（只列 ready）、`PATCH …/:aid`（搬移、改可見度）、`DELETE …/:aid`（軟刪除；同時清掉指向它的旅程封面與心願照片；**R2 物件留給 e11-t06 的清理工作刪**）、`GET …/attachments/usage` → `{ bytes, count, warnAtBytes: 1.5 GB }`（含縮圖，給 e6-t05）。
    - **瀏覽器工具** `src/lib/upload/`：`exif.ts`（JPEG APP1／TIFF，IFD0＋Exif IFD＋GPS IFD；`DateTimeOriginal`＋`OffsetTimeOriginal`、GPS；有時差就轉 UTC，沒有就存不帶時區的當地時間，按旅程時區讀）、`resize.ts`（`createImageBitmap`＋canvas → WebP，不支援就 JPEG；重新編碼即去除全部 EXIF）、`upload.ts`（`uploadAttachment`：EXIF → 2048／400 → sign → XHR PUT 帶進度、失敗重試 3 次指數退避 → complete；可關「使用照片位置」；`uploadQueue` 並發 3）、`api.ts`（型別化呼叫與 `fetchBlob`，`<img>` 帶不了 Bearer，成員端用 blob URL）。`resize.ts` 需要真瀏覽器，單元測試只測它的尺寸計算，留給 e6-t02 的 Playwright。
    - **#D1b（e6-t02）介面完成，本機瀏覽器實測後勾選**：Playwright（Chromium，375／1440）以 `setInputFiles` 選兩張 PNG（一張 3000×1500），走真的 Worker＋本機 D1＋本機 R2：瀏覽器縮成 2048×1024 WebP、兩張都有縮圖、佇列「2／2 張完成 · 100%」、格狀顯示兩張。**「10 張照片在手機 4G 下 1 分鐘內完成」本機無法驗證**（沒有實體手機與 4G），留待預覽站用手機實測；HEIC 在 Chromium 解不了時顯示轉檔提示（單元測試涵蓋，未用真 HEIC 檔跑過）；相機輸入只在 `pointer: coarse` 出現，未在實體手機按過。
    - 測試：`tests/worker/media.test.ts`（簽發驗證、上傳大小／型別／上傳者、complete、列表／搬移／刪除、用量、`/api/media` 權限矩陣、各類快取標頭、ETag 304、`APP_ENV` 前綴）、`tests/src/upload/`（手做含 GPS IFD 的 JPEG 位元組、管線與重試、佇列並發）。本機 `vite dev` 以 curl 走過 sign → PUT → complete → `/api/media` → 304。
- [x] AC-6.2 — 配對：GPS 500 m 內掛最近行程點、否則掛當日；可手動搬；有測試。
  - 驗證（#F1b，e6-t03）：純函式 `src/lib/upload/match.ts`（`tests/src/photos/match.test.ts`：500 m 邊界、同一天才配、旅程時區跨午夜、沒 GPS 依日期、沒時間或不在旅程日期內不配、已手動分過的不動、指向已刪除日的重配）。Playwright（375／1440）：API 建兩天旅程＋有座標的行程點 → 上傳測試裡組出的 JPEG（canvas 產生、插入 EXIF `DateTimeOriginal` 為 Day 1、GPS 距行程點約 60 m）＋一張無 EXIF 的 PNG → 上傳批次結束後自動配對：JPEG 掛到該行程點與 Day 1、PNG 留在「還沒分到哪一天」→ 燈箱「搬到…」改到 Day 2 → API 與依日相簿都跟著變。
- [x] AC-6.3 — 相簿：每日／全程相簿、封面、燈箱（鍵盤可用）。
  - 驗證（#F1b，e6-t04）：照片頁「全部／依日」分頁；依日每段有日色邊條、Day N · 日期、張數、當日封面縮圖，最後是「還沒分到哪一天」。燈箱（`src/components/Lightbox.tsx`）是全螢幕原生 modal `<dialog>`（焦點困在裡面、Esc 關閉、關閉後焦點回到縮圖）、←／→ 與左右按鈕切換、指標水平滑動切換、`aria-live` 唸「第 N／M 張」、動畫只在沒有 `prefers-reduced-motion` 時播；資訊欄顯示拍攝時間（旅程時區）、分在哪天／行程點、「搬到…」、「設為旅程封面」、「設為當日封面」、刪除（編輯者）。Playwright 以鍵盤 ←／→ 走過兩張、Esc 關閉；元件測試檢查 aria。**取捨：當日封面存在這台裝置的 localStorage**（`tripfolio.photos.dayCovers.<tripId>`），因為 `days` 沒有封面欄位、這批不能改 Worker；其他裝置退回當天第一張。之後在 `days` 加 `coverAttachmentId` 再搬過去。
- [ ] AC-6.4 — 容量：旅程與全站用量顯示與警示。
  - 進度（#D1b，e6-t05）：**旅程用量已完成並驗證**：`StorageMeter` 讀 `GET …/attachments/usage`，「已用 X / 1.5 GB」、≥ 80% 琥珀色提示、超過 1.5 GB 紅色警示（元件測試涵蓋三種狀態；Playwright 驗證上傳後與刪除後數字會更新）；照片頁一律顯示，旅程首頁在 > 50% 才顯示精簡版。**全站 8 GB 警示給擁有者要等 E11 用量頁**，所以本條不勾。

## Task 拆分

### M1

- [x] `e6-t01` `attachments` schema、Worker 簽發 R2 直傳 URL、瀏覽器縮圖與 EXIF 讀取／移除工具（純函式有測試） · AC-6.1 · M · ← e1-t01
- [x] `e6-t02` 上傳元件（多選、拖放、相機、進度、重試、並發 3）與封面設定 · AC-6.1, 6.3 · M · ← e6-t01, e10-t01
- [x] `e6-t05` 容量統計與警示（旅程頁、擁有者用量頁） · AC-6.4 · S · ← e6-t01

  - 做了什麼（#D1b，2026-11-09）：`src/components/PhotoUploader.tsx`（拖放、多選、觸控裝置多一個 `capture="environment"` 相機輸入；每列預覽、階段、進度條、取消（AbortController）、失敗重試、全部取消／清除已完成；「使用照片位置」記在 localStorage `tripfolio.photos.useLocation`；`useCan('editContent')` 才顯示）、`src/lib/upload/limiter.ts`（每個上傳元件一個並發閘，跨批次與重試仍最多 3 個在傳）、`queue-items.ts`（錯誤分類：太大／格式不支援／HEIC 提示／解碼失敗／網路錯誤可重試）、`PhotoThumb`＋`photo-cache.ts`（`fetchBlob`→object URL，模組層快取共用同一次下載，閒置 120 個以上才 revoke，刪除時立即 evict；縮圖失敗退回原圖）、`StorageMeter`＋`storage.ts`、`src/pages/photos/PhotosPage.tsx`（依拍攝時間排列，手機 3 欄、平板 4、桌機 5；簡易檢視 Dialog：上一張／下一張／方向鍵、設為封面／取消封面、刪除要確認；完整燈箱與每日相簿留給 e6-t04）、旅程首頁 hero 顯示封面照片（底部漸層壓暗）、「照片」／「設定封面」連結。`resize.ts` 改為先用 `<img>` 讀 `naturalWidth`（只解析檔頭、不解像素），再 `createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: 'high' })` 直接解碼成 2048 大小；瀏覽器忽略 resize 選項或方向不對時退回一次全尺寸解碼並立即 `close()`，輸出尺寸一律由 bitmap 本身的長寬比計算，不會變形（Chromium 實測走 resize 路徑；Safari 未測）。`upload.ts` 讀 EXIF 只讀前 256 KB。**PhotoUploader 不從 `components/index.ts` 匯出**（它帶進 zod，會讓首屏從 134 漲到 162 kB）。

### M3

- [x] `e6-t03` GPS／時間配對與手動搬移 · AC-6.2 · S · ← e6-t02, e2-t03
- [x] `e6-t04` 相簿頁與燈箱 · AC-6.3 · S · ← e6-t02

  - 做了什麼（#F1b，2026-11-10）：`src/lib/upload/match.ts`（`matchPhoto`／`buildMatchContext`／`planMatches`／`isUnfiled`；行程點座標取自它的地點，只看已排入日期的日）；照片頁在上傳批次的最後一張完成 0.7 秒後對新照片跑配對（只有編輯者，`PATCH /attachments/:aid { dayId, stopId }`），有未分的照片時顯示「自動整理」；只配「還沒分」的照片，手動搬過的不會被改。`src/lib/photos/`：`albums.ts`（`groupByDay`、`photosByStop`、`sortPhotos` 搬來這裡）、`day-covers.ts`（localStorage）、`store.ts`（每旅程一份照片清單的模組層快取＋`useTripPhotos`／`usePhotosByStop`；照片頁的上傳／搬移／刪除寫回同一份，所以行程頁的卡片跟著變；超過 60 秒才重抓）。`PhotoGrid`（3／4／5 欄、接近視窗 800 px 才掛 `PhotoThumb`、每格是按鈕）、`Lightbox`。`StopCard` 底部：這個行程點有照片時顯示最多 3 張縮圖＋「+N」（`role="img"`，「這個行程點有 N 張照片」）。「設為封面」改名「設為旅程封面」以區分當日封面。app 首屏 154.2／180 kB（rebase 前 main 約 152）、share 98.2／120。
  - 留下：當日封面只存在裝置上（要 Worker 加欄位）；配對只在照片頁跑（行程點改座標或日期後不會自動重配，要按「自動整理」，而且只處理還沒分的照片）；沒有座標的行程點只能靠手動搬；縮放（pinch）沒做；滑動切換沒有跟手動畫；Safari 與實體手機的滑動未實測；新元件沒進 `/dev/ui`。

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| R2 10 GB 免費額度用完 | 只存 2048 版；容量警示；最舊的已封存旅程可「匯出後清除照片」 |
| 手機瀏覽器縮圖慢或當掉 | 一次處理一張、用 `createImageBitmap` 的 `resizeWidth`；超過 50 MB 的檔先拒絕 |

## 未決問題

- [ ] **Q:** 分享頁的照片要不要加浮水印或限制下載？
      **A:** _(建議不要；朋友圈不需要，分享連結可撤銷)_
