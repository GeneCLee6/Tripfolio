---
title: E7 — 記帳與分帳
date: 2026-11-09
status: planned
epic: E7
owner: GeneCLee6
milestones: [M2]
depends_on: [E1, E10]
---

## 背景

出門玩的記帳有幾個現成 app 做不到或做不好的地方：和行程連在一起（這筆是哪一天哪一站的）、多幣別（紐幣刷卡，回台灣算台幣）、台灣朋友常用的**公基金**（大家先丟一筆現金進池子，池子付公共花費，最後退）、以及「這筆只有三個人分」。這個 epic 的目標是：**手機上 10 秒記完一筆，結算時一張表大家都服氣**。

## 目標

- M2：記一筆、多幣別、公基金、餘額與結算、統計與匯出、修改歷史。

## 非目標

- 連銀行、信用卡帳單匯入。
- 發票辨識（收據照片只是附圖）。
- 債務利息、分期。

## 需求

- **記一筆**：金額與幣別（預設上一筆的幣別）、日期（預設今天，旅程期間用目的地時區）、類別（餐飲／住宿／交通／加油／門票／購物／雜支／其他）、說明、**誰付**（成員或公基金）、**分給誰**（預設全員，可勾選）、**分法**（平均／份數／比例／指定金額／只有我自己）、收據照片、連結行程點（可從當天行程挑）。手機優先、數字鍵盤、最近類別快捷。離線可記，連線後同步。
- **幣別表**（`shared/money/currencies.ts`）：代碼、符號、小數位（IDR／JPY／KRW／VND 0 位，其餘 2 位）、名稱雙語；金額一律以該幣別的最小單位存整數，顯示用 `Intl.NumberFormat`。主幣預設 AUD、第二顯示幣別 TWD，清單與統計每筆同時顯示主幣與第二幣別。
- **多幣別**：每筆存原幣金額、匯率、主幣金額；匯率自動取「那一天」的（Worker 代理匯率 API、D1 每日快取），可手動改並可「把這個匯率套用到這趟所有同幣別的未結算項目」（刷卡實際匯率通常比參考匯率差 1–2%，E7 的 `01-travel-domain-notes.md` §6）；旅程可設預設匯率。
- **公基金**：成員出資入池（金額、幣別、日期）、池付費用（付款人＝池）、池結餘即時顯示、旅程結束「退還結餘」併入結算（結餘按出資比例退，或平均退，可選）。
- **餘額與結算**：每人「應收／應付」（主幣）即時更新；「最少轉帳次數」的結算建議（貪婪：最大債權人配最大債務人）；標記已結清（可部分金額、可記轉帳方式）；結算紀錄可查；結清後再加花費，餘額重算。
- **統計**：每日／類別／人三種切法；每日花費對 E9 預算的進度（旅途中的 burn-down）；每人「實際付出」vs「應分攤」；匯出 CSV（UTF-8 BOM，Excel 可直接開）。
- **歷史**：每筆改動記錄（誰、何時、哪些欄位從什麼改成什麼）、可還原到任一版本；刪除為軟刪並顯示在歷史。

## 設計方向

- 純函式 `split(expense) → shares[]`，用整數「分」（minor units）運算，餘數依「付款人最後拿餘數」規則分配；有完整測試（四種分法 × 2–8 人 × 餘數）。
- 餘額 = Σ 代付 − Σ 分攤 ± 公基金出資／退還 ± 已結清轉帳；全部在前端由完整明細重算（旅程花費不會超過幾千筆），伺服器也算一次對帳。
- `expenses`（tripId、payerMemberId|pool、amountMinor、currency、fxRate、baseMinor、date、category、note、stopId、receiptId、splitMethod、deletedAt）、`expenseShares`（expenseId、memberId、weight|amountMinor、shareMinor）、`poolContributions`、`settlements`（from、to、amountMinor、method、note）、`expenseHistory`（expenseId、memberId、at、diff JSON）。
- 匯率：`fxRates`（date、base、quote、rate、source）；來源見總 PRD Q4；一律允許手動覆寫。
- 純函式已先行實作於 `shared/money/`（分支 feat/shared-pure-core），schema 部分留給 G1。

### API 已有（e7-t01）

- **Migration `0007_expenses.sql`**：`expenses`、`expenseShares`、`poolContributions`、`settlements`、`expenseHistory`、`fxRates`；`trips` 加 `poolRefundMode`（預設 `proportional`）與 `fxOverrides`（JSON，旅程預設匯率）。每筆另存 `fxSource`（`base`／`manual`／`trip`／`auto`）與 `fxDate`，就是「標示來源」。stopId／dayId／收據／booking 不設外鍵（行程點是硬刪，附件與 booking 表之後才有）。
- **路由**（成員 token；viewer 讀、editor 寫，任何 editor 都能改任何一筆，歷史記下是誰改的）：
  - `GET/POST /api/trips/:id/expenses`（篩選 `from`、`to`、`category`、`memberId`＝付款人或分攤人、`q`＝說明關鍵字、`deleted=1` 只看軟刪）；`GET/PATCH/DELETE …/expenses/:eid`；`POST …/expenses/:eid/restore`（`{}` 取消刪除，`{ historyId }` 還原到那一版）；`GET …/expenses/:eid/history`；`GET /api/trips/:id/expense-history?entity=`（整趟的金錢紀錄，新到舊）。
  - `GET …/expenses/summary?by=day|category|member&from=&to=`（主幣分加總；member 另給 `paidMinor` 實付與 `shareMinor` 應分攤）。
  - `POST …/expenses/apply-rate { currency, rate, scope: unsettled|all }`：把手動匯率套到同幣別的花費並重算分攤，每筆一條歷史。「未結算」＝最後一筆結算紀錄之後才記的花費。
  - `GET/POST /api/trips/:id/pool/contributions`、`PATCH/DELETE …/contributions/:cid`、`PATCH /api/trips/:id/pool/settings { refundMode }`。
  - `GET /api/trips/:id/balances`（`computeBalances` 的結果、`poolBalanceMinor`、`suggested`＝`suggestSettlements`）；`GET/POST /api/trips/:id/settlements`、`DELETE …/settlements/:sid`（軟刪）。
  - `GET /api/trips/:id/fx?date=&quote=`、`PUT /api/trips/:id/fx/overrides { "NZD": 0.91 }`（整份取代）。
- **自動匯率（e7-t03，`worker/proxy/fx.ts`）**：來源 open.er-api.com（`FX_API_URL`，免金鑰，供應商每天約 00:00 UTC 更新一次）。`GET /v6/latest/<base>` 的結果對 `currencies.ts` 裡每個已知幣別各寫一列 `fxRates(date＝time_last_update 的 UTC 日期, base, quote, rate, source='open.er-api')`，同日重抓就覆蓋；只存 base→quote 一個方向。
  - **每日**：唯一的 cron `0 17 * * *` 先跑備份、再跑 `refreshAllBases`：未刪除旅程的每個主幣各抓一次，再加 AUD、TWD（一天只有幾次呼叫）；匯率失敗只記 log，不影響備份成敗。
  - **即時補抓**：記帳／改帳解析匯率時，主幣在 `fxRates` 7 天內都沒有列，就在回 422 之前抓一次該主幣的最新匯率再查一次。只有記帳日期在「今天前 7 天到明天」之間才抓（最新匯率幫不了更早或未來的日期）；每個主幣每小時最多一次（`providerThrottle` 的 `fx:<base>`）；失敗一律當成沒有，照舊回 422 needsRate。
  - **手動重抓**：`POST /api/trips/:id/fx/refresh`（editor；每旅程每分鐘 2 次，超過 429＋Retry-After；供應商失敗 502 `provider_error`）→ `{ date, count }`。
  - 每次呼叫記在 `apiUsage(provider='fx')`（cron 與即時補抓的 tripId 記 `*`）；全站每天上限 100 次。
- **匯率解析順序**（匯率＝1 單位該幣等於多少主幣，6 位小數）：與主幣相同 → 1；請求帶 `fxRate`（manual）；旅程預設 `fxOverrides`（trip）；`fxRates` 當天，否則往前最多 7 天內最近的一天（auto）；都沒有 → 422 `fx_unavailable`、`details.needsRate=true`，介面請使用者輸入匯率。`fxRates` 一列的意思是「1 base ＝ rate quote」（open.er-api.com 的形式），兩個方向都接受。每日抓取是 e7-t03。PATCH 只在幣別改了、或日期改了且原本是 auto 時重新取匯率；`fxRate: null` 清掉手動匯率並重新取。
- **分攤**：一律在主幣金額上跑 `splitExpense`；「指定金額」以原幣輸入，先以原幣驗證總和，再把這些金額當權重分配主幣，總和仍等於 `baseMinor`。
- **歷史**：每次建立／修改／刪除／還原寫一條 `expenseHistory`（entity ＝ expense／pool／settlement），`diff` 是 `{ 欄位: [前, 後] }`，`snapshot` 是改完後的完整狀態（含每人分攤），所以可以還原任一版；沒有實際變動的 PATCH 不寫歷史、也不升 rev。
- **被移除的成員**：分攤列保留、餘額照算（`removed: true`，只要還有非零數字就列出）；已經出現在某筆的移除成員，修改那筆時仍可保留，新的引用只能是現任成員。
- 每個寫入都升旅程 `rev`。

## 驗收條件

- [ ] AC-7.1 — 記一筆：所有欄位、五種分法、收據、連行程點；手機上從按「＋」到存檔 ≤ 10 秒（實測）；離線記帳連線後同步。
- [ ] AC-7.2 — 多幣別：自動取當日匯率、手動覆寫、批次套用、旅程預設匯率；結算以主幣；分計算以整數分且總和一致（測試）。
  - 進度（e7-t03）：自動匯率已有——每日 cron（約 17:00 UTC，接在備份後）＋記帳時查不到就即時補抓一次；手動覆寫、批次套用（`apply-rate`）、旅程預設匯率在 e7-t01 已完成。**介面未做**（e7-t02 的匯率欄、422 needsRate 提示），所以 AC 還不勾。
- [ ] AC-7.3 — 公基金：出資、池付、結餘、退還方式二選一、併入結算（測試）。
- [ ] AC-7.4 — 餘額與結算：餘額即時正確；最少轉帳建議（測試含 2–8 人）；部分結清；結算紀錄。
- [x] AC-7.3 — 公基金：出資、池付、結餘、退還方式二選一、併入結算（測試）。（`tests/shared/money/balances-settle.test.ts` 按比例／平均／透支；`e2e/balances.spec.ts` 經 API 出資與池付後，介面的結餘、預估退還與每人餘額等於 `GET /balances`，切換退還方式後退還數字改變；出資的新增／編輯／刪除走 Sheet）
- [x] AC-7.4 — 餘額與結算：餘額即時正確；最少轉帳建議（測試含 2–8 人）；部分結清；結算紀錄。（最少轉帳在 `tests/shared/money/balances-settle.test.ts` 2–8 人；`e2e/balances.spec.ts` 375／1440：每次寫入後重抓 `GET /balances` 且畫面數字一致、部分結清後該筆建議縮小、結算紀錄出現並可刪除還原）
- [ ] AC-7.5 — 統計與匯出：日／類別／人、預算進度、實付 vs 分攤；CSV 在 Excel 正常開。
- [ ] AC-7.6 — 歷史：每筆改動可查、可還原；軟刪可見。

## Task 拆分

### M2

- [x] `e7-t01` schema（`expenses`、`expenseShares`、`poolContributions`、`settlements`、`expenseHistory`、`fxRates`）；`split()` 與 `balances()` 純函式與測試 · AC-7.1, 7.4 · M · ← e1-t03 · `#G1a`（純函式先前已在 `feat/shared-pure-core` 完成；這次是 migration 0007 與 API）
- [x] `e7-t03` 匯率：Worker 代理匯率 API、每日快取、手動覆寫與批次套用、旅程預設匯率 · AC-7.2 · S · ← e7-t01 · `#G1b`（自動抓取；手動覆寫、批次套用、旅程預設匯率已在 e7-t01）
- [ ] `e7-t04` 公基金：出資、池付、結餘卡、退還方式 · AC-7.3 · S · ← e7-t01
- [ ] `e7-t03` 匯率：Worker 代理匯率 API、每日快取、手動覆寫與批次套用、旅程預設匯率 · AC-7.2 · S · ← e7-t01
- [x] `e7-t04` 公基金：出資、池付、結餘卡、退還方式 · AC-7.3 · S · ← e7-t01 · `#G3a`（API 在 e7-t01；介面是餘額頁裡的 `PoolCard`：結餘、出資紀錄增改刪、退還方式 `PATCH /pool/settings`、預估退還）
- [ ] `e7-t02` 記一筆表單（手機優先、數字鍵盤、最近類別、幣別記憶、相機收據、連行程點）＋離線佇列 · AC-7.1 · M · ← e7-t01, e10-t05
- [ ] `e7-t08` 花費清單頁（依日分組、篩選、搜尋、顯示行程點與收據） · AC-7.1 · S · ← e7-t02
- [x] `e7-t05` 餘額頁、最少轉帳結算建議、部分結清、結算紀錄 · AC-7.4 · M · ← e7-t01, e7-t04 · `#G3a`（`src/pages/balances/`，掛在 `/trips/:id/expenses/balances`；`BalanceRow`、`SettleCard`、`PoolCard`、`MyBalanceChip`；「怎麼算的」說明餘數與公基金退還）
- [ ] `e7-t07` 修改歷史與還原、軟刪 · AC-7.6 · S · ← e7-t02
- [ ] `e7-t06` 統計頁（日／類別／人、預算進度、實付 vs 分攤）與 CSV 匯出 · AC-7.5 · M · ← e7-t02

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 分攤有一分錢對不起來，朋友不服 | 整數分運算、餘數規則寫在說明頁、每筆可展開看每人分到多少 |
| 匯率 API 當天沒有 TWD 或服務掛掉 | 退回最近一日；再不行用旅程預設匯率；永遠可手動改並標示來源 |
| 兩個人同時記同一筆 | 清單依時間排、相同金額同分鐘的提示「可能重複」 |

## 未決問題

- [ ] **Q:** 公基金結餘退還預設「按出資比例」還是「平均」？
      **A:** _(建議按出資比例；台灣朋友通常每人丟一樣多，兩者結果相同，但有人多丟時比例才公平)_
