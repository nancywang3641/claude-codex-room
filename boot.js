// ============================================================
// boot.js —— Claude / Codex 房間的引導檔（給酒館助手 / TauriTavern 用）
// ------------------------------------------------------------
// 用法（在酒館助手另開一支腳本，內容就這一行）：
//   import 'https://testingcf.jsdelivr.net/gh/nancywang3641/claude-codex-room@<commit>/boot.js'
//
// 原理（跟奧瑞亞 boot.js 同一套，但完全獨立、互不干涉）：
//   ① 本檔被靜態 import ＝ ES 模組 → import.meta.url 就是自己的網址，
//      由它反推 CDN base（含節點 + 鎖定的 commit），整包檔案都跟 boot.js 同節點同 commit。
//   ② 酒館助手把腳本丟進沙盒 <iframe> 跑，裸 document 指向 iframe 自己 → 浮球會掛不到主頁面。
//      偵測到「自己不在主頁面、parent 才是」→ 把 index.js 以 module script 注入主頁面執行。
//   ③ 換 commit 重跑時，舊 webview 沒被銷毀（TauriTavern 常見）→ 偵測 base 變更就強制重載主頁面。
// ============================================================
try {
    const base = new URL('.', import.meta.url).href.replace(/\/+$/, '');

    // 主頁面判定：酒館的 #chat / #sheld / #send_form 在誰身上，誰就是主頁面
    const hasST = function (d) {
        try { return !!(d && (d.getElementById('chat') || d.getElementById('sheld') || d.querySelector('#send_form'))); }
        catch (e) { return false; }
    };

    let W = window;
    try {
        if (!hasST(document) && window.parent && window.parent !== window && hasST(window.parent.document)) {
            W = window.parent;   // 我在酒館助手沙盒 iframe，主頁面在 parent
        }
    } catch (e) {}

    const prev = W.__CCR_BOOTSTRAPPED__;
    if (prev === base) {
        console.log('[claude-codex-room boot] 同一版本已在執行，略過');
    } else if (prev) {
        // 換了 commit，但主頁面沒被銷毀 → 直接重注入會出現兩份浮窗，改強制重載（只會觸發一次）
        console.log('[claude-codex-room boot] 偵測到版本變更 → 強制重載主頁面套用新版');
        W.__CCR_BOOTSTRAPPED__ = undefined;
        try { W.location.reload(); } catch (e) { console.warn('[claude-codex-room boot] 重載失敗', e); }
    } else {
        W.__CCR_BOOTSTRAPPED__ = base;
        W.__CCR_BASE__ = base;   // index.js 直接讀這個當自己的資料夾

        const doc = W.document;
        const s = doc.createElement('script');
        s.src = base + '/index.js?boot=' + Date.now();   // index.js 是普通 script，不需要 type=module
        s.onerror = function () {
            // jsdelivr 對剛 push 的新 commit 冷快取會 503 → 解鎖，讓 Rae 重跑 import 就能重試
            W.__CCR_BOOTSTRAPPED__ = undefined;
            console.warn('[claude-codex-room boot] 載入失敗（多半是 jsdelivr 冷快取）→ 已解鎖，重跑 import 即可重試');
        };
        doc.head.appendChild(s);
        console.log('[claude-codex-room boot] 已注入主頁面：' + base);
    }
} catch (e) {
    console.error('[claude-codex-room boot] 引導失敗', e);
}
