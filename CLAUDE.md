# CLAUDE.md — Tripfolio · 旅誌

給 Claude Code 的專案說明。開始工作前先讀 `docs/NEXT.md`；實作後會補 `RULES.md` 與 `ARCHITECTURE.md` 的實作細節。

## 這是什麼

給擁有者和同行朋友用的自由行手冊：規劃時像旅行社的行程頁（每日行程、地圖路線、住宿、必吃必買、價位），出門時像共同錢包（多幣別記帳、公基金、分攤、結算），結束後翻面變遊記。**只給朋友，不做社群、不營利。** 介面**預設繁體中文**、可切英文（第一次依瀏覽器語言）。技術與淡江牌桌（`C:\dev\TKU-BridgeTable`）、LongTalk、TKU Arcade 相同：React 19 + TypeScript（strict）+ styled-components + Vite；Cloudflare Workers（帶靜態資產）+ D1 + R2 + Durable Objects（只用在即時同步）；地圖 MapLibre GL JS。

## 先讀

| 情境 | 讀 |
| --- | --- |
| 現在做到哪、下一批是什麼 | `docs/NEXT.md` |
| 批次順序 | `docs/ROADMAP.md` |
| 產品範圍、某個功能的 AC 與 task | `docs/PRD/00-prd.md`、`docs/PRD/e*.md` |
| 旅遊領域知識（駕駛上限、公基金、隱私） | `docs/PRD/01-travel-domain-notes.md` |
| 架構、資料模型、外部服務切換 | `docs/ARCHITECTURE.md` |
| 介面、token、i18n 規則、術語表 | `docs/DESIGN.md`、`docs/design/mockup.html` |

## 硬性規則

1. **介面文字一律走 i18n**：`t('key')`，`zh-TW.ts` 是來源、`en.ts` 必須同步；JSX 不得有裸字串；`npm run check-i18n` 在 CI 擋。
2. **金額一律整數分**（minor units），分攤總和必須等於原金額；匯率可手動覆寫並標示來源。餘數規則見 `ARCHITECTURE.md` §4.3。
3. **外部 API 一律經 Worker 代理**（地點搜尋、路線、匯率、連結預覽）：快取、速率限制、`apiUsage` 計數、金鑰不落前端。
4. **分享頁的隱藏在伺服器端**：`/api/share/:token` 回傳的就是過濾後的資料；前端不做隱藏。
5. **文件類（護照、保單、收據）只經 Worker 驗權回傳**、`no-store`、永不進分享頁；照片只存 2048 版並去 EXIF。
6. **顏色只來自 `src/styles/tokens.ts`**；只用於樣式的 prop 加 `$` 前綴。
7. **不要直接推送到 `main`，也不要 force-push。** 功能走分支＋PR，合併用 `gh pr merge <號> --squash --delete-branch`。
8. **合併到 `main` 就會自動上線**；PR 要 CI 全綠、看過預覽站才合併。
9. 程式碼、註解、commit、**PR 標題**用英文；文件用繁體中文（台灣用語）；介面兩語都要。
10. **一批一個 PR**，照 `docs/ROADMAP.md` 的批次號；在同一個 PR 更新 epic 勾選、`PRD/README.md` 進度表、ROADMAP、NEXT。
11. 離線與即時同步的 AC（E2 AC-2.6、E3 AC-3.5、E10 AC-10.4）要兩台裝置實測才能勾。
12. **多個 agent 平行時**（`docs/NEXT.md` §1）：只改自己被指派的資料夾；`package.json`、`tsconfig*`、`vite.config.ts`、`wrangler.jsonc`、CI 檔只有被明確指定的批次可以改，需要新依賴就在 PR 說明裡寫、由合併者加；合併前 rebase 到最新 `main`。
13. 主幣別預設 **AUD**、第二顯示幣別 **TWD**；幣別小數位查 `shared/money/currencies.ts`，不要假設都是 2 位。

## 指令（A1 之後生效）

```bash
npm run dev          # http://localhost:5176（牌桌 5173、橋館 5174、Arcade 5175）
npm run build        # tsc -b + vite build（app、share 兩個入口）
npm run lint         # oxlint
npm run typecheck    # tsc -b
npm test             # vitest run
npm run check-i18n   # en 與 zh-TW 的 key 一致、JSX 無裸字串
npm run budget       # 三個入口的 gzip 預算
npm run test:browser # Playwright（拖曳、記一筆、分享頁、axe）
npm run deploy       # 手動部署（通常不用，main 自動）
```
