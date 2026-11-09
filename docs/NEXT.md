# NEXT — 接下來怎麼做（給 AI 協作者與自己的交接手冊）

最後更新 2026-11-09（A1 骨架完成，在本機分支 `feat/e11-t01-skeleton`，尚未合併、尚無 remote）。**完整順序在 [`ROADMAP.md`](ROADMAP.md)**（一批一個 PR）；這份只記「現在的位置」與工作方式。每完成一批就更新「現在的位置」；每個 AI session 開頭只需要讀 `CLAUDE.md` 和這一份。

## 1. 現在的位置

- **2026-11-09 規劃完成，尚未有程式碼。** 名稱拍板 **Tripfolio · 旅誌**；GitHub `GeneCLee6/Tripfolio`（私人）。主幣預設 **AUD**、第二幣別 TWD。擁有者接下來要規劃：紐西蘭露營車、峇里島包車、泰國、斐濟、帛琉、歐洲（型態範本與幣別見 `01-travel-domain-notes.md` §9b）。總 PRD `docs/PRD/00-prd.md`、旅遊領域筆記 `docs/PRD/01-travel-domain-notes.md`、11 個 epic（71 個 task、57 條 AC）、`ROADMAP.md` Phase A–J（跳過 E、M）、`ARCHITECTURE.md`、`DESIGN.md`、`PLANNING-METHOD.md`、視覺稿 `docs/design/mockup.html`、標誌 `docs/design/logo/logo.svg`。
- **平行開發（2026-11-09 擁有者要求）**：A1 之後，互不碰同一個資料夾的批次可以由多個 agent 各自在 worktree 平行做、各開 PR、依序合併（後合併的先 rebase）。分工規則：`shared/**` 純函式一組、`worker/**`＋`migrations/**` 一組、`src/**` 一組；共用的設定檔（`package.json`、`tsconfig*`、`vite.config.ts`、`wrangler.jsonc`）只有 A1 和明確被指定的批次可以改。ROADMAP 的批次內容不變，只是幾批同時進行。
- **2026-11-09 A1 完成（`e11-t01`，#A1，本機分支 `feat/e11-t01-skeleton`，尚無 remote）。** 有什麼：Vite＋React 19＋TS strict＋styled-components 骨架，兩個入口（`index.html` app、`share.html` 分享頁獨立 bundle）；`worker/`（`app.ts` 路由：`GET /api/health`、其他 `/api/*` JSON 404、`/s/*` 交給 `share.html` 並加 noindex、其餘 SPA fallback；`trip-do.ts` 只回 ping 的 `TripDO`，SQLite migration `v1`）；`migrations/0001_init.sql`（只有 `meta`）；`shared/i18n/`（`t()` 雛形、`zh-TW.ts` 來源、`en.ts`）；`src/styles/tokens.ts`（DESIGN §2 的色票，A2 補完）；`scripts/check-budget.mjs`（app 180、share 120、MapLibre 250 kB gzip）、`scripts/check-i18n.mjs`；`.github/workflows/ci.yml`、`deploy.yml`、`preview.yml`（沒有 secret 時 notice 跳過）；`DEPLOY.md`、`RULES.md`；Playwright 只有設定。**Cloudflare 資源已建**：D1 `tripfolio`（`3a5cba15-…`）、`tripfolio-staging`（`2565701d-…`）、R2 `tripfolio-media`、`tripfolio-backups`，id 已填進 `wrangler.jsonc`。驗證過：本機 lint／typecheck／test（9 個）／build／check-i18n／budget 全過（app 94.2 kB、share 80.6 kB）；`npm run dev` 實測 `/api/health`、JSON 404、SPA fallback、`/s/<token>`；本機 D1 套用 0001；正式與預覽設定 `wrangler deploy --dry-run` 綁定正確。**還沒做**：沒有部署過（沒跑 `wrangler deploy`）、GitHub repo 與 remote 未建、`CLOUDFLARE_API_TOKEN`／`CLOUDFLARE_ACCOUNT_ID` 未設、workflow 沒在 GitHub 跑過（所以 AC-11.1、11.2 未勾）、分支保護未設；cron 留註解（e11-t03）。注意：分享頁首屏已有 80.6 kB（React＋styled-components），離 120 kB 預算只剩約 40 kB；預覽與正式共用 R2 bucket，之後寫 R2 的批次要分前綴（`DEPLOY.md` §2）。
- **2026-11-09 純函式核心提前完成（分支 `feat/shared-pure-core`，已 ff 合併進 main）。** `shared/money/`（`currencies.ts` 幣別表含小數位、預設 AUD／TWD；`split.ts` 五種分法與餘數規則；`fx.ts`；`balances.ts` 含公基金按比例／平均退還、透支時由出資者承擔；`settle.ts` 最少轉帳貪婪法）、`shared/time/`（`sun.ts` NOAA 日出日落、`tz.ts` UTC＋IANA，含 NZDT 轉換測試；時區縮寫來自 Intl 是「GMT+13」不是「NZDT」）、`shared/itinerary/`（`legs.ts` 移動段估算與每日合計、`checks.ts` 四種警示）。107 個測試。`TripStyle` 同時收 ARCHITECTURE 與 E1 的型態名（self-drive／roadtrip／campervan／private-driver／island／city／rail／winter／other），包車／海島／城市／鐵路不算駕駛上限、標 `ride`。這些 task（e7-t01 的純函式部分、e2-t05／e2-t06 的計算部分）在 epic 裡**尚未打勾**，等 G1／B2／B3 接上 schema 與畫面時一併勾。
- **下一步：A2（`src/` token／元件／i18n／格式）與 A3 後端（`worker/`＋`migrations/`＋`shared/schema`：trips／members／invites／shares／days／stops／places API）兩個 agent 平行進行中；合併後做 A3 前端（app 殼、旅程清單）。擁有者要先建 GitHub repo、設 secret（§2）。**

## 2. 待擁有者決定（開工前）

| 問題 | 在哪一批之前 | 決定 |
| --- | --- | --- |
| ~~Q1 產品名稱~~ | — | 已拍板（2026-11-09）：Tripfolio · 旅誌 |
| ~~Q1b 預設繁中、繁中為來源語言~~ | — | 已拍板：是 |
| ~~Q2 身分方式~~ | — | 已拍板：邀請連結＋「我是誰」；Google 登入排 H3 |
| ~~Q3 地圖／搜尋／路線 provider~~ | B2 | 已拍板：MapLibre＋OpenFreeMap、Photon＋Nominatim、OpenRouteService；**擁有者要在 B2 前註冊 ORS 金鑰並 `wrangler secret put ORS_API_KEY`** |
| ~~Q4 匯率來源~~ | — | 已拍板：open.er-api.com，永遠可手動覆寫 |
| ~~Q5 主幣別~~ | — | 已拍板：預設 AUD、第二幣別 TWD，每旅程可改 |
| Q6 Email 提醒 | M3 | 先不做 |
| **部署 secret** | A1 合併後 | 擁有者在 GitHub repo 設 `CLOUDFLARE_API_TOKEN`（同 TKU Arcade 的 token 即可；`CLOUDFLARE_ACCOUNT_ID` 已設）；沒設之前部署 workflow 會跳過不會失敗 |

## 3. 工作方式（每批）

1. **在 worktree 開分支**：`git worktree add ../_wt/<分支> -b feat/<第一個 task 編號>-<slug>`。
2. **只讀需要的段落**：`CLAUDE.md`、這份、`ROADMAP.md` 的該批、該批 task 所在的 epic 段落、相關的 `ARCHITECTURE.md` 章節。不要整本讀。
3. **做完跑** `npm run lint && npm run typecheck && npm test && npm run build`，只看最後 5 行。
4. **一批一個 ready PR**：標題英文、結尾列出全部 task 編號；本文（繁中）寫對應 AC、怎麼驗證、實測結果（離線與同步要兩台裝置）。
5. **在同一個 PR 更新文件**：epic 勾選 task（寫 PR 號）、AC 勾選（有驗證才勾）、`PRD/README.md` 進度表、`ROADMAP.md` 該批 `[x]` 與 PR 號、這份「現在的位置」。
6. **CI 綠了直接合併**（`gh pr merge --squash --delete-branch`），需要人決定的事才停下來問。
7. 合併後回報：做了什麼、PR 號、下一批是哪一批、有沒有等人決定的事。

## 4. 不要做的事

- 不要重做規劃、不要改批次順序；覺得順序有問題就在回報裡說，讓擁有者改 ROADMAP。
- 不要在 JSX 寫裸字串；介面文字一律 `t('key')`，zh-TW 與 en 同時加。
- 不要在前端直接打外部 API（地圖搜尋、路線、匯率）；一律經 Worker 代理、快取、計數。
- 不要用浮點數算錢；金額一律整數分，分攤總和要等於原金額。
- 不要在分享頁用前端隱藏金額或地址；過濾在 Worker 端。
- 不要把照片原檔、文件存進 repo 或公開 R2 路徑；文件類只經 Worker 驗權回傳。
- 不要直接推 `main`、不要 force-push。
- 名稱（Q1）未拍板前不要把工作名稱寫死在 Worker 名、bucket 名、網域。
