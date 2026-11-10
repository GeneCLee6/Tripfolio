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
- i18n 目錄分三份（2026-11-09，分享頁預算）：`zh-TW.ts`（app 專用）、`zh-TW.common.ts`（app 與分享頁共用：地圖、format、通用字）、`zh-TW.share.ts`（`share.*`），各配 `en.*`；app 註冊前兩份、分享頁註冊後兩份；`check-i18n` 走分享頁 import 圖，擋缺 key、多餘 key、分享頁載入整份目錄、key 重複定義（規則見 `RULES.md` §2）。
- 頁面目錄（2026-11-10，首屏預算）：只有一個 lazy 頁面用的 key 放 `shared/i18n/pages/<頁>.zh-TW.ts`／`.en.ts`，由該頁 entry import `pages/<頁>.ts` 在 chunk 載入時 `registerCatalog`，不進首屏；目前 `itinerary`（117）、`bookings`（104）、`dev`（35），首屏 175.7 → 168.8 kB；`check-i18n` 以「不經過該頁 entry 就載入不到」判定歸屬，頁外用到就擋並指名搬回（規則見 `RULES.md` §2）。
- 頁面目錄第二輪（2026-11-10）：再加 `picks`（109）、`places`（111）、`photos`（77）、`balances`（69）、`stats`（60）、`history`（14）、`settings`（90，含 `members.*`、`shares.*`）、`map`（37，含 `OfflineMapSheet` 的 `offline.map.*`）、`expenses`（18）、`expense-form`（50）、`admin`（57）、`prep`（147，四個準備頁共用；`PrepLinks` 的 `prep.links.*` 留在 app 目錄），共 839 個 key；首屏 176.1 → 150.1 kB（rebase 到 E9 之後）。共用元件、首頁、`lib/` 對照表用到的 key 留在 app 目錄。
- 字型 self-host 子集（Fraunces 只拉丁、Noto Serif TC 與 Noto Sans TC 用 Google Fonts 的 unicode-range 子集）；登記 `docs/ASSETS.md`。

## 驗收條件

- [x] AC-10.1 — Token 與基礎元件：深淺色、字型、全部元件有 Storybook 式展示頁（`/dev/ui`，production 不含）。 · #A2（Playwright 開 `/dev/ui` 確認淺深兩欄並排、Sheet 開啟與 Esc 關閉；production build 不含展示頁 chunk）
- [x] AC-10.2 — i18n：zh-TW 來源、en 完整；偵測與切換；`check-i18n` 進 CI；英文與繁中走查各一次。
      _進度（A2）：zh-TW 來源與 en 同步、`navigator.languages` 偵測（非 `zh*` → en）、切換並存 localStorage、`check-i18n` 在 CI 擋缺漏／多餘 key 與裸字串，皆已完成；兩語走查（C2b，e10-t07）完成：`docs/ZH-WALKTHROUGH.md`、`docs/EN-WALKTHROUGH.md`，術語表定稿在 `DESIGN.md` §5（英文用英式／澳式拼法）。仍建議各請一位母語使用者實際用一輪。_
- [x] AC-10.3 — 版面：375 px 全功能可用、底部導覽；桌機三欄；平板兩欄。 · #A3f（`e2e/trips.spec.ts` 在本機 Worker＋D1 跑：375 px 底部導覽五格＋浮動「記一筆」、無側欄、`body.scrollWidth` = 375、整條建立→清單→編輯→封存流程在 375 px 走完；900 px 側欄＋內容兩欄、無底部導覽；1440 px 量到左欄 360 px、右細節欄 400 px、中欄在兩者之間）
- [ ] AC-10.4 — PWA：可安裝、離線開啟最近旅程、離線佇列重送、更新提示（實體手機實測）。
      _進度（#G2b）：功能都已做完，Chromium（Playwright，對 production build 的 `vite preview`＋本機 Worker／D1，含 `public/_headers` 的 CSP）驗過：`/sw.js` 註冊並控制頁面、`shell-<版本>` 快取存在、manifest 可讀；開過的旅程在 `context.setOffline(true)` 後重新整理仍能打開（殼來自快取、資料來自 `data-<tripId>`），頂欄顯示「離線」；離線記一筆 → 徽章「離線 · 1 筆待同步」、伺服器尚無資料 → 恢復連線後徽章消失、API 有該筆、清單自動重載；出發前 3 天的旅程首頁出現安裝橫幅（模擬 `beforeinstallprompt`），「不用了」後重新整理不再出現。**未驗**：真的安裝（Android Chrome、iOS Safari 加入主畫面）、iOS 的「加到主畫面」提示、更新提示（需要部署兩個版本）、實體手機的飛航模式與弱網路、「連線 10 秒內送完」。_
- [x] AC-10.5 — 無障礙：axe 無 serious／critical；鍵盤走查；reduced motion。 · #C2a（`e2e/a11y.spec.ts`：22 條路由＋兩個 Sheet＋燈箱 × 淺深色 × 繁中／英文共 100 次 axe〔wcag2a／2aa／21aa〕無 serious／critical；375 px 觸控 16 頁 ≥ 44 px；reduced motion 下 Sheet 與燈箱無動畫、反向對照有動畫；`e2e/keyboard.spec.ts` 10 項鍵盤走查；地圖鏡頭 `tests/src/map/camera.test.ts`）
- [x] AC-10.6 — 格式：金額／日期／時長／距離／時區依語言正確（測試）。 · #A2（`tests/shared/i18n/format.test.ts`）

## Task 拆分

### M0

- [x] `e10-t01` token、字型子集、基礎元件、深淺色、`/dev/ui` 展示頁 · AC-10.1 · M · #A2
- [x] `e10-t02` i18n `t()`、zh-TW 來源與 en、語言偵測與切換、`check-i18n` 腳本 · AC-10.2 · S · #A2
- [x] `e10-t04` `Intl` 格式工具（金額、日期、時長、距離、時區）與測試 · AC-10.6 · S · #A2
- [x] `e10-t03` App 殼：路由、三欄／兩欄／單欄版面、底部導覽、頂欄、空狀態 · AC-10.3 · M · ← e10-t01 · #A3f

### M0 收尾

- [x] `e10-t06` 無障礙走查、axe e2e、拖曳鍵盤替代驗證、reduced motion · AC-10.5 · S · ← e2-t04 · #C2a
  - **axe**（`e2e/a11y.spec.ts`＋共用種子 `e2e/a11y-seed.ts`：成員、三天行程點、有座標的地點、住宿、租車預訂、必吃必買、一筆花費、預算、清單與筆記範本、兩張照片、分享連結、邀請）：旅程清單、新增旅程、首頁、行程、地圖、必吃必買、地點、照片、預訂、記帳、餘額、統計、歷史、清單、預算、文件、筆記、回顧、設定、加入頁、隱私、`/s/<token>`，加上記一筆 Sheet、加行程點 Sheet、燈箱；淺深色 × zh-TW／en。第一輪（淺色繁中）7 頁有 `color-contrast`（首頁 2、行程 1、必吃必買 1、預訂 2、餘額 6、統計 1、回顧 4 個節點），其餘 0；深色與英文修完後全數通過。
  - **對比修正**（`src/styles/tokens.ts`，外觀幾乎不變）：淺色 `muted` #5F6E72 → #56656A（在 glacier／tussockSoft 底上也 ≥ 4.5）、`success` #3C8C5A → #2C7446、`danger` #B9483A → #AD4134；新增只給小字用的 `warningText`（淺 #8A5E12）與 `tussockText`（淺 #80610E；深色與原色相同），填色、外框、圖示仍用原本的 `warning`／`tussock`。行程頁「每日上限」提示原本 muted 再加 0.8 透明度，改為純 muted。`docs/DESIGN.md` §2 的色票表需同步（本批不能改該檔）。
  - **鍵盤**（`e2e/keyboard.spec.ts`）：清單／首頁／行程／記帳每個 Tab 停點都有焦點框；只用鍵盤建立旅程（含日期欄）、用地點搜尋加行程點、空白鍵抓起→方向鍵→空白鍵放下、Esc 取消且焦點留在把手、記一筆、燈箱 ←／→、Esc 關閉後焦點回到原按鈕或照片、語言與主題用方向鍵切換。**修掉的問題**：只在開啟時才 render 的 Sheet（記一筆、加行程點）關閉時整個卸載，瀏覽器沒有 `close()` 可還原焦點，焦點掉到 body；`Dialog.tsx` 改為開啟時記住開啟者、卸載前（layout cleanup）先 `close()` 再把焦點還給它。
  - **reduced motion**：Sheet／Dialog／燈箱原本就用 `media.motion` 包動畫、`GlobalStyle` 把時間壓到 0.01 ms；測試確認 reduce 時開著的 modal 內所有元素 `animation-name` 皆為 none、no-preference 時有動畫。地圖鏡頭移動抽到 `src/map/camera.ts`（`cameraDuration()`、`moveCamera()`），四處 `fitBounds`／`easeTo` 都經它，reduce 時 duration 0（單元測試）。
  - **觸控 44 px**（375 px、`hasTouch`、`isMobile`）：`GlobalStyle` 在 coarse pointer 下讓 `a`（非行內）、`button`、`select`、`summary`、`role=button/tab/radio/checkbox` 至少 44 × 44，MapLibre 縮放鈕 44；新增 `coarseTarget`／`coarseLink` mixin 給自己設了較小尺寸的元件（行程日期晶片、移動段列、餘額「怎麼算」、隱私連結、分享頁頁尾連結、統計與預算的勾選列）；原本 `touchTarget - N` 的 Chip、SegmentedControl、DayChip、MemberPicker、ColorSwatches、MoneyField、VoteButton 都改成滿 44；清單項目的勾選框外包 44 px 的 `CheckHit` label。段落裡的行內連結依 WCAG 2.5.8 例外不算。
  - **留下**：MapLibre 的版權（attribution）收合鈕與連結是函式庫自己的 DOM，觸控檢查排除；地圖畫布本身不可聚焦，鍵盤靠隱藏的「地圖上的點」清單（聚焦時浮出）；記一筆 Sheet 的分類與付款人 radio 每個都是 Tab 停點（未做 roving，可用但停點多）；日期／時間欄每個欄位分段各吃一次 Tab（瀏覽器原生行為）；只驗 Chromium，VoiceOver／TalkBack 實機朗讀未測。
- [x] `e10-t07` 英文走查與繁中語感複查、旅遊術語表定稿 · AC-10.2 · S · ← e10-t02 · #C2b

### M2

- [x] `e10-t05` PWA：manifest、圖示、安裝提示、Service Worker（shell＋旅程資料）、離線佇列基礎、更新提示 · AC-10.4 · M · ← e10-t03 · #G2b
  - **Manifest 與圖示**：`public/manifest.webmanifest`（Tripfolio · 旅誌、standalone、底色＝淺色 paper token）、`public/icons/`（192／512、maskable 192／512、apple-touch 180、SVG；由 `sw/make-icons.mjs` 用 sharp 從 `docs/design/logo/logo.svg` 產生，見 `docs/ASSETS.md`）；`index.html` 加 manifest、深淺兩個 `theme-color`、apple meta。
  - **Service Worker**（`sw/sw.ts`，無框架、無 import；`vite.config.ts` 把它當第三個 client 入口輸出成 `dist/client/sw.js`，build 後把所有 client 檔案清單與版本〔`APP_VERSION`＋檔名雜湊〕寫進去；型別檢查 `npx tsc -p sw/tsconfig.sw.json`，不在 `tsc -b` 內）：殼 precache（`/` 與全部 `/assets/*`，約 2.6 MB，含 MapLibre）；導覽 network-first、離線回快取的 `/`；`/assets/*` cache-first；`GET /api/trips`、`/api/trips/:id`、`/api/trips/:id/*`（不含 `/geo/` 搜尋）network-first、失敗時回快取並帶 `x-tripfolio-offline: 1`，沒有快取回 503 `offline`；只留最近 3 個開過的旅程（app 以 `postMessage` 告知，請求也會更新順序）；`POST …/geo/route(s)` 是唯讀，以 body 雜湊快取（離線看得到路線）；寫入（POST／PATCH／PUT／DELETE）一律不碰；`/api/media/*` cache-first、上限 200 筆、回應有 `no-store`（文件、收據）就不存；OpenFreeMap 瓦片 cache-first、style／TileJSON／sprite／glyphs network-first 後備優先用離線下載時存的那份；Google Fonts cache-first；`/s/*`、`/ws/*` 不攔。**與 ARCHITECTURE §4.2 的差異**：旅程資料不用 stale-while-revalidate，因為寫入後清單會立刻重讀，舊答案會把剛寫的藏起來；改成 network-first＋離線後備。
  - **更新**：新版本裝好就等待；頂欄下方出現「有新版本 · 重新整理」，按下才 `skip-waiting`，接管後重新載入；每小時 `registration.update()`。只在 production build 註冊（dev 與其他 e2e 不受影響）。
  - **離線佇列**（`src/lib/offline/`）：`queue.ts` IndexedDB `tripfolio-offline/mutations`（`{ id, seq, method, url, body, token, createdAt, entity, failure? }`），依序重送，4xx 停下並標成失敗（後面的等使用者「再試一次」或「捨棄」），網路錯誤、5xx、408／425／429 留著下次再送；`useOnline.ts` 以 `navigator.onLine`＋失敗請求判定離線、離線時每 10 秒打 `/api/health`；`sync.ts` 在 app 啟動、恢復連線、分頁回到前景時重送（不依賴 Background Sync）。`submitExpense()`（簽名不變）離線或遇網路錯誤就排隊並回暫時的花費（id `pending-…`、`rev` -1）；送出前再改那一筆會併進排隊中的新增。頂欄徽章「離線 · N 筆待同步」／「N 筆待同步」／「N 筆無法同步」，點開列出待送項目。**行程編輯、勾選、文字修改還沒排隊**（等 e2-t08b 的 `useTrip()`，佇列屆時改存 patch）。
  - **安裝提示**（`install.ts`、`InstallBanner.tsx`）：一載入就接住 `beforeinstallprompt`；旅程開始前 7 天內（或進行中）在旅程首頁顯示橫幅，Chromium 有「安裝」、iOS 顯示「分享 → 加入主畫面」；「不用了」按旅程記在 localStorage；已安裝（standalone）不顯示。
  - **預算**：SW 是獨立檔案，不算首屏；app 首屏 168.8／180 kB（rebase 到 6d02295 後，含 main 上其他批次；本批約 +6.5 kB）。
  - **留下**：離線新增的花費還不會出現在清單（清單頁在 `src/pages`，下一批可讀 `usePendingMutations()` 畫「待同步」列）；離線新增後按「復原」會打 `DELETE /expenses/pending-…` 而失敗（`expensesApi.remove` 沒包）；重送 POST 若第一次其實已到伺服器但回應遺失，會重複一筆（伺服器沒有冪等鍵）；token 存在佇列裡（同一台裝置，與 localStorage 的 token 同級）；字型仍從 Google Fonts 載入（SW 會快取看過的字型檔，沒看過的離線用後備字型）；`sw/tsconfig.sw.json` 未接進 CI 的 typecheck。

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 襯線中文字型檔太大 | unicode-range 子集、只標題用；內文 Noto Sans TC 走系統字型後備 |
| 離線佇列與即時同步互相打架 | 同一條 `useTrip()` 管線（E2 e2-t08b），佇列只是「還沒送出去的 patch」 |

## 未決問題

- [ ] **Q:** 預設語言繁中、來源語言繁中（與 TKU Arcade 相反）？
      **A:** _(建議是：使用者與同行朋友都是台灣人、內容是中文寫的；英文介面給分享頁的外國朋友；見總 PRD Q1b)_
