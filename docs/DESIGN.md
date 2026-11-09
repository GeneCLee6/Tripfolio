# DESIGN — 設計規格與 i18n 規則（規劃版，2026-11-09）

視覺稿：[`design/mockup.html`](design/mockup.html)（四個畫面：旅程總覽、日程＋地圖、必吃必買、記帳與結算）。標誌：[`design/logo/logo.svg`](design/logo/logo.svg)。

## 1. 調性

- **旅遊雜誌，不是儀表板。** 骨白（偏冷、帶一點綠）的紙感底色、峽灣墨綠主色、叢草金點綴、冰川淡青做底；標題用有個性的寬體無襯線（Bricolage Grotesque），內文 IBM Plex Sans，數字、座標、日期一律等寬字（IBM Plex Mono）——地圖與帳本的味道來自等寬數字與等高線紋理，不來自花俏裝飾。照片大、留白多；資訊密度靠層級（標題／副標／註記）而不是靠邊框。刻意避開「米白＋襯線＋陶土橘」這種一看就是 AI 生成的組合。
- 每一天一個「日色」（10 色循環，低飽和、彼此可辨），日程頁、地圖針、路線、分享頁的每日卡都用同一個色，看地圖就知道是哪一天。
- 深色模式要有：底色換成深墨、紙感改成淡紋理；照片不變。

## 2. Token（`src/styles/tokens.ts`，唯一來源）

| 類別 | 淺色 | 深色 |
| --- | --- | --- |
| `paper`（底，骨白） | `#EDEFEA` | `#121A1D` |
| `card`（卡片） | `#F8F9F6` | `#1A2427` |
| `ink`（主文字） | `#17262B` | `#E6ECE8` |
| `muted`（次文字） | `#5F6E72` | `#97A6A9` |
| `line`（分隔） | `#D5DCD6` | `#2A373B` |
| `fjord`（峽灣墨綠，主動作） | `#0F6E74` | `#5FB6BC` |
| `fjordInk`（深墨綠，封面底） | `#0A4F54` | `#9ADCE0` |
| `glacier`（冰川淡青，軟底） | `#CDE7EA` | `#173B40` |
| `tussock`（叢草金，價格／強調） | `#B88A1E` | `#D9AE4A` |
| `tussockSoft`（金色軟底，公基金） | `#F1E7C8` | `#3A3217` |
| `success`／`warning`／`danger` | `#3C8C5A`／`#C9892B`／`#B9483A` | `#6BC08A`／`#E0A552`／`#E07A6C` |

- **日色**（10）：`#0F6E74` 墨綠、`#B5654A` 赭、`#5B7B4A` 苔綠、`#4C6A92` 靛、`#8B5E83` 紫灰、`#3F8F8A` 湖綠、`#A64B4B` 磚紅、`#C99A3B` 芥末、`#6E8B3D` 橄欖、`#7A6A5A` 岩棕。
- 間距：4 的倍數（4、8、12、16、24、32、48、64）。
- 圓角：10（輸入、按鈕）、14（卡片）、22（封面、底部抽屜）。
- 字級：13、15、17、20、26、34；行高 1.55（內文）、1.15（標題）。
- 字型：標題 **Bricolage Grotesque**（variable、OFL）＋ **Noto Sans TC**（700）；內文 **IBM Plex Sans** ＋ **Noto Sans TC**；數字、座標、日期、金額 **IBM Plex Mono** 並 `font-variant-numeric: tabular-nums`。全部登記 `docs/ASSETS.md`。
- 紋理：等高線（SVG pattern，`fjord` 色、透明度 0.2）只用在封面與地圖底，不用在內文區。
- 陰影：只有卡片懸浮時一層淡陰影；平常靠底色差。

## 3. 元件

Button（primary／secondary／ghost／danger）、IconButton、Input、Select、DateField、TimeField、MoneyField（幣別 chip＋數字鍵盤）、Card、Sheet（手機底部抽屜，可拖）、Dialog、Tabs、SegmentedControl、Chip（類別、幣別、狀態）、Toast、Avatar（名字首字＋成員色）、EmptyState（有插圖的空狀態）、Skeleton、Timeline（日程左側的線與圓點，圓點是日色）、StopCard、LegRow（兩個行程點之間的「🚗 1 小時 20 分 · 95 km」細行）、DayChip、MapFrame、PlacePicker、PhotoGrid、Lightbox、BalanceRow、SettleCard、ChecklistItem。

樣式只用 styled-components，樣式 prop 加 `$`；顏色只從 token。

## 4. 版面

- **手機（< 768）**：單欄；底部導覽五格（總覽／日程／地圖／清單／記帳），旅途中第一頁是「今日卡」；「＋記一筆」是底部導覽中央的浮動鈕；編輯用 Sheet 不用整頁跳轉。
- **平板（768–1199）**：兩欄：左日程、右地圖；細節用 Sheet。
- **桌機（≥ 1200）**：三欄：左 Day 導覽＋日程（360 px）、中地圖（彈性）、右細節抽屜（400 px，選到行程點才出現）。
- **日程頁**：頂部 Day chip 橫向捲動（日色底、日期、標題）；每日區塊：標題列（Day N · 日期 · 住宿 · 駕駛合計）→ Timeline（行程點卡 ＋ LegRow）→ 雨天備案摺疊 → 「＋加行程點」。
- **地圖頁**：全螢幕地圖；頂部浮動 SegmentedControl（全程／Day N）；右上圖層鈕；點針出現底部卡。
- **必吃必買**：Masonry 兩欄（手機）／三欄（桌機）卡片牆；卡片＝圖、類別 chip、名稱（襯線）、價格、推薦人頭像、想去人數。
- **記帳**：餘額卡在最上（我的餘額大字、應收綠／應付珊瑚）、下面依日分組的花費列；結算頁是「A → B NZD 123」的卡片列，可勾已結清。
- **分享頁**：封面全幅（照片或日色漸層）＋標題＋日期＋人數；路線總圖；每日卡（左側日色邊條）；精選卡片牆；概算表；頁尾「用 Tripfolio 規劃」小字。

## 5. i18n 規則

1. **繁中是來源語言**：先寫 `zh-TW.ts`，再翻 `en.ts`；key 以語意命名（`itinerary.addStop`），不以句子當 key。
2. **禁止裸字串**：JSX 可見文字一律 `t()`；`scripts/check-i18n.mjs` 擋 en 缺 key 與多餘 key，另一支 grep JSX 的 CJK 與長英文字串。
3. **數字、日期、金額、時長、距離**用 `Intl` 與 `shared/i18n/format.ts`，不要手拼。
4. **繁中語氣**：台灣用語、短句、動詞開頭（「加行程點」「記一筆」「結算」）；不用簡中詞彙（「創建」「視頻」「打車」）。
5. **英文語氣**：短、直接、動詞開頭（"Add stop"、"Log expense"、"Settle up"）；不用 "Please"。
6. **內容語言**：使用者填的內容（行程點名稱、備註）是單語，不翻譯；地點有 `nameLocal`／`nameEn`，介面語言是英文時優先顯示 `nameEn`。
7. **術語表**（兩語對照，隨功能加）：

   | zh-TW | en |
   | --- | --- |
   | 旅程／日程／行程點／移動段 | Trip / Itinerary / Stop / Leg |
   | 口袋名單／雨天備案 | Pocket list / Rainy-day plan |
   | 必吃／必買／必看／體驗 | Must-eat / Must-buy / Must-see / Experience |
   | 住宿／預訂／取消期限 | Lodging / Booking / Cancel by |
   | 記一筆／分攤／誰付／公基金 | Log expense / Split / Paid by / Shared fund |
   | 餘額／應收／應付／結算 | Balance / Gets back / Owes / Settle up |
   | 主幣別／匯率 | Base currency / Exchange rate |
   | 行前清單／打包清單／文件夾 | Pre-trip checklist / Packing list / Documents |
   | 今日卡／回顧 | Today / Recap |
   | 駕駛時間／里程 | Driving time / Distance |

8. **預設語言**：`zh-TW`；第一次進站（localStorage 無紀錄）依 `navigator.languages`，非 `zh*` 用英文；之後以使用者切換為準（建議，總 PRD Q1b）。分享頁的語言切換獨立記憶。

## 6. 無障礙

- 全部操作可鍵盤完成；焦點樣式可見（`accent` 2 px 外框）；拖曳有鍵盤替代（空白鍵抓起、方向鍵移動、Esc 取消）與按鈕替代（上移／下移／移到別天）。
- 觸控目標 ≥ 44 px；底部導覽與浮動鈕避開 iOS home indicator（`env(safe-area-inset-bottom)`）。
- 狀態不只靠顏色：應收／應付同時有「＋／−」與文字；日色針上有編號；警示有圖示。
- 對比 AA：`muted` 在 `paper` 上 ≥ 4.5:1（已選色達標）；珊瑚只用在大字與圖示，不用在小字。
- `prefers-reduced-motion`：Sheet 與地圖飛行動畫改為直接切換。
- axe 無 serious／critical 進 CI（M0 收尾 C2）。

## 7. 視覺資產

- 字型、地圖 style 來源、圖示集（Lucide，ISC）在 `docs/ASSETS.md` 登記。
- 空狀態插圖：程式畫的簡單幾何 SVG（旅行箱、地圖針、收據），同一套線條粗細與日色。
- 照片是使用者的；分享頁不加浮水印。
