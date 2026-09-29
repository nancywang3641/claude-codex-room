// ----------------------------------------------------------------
// [檔案] aurelia_link.js — 宿舍住戶用奧瑞亞的工具（2026-09-30）
// 住戶（Claude Code／Codex）跑在橋上，奧瑞亞的資料（世界書、劇情、手機）在這個頁面裡（酒館或手機 PWA）。
// 這支是頁面這一端（橋那端見 cc-bridge 的 aurelia_relay.py、aurelia_mcp.py）：
//   ・一連上就把奧瑞亞現在有的工具送給橋（POST /v1/aurelia/tools），住戶的 CLI 才列得出來。
//   ・一直長輪詢 GET /v1/aurelia/jobs：住戶叫了工具，就在這裡用 OS_AURELIA_TOOLS／OS_AURELIA_EDIT 跑，結果交回橋。
//   ・改世界書只做成單子（prop）交給橋存著，她在留言板「等你同意的」按同意才寫（os_board.js）。
//     單子記下是在酒館還是手機提的：兩邊的世界書是分開的，要在同一邊按同意。
// 頁面裡沒有奧瑞亞（只裝房間、或通知點進來的 board.html）就什麼都不做。
// 酒館與手機同時開著：誰先拿到工作誰做。
// ----------------------------------------------------------------
(function () {
    'use strict';
    const win = window.parent || window;
    if (win.__AURELIA_LINK_ON) return;
    win.__AURELIA_LINK_ON = true;

    const REPUBLISH_MS = 30 * 60 * 1000;   // 奧瑞亞更新了工具也跟得上
    const PROP_TEXT = '已經做成單子交給她了：她在留言板「等你同意的」按同意才會寫進去（寫了也能改回去）。'
        + '你不會馬上知道結果，不要跟她說已經改好了。';

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function _A() { return win.OS_AURELIA_TOOLS || window.OS_AURELIA_TOOLS || null; }
    function _E() { return win.OS_AURELIA_EDIT || window.OS_AURELIA_EDIT || null; }
    function _where() {
        try { return (win.OS_API && win.OS_API.isStandalone && win.OS_API.isStandalone()) ? '手機' : '酒館'; } catch (e) { return '酒館'; }
    }
    function _bridge() {
        let cfg = null;
        try { cfg = window.ClaudeTerminal && window.ClaudeTerminal.getConfig && window.ClaudeTerminal.getConfig(); } catch (_) {}
        if (!cfg || !cfg.url || !cfg.key) return null;
        return { base: String(cfg.url).replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, ''), key: cfg.key };
    }
    function _residentName(rid) {
        try {
            const r = (window.ClaudeTerminal.listResidents() || []).find(x => x && x.id === rid);
            return (r && r.name) || rid;
        } catch (_) { return rid; }
    }
    async function _post(b, path, body) {
        const r = await fetch(b.base + path, { method: 'POST', headers: { 'Authorization': 'Bearer ' + b.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }

    // 住戶看的工具：兩組合起來，同名的（查世界書）留改世界書那份——住戶不是故事裡的人，查世界書找所有的書
    function _tools() {
        const A = _A(), E = _E();
        const out = [], seen = {};
        const add = t => { if (t && t.name && !seen[t.name]) { seen[t.name] = 1; out.push({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || { type: 'object', properties: {} }, propose: !!t.propose }); } };
        ((E && E.tools) || []).forEach(add);
        ((A && A.tools) || []).forEach(add);
        return out;
    }
    function _note() {
        const A = _A(), E = _E();
        return [(A && A.note) || '', (E && E.note) || ''].filter(Boolean).join(' ');
    }

    async function _run(job) {
        const A = _A(), E = _E();
        const name = String(job.name || ''), args = job.args || {};
        const edit = ((E && E.tools) || []).find(t => t.name === name);
        try {
            if (edit && edit.propose) {
                const r = await E.propose(name, args);
                if (r && r.ok && r.prop) {
                    r.prop.by = _residentName(job.rid);
                    r.prop.where = _where();
                    return { ok: true, text: PROP_TEXT, prop: r.prop, rid: job.rid, tool: name };
                }
                return { ok: false, text: (r && r.text) || '沒有成功' };
            }
            if (edit && name !== 'aurelia_worldbook_search') return { ok: true, text: String(await E.run(name, args)) };
            if (!A) return { ok: false, text: '奧瑞亞還沒載好' };
            const text = await A.run(name, args, { wbAll: true });
            return { ok: true, text: String(text) + '（在她的' + _where() + '查的）' };
        } catch (e) {
            return { ok: false, text: (e && e.message) || '失敗' };
        }
    }

    async function _loop() {
        let fails = 0, pubKey = '', pubAt = 0;
        for (;;) {
            const b = _bridge();
            if (!b || !_A()) { await sleep(10000); continue; }
            const key = b.base + '|' + b.key;
            if (pubKey !== key || Date.now() - pubAt > REPUBLISH_MS) {
                try {
                    await _post(b, '/v1/aurelia/tools', { tools: _tools(), note: _note(), where: _where() });
                    pubKey = key; pubAt = Date.now();
                } catch (e) {
                    // 舊的橋沒有這個端點（404）：一小時後再看，不要一直敲
                    await sleep(/404/.test(String(e && e.message)) ? 3600000 : 15000);
                    continue;
                }
            }
            try {
                const r = await fetch(b.base + '/v1/aurelia/jobs?wait=25&where=' + encodeURIComponent(_where()), { headers: { 'Authorization': 'Bearer ' + b.key } });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const d = await r.json();
                fails = 0;
                for (const job of (d.jobs || [])) {
                    const res = await _run(job);
                    res.id = job.id;
                    try { await _post(b, '/v1/aurelia/result', res); } catch (_) {}
                }
            } catch (e) {
                fails++;
                await sleep(Math.min(60000, 3000 * fails));   // 橋關著、網路斷：慢慢退
            }
        }
    }

    setTimeout(_loop, 3000);
    window.AureliaLink = { tools: _tools, run: _run, where: _where };
})();
