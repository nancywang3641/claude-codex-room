// ----------------------------------------------------------------
// [檔案] aurelia_link.js — 宿舍住戶用奧瑞亞的工具（2026-09-30）
// 住戶（Claude Code／Codex）跑在橋上，奧瑞亞的資料（世界書、劇情、手機）在這個頁面裡（酒館或手機 PWA）。
// 這支是頁面這一端（橋那端見 cc-bridge 的 aurelia_relay.py、aurelia_mcp.py）：
//   ・一連上就把奧瑞亞現在有的工具送給橋（POST /v1/aurelia/tools），住戶的 CLI 才列得出來。
//   ・一直長輪詢 GET /v1/aurelia/jobs：住戶叫了工具，就在這裡用 OS_AURELIA_TOOLS／OS_AURELIA_EDIT／OS_AURELIA_PRESET 跑，結果交回橋。
//   ・改世界書、改預設只做成單子（prop）交給橋存著，她在留言板「等你同意的」按同意才寫（os_board.js）。
//     單子記下是在酒館還是手機提的：兩邊的世界書、預設是分開的，要在同一邊按同意。
//     單子的同意、改回去、那一行的字都經 OS_AURELIA_EDIT（改預設的單子它轉給 OS_AURELIA_PRESET），留言板不用分兩條。
// 頁面裡沒有奧瑞亞（只裝房間、或通知點進來的 board.html）就什麼都不做。
// 酒館與手機同時開著：誰先拿到工作誰做。
// ----------------------------------------------------------------
(function () {
    'use strict';
    const win = window.parent || window;
    if (win.__AURELIA_LINK_ON) return;
    win.__AURELIA_LINK_ON = true;

    const REPUBLISH_MS = 30 * 60 * 1000;   // 奧瑞亞更新了工具也跟得上
    const PROP_TEXT = '已經做成單子交給她了：她按同意才會寫進去（寫了也能改回去）。'
        + '結果你現在不會知道，她處理了之後，你下次跟她說話或醒來時會看到一行寫結果；不要跟她說已經改好了。';

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function _A() { return win.OS_AURELIA_TOOLS || window.OS_AURELIA_TOOLS || null; }
    function _E() { return win.OS_AURELIA_EDIT || window.OS_AURELIA_EDIT || null; }
    function _P() { return win.OS_AURELIA_PRESET || window.OS_AURELIA_PRESET || null; }
    function _V() { return win.OS_AURELIA_VN || window.OS_AURELIA_VN || null; }
    function _T() { return win.OS_AURELIA_THEME || window.OS_AURELIA_THEME || null; }
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

    // 住戶看的工具：三組合起來，同名的（查世界書）留改世界書那份——住戶不是故事裡的人，查世界書找所有的書
    //   每個工具帶 groups：出現在哪幾組（look 翻資料、wb 改世界書、preset 改預設、vn 改 VN 組件、theme 改主題）。宿舍門卡上每位住戶勾了哪幾組，
    //   橋照這個只列給他勾了的（查世界書兩組都有、看修改紀錄改世界書與改預設都有，勾其中一組就有）。
    function _tools() {
        const A = _A(), E = _E(), P = _P(), V = _V(), T = _T();
        const out = [], seen = {};
        const add = g => t => {
            if (!t || !t.name) return;
            if (seen[t.name]) { if (seen[t.name].groups.indexOf(g) === -1) seen[t.name].groups.push(g); return; }
            seen[t.name] = { name: t.name, description: t.description || '', inputSchema: t.inputSchema || { type: 'object', properties: {} }, propose: !!t.propose, groups: [g] };
            out.push(seen[t.name]);
        };
        ((E && E.tools) || []).forEach(add('wb'));
        ((P && P.tools) || []).forEach(add('preset'));
        ((V && V.tools) || []).forEach(add('vn'));
        ((T && T.tools) || []).forEach(add('theme'));
        ((A && A.tools) || []).forEach(add('look'));
        return out;
    }
    function _notes() {
        const A = _A(), E = _E(), P = _P(), V = _V(), T = _T();
        return { look: (A && A.note) || '', wb: (E && E.note) || '', preset: (P && P.note) || '', vn: (V && V.note) || '', theme: (T && T.note) || '' };
    }
    function _note() {
        const n = _notes();
        return [n.look, n.wb, n.preset, n.vn, n.theme].filter(Boolean).join(' ');
    }

    async function _run(job) {
        const A = _A(), E = _E(), P = _P(), V = _V(), T = _T();
        const name = String(job.name || ''), args = job.args || {};
        // 改主題那組自己的（跟改 VN 組件同一種走法）
        const th = /^aurelia_theme_/.test(name) ? ((T && T.tools) || []).find(t => t.name === name) : null;
        if (th) {
            try {
                if (th.propose) {
                    const r = await T.propose(name, args);
                    if (r && r.ok && r.prop) {
                        r.prop.by = _residentName(job.rid);
                        r.prop.where = _where();
                        r.prop.from = '宿舍';
                        return { ok: true, text: PROP_TEXT, prop: r.prop, rid: job.rid, tool: name };
                    }
                    return { ok: false, text: (r && r.text) || '沒有成功' };
                }
                return { ok: true, text: String(await T.run(name, args)) + '（在她的' + _where() + '查的）' };
            } catch (e) { return { ok: false, text: (e && e.message) || '失敗' }; }
        }
        // 改 VN 組件那組自己的（看修改紀錄兩邊都有，交給改世界書那組跑就好）
        const vn = /^aurelia_vn_/.test(name) ? ((V && V.tools) || []).find(t => t.name === name) : null;
        if (vn) {
            try {
                if (vn.propose) {
                    const r = await V.propose(name, args);
                    if (r && r.ok && r.prop) {
                        r.prop.by = _residentName(job.rid);
                        r.prop.where = _where();
                        r.prop.from = '宿舍';
                        return { ok: true, text: PROP_TEXT, prop: r.prop, rid: job.rid, tool: name };
                    }
                    return { ok: false, text: (r && r.text) || '沒有成功' };
                }
                // 看看畫出來的樣子：截圖一起交回（橋轉成住戶看得到的圖片）
                if (name === 'aurelia_vn_look' && V.look) {
                    const r = await V.look(args);
                    return { ok: true, text: r.text + '（在她的' + _where() + '畫的）', images: (r.images || []).slice(0, 3) };
                }
                return { ok: true, text: String(await V.run(name, args)) + '（在她的' + _where() + '查的）' };
            } catch (e) { return { ok: false, text: (e && e.message) || '失敗' }; }
        }
        const pre = ((P && P.tools) || []).find(t => t.name === name);
        const edit = pre ? null : ((E && E.tools) || []).find(t => t.name === name);
        const M = pre ? P : E;   // 改預設的歸 OS_AURELIA_PRESET，其他會動手的歸 OS_AURELIA_EDIT
        try {
            if ((pre || edit) && (pre || edit).propose) {
                const r = await M.propose(name, args);
                if (r && r.ok && r.prop) {
                    r.prop.by = _residentName(job.rid);
                    r.prop.where = _where();
                    r.prop.from = '宿舍';   // 修改紀錄寫在哪提的
                    return { ok: true, text: PROP_TEXT, prop: r.prop, rid: job.rid, tool: name };
                }
                return { ok: false, text: (r && r.text) || '沒有成功' };
            }
            if (pre) return { ok: true, text: String(await P.run(name, args)) + '（在她的' + _where() + '查的）' };
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
                    await _post(b, '/v1/aurelia/tools', { tools: _tools(), note: _note(), notes: _notes(), where: _where() });
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
