---
title: E1 — 旅程、成員與分享權限
date: 2026-11-09
status: planned
epic: E1
owner: GeneCLee6
milestones: [M0, M1, M2]
depends_on: [E10, E11]
---

## 背景

一趟旅行就是一個「旅程（trip）」：行程、地點、住宿、清單、照片、花費全部掛在它底下。使用者只有朋友圈，所以**不做公開社群、不做帳號門檻**：拿到邀請連結就能進來、選「我是哪一位」、開始編輯與記帳（Tricount 式）。對外分享則是另一條唯讀連結，可以把金額、住宿地址、訂位代號藏起來。

## 目標

- M0：建旅程、拉朋友進來（編輯者）、對外唯讀分享。
- M2：記帳需要穩定的成員身分；選用 Google 登入讓換手機也找得回旅程。

## 非目標

- 公開探索別人的旅程、追蹤、按讚。
- 細到每一頁的權限矩陣：只有 owner／editor／viewer 三種。
- 自建帳號密碼（忘記密碼流程不值得做；要跨裝置就用 Google）。

## 需求

- **旅程**：名稱、目的地（文字＋地圖中心）、日期範圍、時區（目的地）、主幣別（結算用，預設 **AUD**）＋第二顯示幣別（預設 **TWD**）＋當地幣別（可多個，依目的地預填：紐西蘭 NZD、峇里島 IDR、泰國 THB、斐濟 FJD、帛琉 USD、歐洲 EUR）、封面（照片或色塊）、一句話簡介、旅行型態（自駕／露營車／包車／城市／海島跳島／鐵路，影響 E9 範本與 E2 駕駛上限預設）。
- **成員**：名字、頭像色、（選用）Email。成員不是帳號：是「這趟旅程裡的一個人」，記帳的付款人與分攤人都是成員。一台裝置選定「我是誰」後記在 localStorage（memberToken），下次直接進。
- **邀請連結**：`/join/<inviteToken>`，進來就是 editor；owner 可重發、撤銷；進來時選既有成員或新增成員。
- **分享連結**：`/s/<shareToken>` 唯讀、免登入、noindex；選項：隱藏金額、隱藏住宿地址與訂位代號、顯示回顧（E8）；文件夾永遠隱藏、不可選；可撤銷重發。
- **角色**：owner（建立者；可刪旅程、管成員、管分享）、editor（可改一切內容與記帳）、viewer（只看，給被分享連結的人；也可以手動指定成員為 viewer，例如小孩）。
- **選用 Google 登入**：登入後「我的旅程」清單跨裝置；可把登入身分綁到某旅程的某成員。
- **生命週期**：封存（只讀、從清單移到「過去的旅程」）、複製為範本（可選清空日期／花費／照片）、刪除（軟刪 30 天後連 R2 物件一起清，E11）。

## 設計方向

- Worker 的每個 `/api/trips/:id/*` 都經角色中介層；token 三種：`memberToken`（成員＋旅程）、`inviteToken`、`shareToken`，都是 128-bit 隨機值、D1 只存雜湊。
- 「我是誰」的選擇畫面要讓人一眼看到頭像色與名字，避免選錯；選錯可以在設定頁換（owner 會看到一條紀錄）。
- 旅程清單頁是 app 首頁：即將出發（倒數，E9）／進行中／過去的旅程。
- **API 已有**（#A3b，`worker/trips/trips.ts`、`members.ts`、`worker/share.ts`、`worker/auth.ts`；schema 在 `shared/schema`、回應型別在 `shared/api/types.ts`）：
  - `POST /api/trips`（免驗證；建旅程＋owner 成員＋Day 列，回 `memberToken`）、`GET /api/trips`（`X-Member-Tokens` 逗號分隔，回 `tokenIndex`）、`GET/PATCH/DELETE /api/trips/:id`（PATCH 由 editor、`archived` 只限 owner；DELETE 軟刪、只限 owner）。
  - `POST /api/trips/:id/members`、`PATCH/DELETE /api/trips/:id/members/:mid`（owner；成員可改自己的名字／顏色；移除＝標記 removedAt 並撤銷其 token）。
  - `GET/POST /api/trips/:id/invites`、`DELETE /api/trips/:id/invites/:iid`（owner）；`GET /api/join/:token`（「我是誰」預覽，不列 owner）、`POST /api/join/:token`（`{ memberId }` 或 `{ name, color }`，回 `memberToken`；不能認領 owner）。
  - `GET/POST /api/trips/:id/shares`、`DELETE /api/trips/:id/shares/:sid`（owner，`options`：hideMoney／hideAddresses／showRecap）；`GET /api/share/:token`（免驗證，#share `e8-t01a`；型別 `SharePayload` 在 `shared/api/share.ts`）回 `{ trip, days, options, generatedAt }`：`trip` 有名稱、目的地、日期、時區、封面色、簡介、型態、`memberCount`、`dayCount`、`baseCurrency?`、`estimatedPerPersonMinor?`（E9 前不出現）；`days` 只含已分配的天（`idx` 不為 null），每天有 `index`、`date`、`title`、`color`、`note`、`lodgingName`（E4 前為 null）、`stops[]`（`order`、`type`、`name`／`nameEn?`、`lat?`／`lng?`、`address?`、`startAt?`／`endAt?`、`durationMin?`、`note`、`costMinor?`／`currency?`、`booking`、`isBackup`）、`legs[]`（依 legOverrides 與 routeCache 推算，不呼叫外部服務；`source` 為 route／estimate／manual）、`driveMinutes`、`distanceM`。`hideMoney` 拿掉 `costMinor`／`currency`／`baseCurrency`／`estimatedPerPersonMinor`，`hideAddresses` 拿掉 `address`（欄位不存在，不是 null）；撤銷或不存在的 token 回 404 `{ error }`；回應帶 `Cache-Control: private, no-store` 與 `X-Robots-Tag: noindex`。
  - 驗證：`Authorization: Bearer <memberToken>`；無效 401、別的旅程 404、角色不足 403、封存後寫入 403 `trip_archived`、驗證失敗 422；錯誤格式 `{ error: { code, message } }`。

## 驗收條件

- [x] AC-1.1 — 建立旅程：名稱、目的地、日期、時區、幣別、封面、型態；清單頁分「即將出發／進行中／過去」。 · #A3f（Playwright 對本機 Worker＋D1：建立（目的地預填時區與當地幣別、欄位錯誤）→ 進旅程首頁 → 清單出現在「即將出發」含倒數／天數／人數 → 編輯 → 封存後移到「過去的旅程」→ 取消封存；分組與倒數依旅程時區的單元測試含「進行中」）
- [ ] AC-1.2 — 成員與邀請：建立成員、邀請連結進來選「我是誰」並記住；owner 可改名、移除、重發連結；沒有帳號也能用。
- [ ] AC-1.3 — 權限與分享：owner／editor／viewer 在 API 層生效；分享連結唯讀、可選隱藏金額／地址／訂位代號、可撤銷。
- [ ] AC-1.4 — 選用 Google 登入：跨裝置看到自己的旅程清單；可綁定既有成員。
- [ ] AC-1.5 — 生命週期：封存、複製為範本（可清空）、軟刪除 30 天可還原。

## Task 拆分

### M0

- [x] `e1-t01` D1 schema：`trips`、`members`、`invites`、`shares`；`/api/trips` CRUD 與 token 中介層骨架 · AC-1.1 · M · ← e11-t01 · #A3b
- [x] `e1-t02` 旅程清單頁與建立／編輯表單（名稱、目的地、日期、時區、幣別、封面色塊、型態） · AC-1.1 · M · ← e1-t01, e10-t03 · #A3f
- [ ] `e1-t03` 成員模型、邀請連結產生與 `/join` 頁、「我是誰」裝置綁定（memberToken）、設定頁換人 · AC-1.2 · M · ← e1-t01
- [ ] `e1-t04` 角色中介層（owner／editor／viewer）與前端依角色隱藏編輯 UI · AC-1.3 · S · ← e1-t03
- [ ] `e1-t05` 分享連結：shareToken、`/s/<token>` 路由接 E8 唯讀頁、隱藏選項、撤銷重發、noindex · AC-1.3 · M · ← e1-t04, e8-t01a

### M1–M2

- [ ] `e1-t06` Google 登入（Worker 端 OAuth code flow、HttpOnly session cookie）、「我的旅程」跨裝置、綁定成員 · AC-1.4 · M · ← e1-t03
- [ ] `e1-t07` 封存、複製為範本（可選清空日期／花費／照片）、軟刪除與還原 · AC-1.5 · S · ← e1-t02

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 朋友選錯「我是誰」，記帳算到別人頭上 | 選人畫面大頭像＋名字；設定頁可換；E7 每筆有歷史可改 |
| 邀請連結外流 | 連結可撤銷重發；旅程只有朋友知道；不做公開索引 |
| 沒帳號的裝置換了就找不到旅程 | 清單頁提示「用 Google 登入保留清單」；邀請連結再點一次也能回來 |

## 未決問題

- [ ] **Q:** 第一版要不要就做 Google 登入？
      **A:** _(建議不要：M0–M2 用邀請連結＋「我是誰」就夠朋友圈用；Google 登入排在 H3，見總 PRD Q2)_
