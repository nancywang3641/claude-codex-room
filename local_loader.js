// ============================================================
// Claude / Codex 房間 —— 本地載入口（貼進酒館助手腳本庫用，跟 DEBUG.js 同一個玩法）
// ------------------------------------------------------------
// 不走 CDN、不用裝擴展，直接從本機資料夾把房間拉起來：
//   public/scripts/extensions/third-party/claude-codex-room/
// 酒館助手把腳本丟進沙盒 <iframe> 跑 → 一律拿 window.parent（主頁面）注入，否則按鈕掛不上去。
// 換資料夾名字就改下面 FOLDER 一行。
// 成功／失敗都會在畫面右上角跳一則提示，不用翻 console。
// ============================================================
(function () {
    'use strict';
    var TAG = '[claude-codex-room]';
    var FOLDER = 'scripts/extensions/third-party/claude-codex-room/';

    var W;
    try { W = (window.parent && window.parent !== window) ? window.parent : window; }
    catch (e) { W = window; }

    function say(msg, isErr) {
        try { console[isErr ? 'error' : 'log'](TAG, msg); } catch (e) {}
        try {
            var t = W.toastr || window.toastr;
            if (t) t[isErr ? 'error' : 'success'](msg, 'Claude / Codex 房間');
        } catch (e) {}
    }

    say('載入口開始執行');

    try {
        var D = W.document;
        if (W.__CCR_LOADED__) { say('房間已在執行，略過'); return; }

        // 用主頁面的 baseURI 拼絕對路徑（酒館裝在子路徑也對）
        var BASE = new URL(FOLDER, D.baseURI).href;
        W.__CCR_BASE__ = BASE;      // index.js 直接讀這個當自己的資料夾，不必猜

        var s = D.createElement('script');
        s.src = BASE + 'index.js?v=' + Date.now();
        s.async = false;
        s.onload = function () { say('已載入：' + BASE); };
        s.onerror = function () { say('載入失敗，這個網址抓不到檔案：' + s.src, true); };
        D.head.appendChild(s);
    } catch (e) {
        say('載入口出錯：' + (e && e.message ? e.message : e), true);
    }
})();
