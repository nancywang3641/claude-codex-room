// ----------------------------------------------------------------
// [檔案] os_spend_panel.js
// 路徑：claude-codex-room/core/os_spend_panel.js
// 職責：💰 額度面板 —— 照「同一池額度」分頁：Claude 訂閱（丹、天天、克語共用）、Codex 訂閱、DeepSeek、小機
//   ・訂閱那兩頁上面是真的額度：橋的 GET /v1/quota（Claude 的 rate_limit_event、Codex session 檔的 rate_limits）
//     ——5 小時內、這週各用了幾 %、什麼時候重置。拿不到就寫拿不到，不放猜的數字。
//   ・下面是這一池每一位用了多少（幾句、送出／回覆多少、緩存讀到幾成）。不寫 $：訂閱的 $ 是照 API 價換算的等值、
//     不是真的花出去的；小機的接口價錢我們不知道。
// 數據：每次住戶回覆收到 usage_meta 就 record(usage, {rid, provider})
//       LocalStorage key: aurelia_spend_log（最多 1000 筆，舊的 FIFO 丟掉）。舊紀錄沒記是誰，照模型名歸到哪一池
// ----------------------------------------------------------------
(function() {
    console.log('[Aurelia] 載入額度面板（v0.2）...');
    const win = window.parent || window;
    const STORAGE_KEY = 'aurelia_spend_log';
    const TAB_KEY = 'aurelia_spend_tab';
    const MAX_ENTRIES = 1000;
    const QUOTA_TTL = 60 * 1000;

    const POOLS = [
        { id: 'claude',   name: 'Claude 訂閱', quota: 'claude' },
        { id: 'codex',    name: 'Codex 訂閱',  quota: 'codex' },
        { id: 'deepseek', name: 'DeepSeek' },
        { id: 'xiaoji',   name: '小機' },
    ];

    const A0 = win.AUI || window.AUI;
    if (A0 && A0.registerHelp) A0.registerHelp({ spend_panel: { title: '額度',
        body: '訂閱的額度：5 小時內、這週各用了幾成，什麼時候重置。丹、天天、克語是同一個 Claude 帳號，共用一池。數字是他們回話時順便報的，沒人回過話就還沒有。\n小機用的是接口的 KEY，查不到還剩多少，所以只算用了多少。\n緩存：這一次送出去的開頭跟前一次一樣，那段就讀之前存過的，比較省。讀到的比例越高越好。' } });

    function _loadLog() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (_) {
            return [];
        }
    }

    function _saveLog(arr) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
        } catch (e) {
            console.warn('[SpendPanel] save failed:', e);
        }
    }

    /**
     * 紀錄一次回覆的 usage。房間（chat_room.js）、群聊（chat_group.js）收到回覆時呼叫。
     * usage_meta: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, total_cost_usd, model }
     * who: { rid, provider }（誰回的、哪一種住戶）
     */
    function record(usage_meta, who) {
        if (!usage_meta || typeof usage_meta !== 'object') return;
        const log = _loadLog();
        log.push({
            ts: Date.now(),
            cost: Number(usage_meta.total_cost_usd || 0),
            input_tokens: Number(usage_meta.input_tokens || 0),
            output_tokens: Number(usage_meta.output_tokens || 0),
            cache_read: Number(usage_meta.cache_read_input_tokens || 0),
            cache_create: Number(usage_meta.cache_creation_input_tokens || 0),
            model: String(usage_meta.model || ''),
            rid: String((who && who.rid) || ''),
            prov: String((who && who.provider) || ''),
        });
        while (log.length > MAX_ENTRIES) log.shift();
        _saveLog(log);
    }

    // 舊紀錄沒記是哪一種住戶：照模型名歸池
    function _poolOf(e) {
        if (e.prov && POOLS.some(p => p.id === e.prov)) return e.prov;
        return /claude|opus|sonnet|haiku|fable|mythos/i.test(e.model || '') ? 'claude' : 'codex';
    }

    function _stats(list) {
        let n = 0, totalIn = 0, totalOut = 0, read = 0, create = 0;
        for (const e of list) {
            n++;
            totalIn += e.input_tokens;
            totalOut += e.output_tokens;
            read += e.cache_read;
            create += e.cache_create;
        }
        // 送出的全部＝沒緩存的＋讀到的＋這次存進去的；緩存讀到幾成＝讀到的 / 送出的全部
        const allIn = totalIn + read + create;
        return { n, sent: allIn, out: totalOut, cachePct: allIn > 0 ? Math.round(read / allIn * 100) : 0 };
    }

    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    const _pad = n => String(n).padStart(2, '0');
    // 今天的只寫幾點，別天的加日期（窄螢幕一行放得下）
    function _formatTs(ts) {
        const d = new Date(ts);
        const hm = `${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
        return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth()+1}/${d.getDate()} ${hm}`;
    }
    function _formatReset(sec) { return _formatTs(sec * 1000); }   // 重置時間是 epoch 秒

    function _formatNum(n) {
        if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n/1000).toFixed(1) + 'K';
        return String(n);
    }

    function _CT() { return window.ClaudeTerminal || null; }
    function _nameOf(rid) {
        if (!rid) return '以前的紀錄';   // 改版前的紀錄沒記是誰（只認得出是哪一池）
        const CT = _CT();
        const r = (CT && typeof CT.getResident === 'function') ? CT.getResident(rid) : null;
        return (r && r.name) || rid;
    }

    // ── 真的額度：橋的 /v1/quota ──
    let _quota = null, _quotaAt = 0, _quotaErr = '';
    function _bridge() {
        const OS = window.OS_SETTINGS;
        const p = (OS && typeof OS.getActiveClaudePreset === 'function') ? OS.getActiveClaudePreset() : null;
        if (!p || !p.url || !p.key) return null;
        return { base: String(p.url).replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, ''), key: p.key };
    }
    async function _loadQuota(force) {
        if (!force && _quotaAt && Date.now() - _quotaAt < QUOTA_TTL) return;
        const b = _bridge();
        _quotaAt = Date.now();
        if (!b) { _quota = null; _quotaErr = 'nobridge'; return; }
        try {
            const res = await fetch(b.base + '/v1/quota', { headers: { 'Authorization': 'Bearer ' + b.key } });
            if (!res.ok) { _quota = null; _quotaErr = res.status === 404 ? 'oldbridge' : 'down'; return; }
            _quota = await res.json();
            _quotaErr = '';
        } catch (_) { _quota = null; _quotaErr = 'down'; }
    }

    // 一條額度：名字、條、幾成、什麼時候重置。過了重置時間就是新的一輪，舊的幾成不算
    function _qRow(label, pct, resetsAt, warn) {
        const now = Date.now() / 1000;
        const past = resetsAt && resetsAt <= now;
        const p = (past || pct == null) ? null : Math.max(0, Math.min(100, Math.round(pct)));
        const meta = past ? '已重置' : (resetsAt ? _formatReset(resetsAt) + ' 重置' : '');
        return '<div class="sp-q-row">'
            + '<div class="sp-q-label">' + _esc(label) + '</div>'
            + '<div class="sp-q-bar' + (warn && !past ? ' warn' : '') + '"><div class="sp-q-fill" data-p="' + (p == null ? 0 : p) + '"></div></div>'
            + '<div class="sp-q-pct">' + (p == null ? '—' : p + '%') + '</div>'
            + '<div class="sp-q-meta">' + _esc(meta) + '</div></div>';
    }
    function _winLabel(min) {
        if (min === 300) return '5 小時內';
        if (min === 10080) return '這週';
        return min ? Math.round(min / 60) + ' 小時內' : '';
    }
    function _quotaHtml(pool) {
        if (!pool.quota) return '';
        let rows = '';
        let note = '';
        if (_quotaErr === 'nobridge') note = '房間沒有連橋，看不到額度。';
        else if (_quotaErr === 'oldbridge') note = '橋還是舊版，重開一次橋才看得到額度。';
        else if (_quotaErr === 'down') note = '連不到橋，看不到額度。';
        else if (pool.quota === 'claude') {
            const c = _quota && _quota.claude;
            const w = (c && c.windows) || {};
            const warn = c && c.status === 'allowed_warning';
            if (w.five_hour) rows += _qRow('5 小時內', w.five_hour.utilization != null ? w.five_hour.utilization * 100 : null, w.five_hour.resets_at, warn);
            if (w.seven_day) rows += _qRow('這週', w.seven_day.utilization != null ? w.seven_day.utilization * 100 : null, w.seven_day.resets_at, warn);
            if (c && c.status === 'rejected') note = '額度用完了，等重置。';
            else if (!rows) note = '還沒拿到數字：Claude 住戶回過一句話之後才有。';
        } else if (pool.quota === 'codex') {
            const x = _quota && _quota.codex;
            const warn = x && x.reached;
            [x && x.primary, x && x.secondary].forEach(w => {
                if (w) rows += _qRow(_winLabel(w.window_minutes), w.used_percent, w.resets_at, warn);
            });
            if (x && x.reached) note = '額度用完了，等重置。';
            else if (!rows) note = '還沒拿到數字：Codex 住戶回過一句話之後才有。';
        }
        const who = pool.id === 'claude' ? '<div class="sp-q-who">丹、天天、克語共用</div>' : '';
        return '<div class="sp-card sp-quota">' + who + rows + (note ? '<div class="sp-note">' + _esc(note) + '</div>' : '') + '</div>';
    }

    function _poolsShown(log) {
        const CT = _CT();
        const res = (CT && typeof CT.listResidents === 'function') ? (CT.listResidents() || []) : [];
        return POOLS.filter(p => res.some(r => r && r.provider === p.id) || log.some(e => _poolOf(e) === p.id));
    }

    function _render(container) {
        const log = _loadLog();
        const pools = _poolsShown(log);
        if (!pools.length) pools.push(POOLS[0]);
        let tab = '';
        try { tab = localStorage.getItem(TAB_KEY) || ''; } catch (_) {}
        const pool = pools.find(p => p.id === tab) || pools[0];
        const mine = log.filter(e => _poolOf(e) === pool.id);

        // 這一池每一位：幾句、送出多少、回覆多少、緩存讀到幾成（用得多的排前面）
        const byWho = {};
        mine.forEach(e => { (byWho[e.rid || ''] = byWho[e.rid || ''] || []).push(e); });
        const whoRows = Object.keys(byWho)
            .map(rid => ({ rid, s: _stats(byWho[rid]) }))
            .sort((a, b) => (b.s.sent + b.s.out) - (a.s.sent + a.s.out))
            .map(({ rid, s }) => `
                <div class="sp-row sp-row-who">
                    <span class="sp-row-name">${_esc(_nameOf(rid))}</span>
                    <span class="sp-row-n">${s.n} 句</span>
                    <span class="sp-row-tokens">送 ${_formatNum(s.sent)} · 回 ${_formatNum(s.out)}</span>
                    <span class="sp-row-cache">緩存 ${s.cachePct}%</span>
                </div>`).join('');

        const recent = mine.slice(-20).reverse().map(e => {
            const s = _stats([e]);
            return `
            <div class="sp-row">
                <span class="sp-row-ts">${_formatTs(e.ts)}</span>
                <span class="sp-row-name">${_esc(_nameOf(e.rid))}</span>
                <span class="sp-row-tokens">送 ${_formatNum(s.sent)} · 回 ${_formatNum(s.out)}</span>
                <span class="sp-row-cache">${e.cache_read ? '緩存 ' + s.cachePct + '%' : ''}</span>
            </div>`;
        }).join('');

        const help = (A0 && A0.helpBtn) ? A0.helpBtn('spend_panel') : '';
        container.innerHTML = `
            <div class="sp-container">
                <div class="sp-tabs">
                    ${pools.map(p => `<button type="button" class="sp-tab${p.id === pool.id ? ' on' : ''}" data-pool="${p.id}">${_esc(p.name)}</button>`).join('')}
                    <span class="sp-help">${help}</span>
                </div>
                ${_quotaHtml(pool)}
                <div class="sp-section-title">誰用了多少</div>
                <div class="sp-list">
                    ${whoRows || '<div class="sp-row-empty">這裡還沒有紀錄。<br>住戶回過話之後就會累計。</div>'}
                </div>
                ${recent ? `<div class="sp-section-title">最近 20 句</div><div class="sp-list">${recent}</div>` : ''}
                <button class="sp-clear-btn" id="sp-clear-btn" type="button"><i class="fa-solid fa-trash-can"></i> 清空累計</button>
            </div>
        `;
        container.querySelectorAll('.sp-q-fill').forEach(el => { el.style.width = (+el.dataset.p || 0) + '%'; });

        container.querySelectorAll('.sp-tab').forEach(b => b.addEventListener('click', () => {
            try { localStorage.setItem(TAB_KEY, b.dataset.pool); } catch (_) {}
            _render(container);
        }));

        // 清空走兩段確認（原生 confirm 會被瀏覽器「禁止對話框」擋掉）
        const clearBtn = container.querySelector('#sp-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (clearBtn.dataset.armed === '1') {
                    localStorage.removeItem(STORAGE_KEY);
                    _render(container);  // 重 render
                } else {
                    clearBtn.dataset.armed = '1';
                    clearBtn.classList.add('armed');
                    clearBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 確定清空？不可逆，再按一次';
                }
            });
        }
    }

    function launch(container) {
        if (!container) return;
        _render(container);
        // 額度從橋拿：先畫用量，拿到了再畫一次（一分鐘內不重拿）
        _loadQuota(false).then(() => { if (container.isConnected) _render(container); });
    }

    win.OS_SPEND_PANEL = { launch, record };
    if (win !== window) { try { window.OS_SPEND_PANEL = win.OS_SPEND_PANEL; } catch (_) {} }

    console.log('[Aurelia] 額度面板載入完成');
})();
