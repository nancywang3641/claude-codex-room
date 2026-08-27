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
            <div class="sp-container">
                <div class="sp-card">
                    <div class="sp-big">$${s.totalCost.toFixed(4)}</div>
                    <div class="sp-sub">累計花費 · ${s.count} 次對話</div>
                </div>

                <div class="sp-grid">
                    <div class="sp-grid-cell">
                        <div class="sp-grid-num">${_formatNum(s.totalIn)}</div>
                        <div class="sp-grid-label"><i class="fa-solid fa-arrow-up"></i> input</div>
                    </div>
                    <div class="sp-grid-cell">
                        <div class="sp-grid-num">${_formatNum(s.totalOut)}</div>
                        <div class="sp-grid-label"><i class="fa-solid fa-arrow-down"></i> output</div>
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

                <button class="sp-clear-btn" id="sp-clear-btn" type="button"><i class="fa-solid fa-trash-can"></i> 清空累計</button>
            </div>
        `;

        // 清空走兩段確認（原生 confirm 會被瀏覽器「禁止對話框」擋掉）
        const clearBtn = container.querySelector('#sp-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (clearBtn.dataset.armed === '1') {
                    localStorage.removeItem(STORAGE_KEY);
                    launch(container);  // 重 render
                } else {
                    clearBtn.dataset.armed = '1';
                    clearBtn.classList.add('armed');
                    clearBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 確定清空？不可逆，再按一次';
                }
            });
        }
    }

    win.OS_SPEND_PANEL = { launch, record };

    console.log('[Aurelia] 額度面板載入完成');
})();
