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
  - 生命週期（#F3a，`e1-t07` 後端，`worker/trips/clone.ts`；型別在 `shared/api/export.ts`）：封存仍是 `PATCH archived`、刪除仍是 `DELETE /api/trips/:id`（設 `deletedAt`）。`POST /api/trips/:id/clone { name, startDate?, keep?: { members, expenses, photos } }`（editor 以上、封存的旅程也可）＝在記憶體裡「匯出 → 匯入」（與 E8 `e8-t03` 同一套），呼叫者成為新旅程 owner、回 `memberToken`；預設清空成員、花費、照片，`startDate` 平移全部日期；保留花費會連成員一起保留；保留照片會在 R2 複製物件（封面與關聯一起換新 id）。`POST /api/trips/:id/restore`（owner；刪除後 30 天內，逾期 410 `restore_expired`、未刪除 409 `not_deleted`）。`GET /api/trips/deleted`（`X-Member-Tokens`，同清單）回已軟刪的旅程＋`deletedAt`、`purgeAt`（＝deletedAt＋30 天）、`canRestore`（owner 且未逾期）。**清除排程（e11-t06）的約定**：`deletedAt` 早於現在減 30 天的旅程，刪掉所有列與 `<APP_ENV>/trips/<tripId>/` 下的 R2 物件；在那之前它會出現在 `/api/trips/deleted`（`canRestore: false`）。
  - 驗證：`Authorization: Bearer <memberToken>`；無效 401、別的旅程 404、角色不足 403、封存後寫入 403 `trip_archived`、驗證失敗 422；錯誤格式 `{ error: { code, message } }`。
- **前端角色（e1-t04，#B3m）**：`src/lib/role.ts`。
  - `can(role, action, { archived? })`，`action` 是 `editContent`（editor 以上）、`manageMembers`／`manageShares`／`archive`／`delete`（owner）；封存的旅程 `editContent`、`manageMembers` 一律 false（API 回 `trip_archived`），`manageShares`／`archive`／`delete` 照角色。
  - **給其他頁面用**：在 `TripLayout` 底下 `const can = useCan(); can('editContent')`（已套用封存狀態）就能決定要不要顯示或停用編輯控制；`useRole()` 取角色；`useApiErrorToast()` 回傳 `(error) => void`，把 `ApiError` 顯示成危險色 toast（403 是「你沒有權限做這件事。」），403 時順便 `reload()` 旅程，讓別處改掉的角色立刻反映到介面。`me`（含 `role`）本來就在 `useTripContext()`。
  - 前端只是方便，把關在 Worker（`RULES.md` §4）。
- **成員與邀請（e1-t03，#B3m）**：設定頁三張卡（`src/pages/members/`）：「旅伴」列出頭像色、名字、角色 chip、「· 你」，owner 可新增（未加入的人、可直接設檢視者）、改名改色、改 editor／viewer（owner 的角色不能改）、移除（不能移除 owner 或自己）；非 owner 只能改自己的名字與顏色。「邀請連結」（owner）：產生後連結只在對話框顯示一次（複製鈕先用 Clipboard API，失敗就選取欄位請人手動複製；沒做 QR），清單只顯示建立時間與「撤銷」。旅程首頁的旅伴改成疊放頭像＋人數（`MemberAvatarRow`），點了到設定頁。
- **「我是誰」與換人**：`/join/:token` 預覽顯示旅程名稱、日期、目的地、名單人數，可認領的人用大頭像＋名字（檢視者加 chip）；加入後 `memberToken` 存 localStorage，同時把邀請 token 記在 **sessionStorage**（只在加入的那個分頁）。設定頁「我是誰」顯示這台裝置是誰；「這不是我」說明一台裝置每趟旅程只記一個身分、要換就再開一次邀請連結選對的人（`POST /api/join` 會換掉這台的 token，原身分不受影響）；同一分頁還留著邀請連結時給一鍵「用加入時的邀請連結重新選」，否則請 owner 再傳一次。owner 不提供換人（owner 不能經邀請認領）。DESIGN 說的「owner 會看到一條紀錄」還沒做（要活動紀錄，留給之後）。

## 驗收條件

- [x] AC-1.1 — 建立旅程：名稱、目的地、日期、時區、幣別、封面、型態；清單頁分「即將出發／進行中／過去」。 · #A3f（Playwright 對本機 Worker＋D1：建立（目的地預填時區與當地幣別、欄位錯誤）→ 進旅程首頁 → 清單出現在「即將出發」含倒數／天數／人數 → 編輯 → 封存後移到「過去的旅程」→ 取消封存；分組與倒數依旅程時區的單元測試含「進行中」）
- [x] AC-1.2 — 成員與邀請：建立成員、邀請連結進來選「我是誰」並記住；owner 可改名、移除、重發連結；沒有帳號也能用。 · #B3m（Playwright `e2e/members.spec.ts` 375／1440 px 對本機 Worker＋D1：owner 產生邀請 → 連結只顯示一次、可複製 → 第二個瀏覽器 context 開 `/join/<token>` 建立 Mia → 進旅程、token 記住；「這不是我」一鍵回到選人畫面；owner 看到 Mia 改成檢視者；owner 手動新增 Leo → 改名 Leon → 移除；撤銷邀請 → 連結顯示「邀請連結無效」）
- [x] AC-1.3 — 權限與分享：owner／editor／viewer 在 API 層生效；分享連結唯讀、可選隱藏金額／地址／訂位代號、可撤銷。 · #B3m、#share、#C1s（角色：#B3m Playwright 驗證檢視者 `PATCH` 回 403、介面依 `useCan()` 隱藏；伺服器端隱藏：#share `worker/share.ts` 依 `hideMoney`／`hideAddresses` 直接不送欄位、Playwright 看過；分享介面：#C1s `e2e/shares.spec.ts` 375／1440 px 對本機 Worker＋D1：owner 建立分享（預設隱藏金額＋地址、回顧預設關）→ 網址只顯示一次、可複製、可在新分頁開啟 → 關閉後頁面不再有 token、清單只列日期與選項 chip → 無 token 的瀏覽器開 `/s/<token>` 看到旅程名稱 → 經邀請加入的編輯者看不到建立按鈕、`GET /shares` 回 403 → owner 確認後撤銷 → `/s/<token>` 顯示「這個連結已失效或不存在」）
- [ ] AC-1.4 — 選用 Google 登入：跨裝置看到自己的旅程清單；可綁定既有成員。
- [ ] AC-1.5 — 生命週期：封存、複製為範本（可清空）、軟刪除 30 天可還原。
  - 進度（#F3a）：封存（#A3b／#A3f）早已完成；複製為範本與還原的 API 完成並有測試（`tests/worker/clone.test.ts`：預設清空成員／花費／照片、可選保留、權限、30 天內還原、逾期 410、已刪清單）。設定頁的「複製為範本」「已刪除的旅程／還原」介面還沒做，所以不勾。

## Task 拆分

### M0

- [x] `e1-t01` D1 schema：`trips`、`members`、`invites`、`shares`；`/api/trips` CRUD 與 token 中介層骨架 · AC-1.1 · M · ← e11-t01 · #A3b
- [x] `e1-t02` 旅程清單頁與建立／編輯表單（名稱、目的地、日期、時區、幣別、封面色塊、型態） · AC-1.1 · M · ← e1-t01, e10-t03 · #A3f
- [x] `e1-t03` 成員模型、邀請連結產生與 `/join` 頁、「我是誰」裝置綁定（memberToken）、設定頁換人 · AC-1.2 · M · ← e1-t01 · #B3m
- [x] `e1-t04` 角色中介層（owner／editor／viewer）與前端依角色隱藏編輯 UI · AC-1.3 · S · ← e1-t03 · #B3m
- [x] `e1-t05` 分享連結：shareToken、`/s/<token>` 路由接 E8 唯讀頁、隱藏選項、撤銷重發、noindex · AC-1.3 · M · ← e1-t04, e8-t01a · #C1s

### M1–M2

- [ ] `e1-t06` Google 登入（Worker 端 OAuth code flow、HttpOnly session cookie）、「我的旅程」跨裝置、綁定成員 · AC-1.4 · M · ← e1-t03
- [x] `e1-t07` 封存、複製為範本（可選清空日期／花費／照片）、軟刪除與還原 · AC-1.5 · S · ← e1-t02 · #F3a（後端；介面待前端）

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 朋友選錯「我是誰」，記帳算到別人頭上 | 選人畫面大頭像＋名字；設定頁可換；E7 每筆有歷史可改 |
| 邀請連結外流 | 連結可撤銷重發；旅程只有朋友知道；不做公開索引 |
| 沒帳號的裝置換了就找不到旅程 | 清單頁提示「用 Google 登入保留清單」；邀請連結再點一次也能回來 |

## 未決問題

- [ ] **Q:** 第一版要不要就做 Google 登入？
      **A:** _(建議不要：M0–M2 用邀請連結＋「我是誰」就夠朋友圈用；Google 登入排在 H3，見總 PRD Q2)_
