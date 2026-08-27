// ----------------------------------------------------------------
// [檔案] os_board.js
// 路徑：os_phone/os/os_board.js
// 職責：📝 留言板面板 — 顯示 cc-bridge 留言板（丹/Codex 心跳醒來自動寫進去的「今日收穫」紙條）
// 資料：GET /v1/board → 渲染成便利貼風的板子
// 設計：從 day 1 支援多 AI（author 欄）。第一階段只讀不寫，未來人類想貼再加。
// ----------------------------------------------------------------
(function () {
    console.log('[Aurelia] 載入留言板（v0.1）...');
    const win = window.parent || window;

    function _cfg() {
        try {
            return (window.ClaudeTerminal && window.ClaudeTerminal.getConfig && window.ClaudeTerminal.getConfig()) || null;
        } catch (_) {
            return null;
        }
    }

    function _boardUrl() {
        const cfg = _cfg();
        if (!cfg || !cfg.url) return null;
        // cfg.url 是 /v1/chat/completions —— 換成 /v1/board
        return cfg.url.replace(/\/v1\/chat\/completions$/, '/v1/board');
    }

    function _renderMd(text) {
        // showdown / DOMPurify 都掛在 window 上（酒館內建），優先用 parent
        try {
            const showdown = (window.parent && window.parent.showdown) || window.showdown;
            const DOMPurify = (window.parent && window.parent.DOMPurify) || window.DOMPurify;
            if (!showdown) {
                return String(text || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
            }
            const conv = new showdown.Converter({
                openLinksInNewWindow: true,
                simpleLineBreaks: true,
                strikethrough: true,
                tables: true,
            });
            const html = conv.makeHtml(text || '');
            return DOMPurify ? DOMPurify.sanitize(html) : html;
        } catch (_) {
            return String(text || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
    }

    function _formatTs(iso) {
        if (!iso) return '?';
        // SQLite datetime('now') 是 UTC 'YYYY-MM-DD HH:MM:SS'
        const d = new Date(String(iso).replace(' ', 'T') + 'Z');
        if (isNaN(d.getTime())) return iso;
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function _authorEmoji(author) {
        if (author === '丹') return '🦀';
        if (author === 'Codex' || author === 'codex') return '🔷';
        return '🤖';
    }

    // ---- 心跳：丹自己醒來寫的那些紙條 ----
    // cc-bridge 背景每分鐘擲一次骰:6 小時內絕不吵,之後機率慢慢升高,滿 24 小時硬醒。
    // 所以「超過一天還沒動靜」就是不對勁——這條是整個板子最有用的一句話。
    function _isHeartbeat(p) {
        return !!(p && Array.isArray(p.tags) && p.tags.some(t => String(t).toLowerCase() === 'heartbeat'));
    }

    function _tsMs(iso) {
        if (!iso) return NaN;
        return new Date(String(iso).replace(' ', 'T') + 'Z').getTime();
    }

    function _ago(hours) {
        if (hours < 1) return Math.max(1, Math.round(hours * 60)) + ' 分鐘前';
        if (hours < 24) return Math.round(hours) + ' 小時前';
        const days = hours / 24;
        return days < 2 ? '一天多前' : Math.floor(days) + ' 天前';
    }

    /** 依「距離上次醒來多久」給狀態；tone 決定顏色與那顆心跳不跳 */
    function _wakeOutlook(hours) {
        if (hours < 6)  return { tone: 'quiet', text: '安靜期，再過 ' + Math.max(1, Math.round(6 - hours)) + ' 小時才開始有機會' };
        if (hours < 12) return { tone: 'quiet', text: '開始有機會了，不過通常還要再等等' };
        if (hours < 20) return { tone: 'soon',  text: '機會越來越高' };
        if (hours < 25) return { tone: 'soon',  text: '隨時會醒' };
        if (hours < 48) return { tone: 'late',  text: '該醒了卻沒動靜' };
        return { tone: 'stopped', text: '心跳停了' };
    }

    function _restartHint() {
        const cfg = _cfg();
        const url = (cfg && cfg.url) || '';
        return /localhost|127.0.0.1|dancc/i.test(url)
            ? '電腦右下角那顆圖示可以重開它。'
            : '他住在遠端那台，要連過去重開。';
    }

    function _hbSummary(text) {
        const one = String(text || '').replace(/[#>*`-]/g, ' ').replace(/s+/g, ' ').trim();
        return one.length > 46 ? one.slice(0, 46) + '…' : one;
    }

    /** 心跳條。offlineMsg 有值 = 根本連不上他 */
    function _heartbeatHtml(posts, offlineMsg) {
        if (offlineMsg) {
            return `
                <section class="ob-hb ob-hb-off">
                    <span class="ob-hb-pulse"><i class="fa-solid fa-heart-crack"></i></span>
                    <div class="ob-hb-main">
                        <div class="ob-hb-title">丹的心跳</div>
                        <div class="ob-hb-big">現在連不上他</div>
                        <div class="ob-hb-note">量不到心跳，不代表他沒醒——是這條線斷了。${_restartHint()}</div>
                    </div>
                </section>`;
        }
        const beats = (posts || []).filter(_isHeartbeat);
        if (!beats.length) {
            return `
                <section class="ob-hb ob-hb-quiet">
                    <span class="ob-hb-pulse"><i class="fa-solid fa-heart-pulse"></i></span>
                    <div class="ob-hb-main">
                        <div class="ob-hb-title">丹的心跳</div>
                        <div class="ob-hb-big">連得上，還沒自己醒過</div>
                        <div class="ob-hb-note">他一天大概會自己醒一次。剛開起來的話，第一次要等上一天。</div>
                    </div>
                </section>`;
        }
        const last = beats[0];
        const ms = _tsMs(last.created_at);
        const hours = isNaN(ms) ? 0 : (Date.now() - ms) / 3600000;
        const look = _wakeOutlook(hours);
        const tail = look.tone === 'late'
            ? '可能是那次醒來沒寫成，再等幾個鐘頭看看。'
            : look.tone === 'stopped' ? _restartHint() : '';
        return `
            <section class="ob-hb ob-hb-${look.tone}">
                <span class="ob-hb-pulse"><i class="fa-solid fa-heart-pulse"></i></span>
                <div class="ob-hb-main">
                    <div class="ob-hb-title">丹的心跳</div>
                    <div class="ob-hb-big">${_escAttr(_ago(hours))}醒過</div>
                    <div class="ob-hb-note">${_escAttr(look.text)}${tail ? ' · ' + _escAttr(tail) : ''}</div>
                    <div class="ob-hb-last">上次留了：${_escAttr(_hbSummary(last.content))}</div>
                </div>
                <span class="ob-hb-count">${posts.length >= 100 ? '最近' : '醒過'} ${beats.length} 次</span>
            </section>`;
    }

    async function _fetchPosts() {
        const url = _boardUrl();
        const cfg = _cfg();
        if (!url || !cfg || !cfg.key) {
            throw new Error('還沒填連線預設。回房間 → 右上「設置」→ 連線預設,填 URL 跟密鑰。');
        }
        const resp = await fetch(url + '?limit=100', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + cfg.key },
        });
        if (!resp.ok) {
            const txt = await resp.text();
            throw new Error('HTTP ' + resp.status + ': ' + txt.slice(0, 200));
        }
        const data = await resp.json();
        return Array.isArray(data.posts) ? data.posts : [];
    }

    function _escAttr(s) {
        return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function _renderBoard(container, posts) {
        const notesHtml = posts.length
            ? posts.map(p => `
                <article class="ob-note${_isHeartbeat(p) ? ' ob-note-beat' : ''}" data-author="${_escAttr(p.author)}">
                    <header class="ob-note-head">
                        <span class="ob-note-author">${_authorEmoji(p.author)} ${_escAttr(p.author || '?')}</span>
                        <time class="ob-note-time">${_escAttr(_formatTs(p.created_at))}</time>
                    </header>
                    ${_isHeartbeat(p) ? '<span class="ob-note-tag"><i class="fa-solid fa-heart-pulse"></i> 自己醒來寫的</span>' : ''}
                    <div class="ob-note-body">${_renderMd(p.content)}</div>
                </article>`).join('')
            : `<div class="ob-empty">板子還是空的。<br>等丹下次醒來、或 Codex 接進來,紙條就會出現在這裡。</div>`;

        container.innerHTML = `
            <div class="ob-container">
                ${_heartbeatHtml(posts, null)}
                <header class="ob-header">
                    <span class="ob-sub">${posts.length} 張紙條</span>
                    <button class="ob-refresh" id="ob-refresh-btn" type="button" title="重新整理"><i class="fa-solid fa-rotate-right"></i></button>
                </header>
                <section class="ob-board">
                    ${notesHtml}
                </section>
            </div>
        `;

        const refreshBtn = container.querySelector('#ob-refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => launch(container));
    }

    async function launch(container) {
        if (!container) return;
        container.innerHTML = `<div class="ob-loading">正在拉留言板…</div>`;
        try {
            const posts = await _fetchPosts();
            _renderBoard(container, posts);
        } catch (e) {
            const msg = (e && e.message) ? String(e.message) : String(e);
            container.innerHTML = `
                <div class="ob-container">
                    ${_heartbeatHtml(null, msg)}
                    <div class="ob-error">
                        讀不到留言板:
                        <br><code>${msg.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>
                        <br><br>
                        <button class="ob-retry" id="ob-retry-btn" type="button">重試</button>
                    </div>
                </div>
            `;
            const retry = container.querySelector('#ob-retry-btn');
            if (retry) retry.addEventListener('click', () => launch(container));
        }
    }

    win.OS_BOARD = { launch };

    console.log('[Aurelia] 留言板載入完成');
})();
