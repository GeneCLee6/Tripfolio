# ASSETS — 第三方視覺資產登記

介面用到的字型、圖示、地圖樣式都登記在這裡：名稱、來源、授權、怎麼載入。新增或換掉資產時同一個 PR 更新這份。

## 1. 字型

| 字型 | 用途 | 字重 | 來源 | 授權 |
| --- | --- | --- | --- | --- |
| Bricolage Grotesque | 標題（`font.display`） | 500、700、800（opsz 12–96） | <https://fonts.google.com/specimen/Bricolage+Grotesque> | SIL Open Font License 1.1 |
| IBM Plex Sans | 內文（`font.body`） | 400、500、600 | <https://fonts.google.com/specimen/IBM+Plex+Sans> | SIL Open Font License 1.1 |
| IBM Plex Mono | 數字、金額、日期、座標（`font.mono`，`tabular-nums`） | 400、500 | <https://fonts.google.com/specimen/IBM+Plex+Mono> | SIL Open Font License 1.1 |
| Noto Sans TC | 中文（標題與內文的第二順位） | 400、500、700 | <https://fonts.google.com/noto/specimen/Noto+Sans+TC> | SIL Open Font License 1.1 |

**怎麼載入**（`src/styles/fonts.ts`，`src/main.tsx` 啟動時呼叫 `loadFonts()`）：

- 一支 Google Fonts CSS2 API 樣式表：
  `https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+TC:wght@400;500;700&display=swap`
- CSS2 API 回的 `@font-face` 已按 `unicode-range` 切片（Noto Sans TC 約一百片），瀏覽器只下載頁面用到的字的那幾片；拉丁字型只有 latin／latin-ext 片。
- 先 `preconnect` 到 `fonts.googleapis.com` 與 `fonts.gstatic.com`；`display=swap`，字型到之前用 `tokens.ts` 的後備字型（`system-ui`、`-apple-system`、`Segoe UI`、`PingFang TC`、`Microsoft JhengHei`；等寬為 `ui-monospace`、`SFMono-Regular`、Menlo、Consolas）。
- 分享頁（`share/main.tsx`）目前還沒呼叫 `loadFonts()`，用後備字型；E8 做分享頁時加上。
- 與 E10 PRD「self-host 子集」的差異：M0 先用 Google Fonts 的子集服務（同樣是 unicode-range 子集、不必自己切字）；若之後要離線（PWA，e10-t05）或不依賴第三方，再把這些檔案下載到 `public/fonts/` 自管，授權（OFL）允許。

## 2. 圖示

| 名稱 | 用途 | 來源 | 授權 | 載入 |
| --- | --- | --- | --- | --- |
| 自繪線條圖示（關閉、加號、下拉、地圖針、垃圾桶） | 基礎元件 | `src/components/icons.tsx`，仿 Lucide 的 24 格線、2 px 筆畫 | 本專案 | 內嵌 SVG |
| 空狀態插圖（旅行箱、地圖針、收據） | `EmptyState` | `src/components/EmptyState.tsx`，程式畫的幾何 SVG，顏色取自 token | 本專案 | 內嵌 SVG |
| 地圖針圖示（書籤、床、星、油槍）與地圖按鈕（定位、全螢幕） | 地圖針（口袋名單／住宿／必吃必買／加油與補給）、地圖控制鈕 | `src/map/sprite.ts`、`src/map/TripMap.tsx`，仿 Lucide 24 格線手繪路徑（非複製 Lucide 原始碼；Lucide 為 ISC 授權，日後改用正式套件時保留其 ISC 聲明） | 本專案 | 程式產生 SVG（data URL → `map.addImage`） |
| Lucide（規劃中） | 全站圖示 | <https://lucide.dev> | ISC | 尚未加入；加入時改用它並更新此列 |

## 3. 地圖

| 項目 | 來源 | 授權／條件 | 載入 |
| --- | --- | --- | --- |
| MapLibre GL JS 6.16.0 | <https://maplibre.org>（npm `maplibre-gl`，固定版本） | BSD-3-Clause | `src/map/TripMap.tsx` 動態載入，獨立 chunk `maplibre`；worker 檔以 `?url` 交給 `setWorkerUrl()`；CSS `maplibre-gl/dist/maplibre-gl.css` 跟著 lazy chunk |
| 底圖 style：OpenFreeMap `liberty` | <https://tiles.openfreemap.org/styles/liberty>（`src/map/config.ts` 的 `MAP_STYLE_URL`，可用 `VITE_MAP_STYLE_URL` 覆寫） | OpenFreeMap 免費、無金鑰、公平使用；style 為 BSD／CC-BY | 執行期 fetch，`restyle()` 依 `tokens.ts` 改色（紙感底、低對比路網、冰川色水域、隱藏 POI 與路牌），深色主題同一套覆寫就地套用 |
| 向量瓦片、字型（glyphs）、sprite | OpenFreeMap（OpenMapTiles schema，資料來自 OpenStreetMap） | 資料 © OpenStreetMap contributors（ODbL）；© OpenMapTiles | style 內的 sources；叢集數字用 glyph `Noto Sans Bold` |
| 低縮放地形底（`ne2_shaded`） | Natural Earth（經 OpenFreeMap） | 公有領域 | 保留但去飽和、低不透明度 |

- **署名**：保留 MapLibre 的 AttributionControl（compact）；文字來自 style 的 sources（OpenFreeMap © OpenMapTiles Data from OpenStreetMap），不得移除。
- **後備**：Protomaps pmtiles（自託管在 R2）或 MapTiler 免費層，改 `VITE_MAP_STYLE_URL`（`ARCHITECTURE.md` §5）；pmtiles 另需 protocol 外掛，字型名稱若不同要改 `MAP_LABEL_FONT`。
