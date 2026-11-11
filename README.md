# ✍️ 作文批改室 — 從零開始教學

學測國寫＋英文作文的 AI 批改網站。每篇作文是一個獨立「檔案」，裡面有照片、分數、評語、可進步之處、滿分改寫、筆記，還有可以一直聊下去的對話框。

---

## 先搞懂：為什麼要分「前端」和「後端」？

GitHub Pages 只能放「靜態網頁」——任何人打開網站，按 F12 就看得到所有程式碼。
**如果把 API key 直接寫在網頁裡，等於把你的 key 公開給全世界**，付費 key 很快就會被盜刷。密碼也一樣：寫在網頁裡的密碼檢查，懂一點的人一秒就能繞過。

所以這個專案分兩半：

| | 放在哪 | 負責什麼 | 費用 |
|---|---|---|---|
| **前端**（網站畫面） | GitHub Pages | 介面、上傳照片、存作文紀錄 | 免費 |
| **後端**（Worker） | Cloudflare Workers | 藏 API key、驗證付費密碼、呼叫 AI | 免費（每天 10 萬次請求） |

```
使用者的瀏覽器 ──► GitHub Pages（網站）
        │
        └──► Cloudflare Worker（key 和密碼藏在這）──► AI（Gemini 等）
```

---

## 專案裡有什麼

```
essay-grader/
├── index.html        網站主頁面
├── css/style.css     所有樣式（顏色、排版）
├── js/
│   ├── config.js     ⭐ 唯一要改的設定：後端網址
│   ├── app.js        畫面與互動
│   ├── api.js        和後端溝通
│   └── db.js         把作文存在瀏覽器裡
└── worker/
    └── worker.js     ⭐ 後端：學測評分標準、API key、密碼驗證
```

---

## 第 1 步：安裝工具（只要做一次）

1. **VS Code**：到 <https://code.visualstudio.com> 下載安裝。
2. **Git**：到 <https://git-scm.com/downloads> 下載安裝（Windows 一路按「Next」即可）。
   - 裝好後打開 VS Code，按 `` Ctrl + ` ``（反引號，在 Esc 下面）打開終端機，輸入：
     ```bash
     git --version
     ```
     有出現版本號就成功了。
   - 第一次使用要設定名字和 email（換成你自己的）：
     ```bash
     git config --global user.name "你的名字"
     git config --global user.email "你的GitHub信箱"
     ```
3. **GitHub 帳號**：到 <https://github.com> 註冊。
4. **VS Code 擴充套件「Live Server」**：VS Code 左邊點方塊圖示（Extensions），搜尋 `Live Server`，按 Install。用來在自己電腦上預覽網站。

---

## 第 2 步：在自己電腦上先跑起來

1. 把 `essay-grader` 資料夾解壓縮到你喜歡的位置（例如桌面）。
2. VS Code → **File → Open Folder** → 選 `essay-grader`。
3. 在左邊檔案列表對 `index.html` 按右鍵 → **Open with Live Server**。
4. 瀏覽器會打開網站。現在是**示範模式**（上方有黃色提示），按「新增作文」→ 上傳任何照片 →「開始批改」，會看到假的批改結果，讓你先熟悉介面。

> ⚠️ 不能直接雙擊 `index.html` 打開，一定要用 Live Server，不然程式會載入失敗。

---

## 第 3 步：拿到 API key

這個網站預設用 **Google Gemini**（有免費額度、可以看照片）。

1. 到 <https://aistudio.google.com/apikey>，用 Google 帳號登入。
2. 按「Create API key」，複製下來 → 這是你的**免費 key**。
3. 付費 key：在另一個 Google Cloud 專案開啟帳單（Billing），同樣建立一組 key → 這是**付費 key**。
   - 付費 key 建議到 Google Cloud 設定「預算提醒」，避免意外花太多錢。

> 想用 OpenAI 或 Claude 的 key 也可以，看第 4 步最後的「換成其他 AI」。

**key 只會貼在 Cloudflare 後台，絕對不要貼進任何網頁檔案、也不要傳到 GitHub。**

---

## 第 4 步：架設後端（Cloudflare Worker）

1. 到 <https://dash.cloudflare.com/sign-up> 註冊（免費）。
2. 左邊選單 **Compute (Workers) → Workers & Pages** → **Create** → **Create Worker**（選 "Start with Hello World"）。
3. 名字取 `essay-grader`，按 **Deploy**。
4. 部署完按 **Edit code**，把編輯器裡原本的程式**全部刪掉**，換成 `worker/worker.js` 的全部內容，按右上角 **Deploy**。
5. 回到這個 Worker 的頁面 → **Settings → Variables and Secrets** → 按 **Add**，依序加入：

   | 名稱 | 類型 | 值 |
   |---|---|---|
   | `FREE_API_KEY` | Secret | 你的免費 key |
   | `PAID_API_KEY` | Secret | 你的付費 key |
   | `PAID_PASSWORDS` | Secret | 給朋友的密碼，例如 `sunflower2026`。可以設多組，用逗號隔開：`小明專用,小華專用` |
   | `PAID_MODEL` | Text | 付費要用的模型名稱（到 AI Studio 的模型列表挑一個比較強的） |

   每加一個都要按 **Deploy** 儲存。

6. 複製 Worker 網址（長得像 `https://essay-grader.你的帳號.workers.dev`），用瀏覽器打開，看到 `作文批改室後端運作中 ✅` 就成功了。

**小技巧：每個朋友一組密碼。** 例如 `PAID_PASSWORDS` 設成 `amy-8812,ben-3301`，如果哪天想停掉某個人，只要把他那組刪掉就好，不影響其他人。

### 換成其他 AI（選用）

| 想用 | 加這些變數 |
|---|---|
| Gemini（預設） | 不用加。免費預設模型是 `gemini-flash-latest` |
| OpenAI | `PAID_PROVIDER` = `openai`、`PAID_MODEL` = 模型名稱 |
| Claude | `PAID_PROVIDER` = `anthropic`、`PAID_MODEL` = `claude-sonnet-5-5` |

免費那組就把 `PAID_` 換成 `FREE_`。模型名稱常常更新，以各家官網列表為準。

---

## 第 5 步：網站接上後端

1. VS Code 打開 `js/config.js`，把網址貼進去：
   ```js
   export const CONFIG = {
     API_BASE: 'https://essay-grader.你的帳號.workers.dev',
   };
   ```
2. 存檔（`Ctrl + S`），Live Server 會自動重新整理，黃色的示範模式提示消失 = 接上了。
3. 拿一篇真的作文照片試試看！

---

## 第 6 步：放上 GitHub（讓網站上線）

1. 到 GitHub 右上角 **＋ → New repository**，名稱填 `essay-grader`，選 **Public**，按 **Create repository**。
2. 回到 VS Code 終端機（確認位置在 `essay-grader` 資料夾），一行一行輸入：
   ```bash
   git init
   git add .
   git commit -m "第一版作文批改網站"
   git branch -M main
   git remote add origin https://github.com/你的帳號/essay-grader.git
   git push -u origin main
   ```
   第一次 push 會跳出視窗要你登入 GitHub，照著做即可。
3. 到 GitHub 的 repository 頁面 → **Settings → Pages** →
   Source 選 **Deploy from a branch**，Branch 選 **main**、資料夾 **/(root)** → **Save**。
4. 等 1～2 分鐘，網址會是：`https://你的帳號.github.io/essay-grader/`

### 最後一步：鎖定只有你的網站能用後端

回到 Cloudflare Worker → Settings → Variables，新增：

| 名稱 | 類型 | 值 |
|---|---|---|
| `ALLOWED_ORIGINS` | Text | `https://你的帳號.github.io` |

（注意：**不要**加後面的 `/essay-grader`，也不要加結尾斜線。）

這樣別人就算知道你的 Worker 網址，也沒辦法從他自己的網站偷用。

---

## 之後要修改網站

改完檔案後，在終端機輸入：

```bash
git add .
git commit -m "說明這次改了什麼"
git push
```

1～2 分鐘後網站就會更新。
**改後端（worker.js）的話**，要記得到 Cloudflare 的 Edit code 貼上新版並 Deploy。

---

## 常見問題

**Q：朋友在他的手機上看得到我的作文嗎？**
看不到。每個人的作文都存在**自己裝置的瀏覽器**裡，彼此看不到。換手機或清除瀏覽器資料前，到「設定」頁下載備份，再到新裝置匯入。

**Q：批改失敗，顯示「使用量達到上限」？**
免費 key 有每分鐘、每天的次數限制。等一下再試，或切換到付費方案。

**Q：顯示「API key 無效」？**
檢查 Cloudflare 的 `FREE_API_KEY` / `PAID_API_KEY` 有沒有貼錯、前後有沒有多空格。

**Q：顯示「這個網站來源沒有被允許使用」？**
`ALLOWED_ORIGINS` 跟你的網址不一樣。打開網站，按 F12 → Console，輸入 `location.origin`，把出現的字串原封不動貼到 `ALLOWED_ORIGINS`。

**Q：免費方案會不會被陌生人用光？**
有可能——知道網址的人都能用免費方案。設定好 `ALLOWED_ORIGINS` 可以擋掉別的網站，但擋不住直接打開你網站的人。如果被濫用，最簡單的方法是把網址只給認識的人，或在 Google AI Studio 換一組新 key。

**Q：分數準嗎？**
評分提示詞是照大考中心公布的評分原則寫的（國寫三等六級、英文五項分項評分），但 AI 終究不是閱卷委員，同一篇批兩次分數可能差 1～2 分。請把它當「很懂學測的家教」，重點放在評語和可進步之處。

**Q：想改評分標準或語氣？**
打開 `worker/worker.js`，最上面的 `ZH_SYSTEM`（國文）、`EN_SYSTEM`（英文）、`chatSystem`（對話）就是給 AI 的指示，用中文改就行，改完記得重新部署到 Cloudflare。
