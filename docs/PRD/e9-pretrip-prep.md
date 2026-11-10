---
title: E9 — 旅前準備
date: 2026-11-09
status: in-progress
epic: E9
owner: GeneCLee6
milestones: [M3]
depends_on: [E1, E6, E7]
---

## 背景

這是「旅遊專業角度」最容易被漏掉的一塊：行程排好了，但簽證沒辦、保險沒買、國際駕照忘了、露營車的自炊認證不知道是什麼、紐西蘭海關對食物超嚴。這個 epic 把旅行社領隊會幫你做的「行前說明會」變成清單與筆記，而且**依旅行型態帶入範本**。

## 目標

- M3：預算規劃、行前與打包清單（含範本）、文件夾、目的地筆記、倒數與今日卡。

## 非目標

- 代辦簽證、賣保險、連結任何第三方服務。
- 天氣 API（放連結到當地氣象局就好）。

## 需求

- **預算規劃**：類別預算（機票、住宿、租車／交通、加油、餐飲、門票與活動、購物、保險、雜支）、每人預估、與 E7 實際花費對照（旅途中變成 burn-down）；「每人預估」是分享頁概算的來源。
- **清單**：行前待辦（簽證／ETA、保險、國際駕照、SIM／eSIM、換匯、信用卡出國通知、疫苗、租車保險決定、駕駛分工、行李限額）；打包清單（個人＋公用，公用項目可認領「誰帶」：轉接頭、藥品、鍋具）；範本依型態（通用、自駕、露營車、**包車**（司機聯絡、每日包車費與小費、接送點、等待時間）、城市、**海島跳島**（船班、潛水／浮潛預訂、環境稅如帛琉的 Pristine Paradise Environmental Fee、防水袋）、**歐洲鐵路／城市**（申根停留天數、火車通行證、城市稅、扒手防範）、冬季）；勾選即時同步；每個項目可設期限。
- **文件夾**：護照影本、簽證、保單、駕照、國際駕照、疫苗證明；分類；只有成員可看；**永不**進分享頁；R2 物件只經 Worker 驗權回傳。
- **目的地筆記**：緊急電話、插座與電壓、小費習慣、開車規則（左駕、單線橋、限速）、飲用水、海關申報、當地常用 App；從範本帶入可編輯；分享頁可選顯示（對沒去的朋友有用）。
- **倒數與今日卡**：app 首頁「距出發 N 天」；旅途中旅程首頁的「今日卡」：今天的行程、今晚住宿、駕駛時間、待辦、天氣連結、「記一筆」快捷鍵。

## 設計方向

- 範本是 repo 內的 JSON（`shared/templates/*.json`，雙語），帶入時複製成旅程的資料，不連動更新。
- 目的地筆記範本只放「泛用」的（開車規則、插座），不嘗試維護全世界的資料；第一份是紐西蘭，當作範例。
- 今日卡是 PWA 安裝後打開 app 的第一畫面（旅途中）。

## 驗收條件

- [ ] AC-9.1 — 預算：類別與每人預估、與實際對照、burn-down；分享頁概算來源。（#I2：前三項完成並有測試；分享頁概算待 `worker/share.ts` 改用 `getBudgetPerPerson`，之後再勾）
- [x] AC-9.2 — 清單：行前／打包、範本帶入、認領、期限、勾選同步。（#I1：同步目前是頁面每 20 秒＋回到視窗時重抓；TripDO 廣播接上 `notifyTrip` 後改即時，兩台實測未做）
- [x] AC-9.3 — 文件夾：上傳、分類、成員限定、分享頁絕不出現（測試）。（#I2：`tests/worker/prep.test.ts` 建分享連結後斷言 payload 不含任何文件 id、`/api/media/:aid?s=` 對文件回 403）
- [x] AC-9.4 — 目的地筆記：範本帶入、可編輯、分享可選。（#I2：`shareable` 旗標已存；分享頁顯示屬 E8）
- [ ] AC-9.5 — 倒數與今日卡：首頁倒數；旅途中今日卡正確顯示當日內容。

## Task 拆分

### M3

- [x] `e9-t02` 清單 schema（`checklists`、`checklistItems`、assignee、dueDate）與範本 JSON（通用、自駕、露營車、包車、城市、海島跳島、歐洲鐵路／城市、冬季；雙語） · AC-9.2 · M · ← e1-t03
- [x] `e9-t03` 清單頁（行前／打包、認領、期限、範本帶入、同步勾選） · AC-9.2 · S · ← e9-t02
- [x] `e9-t05` 目的地筆記範本（第一份紐西蘭）與編輯、分享可選 · AC-9.4 · S · ← e1-t02
- [x] `e9-t01` 預算 schema 與頁面（類別、每人、對照實際、burn-down）；接分享頁概算 · AC-9.1 · M · ← e7-t06
- [ ] `e9-t06` 倒數與今日卡（app 首頁、旅程首頁、PWA 啟動） · AC-9.5 · S · ← e2-t02, e4-t02
- [x] `e9-t04` 文件夾（上傳、分類、成員限定、分享頁排除測試） · AC-9.3 · S · ← e6-t01, e11-t04

## 實作紀錄（#I1／#I2，分支 `feat/e9-prep`）

- `migrations/0011_prep.sql`：`checklists`、`checklistItems`（assignee、`dueAt`、`templateKey`、`linkHint`）、`budgets`（`tripId`＋`category` 主鍵、`perPerson` 0／1、主幣）、`notes`（`section`、`shareable`）；`attachments.docCategory`。範本的 `templateKey` 在旅程內唯一，帶入兩次不重複；刪掉的項目再帶入會回來。
- API（`/api/trips/:id/`）：`checklists` CRUD、`checklists/:cid/items` CRUD、`POST checklists/apply-template { style, locale }`（通用＋該型態）；`GET/PUT budget`（整張表）、`GET budget/progress`（類別預算 vs 實際、每人、每日 burn-down，實際數字與 `expenses/summary` 同一套 SQL）；`notes` CRUD、`POST notes/apply-template { destination: 'nz', locale }`；`GET documents`、`PATCH documents/:aid { docCategory }`。成員可讀、編輯者可寫。
- 範本：`shared/templates/checklists/{general,roadtrip,campervan,private-driver,city,island,rail,winter}.json`、`shared/templates/notes/nz.json`；行前項目一律「確認…」，官方連結只放根網域，緊急電話留空白給使用者查證後填。`tests/shared/templates.test.ts` 驗 zod、雙語、key、連結。
- 頁面：`/checklists`、`/budget`、`/documents`、`/notes`（各自 lazy chunk）；`PrepLinks`（`src/pages/checklists/PrepLinks.tsx`）給旅程首頁用；`useBudgetProgress(tripId)`（`src/lib/prep/budget.ts`）給統計頁的預算卡用。
- 預算類別多了機票、保險：花費沒有這兩類，進度表標「通常行前付清」，不算入可對照的剩餘。

## 風險與對策

| 風險 | 對策 |
| --- | --- |
| 範本內容過時（簽證規定會改） | 範本只寫「要確認什麼」，不寫「規定是什麼」；附官方連結 |
| 文件夾裝了護照影本，外洩風險 | 只經 Worker 驗權、不進分享、不進快取；刪旅程連帶刪（E11） |

## 未決問題

- [ ] **Q:** 文件夾要不要端對端加密？
      **A:** _(建議不要：R2 at-rest 加密＋驗權就好；端對端會讓換裝置拿不回文件)_
