# RULES — 工程慣例

`CLAUDE.md` 是硬性規則的摘要；這份寫成工程上的做法。架構見 `docs/ARCHITECTURE.md`，介面、token 與術語見 `docs/DESIGN.md`，部署見 `DEPLOY.md`。

## 1. 分層與職責

| 位置 | 職責 | 禁止 |
| --- | --- | --- |
| `shared/` | 前後端共用的型別與純函式（協定、patch、money、time、itinerary、schema、i18n） | React、DOM、Cloudflare API；讀時間或隨機數不經注入 |
| `shared/i18n/` | `zh-TW.ts`（來源）、`en.ts`、`t()` | — |
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
