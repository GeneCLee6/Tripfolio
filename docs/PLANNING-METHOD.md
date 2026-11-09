# PLANNING-METHOD — 規劃文件要分幾層？

完整的論證在 LongTalk 的同名文件（`C:\dev\LongTalk\docs\PLANNING-METHOD.md`）；這裡只記這個專案採用的結論。

## 三層

```
00-prd.md（總 PRD）
   └─ e1 … e11（epic：功能 PRD ＋ 設計方向）
         └─ AC-<epic>.<n>（驗收條件：可勾選）
               └─ e<epic>-t<nn>（task：一個 PR，1–3 天）
```

加上三份索引：`PRD/README.md`（進度表）、`ROADMAP.md`（批次順序）、`NEXT.md`（現在的位置與工作方式）。

## 這個專案另開的獨立文件

| 文件 | 原因 | 狀態 |
| --- | --- | --- |
| `PRD/01-travel-domain-notes.md` | 旅遊專業角度的領域知識跨所有 epic；是「使用者沒想到的事」的來源 | 已寫 |
| `ARCHITECTURE.md` §5 外部服務與切換 | 免費地圖／搜尋／路線／匯率服務可能停用，切換步驟要獨立好找 | 已寫（規劃版） |
| `ASSETS.md` | 字型、圖示、地圖 style 的來源與授權 | A2 寫 |
| `DEPLOY.md` | 部署、secrets、備份還原 | A1 寫 |
| `SPLIT-RULES.md` | 分帳的餘數規則、公基金退還規則，給朋友看的白話版（同時是 app 內說明頁的來源） | G1 寫 |

不再多拆：每個功能面一個 epic 就是它的功能 PRD；AC 的文字就是驗收規格。
