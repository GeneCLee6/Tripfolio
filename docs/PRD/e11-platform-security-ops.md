---
title: E11 — 平台、安全、成本與維運
date: 2026-11-09
status: planned
epic: E11
owner: GeneCLee6
milestones: [M0, M1, M2, M3]
depends_on: []
---

## 背景

技術棧沿用淡江系列與 LongTalk：Cloudflare Workers（帶靜態資產）＋ D1 ＋ R2 ＋ Durable Objects（只用在即時同步）。新的風險點是**隱私**（護照影本、住宿地址、花費）與**外部 API 配額**（地圖搜尋、路線、匯率）。全程要在免費額度內。

## 目標

- M0：部署、CI、備份。
- M1–M3：安全強化、用量頁、刪除連帶清理、隱私頁。

## 非目標

- 多區域、高可用、SLA。
- 付費方案。

## 需求

- **部署**：單一 Worker（靜態資產＋API＋DO）、D1（正式／staging）、R2（`tripfolio-media`、`tripfolio-backups`）、PR 預覽 Worker、`main` CI 綠自動上線；`DEPLOY.md`。
- **CI**：oxlint、tsc、vitest、build、`check-i18n`、bundle 預算（主 app 首屏 ≤ 180 kB gzip、分享頁 ≤ 120 kB、地圖 chunk 另計 ≤ 250 kB）。
- **備份**：D1 每日匯出到 R2（保留 30 天）；R2 媒體不另備份（說明在隱私頁）；還原步驟文件。
- **安全**：三種 token 128-bit、D1 存雜湊；memberToken 綁旅程；速率限制（建旅程、搜尋、路線、上傳簽發）；上傳限型別與大小（圖 ≤ 50 MB 原檔、文件 ≤ 20 MB）；文件類 R2 物件只經 Worker 驗權回傳且 `Cache-Control: private, no-store`；分享頁伺服器端過濾；所有頁 `noindex`（這不是公開網站）；CSP。
- **成本與配額**：用量頁（擁有者）：Workers 請求、D1 讀寫、R2 容量、DO 時數、外部 API 今日用量（Photon／Nominatim／ORS／匯率）；80% 警示（頁面＋ Worker 日誌）。
- **隱私**：個資最少化（成員只有名字；Email 選填）；刪旅程 30 天後連 R2 物件一起刪；隱私說明頁（存什麼、誰看得到、怎麼刪）。

## 設計方向

- 與 TKU Arcade 相同的 repo 骨架與 CI 檔，複製後改名；`RULES.md` 寫硬性規則。
- 外部 API 代理統一在 `worker/proxy/*.ts`，每個有：快取鍵、TTL、速率、配額計數（D1 `apiUsage` 表，按日）。

## 驗收條件

- [ ] AC-11.1 — 部署：PR 預覽與 `main` 自動上線可用；`DEPLOY.md`。
  - 進度（A1）：`DEPLOY.md`、`deploy.yml`、`preview.yml` 已有；正式與預覽設定以 `wrangler deploy --dry-run` 確認綁定正確（正式 D1 `tripfolio`、預覽 `tripfolio-staging`）。**workflow 還沒在 GitHub 跑過**（尚無 remote、未設 `CLOUDFLARE_API_TOKEN`），也還沒部署過，所以不勾。
- [ ] AC-11.2 — CI：lint／typecheck／test／build／check-i18n／bundle 預算全部在 CI 擋。
  - 進度（A1）：六個步驟都寫進 `ci.yml`，本機六個指令全部通過；**`ci.yml` 還沒在 GitHub Actions 跑過**，等 repo 建立、第一個 PR 跑綠才勾。
- [ ] AC-11.3 — 備份：每日備份到 R2 並實際還原一次成功。
- [ ] AC-11.4 — 安全：token 規格、速率限制、上傳限制、文件驗權、伺服器端過濾、noindex、CSP 都有測試或實測紀錄。
- [ ] AC-11.5 — 成本：用量頁顯示六項指標與外部 API 配額；80% 警示。
- [ ] AC-11.6 — 隱私：刪旅程連帶刪 R2（測試）；隱私頁上線。

## Task 拆分

### M0

- [x] `e11-t01` repo 骨架（Vite／React／TS、worker、shared、wrangler：D1＋R2＋DO、Vitest、oxlint、CLAUDE.md、RULES.md）、CI、PR 預覽、自動部署、`DEPLOY.md` · AC-11.1, 11.2 · M · #A1
- [ ] `e11-t02` bundle 預算腳本（三個入口）與 `check-i18n` 進 CI · AC-11.2 · S · ← e10-t02
- [ ] `e11-t03` 每日備份 cron 與還原文件、實際還原一次 · AC-11.3 · S · ← e1-t01

### M1–M2

- [ ] `e11-t06` 刪旅程連帶清 R2、隱私頁、noindex 與 CSP 檢查 · AC-11.6 · S · ← e1-t07
- [ ] `e11-t04` 速率限制、token 規格與測試、上傳限制、文件驗權讀取、`apiUsage` 計數 · AC-11.4 · M · ← e6-t01

### M3

- [ ] `e11-t05` 用量頁（Cloudflare GraphQL Analytics＋自計數）與 80% 警示 · AC-11.5 · M · ← e11-t04

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 外部 API 配額被一個人狂搜用完 | 每成員每分鐘限制、結果快取、配額計數與警示；超過改用後備 |
| R2 免費 10 GB | E6 容量警示；只存 2048 版；封存旅程可清照片 |

## 未決問題

- [ ] **Q:** 要不要自訂網域？
      **A:** _(建議先用 `*.workers.dev`，名稱拍板後再買)_
