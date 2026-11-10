# RULES — 工程慣例

`CLAUDE.md` 是硬性規則的摘要；這份寫成工程上的做法。架構見 `docs/ARCHITECTURE.md`，介面、token 與術語見 `docs/DESIGN.md`，部署見 `DEPLOY.md`。

## 1. 分層與職責

| 位置 | 職責 | 禁止 |
| --- | --- | --- |
| `shared/` | 前後端共用的型別與純函式（協定、patch、money、time、itinerary、schema、i18n） | React、DOM、Cloudflare API；讀時間或隨機數不經注入 |
| `shared/i18n/` | 目錄分三份（`zh-TW.ts`／`zh-TW.common.ts`／`zh-TW.share.ts`，各配一個 `en.*`）；`core.ts` 的 `t()`、`t.ts` 註冊 app 目錄 | 分享頁載入的程式 import `t.ts` |
| `worker/index.ts` | Worker 入口：匯出 handler 與 DO class | 其他邏輯 |
| `worker/app.ts` | HTTP 路由：`/api/*`、`/ws/*`、`/s/*`，其餘交給靜態資產 | 直接呼叫外部 API（走 `worker/proxy/*`） |
| `worker/trip-do.ts` | `TripDO`：每旅程一個，WebSocket、patch 廣播、rev | 當真相來源（D1 才是） |
| `worker/proxy/*` | 外部 API 代理：快取、速率、`apiUsage` 計數 | 把金鑰回給前端 |
| `src/` | app 入口（`main.tsx`）、`app/` 路由與殼、`pages/`、`components/`、`map/`、`lib/` | 直接打外部 API |
| `share/` | 分享頁入口（獨立 bundle） | import 編輯器、`react-router-dom`、`src/pages`；在前端隱藏資料 |
| `src/styles/tokens.ts` | 顏色、間距、圓角、字級的唯一來源 | — |
| `migrations/` | D1 遷移，只增不改（`DEPLOY.md` §6） | 修改已合併的檔案 |

## 2. 介面文字（i18n）

- JSX 不得有裸字串（文字，以及 `aria-label`、`title`、`placeholder`、`alt`、`label`）：一律 `t('key')`。
- `shared/i18n/zh-TW.ts` 是來源，先加 key；`en.ts` 同時加同一組 key、同樣的 `{佔位}`。型別與 `npm run check-i18n` 都會擋。
- **目錄分三份，key 放哪裡**：只有 app 用的 → `zh-TW.ts`／`en.ts`（照原本的區塊放，例如 `mapPage.*` 後面）；分享頁自己的 `share.*` → `zh-TW.share.ts`／`en.share.ts`；分享頁與 app 都會用的（`src/map/**`、`shared/i18n/format.ts`、分享頁用到的術語、通用按鈕、語言名稱）→ `zh-TW.common.ts`／`en.common.ts`。app 的 `zh-TW.ts` 展開 common；分享頁由 `share/catalog.ts` 只註冊 common＋share，所以分享頁的 bundle 不帶整份目錄（e8 分享頁預算）。每個 key 只寫在一個檔案。
- **頁面目錄（首屏預算）**：只有某個 lazy 頁面自己用的 key，可以放 `shared/i18n/pages/<頁>.zh-TW.ts`／`<頁>.en.ts`（匯出 `<頁>ZhTW`／`<頁>En`），由 `pages/<頁>.ts` 呼叫 `registerPageCatalog()`，該頁的 lazy entry（例如 `src/pages/itinerary/ItineraryPage.tsx`）加一行 `import '…/shared/i18n/pages/<頁>.ts'`；新的 page key 型別要加進 `pages/keys.ts`，測試註冊在 `pages/all.ts`。「屬於該頁」＝不經過該頁 entry 就載入不到的檔案；共用元件（`src/components/**`）、`src/app/**`、別的頁也會載入的檔案（例如 itinerary 也會開的 `LodgingSheet`、首頁的 `DeadlinesBlock`）、Suspense fallback 用到的 key 一律留在 `zh-TW.ts`。拿不準就放 `zh-TW.ts`（永遠合法，只是進首屏）。目前有 `itinerary`、`bookings`、`dev`、`picks`、`places`、`photos`、`balances`、`stats`、`history`、`settings`（設定頁的 `members.*`、`shares.*`、`settings.*`）、`map`（含 MapPage 裡 lazy 的離線地圖抽屜）、`expenses`、`expense-form`、`admin`、`prep`（四個準備頁共用一份，每個 entry 各 import 一次）。原則上一個 lazy entry 一份目錄；幾個 lazy 頁共用元件（如 `checklists/prep-ui.tsx`）時，可以共用一份目錄、每個 entry 都 import，共用元件的 key 也能搬，檔名用 kebab-case（`expense-form.zh-TW.ts` 匯出 `expenseFormZhTW`）；entry 也可以是「別處 lazy、另一頁靜態 import」的模組（`ExpenseFormSheet`），只要它自己 import 目錄，它底下只經過它載入的檔案就能用。搬走區塊的 key 時，在 `zh-TW.ts`／`en.ts` 原位置留一行 `// <prefix>.* → shared/i18n/pages/<頁>.*.ts (lazy)` 註解，還有共用者的 key 留在註解下方，別的分支插區塊時才好 rebase。
- 分享頁會載入的程式（`share/**`、`src/map/**`、它 import 的元件與 `shared/`）從 `shared/i18n/core.ts` 拿 `t()`、型別，**不要 import `shared/i18n/t.ts`**（它會把整份 app 目錄帶進分享頁）；`src/` 其他地方照舊 import `t.ts`（或用 `useT()`）。只 import 純函式（例如 `format.ts`）的測試要另外 `import '…/shared/i18n/t.ts'` 註冊目錄。
- `npm run check-i18n` 從 `share/main.tsx` 走 import 圖（含 lazy import、barrel 只跟被 import 的名稱），找出分享頁用到的 key（字面字串剛好是 key、複數 base、`` `share.mode.${…}` `` 這種樣板前綴），擋：分享頁用了只在 app 目錄的 key（搬到 common）、common／share 有分享頁沒用到的 key（搬回 `zh-TW.ts`）、分享頁載入 `t.ts`／`zh-TW.ts`／`en.ts`、`src/` 用了 share 專屬的 key 或不存在的 key、同一個 key 寫在兩個檔案（含頁面目錄）；每對 zh-TW／en 檔案（含頁面目錄）各自 key 與佔位一致；頁面目錄的 key 被不屬於該頁的檔案用到（`t()` 字面、key 對照表、樣板前綴都算）→ 失敗並指名「把 key 搬回 `zh-TW.ts`／`en.ts`」；分享頁載入頁面目錄也擋。
- `src/`、`share/` 的程式碼（註解以外）不得出現中日韓文字；真的需要時該行加 `// i18n-ignore`，並在 PR 說明為什麼。
- 介面預設繁體中文；第一次依瀏覽器語言，之後以使用者切換為準（A2）。
- 日期、數字、金額一律經 `Intl` 格式工具（A2 的 e10-t04），不要手拼。

## 3. 金額與時間

- 金額一律**整數分**（minor units）、帶幣別；不用浮點數算錢。分攤總和必須等於原金額，餘數規則見 `ARCHITECTURE.md` §4.3。
- 幣別小數位查 `shared/money/currencies.ts`，不假設都是 2 位（JPY 0 位、部分幣別 3 位）。
- 匯率可手動覆寫，並記下來源（自動／手動）。主幣預設 AUD、第二顯示幣別 TWD。
- 時間存 UTC＋IANA 時區；當地日期不靠瀏覽器時區推算。

## 4. 伺服器把關

- **外部 API 一律經 Worker 代理**（地點搜尋、路線、匯率、連結預覽）：每個代理有快取鍵、TTL、每成員或每旅程的速率限制、`apiUsage` 計數；金鑰只放 Worker secret。
- **分享頁的隱藏在伺服器端**：`/api/share/:token` 回傳的就是過濾後的資料；前端不做隱藏，也不會收到被隱藏的欄位。
- **文件類（護照、保單、收據）只經 Worker 驗權回傳**，回應 `cache-control: no-store`，永不出現在分享頁。照片只存 2048／400 版並去 EXIF。
- 權限與角色在 Worker 判斷；前端的按鈕只是方便，不是把關。
- `/api/*` 的回應預設 `no-store`；不認得的 `/api/*` 回 JSON 404。分享頁加 `noindex`。

## 5. 樣式

- 顏色只來自 `src/styles/tokens.ts`（元件用 `color.*`，是跟著深淺色切換的 CSS 變數）；元件裡不得寫色碼或 `rgb()`。
- 只用於樣式的 prop 加 `$` 前綴（`$tone`、`$active`），避免傳到 DOM。
- 用 styled-components；不另加 CSS 檔或 CSS 框架。

## 6. 依賴與 bundle

- 預算（gzip，`npm run budget` 在 CI 擋）：app 首屏 ≤ 180 kB、分享頁首屏 ≤ 120 kB、MapLibre chunk ≤ 250 kB（`ARCHITECTURE.md` §6）。
- MapLibre 與各頁一律 `lazy()`；分享頁不得靜態 import 地圖。
- 平行開發時，只有被指定的批次可以改 `package.json`、`tsconfig*`、`vite.config.ts`、`wrangler.jsonc`、CI 檔；需要新依賴就寫在 PR 說明，由合併者加。

## 7. 程式風格

- TypeScript strict；不使用 `any`（oxlint 擋）；`erasableSyntaxOnly`（不用 enum、建構子參數屬性）。
- Prettier 設定見 `.prettierrc.json`（無分號、單引號、尾逗號、寬 100）。
- import 寫出 `.ts`／`.tsx` 副檔名。
- 程式碼、註解、commit、分支名稱、PR 標題用英文；文件用繁體中文（台灣用語）。

## 8. 測試

- `tests/shared/`：純函式（money、time、itinerary、i18n）。
- `tests/worker/`：Worker 路由與 handler，用 Worker 的 tsconfig；路由寫在 `worker/app.ts`，不依賴 `cloudflare:workers`，讓 Vitest 直接測。
- `tests/app/`：元件與頁面（之後的批次加 jsdom 與 Testing Library）。
- `e2e/`：Playwright（`npm run test:browser`），對 `BASE_URL`（預設 `http://localhost:5176`）跑；檔名 `.spec.ts`。
- 離線與即時同步的 AC 要兩台裝置實測才能勾。
- 提交前：`npm run lint && npm run typecheck && npm test && npm run build && npm run check-i18n && npm run budget`。

## 9. Commit、分支、PR

- Conventional Commits：`feat:`、`fix:`、`docs:`、`chore:`、`test:`、`refactor:`、`ci:`。
- 一批 = 一個分支 = 一個 PR（`docs/ROADMAP.md`）。分支名帶第一個 task 編號（`feat/e11-t01-skeleton`），PR 標題結尾列出全部編號。
- 不要直接推送 `main`，不要 force-push；合併用 `gh pr merge <號> --squash --delete-branch`。合併前 rebase 到最新 `main`。
- 合併到 `main` 就自動上線：CI 全綠、看過預覽站才合併。
- 在同一個 PR 勾選 epic task、AC（有驗證才勾）、`docs/PRD/README.md` 進度表、`docs/ROADMAP.md`、`docs/NEXT.md`。
