// ----------------------------------------------------------------
// [檔案] os_spend_panel.js
// 路徑：os_phone/os/os_spend_panel.js
// 職責：💰 額度面板 — 累計 Claude 房間 cost / token / cache 命中率
// 數據：每次 _sendClaudeMessage 收到 usage_meta 就呼叫 record(usage)
//       LocalStorage key: aurelia_spend_log（最多 1000 筆，舊的 FIFO 丟掉）
// ----------------------------------------------------------------
(function() {
    console.log('[Aurelia] 載入額度面板（v0.1）...');
    const win = window.parent || window;
    const STORAGE_KEY = 'aurelia_spend_log';
    const MAX_ENTRIES = 1000;

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
     * 紀錄一次 assistant message 的 usage。在 _sendClaudeMessage 成功收到回覆時呼叫。
     * usage_meta: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, total_cost_usd, model }
     */
    function record(usage_meta) {
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
        });
        while (log.length > MAX_ENTRIES) log.shift();
        _saveLog(log);
    }

    function _stats(log) {
        let totalCost = 0, totalIn = 0, totalOut = 0, totalCacheRead = 0, totalCacheCreate = 0;
        for (const e of log) {
            totalCost += e.cost;
            totalIn += e.input_tokens;
            totalOut += e.output_tokens;
            totalCacheRead += e.cache_read;
            totalCacheCreate += e.cache_create;
        }
        // cache 命中率 = cache_read / (cache_read + uncached_input + cache_create)
        const totalAllInput = totalIn + totalCacheRead + totalCacheCreate;
        const cacheHitPct = totalAllInput > 0
            ? Math.round(totalCacheRead / totalAllInput * 100)
            : 0;
        return {
            count: log.length,
            totalCost,
            totalIn,
            totalOut,
            totalCacheRead,
            totalCacheCreate,
            cacheHitPct,
        };
    }

    function _formatTs(ts) {
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function _formatNum(n) {
        if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n/1000).toFixed(1) + 'K';
        return String(n);
    }

    function _shortModel(model) {
        if (!model) return '?';
        return model.replace(/^claude-/, '').replace(/-202\d+$/, '');
    }

    function launch(container) {
        if (!container) return;
        const log = _loadLog();
        const s = _stats(log);
        const recent = log.slice(-30).reverse();
        const recentRows = recent.length ? recent.map(e => `
            <div class="sp-row">
                <span class="sp-row-ts">${_formatTs(e.ts)}</span>
                <span class="sp-row-cost">$${e.cost.toFixed(4)}</span>
                <span class="sp-row-tokens">${_formatNum(e.input_tokens)}↑ ${_formatNum(e.output_tokens)}↓</span>
                <span class="sp-row-model">${_shortModel(e.model)}</span>
            </div>
        `).join('') : '<div class="sp-row-empty">還沒有對話紀錄。<br>進 Claude 房間發訊息後就會累計。</div>';

        container.innerHTML = `
            <style>
                .sp-container { width: 100%; height: 100%; padding: 16px;
                    background: linear-gradient(135deg, #fff8ec 0%, #fcefcc 100%);
                    color: #3d2010;
                    font-family: 'Playfair Display', Georgia, 'Songti TC', 'Microsoft JhengHei', serif;
                    overflow: auto; box-sizing: border-box; }
                .sp-header { font-size: 18px; font-weight: 700; margin-bottom: 16px;
                    display: flex; align-items: center; gap: 8px; color: #3d2010;
                    position: relative; }
                .sp-header-sub { font-size: 11px; color: #896645; font-weight: 400; margin-left: 8px; }
                .sp-close-btn {
                    position: absolute; right: 0; top: -4px;
                    background: transparent; border: 1px solid #EAB05C;
                    color: #896645;
                    width: 28px; height: 28px; border-radius: 50%;
                    cursor: pointer; font-size: 14px;
                    display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s; padding: 0;
                }
                .sp-close-btn:hover {
                    background: rgba(217,81,34,0.15);
                    color: #D95122;
                    border-color: #D95122;
                }
                .sp-card { background: rgba(255,255,255,0.85); border: 1px solid #EAB05C;
                    border-radius: 12px; padding: 14px 18px; margin-bottom: 12px;
                    box-shadow: 0 2px 8px rgba(137,102,69,0.1); }
                .sp-big { font-size: 32px; font-weight: 700; color: #D95122;
                    text-align: center; margin: 4px 0; letter-spacing: 0.5px; }
                .sp-sub { font-size: 12px; color: #896645; text-align: center; }
                .sp-grid { display: grid; grid-template-columns: 1fr 1fr 1fr;
                    gap: 10px; margin-bottom: 12px; }
                .sp-grid-cell { background: rgba(255,255,255,0.85); border: 1px solid #EAB05C;
                    border-radius: 10px; padding: 10px 6px; text-align: center; }
                .sp-grid-num { font-size: 18px; font-weight: 700; color: #D95122; }
                .sp-grid-label { font-size: 11px; color: #896645; margin-top: 2px; }
                .sp-section-title { font-size: 13px; font-weight: 700; color: #896645;
                    margin: 12px 0 6px 0; padding-left: 4px; }
                .sp-list { background: rgba(255,255,255,0.85); border: 1px solid #EAB05C;
                    border-radius: 12px; overflow: hidden;
                    box-shadow: 0 2px 8px rgba(137,102,69,0.1); }
                .sp-row { display: grid; grid-template-columns: 1.1fr 1fr 1.5fr 1fr;
                    padding: 7px 12px; font-size: 12px; align-items: center;
                    border-bottom: 1px solid rgba(234,176,92,0.2); }
                .sp-row:last-child { border-bottom: none; }
                .sp-row-ts { color: #896645; font-family: 'Cascadia Code', Consolas, monospace; }
                .sp-row-cost { color: #D95122; font-weight: 600; text-align: right;
                    font-family: 'Cascadia Code', Consolas, monospace; }
                .sp-row-tokens { color: #896645; font-family: 'Cascadia Code', Consolas, monospace;
                    font-size: 11px; text-align: center; }
                .sp-row-model { color: #896645; font-family: 'Cascadia Code', Consolas, monospace;
                    font-size: 11px; text-align: right; }
                .sp-row-empty { padding: 30px 20px; text-align: center; color: #896645;
                    opacity: 0.7; font-size: 13px; line-height: 1.6; }
                .sp-clear-btn { margin-top: 12px; padding: 8px 14px;
                    background: rgba(217,81,34,0.12); border: 1px solid rgba(217,81,34,0.4);
                    color: #D95122; border-radius: 8px; cursor: pointer; font-size: 12px;
                    font-family: inherit; transition: background 0.2s; }
                .sp-clear-btn:hover { background: rgba(217,81,34,0.25); }
            </style>
            <div class="sp-container">
                <div class="sp-header">💰 額度面板<span class="sp-header-sub">累計 ${s.count} 次對話的本地統計</span><button class="sp-close-btn" id="sp-close-btn" title="關閉">✕</button></div>

                <div class="sp-card">
                    <div class="sp-big">$${s.totalCost.toFixed(4)}</div>
                    <div class="sp-sub">累計花費</div>
                </div>

                <div class="sp-grid">
                    <div class="sp-grid-cell">
                        <div class="sp-grid-num">${_formatNum(s.totalIn)}</div>
                        <div class="sp-grid-label">↑ input</div>
                    </div>
                    <div class="sp-grid-cell">
                        <div class="sp-grid-num">${_formatNum(s.totalOut)}</div>
                        <div class="sp-grid-label">↓ output</div>
                    </div>
                    <div class="sp-grid-cell">
                        <div class="sp-grid-num">${s.cacheHitPct}%</div>
                        <div class="sp-grid-label">cache 命中</div>
                    </div>
                </div>

                <div class="sp-section-title">最近 30 次呼叫</div>
                <div class="sp-list">
                    ${recentRows}
                </div>

                <button class="sp-clear-btn" id="sp-clear-btn">🗑️ 清空累計（不可逆）</button>
            </div>
        `;

        // 綁清空按鈕
        const clearBtn = container.querySelector('#sp-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('清空所有累計花費紀錄？此動作不可逆。')) {
                    localStorage.removeItem(STORAGE_KEY);
                    launch(container);  // 重 render
                }
            });
        }

        // 綁關閉按鈕（走 PhoneSystem.goHome → control_center 註冊的 doClose）
        const closeBtn = container.querySelector('#sp-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (window.PhoneSystem && typeof window.PhoneSystem.goHome === 'function') {
                    window.PhoneSystem.goHome();
                }
            });
        }
    }

    win.OS_SPEND_PANEL = { launch, record };

    console.log('[Aurelia] 額度面板載入完成');
})();
