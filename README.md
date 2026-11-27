# Claude / Codex 房間（獨立版）

一個 SillyTavern 第三方擴展，提供「Claude / Codex / 蘇景明 / 群聊」的暖色咖啡店風格氣泡聊天室。
直連 Anthropic API，或經 **cc-bridge** 接訂閱制 Max CLI / Codex CLI。

> 原本寄宿在「奧瑞亞 (my-tavern-extension)」內，現已獨立成自己的擴展。

## 安裝

把整個 `claude-codex-room/` 資料夾放進：

```
SillyTavern/public/scripts/extensions/third-party/claude-codex-room/
```

重啟（或重新整理）SillyTavern。畫面**右下角會出現一顆 💬 浮球**，點它選房間。

## 設定 cc-bridge / API

第一次用：開房間 → 浮窗右上角 **⚙️ 設置** → 新增一組「連線預設」：

- **URL**：cc-bridge 端點（例如 `https://你的網域/v1`），或 Anthropic 直連端點。
- **密鑰**：cc-bridge token 或 API key。

填好就能聊。設定存在瀏覽器 `localStorage`（鍵：`os_claude_room_config`），對話存在 IndexedDB（`WeChat_Simulator_DB / studio_chats`）。

## 與奧瑞亞共存

- 若同一個 SillyTavern 也裝了奧瑞亞，本擴展會**自動讓出** `OS_SETTINGS` / `OS_DB` 給奧瑞亞，
  共用同一份設定與對話紀錄（不會打架、舊對話讀得到）。
- 若只裝本擴展，內建的輕量 shim 會自己頂上。

## 檔案結構

```
claude-codex-room/
├── manifest.json          ST 擴展清單
├── index.js               載入器：補 OS_SETTINGS/OS_DB shim、載核心檔、掛浮球
├── core/
│   ├── chat_window.js     浮窗外殼
│   ├── chat_room.js       房間邏輯（cc-bridge fetch）
│   ├── claude_terminal.js 連線 / 串流 / 對話持久化
│   ├── chat_group.js      群聊
│   ├── chat_canvas.js     圖片畫布
│   └── assets/claude/     Claude 角色頭像 SVG
└── css/
    ├── chat_window.css    房間樣式
    └── launcher.css       右下角浮球樣式
```
