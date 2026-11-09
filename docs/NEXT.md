# NEXT — 接下來怎麼做（給 AI 協作者與自己的交接手冊）

最後更新 2026-11-09（規劃完成，尚無程式碼）。**完整順序在 [`ROADMAP.md`](ROADMAP.md)**（一批一個 PR）；這份只記「現在的位置」與工作方式。每完成一批就更新「現在的位置」；每個 AI session 開頭只需要讀 `CLAUDE.md` 和這一份。

## 1. 現在的位置

- **2026-11-09 規劃完成，尚未有程式碼。** 名稱拍板 **Tripfolio · 旅誌**；GitHub `GeneCLee6/Tripfolio`（私人）。主幣預設 **AUD**、第二幣別 TWD。擁有者接下來要規劃：紐西蘭露營車、峇里島包車、泰國、斐濟、帛琉、歐洲（型態範本與幣別見 `01-travel-domain-notes.md` §9b）。總 PRD `docs/PRD/00-prd.md`、旅遊領域筆記 `docs/PRD/01-travel-domain-notes.md`、11 個 epic（71 個 task、57 條 AC）、`ROADMAP.md` Phase A–J（跳過 E、M）、`ARCHITECTURE.md`、`DESIGN.md`、`PLANNING-METHOD.md`、視覺稿 `docs/design/mockup.html`、標誌 `docs/design/logo/logo.svg`。
- **平行開發（2026-11-09 擁有者要求）**：A1 之後，互不碰同一個資料夾的批次可以由多個 agent 各自在 worktree 平行做、各開 PR、依序合併（後合併的先 rebase）。分工規則：`shared/**` 純函式一組、`worker/**`＋`migrations/**` 一組、`src/**` 一組；共用的設定檔（`package.json`、`tsconfig*`、`vite.config.ts`、`wrangler.jsonc`）只有 A1 和明確被指定的批次可以改。ROADMAP 的批次內容不變，只是幾批同時進行。
- **下一步：A1（repo 骨架）由單一 agent 先做完並合併；接著 A2（`src/`）、A3 後端（`worker/`＋`shared/schema`）、以及提前的純函式批（`shared/money`、`shared/time`、`shared/itinerary`，對應 e7-t01 的 split／balances、e2-t06 的日出日落、e2-t05 的移動段計算）三個 agent 平行。**

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
