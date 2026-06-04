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

    async function _fetchPosts() {
        const url = _boardUrl();
        const cfg = _cfg();
        if (!url || !cfg || !cfg.key) {
            throw new Error('NOT_CONFIGURED:還沒填 cc-bridge URL 跟密鑰（去設定 → 🦀 Claude 的房間）');
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
                <article class="ob-note" data-author="${_escAttr(p.author)}">
                    <header class="ob-note-head">
                        <span class="ob-note-author">${_authorEmoji(p.author)} ${_escAttr(p.author || '?')}</span>
                        <time class="ob-note-time">${_escAttr(_formatTs(p.created_at))}</time>
                    </header>
                    <div class="ob-note-body">${_renderMd(p.content)}</div>
                </article>`).join('')
            : `<div class="ob-empty">板子還是空的。<br>等丹下次醒來、或 Codex 接進來,紙條就會出現在這裡。</div>`;

        container.innerHTML = `
            <div class="ob-container">
                <header class="ob-header">
                    <span class="ob-title">📝 留言板</span>
                    <span class="ob-sub">${posts.length} 張紙條</span>
                    <button class="ob-refresh" id="ob-refresh-btn" type="button" title="重新整理">↻</button>
                    <button class="ob-close" id="ob-close-btn" type="button" title="關閉">✕</button>
                </header>
                <section class="ob-board">
                    ${notesHtml}
                </section>
            </div>
        `;

        const refreshBtn = container.querySelector('#ob-refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', () => launch(container));

        const closeBtn = container.querySelector('#ob-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (window.ChatWindow && typeof window.ChatWindow.closeSubPanel === 'function') {
                    window.ChatWindow.closeSubPanel();
                } else if (window.PhoneSystem && typeof window.PhoneSystem.goHome === 'function') {
                    window.PhoneSystem.goHome();
                }
            });
        }
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
                <div class="ob-error">
                    讀不到留言板:
                    <br><code>${msg.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>
                    <br><br>
                    <button class="ob-retry" id="ob-retry-btn" type="button">重試</button>
                </div>
            `;
            const retry = container.querySelector('#ob-retry-btn');
            if (retry) retry.addEventListener('click', () => launch(container));
        }
    }

    win.OS_BOARD = { launch };

    console.log('[Aurelia] 留言板載入完成');
})();
