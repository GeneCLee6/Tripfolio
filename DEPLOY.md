# DEPLOY — 部署

## 1. 架構

Tripfolio 是**一個 Cloudflare Worker**（`tripfolio`）：同一個 Worker 回答 `/api/*`、`/ws/*`、`/s/*`，承載 Durable Object（每個旅程一個 `TripDO`，只用在即時同步；A1 只是會回 ping 的佔位），其餘路徑交給靜態資產（`dist/client`，SPA fallback 到 `index.html`）。

- **兩個前端入口**：`index.html`（app）與 `share.html`（唯讀分享頁，獨立 bundle、不載編輯器）。`/s/<token>` 由 Worker 交給 `share.html`，並加 `x-robots-tag: noindex`。
- **D1 `DB`**：全部結構化資料（A1 只有 `meta` 表；真正的 schema 在 A3）。
- **R2 `MEDIA`**：照片（2048／400）、文件、收據；文件類只經 Worker 驗權讀取。**R2 `BACKUPS`**：D1 每日備份（e11-t03）。
- **cron**：`wrangler.jsonc` 裡先註解掉，e11-t03 備份時打開。

設定都在 `wrangler.jsonc`。一個 Worker 一次部署：前端與 API 永遠是同一個 commit。建置時 `APP_VERSION`（commit SHA）寫進兩個 HTML 的 `<meta name="app-version">`，部署時也以 `--var APP_VERSION:<sha>` 給 Worker（`GET /api/health` 回傳）；smoke test 就是查這個。

## 2. 環境

| 環境 | Worker | 網址 | D1 | R2 | Durable Object 資料 |
| --- | --- | --- | --- | --- | --- |
| 正式 | `tripfolio` | <https://tripfolio.genelee-pro.workers.dev> | `tripfolio` | `tripfolio-media`、`tripfolio-backups` | 正式站自己的 |
| PR 預覽 | `tripfolio-pr-<PR 號>` | `https://tripfolio-pr-<號>.genelee-pro.workers.dev` | `tripfolio-staging`（所有預覽共用） | 與正式站相同的兩個 bucket | 每個預覽自己的，PR 關閉時隨 Worker 刪除 |
| staging（手動） | `tripfolio-preview` | `https://tripfolio-preview.genelee-pro.workers.dev` | `tripfolio-staging` | 同上 | 自己的 |

（子網域 `genelee-pro` 沿用同帳號的 TKU Arcade；第一次部署後以 wrangler 印出的網址為準，若不同要改這裡和 `deploy.yml` 的 `SITE_URL`。）

PR 預覽以 `CLOUDFLARE_ENV=preview` 建置（Vite 的 Cloudflare 外掛把 `env.preview` 的設定烤進 `dist/`），再用 `wrangler deploy --name tripfolio-pr-<號>` 部署成**獨立的 Worker**。

**R2 預覽與正式共用**（A1 照指示設定）：之後寫 R2 的批次（E6 照片、e11-t03 備份）必須讓預覽寫到獨立的前綴（例如 `preview/`），或在預覽環境不寫，不能和真正的旅程混在一起；刪旅程連帶清 R2（e11-t06）也只能刪自己前綴下的物件。

**為什麼每個 PR 一個 Worker，而不是 `wrangler versions upload`**（同 TKU Arcade、LongTalk 的經驗）：

- 正式 Worker 的 version 和正式站共用同一個 Durable Object namespace 與 D1，預覽會直接動到正式站的資料。
- Durable Object 的 migration 不能經由 `versions upload` 套用；新增 DO class 的 PR 根本做不出預覽。
- Cloudflare 不給實作 Durable Object 的 Worker 預覽網址。

## 3. 一次性設定

### 3.1 Cloudflare API token

可以直接沿用 TKU Arcade 的 token（同一個帳號、同樣的權限）。要新建的話：儀表板 → My Profile → API Tokens → Create Token → 範本「Edit Cloudflare Workers」，再**加上 D1 Edit**。帳號限定為自己的帳號。

| 範圍 | 權限 | 為什麼 |
| --- | --- | --- |
| Account | Workers Scripts：Edit | 部署、刪除預覽 Worker、`wrangler secret put` |
| Account | D1：Edit | `wrangler d1 migrations apply --remote` |
| Account | Workers R2 Storage：Read（範本給 Edit 也可以） | 部署時確認 R2 綁定的 bucket |
| Account | Account Settings：Read | wrangler 讀取帳號與 workers.dev 子網域 |
| User | User Details：Read、Memberships：Read | wrangler 確認身分（範本內建） |

### 3.2 GitHub repo 與 secrets

repo 預定為 `GeneCLee6/Tripfolio`（私人）。**A1 完成時還沒有 remote**，由擁有者建立：

```sh
gh repo create GeneCLee6/Tripfolio --private --source . --remote origin
git push -u origin main
gh secret set CLOUDFLARE_API_TOKEN      # 貼上 3.1 的 token
gh secret set CLOUDFLARE_ACCOUNT_ID     # 儀表板右側欄 Account ID，或 npx wrangler whoami
gh secret list                          # 確認兩個都在
```

**沒設定 secret 時，部署與預覽 workflow 會跳過（notice，不是失敗）**，CI 照跑。

### 3.3 GitHub 分支保護

`main` 設為受保護分支：要求 PR、要求 `CI / verify` 通過、禁止 force-push（`CLAUDE.md` 規則 7、8）。在 GitHub → Settings → Branches → Add rule 設定（私人 repo 的分支保護需要 GitHub Pro；沒有的話靠 `CLAUDE.md` 規則與習慣）。

### 3.4 已建好的資源（2026-11-09 由 A1 建立，不用再建）

| 種類 | 名稱 | id | 用途 |
| --- | --- | --- | --- |
| D1 | `tripfolio` | `3a5cba15-7516-409d-adad-e548a43cae34` | 正式站（APAC） |
| D1 | `tripfolio-staging` | `2565701d-fb58-406f-9e86-91728e858240` | 所有 PR 預覽與 staging 共用（APAC） |
| R2 | `tripfolio-media` | — | 照片、文件、收據（正式與預覽都綁定，見 §2） |
| R2 | `tripfolio-backups` | — | D1 每日備份（e11-t03） |

**正式站的 D1 id 只能出現在 `wrangler.jsonc` 頂層**，不要放進 `env.preview`。

萬一要在別的帳號重建，指令如下（在 repo 外的資料夾跑，避免 wrangler 改到 `wrangler.jsonc`），再把新的 id 填回 `wrangler.jsonc` 與上表：

```sh
npx wrangler d1 create tripfolio
npx wrangler d1 create tripfolio-staging
npx wrangler r2 bucket create tripfolio-media
npx wrangler r2 bucket create tripfolio-backups
```

## 4. 日常流程

1. 開分支、開 PR（標題英文、照 ROADMAP 批次號）。
2. `ci.yml`：`npm ci` → lint → check-i18n → typecheck → test → build → budget，全綠才可合併。
3. `preview.yml`：套用 staging 的 D1 遷移 → 建置 → 部署 `tripfolio-pr-<號>` → smoke test → 在 PR 留言預覽網址（同一則留言隨每次 push 更新）。
4. 在預覽站看過，`gh pr merge <號> --squash --delete-branch`。
5. `deploy.yml`（CI 在 `main` 綠了之後）：套用正式 D1 的遷移 → 建置 → `wrangler deploy` → smoke test。**合併就是上線。**
6. PR 關閉（合併或放棄）時，`preview.yml` 的 `cleanup` 刪掉 `tripfolio-pr-<號>` 與它的 Durable Object 資料。

| Workflow | 何時 | 做什麼 |
| --- | --- | --- |
| `ci.yml` | PR 到 `main`、push 到 `main` | lint、check-i18n、typecheck、test、build、budget |
| `preview.yml` | PR 開啟、更新、重開；關閉 | 部署並留言預覽網址；關閉時刪除 |
| `deploy.yml` | CI 在 `main` 成功後；或手動 Run workflow | 部署正式站 |

smoke test 檢查：首頁 `<meta name="app-version">` 是這個 commit（最多重試約一分鐘）、未知路徑回 200（SPA fallback）、`/api/health` 回 `"ok":true`、`/s/smoke` 回的是 `share.html`。

部署之間不會重疊：正式站一個 concurrency group（排隊、不中途取消），每個 PR 一個（新的 push 取代進行中的預覽部署）。漏刪的預覽：在 repo 外的資料夾執行 `npx wrangler delete --name tripfolio-pr-<號>`。

## 5. 本機與手動部署

```sh
npm run dev                                                           # http://localhost:5176，Worker 與 TripDO 一起跑
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc   # 本機 D1
```

手動部署通常不需要。要的話：

- 正式站：GitHub Actions → Deploy → Run workflow，或本機：

  ```sh
  npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc   # 有新遷移時
  npm run deploy                                                          # build + wrangler deploy
  ```

- staging（`tripfolio-preview`）：

  ```sh
  npx wrangler d1 migrations apply DB --remote --env preview --config wrangler.jsonc
  CLOUDFLARE_ENV=preview npm run build && npx wrangler deploy
  ```

本機 secret 放 `.dev.vars`（不進 git）。

## 6. D1 遷移規則

- 現有：`0001_init.sql`（骨架，只有一張 `meta`）；`trips`、`members` 等表由 A3 加。
- 遷移檔放 `migrations/`，用 `npx wrangler d1 migrations create DB <名稱> --config wrangler.jsonc` 產生，檔名帶流水號，**已合併的檔案不要改、不要刪**；要改就再加一個。
- workflow 在**建置之前**套用遷移（建置後 Vite 外掛會把 wrangler 導向 `dist/` 的設定，那份設定不接受 `--env`）。
- 遷移在新程式上線**之前**套用，所以每個遷移都要讓**舊程式照常運作**：只加表、加欄位（給預設值）、加索引；刪欄位或改名分兩次 PR。
- staging 被所有預覽共用：某個 PR 的遷移套到 staging 後，即使 PR 沒合併也會留著。staging 可以清空重建；正式站不行。
- 查看狀態：`npx wrangler d1 migrations list DB --remote --config wrangler.jsonc`（staging 加 `--env preview`）。

## 7. Durable Object migration 只增不改

- `wrangler.jsonc` 的 `migrations`（DO 的）**只能往後加**：已部署的 tag 不要改、不要刪。現有：`v1` `TripDO`（SQLite 版，免費方案只能用這種）；下一個是 `v2`。
- 刪除或改名 DO class 要用新的 tag（`deleted_classes`／`renamed_classes`），而且**會刪資料**，先問擁有者。
- `env.preview` **不會繼承**頂層的綁定與 `vars`：新增 DO、D1、R2 綁定或 var 時，頂層與 `env.preview` 各寫一次；DO 的 `migrations` 只寫在頂層。

## 8. 回滾

```sh
npx wrangler deployments list
npx wrangler rollback                                     # 回到上一個 version
npx wrangler rollback <version-id> --message "rollback: <原因>"
```

`rollback` 換回程式與靜態資產，**不會**撤銷 D1 遷移或 DO migration（所以第 6、7 節的「只增」很重要）。回滾後盡快開 revert PR，讓 `main` 與正式站一致。

## 9. Secrets 清單

### GitHub Actions secrets（repo 建立後就需要）

| 名稱 | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 部署、遷移、刪除預覽（§3.1） |
| `CLOUDFLARE_ACCOUNT_ID` | 指定 Cloudflare 帳號 |

### Worker secrets（之後的批次加入）

| 名稱 | 批次 | 用途 |
| --- | --- | --- |
| `ORS_API_KEY` | B2 之前 | OpenRouteService 路線（擁有者註冊後 `npx wrangler secret put ORS_API_KEY`） |
| Google OAuth 用戶端 | H3 | Google 登入（選用） |

只用 `wrangler secret put` 放在 Worker，**不進前端、不進 repo**。PR 預覽是每次新建的 Worker，不會自動有這些 secret；需要時由該批次在 `preview.yml` 加一步，沒設定就 notice 跳過。

## 10. D1 備份與還原

e11-t03 實作（cron → `worker/backup.ts` → R2 `tripfolio-backups`），屆時補上本節（照 TKU Arcade `DEPLOY.md` §10 的做法：Time Travel 優先，R2 備份還原到新的空資料庫，並實際還原一次）。
