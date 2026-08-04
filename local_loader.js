// ============================================================
// Claude / Codex 房間 —— 本地載入口（貼進酒館助手腳本庫用，跟 DEBUG.js 同一個玩法）
// ------------------------------------------------------------
// 用途：不走 CDN、不裝擴展，直接從本機資料夾把房間拉起來：
//   public/scripts/extensions/third-party/claude-codex-room/
// 原理：酒館助手把腳本丟進沙盒 <iframe> 跑，裸 document 是 iframe 自己，
//   按鈕會掛不到主頁面 → 這裡一律拿 window.parent（主頁面）來注入。
//   index.js 用 import.meta.url 反推自己的資料夾，所以必須用 type="module" 注入。
// 換資料夾名字的話，改下面 FOLDER 一行就好。
// ============================================================
(function () {
    'use strict';
    var TAG = '[claude-codex-room loader]';
    var FOLDER = 'scripts/extensions/third-party/claude-codex-room/';

    try {
        var W = (window.parent && window.parent !== window) ? window.parent : window;
        var D = W.document;

        if (W.__CCR_LOADED__) { console.log(TAG, '房間已在執行，略過'); return; }

        // 用主頁面的 baseURI 拼絕對路徑（酒館裝在子路徑也對）
        var BASE = new URL(FOLDER, D.baseURI).href;

        var s = D.createElement('script');
        s.type = 'module';                       // index.js 靠 import.meta.url 找自己的資料夾
        s.src = BASE + 'index.js?v=' + Date.now();
        s.onerror = function () {
            console.error(TAG, '載入失敗 —— 確認資料夾存在：' + BASE);
        };
        D.head.appendChild(s);
        console.log(TAG, '已注入主頁面：' + BASE);
    } catch (e) {
        console.error(TAG, '載入口出錯', e);
    }
})();
