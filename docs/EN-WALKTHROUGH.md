# 英文走查（e10-t07）

AC-10.2 的英文走查紀錄。範圍：`shared/i18n/**` 每一份英文目錄（`en.ts`、`en.common.ts`、`en.share.ts`、`pages/*.en.ts`）的每一個值，加上 `shared/templates/**` 的英文；並在 375 px 實際打開主要頁面。規則與術語表見 `docs/DESIGN.md` §5。

> 這是 AI 走查，**建議再請一位英文母語（最好是澳洲）使用者實際用一輪**。

## 拼法決定

**英式／澳式拼法**（擁有者住在澳洲，原本的文案也大多已是英式）：colour、traveller、licence、centre、cancelled、uncategorised、Mum、car hire、tyres、jandals（紐西蘭用語，範本裡保留）。程式碼的 `color` 不受影響。唯一的美式拼法 "centered"（開發元件頁）已改成 "centred"。

## 其他統一的寫法

- 不用 "Please"（改掉 4 處：Google 登入失敗、附件上傳失敗、照片超量、回顧載入失敗）。
- 不用縮寫：Couldn't → Could not（5 處）、can’t → cannot；第一人稱按鈕 “I’ll bring it” 保留。
- 彎引號與撇號 “ ” ’：直撇號 `'` 改掉 8 處（Driver’s name、{name}’s shares…）；必吃必買頁原本名稱不加引號，改成和其他頁一樣的 “{name}”（11 處）。
- "and" 取代 "&"：Confirmations and attachments、Food and drink、Sights and activities、Done and log expense、Balances and settling up。
- 術語：「公基金」一律 **Shared fund**（原本畫面上混用 "pool"，改掉 9 處；程式與 API 裡的 `pool` 不動）；「旅伴」一律 **traveller(s)**（原本混用 "travel mate"，改掉 4 處）；「租車」**Car hire**（原本 "Rental"）；預訂類型「火車」**Train**；「雜支」**Misc**（原本記帳寫 "Sundries"、預算寫 "Misc"）；「必吃必買」統稱 **Picks**（頁標題原本 "Must-eats & buys"，分享頁標題用完整的 "Must-eats and must-buys"）。
- 複數：沒有 `.one/.other` 的 key 不能加 key，就改寫句子避開單複數（"{count} more stops" → "More stops: {count}"、"Arrives {n} day(s) after" → "Arrival date: departure date + {n}"、航班跨日 "(+2 day)" → "(+2 d)"、離線地圖與照片整理失敗的數量）。
- 錯誤訊息的檔案大小統一 "File too large (N MB max)"；格式統一 "Images or PDFs only"。

## 各頁

| 頁面／區塊 | 看了什麼 | 改了什麼 |
| --- | --- | --- |
| 通用、旅程列表、建立旅程、加入 | 按鈕、錯誤、空狀態 | travel mate → fellow traveller；目的地提示改寫成自然句（"…are filled in from the destination; you can search for the map location later."）；Google 登入失敗去掉 Please |
| 總覽、今日卡 | 今日卡、期限、行前連結 | "{count} more stops" → "More stops: {count}" |
| 日程 | 行程點、移動段、雨天備案、拖曳 | "＋ Add a stop"（全形加號）→ "+ Add stop"（照術語表）；刪除確認改成 "This cannot be undone. Its legs are removed too."；"Some fields need a fix." → "…need fixing."（和其他表單一致）；手動放針的過時說明（"the map arrives in the next batch"）改寫 |
| 地圖頁 | 圖層提示、離線地圖 | 住宿／Picks 圖層空的提示原本寫 "Shows once lodging arrives"（功能已上線）→ "No lodging yet; add it in Bookings" / "No picks with a place yet" |
| 必吃必買 | 投票、認領、選單、提示 | 頁標題 → "Picks"；所有 {name} 加彎引號；"Which day for {name}?" → "Add “{name}” to which day?"（和日程一致）；放針說明改寫成 "long-press the map on the Map page" |
| 地點庫 | 營業時間、合併 | 跨午夜時段的說明改寫；放針說明改寫；載入失敗句 |
| 預訂、住宿 | 類型、欄位、附件、期限 | Rental → Car hire、Rail → Train；"Nobody pays first yet" → "Payer not decided yet"；誰先付的提示原本寫成「之後才會有」（功能已上線）→ "Fill this in to log it as an expense in one tap"；退房時間用名詞 "Check-out {time}"；Couldn't × 3 |
| 記帳、記一筆 | 分法、匯率、收據 | 撇號；"(from your card statement, say)" → "(for example, from your card statement)"；"Just me" 的錯誤改用 shared fund |
| 餘額、統計、修改紀錄 | 公基金、結算、CSV 欄名 | pool → shared fund；"worked out again" → "recalculated"；"Brought back" → "Restored"；修改紀錄篩選「公基金出資」用 **"Contribution"**（"Shared fund contribution" 在 375 px 讓分頁列橫向溢出，實機看到後縮短） |
| 行前、預算、文件夾、筆記 | 範本、文件上傳 | 上傳格式與大小訊息統一 |
| 回顧 | 錯誤、重試 | 去掉 Please；Retry → Try again（和全站一致） |
| 設定、旅伴、分享連結、旅程檔 | 邀請、分享、身分、匯出入、刪除 | 邀請與分享說明統一 "If a link gets out, revoke it and create a new one."、"Link selected; copy it by hand"；"Unticked, it is just you." → "If unticked, …" |
| 分享頁 | 每日行程、Picks 牆、費用概算 | 標題 "Must eat & must buy" → "Must-eats and must-buys"；"listed apart" → "listed separately" |
| 範本 | 清單與紐西蘭筆記 | 信用卡一句改寫（"…and what the foreign transaction fee is"）；包車小費 "from the pool" → "from the shared fund"；"documents folder" → "Documents"（產品名） |

## 375 px 實機

兩種語言、19 個主要頁面（空狀態為主，字最多）：英文修改紀錄頁發現篩選分頁列溢出（見上），縮短後消失；其餘只有頂列旅程名稱的省略號與日期選單的橫向捲動，都是設計如此。

## 留給之後

- 英文日期是美式順序（"Tue, Nov 10"、"Nov 8 – 15"）：`shared/i18n/format.ts` 用的 Intl 地區是程式碼，不在這批範圍；若要澳式（"Tue 10 Nov"）要改 format 的 locale（建議 `en-AU`）。
- 幾個沒有複數 key 的句子是改寫避開；之後若加 `.one/.other` 可以寫回自然句。
- 未使用的 key（`itinerary.lodging.hint`、`nav.logExpenseSoon` 等）沒有動。
