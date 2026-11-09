# NEXT — 接下來怎麼做（給 AI 協作者與自己的交接手冊）

最後更新 2026-11-09（規劃完成，尚無程式碼）。**完整順序在 [`ROADMAP.md`](ROADMAP.md)**（一批一個 PR）；這份只記「現在的位置」與工作方式。每完成一批就更新「現在的位置」；每個 AI session 開頭只需要讀 `CLAUDE.md` 和這一份。

## 1. 現在的位置

- **2026-11-09 規劃完成，尚未有程式碼、尚未 `git init` 到遠端。** 工作名稱 **Tripfolio · 旅誌**（未拍板）。總 PRD `docs/PRD/00-prd.md`、旅遊領域筆記 `docs/PRD/01-travel-domain-notes.md`、11 個 epic（71 個 task、57 條 AC）、`ROADMAP.md` Phase A–J（跳過 E、M）、`ARCHITECTURE.md`、`DESIGN.md`、`PLANNING-METHOD.md`、視覺稿 `docs/design/mockup.html`、標誌 `docs/design/logo/logo.svg`。
- **下一步：擁有者拍板 §2 的 Q1（名稱），然後 A1。**

## 2. 待擁有者決定（開工前）

| 問題 | 在哪一批之前 | 建議 |
| --- | --- | --- |
| Q1 產品名稱 | A1 | Tripfolio · 旅誌（備選 Wayfolio · 行旅簿、Roam & Ledger · 旅帳） |
| Q1b 預設繁中、繁中為來源語言 | A2 | 是；第一次依瀏覽器語言，非 `zh*` 用英文 |
| Q2 身分方式 | H3 | 邀請連結＋「我是誰」；Google 登入排 H3 |
| Q3 地圖／搜尋／路線 provider | B2 | MapLibre＋OpenFreeMap、Photon＋Nominatim、OpenRouteService（要註冊金鑰） |
| Q4 匯率來源 | G1 | open.er-api.com（有 TWD）；永遠可手動覆寫 |
| Q5 主幣別預設 TWD、結算只用主幣 | G1 | 是 |
| Q6 Email 提醒 | M3 | 先不做 |

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
