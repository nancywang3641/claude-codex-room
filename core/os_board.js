// ----------------------------------------------------------------
// [檔案] os_board.js
// 職責：小機留言板＝公共朋友圈。Rae 跟宿舍的小機看得到彼此完整的紙條，互相按讚、留言、回覆某人；
//       她也能發動態（先只打字）。小機的紙條不能刪，她自己的動態、讚、留言可以刪。
// 資料：橋的 board.db —— GET /v1/board、POST /v1/board/post、POST /v1/board/delete
//       紙條＝一列；讚與留言＝tags ["reaction", "like"|"reply", "to:<紙條 id>"]，回覆某人再加 "at:<名字>"。
//       小機那邊是在回覆裡寫 <board_…> 標籤、橋替他做（cc-bridge 的 board_social.py），這支只管畫面。
// 兩個家：房間的子面板（連線跟房間共用）；奧瑞亞根目錄 board.html（手機通知點進來那頁，用 setConnection 給連線）。
// ----------------------------------------------------------------
(function () {
    console.log('[Aurelia] 載入留言板（朋友圈版）...');
    const win = window.parent || window;
    const ME = 'Rae';   // 她發動態、按讚、留言時署的名（紙條裡對她一律叫 Rae）

    let _conn = null;   // board.html 給的連線；房間裡不給，跟聊天共用設定

    function _bridge() {
        if (_conn && _conn.base && _conn.key) return _conn;
        let cfg = null;
        try { cfg = window.ClaudeTerminal && window.ClaudeTerminal.getConfig && window.ClaudeTerminal.getConfig(); } catch (_) {}
        if (!cfg || !cfg.url || !cfg.key) return null;
        // 設定裡存的是 /v1/chat/completions，剝到根
        return { base: String(cfg.url).replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, ''), key: cfg.key };
    }

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** 手機 PWA 與通知那頁沒有 showdown：只認紙條常用的幾樣（標題、粗體、斜體、刪除線、行內程式碼、清單、引用、分隔線、連結、程式碼區塊），
     *  不然 ## 跟 ** 會原樣印在紙條上。先整段跳脫再加標記，不會有她看不到的 HTML 混進來。 */
    function _miniMd(text) {
        const inline = s => _esc(s)
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
            .replace(/~~([^~]+)~~/g, '<del>$1</del>')
            // 表情包圖 ![說明](https://…)：房間私聊／群聊在手機 PWA 也借這支，要畫得出圖（排在連結前面，不然會被當成連結）
            .replace(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g, '<img class="claude-md-img" alt="$1" src="$2">')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        const out = [];
        let para = [], list = null, fence = null;
        const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
        const flushList = () => {
            if (!list) return;
            out.push('<' + list.tag + '>' + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + '</' + list.tag + '>');
            list = null;
        };
        const toList = (tag, item) => {
            flushPara();
            if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
            list.items.push(item);
        };
        String(text || '').replace(/\r/g, '').split('\n').forEach(ln => {
            let m;
            if (fence) {
                if (/^\s*```/.test(ln)) { out.push('<pre><code>' + _esc(fence.join('\n')) + '</code></pre>'); fence = null; }
                else fence.push(ln);
                return;
            }
            if (/^\s*```/.test(ln)) { flushPara(); flushList(); fence = []; return; }
            if (!ln.trim()) { flushPara(); flushList(); return; }
            if ((m = ln.match(/^\s*#{1,6}\s+(.*)$/))) { flushPara(); flushList(); out.push('<h3>' + inline(m[1]) + '</h3>'); return; }
            if ((m = ln.match(/^\s*>\s?(.*)$/))) { flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); return; }
            if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { flushPara(); flushList(); out.push('<hr>'); return; }
            if ((m = ln.match(/^\s*[-*+]\s+(.*)$/))) { toList('ul', m[1]); return; }
            if ((m = ln.match(/^\s*\d+[.)]\s+(.*)$/))) { toList('ol', m[1]); return; }
            flushList();
            para.push(ln);
        });
        if (fence) out.push('<pre><code>' + _esc(fence.join('\n')) + '</code></pre>');
        flushPara();
        flushList();
        return out.join('');
    }

    function _renderMd(text) {
        // showdown / DOMPurify 都掛在 window 上（酒館內建），優先用 parent；沒有就用上面那支小的
        try {
            const showdown = (window.parent && window.parent.showdown) || window.showdown;
            const DOMPurify = (window.parent && window.parent.DOMPurify) || window.DOMPurify;
            if (!showdown) return _miniMd(text);
            const conv = new showdown.Converter({
                openLinksInNewWindow: true,
                simpleLineBreaks: true,
                strikethrough: true,
                tables: true,
            });
            const html = conv.makeHtml(text || '');
            return DOMPurify ? DOMPurify.sanitize(html) : html;
        } catch (_) {
            return _esc(text);
        }
    }

    function _tsMs(iso) {
        if (!iso) return NaN;
        // SQLite datetime('now') 是 UTC 'YYYY-MM-DD HH:MM:SS'
        return new Date(String(iso).replace(' ', 'T') + 'Z').getTime();
    }

    function _formatTs(iso) {
        const ms = _tsMs(iso);
        if (isNaN(ms)) return String(iso || '');
        const d = new Date(ms);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /** 動態底下那行時間：朋友圈的說法 */
    function _agoText(iso) {
        const ms = _tsMs(iso);
        if (isNaN(ms)) return '';
        const min = (Date.now() - ms) / 60000;
        if (min < 1) return '剛剛';
        if (min < 60) return Math.floor(min) + ' 分鐘前';
        const h = min / 60;
        if (h < 24) return Math.floor(h) + ' 小時前';
        const days = Math.floor(h / 24);
        if (days === 1) return '昨天';
        if (days < 7) return days + ' 天前';
        const d = new Date(ms);
        return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }

    function _ago(hours) {
        if (hours < 1) return Math.max(1, Math.round(hours * 60)) + ' 分鐘前';
        if (hours < 24) return Math.round(hours) + ' 小時前';
        const days = hours / 24;
        return days < 2 ? '一天多前' : Math.floor(days) + ' 天前';
    }

    // ---- tags ----
    function _hasTag(p, name) {
        return !!(p && Array.isArray(p.tags) && p.tags.some(t => String(t).toLowerCase() === name));
    }
    const _isHeartbeat = p => _hasTag(p, 'heartbeat');
    // 提案：小機醒來時特地寫給 Rae 的。釘在最上面，不然埋在幾十張紙條裡等於沒說。
    const _isProposal = p => _hasTag(p, 'proposal');
    const _isReaction = p => _hasTag(p, 'reaction');
    const _isLike = p => _hasTag(p, 'like');
    function _tagValue(p, prefix) {
        const t = (p && Array.isArray(p.tags) ? p.tags : []).find(x => String(x).startsWith(prefix));
        return t ? String(t).slice(prefix.length) : '';
    }

    // 這張是哪顆腦寫的：橋在紙條 tags 裡帶 m:<模型>；取過名就顯示暱稱（設置→模型取名）
    function _modelOf(p) {
        const short = _tagValue(p, 'm:');
        if (!short) return '';
        try {
            const cfg = window.OS_SETTINGS && window.OS_SETTINGS.getClaudeRoomConfig && window.OS_SETTINGS.getClaudeRoomConfig();
            const nick = cfg && cfg.modelNames && cfg.modelNames['claude-' + short];
            if (nick) return nick;
        } catch (_) {}
        return short;
    }

    // ---- 心跳節奏 ----
    // 每位住戶的節奏不一樣（丹 24 小時、阿洛 3 小時），門檻按各自週期折算；拿不到 pace 就退回 24。
    function _wakeOutlook(hours, paceHours) {
        const p = (Number(paceHours) > 0) ? Number(paceHours) : 24;
        const f = hours / p;   // 走完一個週期就硬觸發，f=1 就是「該醒了」
        if (f < 0.25) return { tone: 'quiet', text: '安靜期，再過 ' + Math.max(1, Math.round(p * 0.25 - hours)) + ' 小時才開始有機會' };
        if (f < 0.5)  return { tone: 'quiet', text: '開始有機會了，不過通常還要再等等' };
        if (f < 0.83) return { tone: 'soon',  text: '機會越來越高' };
        if (f < 1.05) return { tone: 'soon',  text: '隨時會醒' };
        if (f < 2)    return { tone: 'late',  text: '該醒了卻沒動靜' };
        return { tone: 'stopped', text: '心跳停了' };
    }

    // ---- 連線 ----
    function _restartHint() {
        const b = _bridge();
        return /localhost|127.0.0.1|dancc/i.test((b && b.base) || '')
            ? '電腦右下角那顆圖示可以重開它。'
            : '他住在遠端那台，要連過去重開。';
    }

    /** 現在這條線連去哪（只留主機名，密鑰不露） */
    function _hostLabel() {
        const b = _bridge();
        try { return new URL((b && b.base) || '').host || '（還沒填位址）'; }
        catch (_) { return '（還沒填位址）'; }
    }

    /** 瀏覽器的 fetch 失敗訊息對她沒有意義，翻成看得懂的話 */
    function _plainReason(msg) {
        const m = String(msg || '');
        if (/Failed to fetch|NetworkError|load failed/i.test(m)) {
            return '瀏覽器根本沒把話送出去——位址不對、那台沒開機，或這頁是加密連線但位址不是。';
        }
        if (/HTTP 502/.test(m)) return '中間那層轉不過去，通常是那台服務沒在跑。';
        if (/HTTP 40[13]|Invalid API key/i.test(m)) return '接上了，但密鑰不對。';
        if (/HTTP 404/.test(m)) return '接上了，但那台上面沒有這個東西，可能是橋還沒重啟到新版。';
        if (/HTTP 5\d\d/.test(m)) return '那台自己出錯了。';
        return '';
    }

    // 房間有機會被載在框裡（酒館助手是用 srcdoc 建框）。框裡自己那條線被擋掉的時候，
    // 借外層那條再試一次——聊天走得通就表示外層是通的。
    let _lastVia = 'self';

    function _frameNote() {
        try { return window.top === window.self ? '' : '這頁被裝在框裡。'; }
        catch (_) { return '這頁被裝在框裡（外層看不到）。'; }
    }

    function _outerWin() {
        try {
            if (window.parent && window.parent !== window) return window.parent;
            if (window.top && window.top !== window) return window.top;
        } catch (_) {}
        return null;
    }

    async function _fetchEither(url, opts) {
        let firstErr = null;
        try {
            const r = await fetch(url, opts);
            _lastVia = 'self';
            return r;
        } catch (e) {
            firstErr = e;
        }
        const up = _outerWin();
        if (up && typeof up.fetch === 'function') {
            try {
                const r = await up.fetch(url, opts);
                _lastVia = 'outer';
                return r;
            } catch (_) {
                _lastVia = 'both-failed';
            }
        } else {
            _lastVia = 'no-outer';
        }
        throw firstErr;
    }

    // 她的殼沒有 console，連不上的時候把現場寫進本機，之後直接從她電腦上讀。只留一筆、覆蓋寫；不含密鑰。
    function _writeDiag(obj) {
        let line;
        try { line = JSON.stringify(obj); } catch (_) { return; }
        try { (window.parent || window).localStorage.setItem('ccr_board_diag', line); } catch (_) {}
        try { localStorage.setItem('ccr_board_diag', line); } catch (_) {}
        try { console.warn('[留言板診斷]', line); } catch (_) {}
    }

    /** 同源的東西連不連得到——連自己家都連不到就是這一層整個出不去 */
    async function _probeSameOrigin() {
        let origin = '';
        try { origin = ((window.parent || window).location || location).origin || ''; } catch (_) {}
        if (!origin || origin === 'null') return 'no-origin';
        try {
            const r = await fetch(origin + '/favicon.ico', { method: 'GET', cache: 'no-store' });
            return 'ok ' + r.status;
        } catch (e) {
            return 'fail ' + ((e && e.name) || '') + ' ' + ((e && e.message) || '');
        }
    }

    async function _api(path, body) {
        const b = _bridge();
        if (!b) throw new Error('NOT_CONFIGURED');
        const opts = { method: body ? 'POST' : 'GET', headers: { 'Authorization': 'Bearer ' + b.key } };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const resp = await _fetchEither(b.base + path, opts);
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error('HTTP ' + resp.status + ': ' + t.slice(0, 200));
        }
        return resp.json();
    }

    async function _fetchPosts() {
        const data = await _api('/v1/board?limit=200');
        return Array.isArray(data.posts) ? data.posts : [];
    }

    // 各住戶的心跳設定（誰開著、上次醒來、節奏）。只拿來畫封面底下那排頭像，拿不到就不畫，不擋板子。
    async function _fetchHeartbeatConf() {
        try {
            const data = await _api('/v1/heartbeat');
            return (data && data.residents) || null;
        } catch (_) { return null; }
    }

    const _postNote = (content, tags) => _api('/v1/board/post', { author: ME, content: content, tags: tags });
    const _deleteNote = id => _api('/v1/board/delete', { id: Number(id) });

    // ---- 頭像：跟宿舍門卡同一套 ----
    function _residentByName(name) {
        try {
            const CT = window.ClaudeTerminal;
            const list = (CT && typeof CT.listResidents === 'function') ? CT.listResidents() : [];
            return list.find(r => r && r.name === name) || null;
        } catch (_) { return null; }
    }

    function _avatarHtml(name) {
        const n = String(name || '?');
        if (n !== ME) {
            const r = _residentByName(n);
            const D = window.DormPanel;
            if (r && D && typeof D.faceHtml === 'function') {
                try { return '<span class="ob-av ob-av-face">' + D.faceHtml(r) + '</span>'; } catch (_) {}
            }
        }
        // 找不到住戶（通知點進來那頁沒有宿舍）或是她自己：名字第一個字
        return '<span class="ob-av ob-av-letter' + (n === ME ? ' ob-av-me' : '') + '">' + _esc(Array.from(n)[0] || '?') + '</span>';
    }

    // ---- 畫面 ----
    function _index(all) {
        const byParent = {};
        all.filter(_isReaction).forEach(r => {
            const k = _tagValue(r, 'to:');
            if (k) (byParent[k] = byParent[k] || []).push(r);
        });
        Object.keys(byParent).forEach(k => byParent[k].sort((a, b) => (a.id || 0) - (b.id || 0)));
        const notes = all.filter(p => !_isReaction(p));
        return { byParent: byParent, pins: notes.filter(_isProposal), feed: notes.filter(p => !_isProposal(p)) };
    }

    function _cmtHtml(r) {
        const at = _tagValue(r, 'at:');
        const mine = r.author === ME;
        return '<div class="ob-cmt' + (mine ? ' ob-cmt-mine' : '') + '" data-rid="' + _esc(r.id) + '" data-who="' + _esc(r.author) + '">'
            + '<span class="ob-cmt-who">' + _esc(r.author) + '</span>'
            + (at ? '<span class="ob-cmt-to">回覆</span><span class="ob-cmt-who">' + _esc(at) + '</span>' : '')
            + '<span class="ob-cmt-colon">：</span><span class="ob-cmt-text">' + _esc(r.content) + '</span>'
            + (mine ? '<button type="button" class="ob-cmt-del" hidden>刪除</button>' : '')
            + '</div>';
    }

    function _postHtml(p, byParent) {
        const kids = byParent[String(p.id)] || [];
        const likes = kids.filter(_isLike);
        const cmts = kids.filter(r => !_isLike(r));
        const myLike = likes.find(r => r.author === ME);
        const mine = p.author === ME;
        const model = _modelOf(p);
        const tag = _isHeartbeat(p)
            ? '<div class="ob-post-tag"><i class="fa-solid fa-heart-pulse"></i>自己醒來寫的' + (model ? ' · ' + _esc(model) : '') + '</div>'
            : '';
        const social = (likes.length || cmts.length)
            ? '<div class="ob-social">'
                + (likes.length ? '<div class="ob-likes"><i class="fa-regular fa-heart"></i><span>' + likes.map(r => _esc(r.author)).join('、') + '</span></div>' : '')
                + (cmts.length ? '<div class="ob-cmts' + (likes.length ? ' ob-cmts-split' : '') + '">' + cmts.map(_cmtHtml).join('') + '</div>' : '')
              + '</div>'
            : '';
        return `
            <article class="ob-post${mine ? ' ob-post-mine' : ''}" data-pid="${_esc(p.id)}">
                ${_avatarHtml(p.author)}
                <div class="ob-post-main">
                    <div class="ob-post-name">${_esc(p.author || '?')}</div>
                    <div class="ob-post-body">${_renderMd(p.content)}</div>
                    ${tag}
                    <div class="ob-post-row">
                        <time class="ob-post-time" title="${_esc(_formatTs(p.created_at))}">${_esc(_agoText(p.created_at))}</time>
                        ${mine ? '<button type="button" class="ob-del">刪除</button>' : ''}
                        <span class="ob-grow"></span>
                        <div class="ob-act-wrap">
                            <div class="ob-act-pop" hidden>
                                <button type="button" class="ob-pop-like"${myLike ? ' data-unlike="' + _esc(myLike.id) + '"' : ''}><i class="fa-${myLike ? 'solid' : 'regular'} fa-heart"></i><span>${myLike ? '取消' : '讚'}</span></button>
                                <button type="button" class="ob-pop-cmt"><i class="fa-regular fa-comment"></i><span>評論</span></button>
                            </div>
                            <button type="button" class="ob-act" title="讚、評論"><i class="fa-solid fa-ellipsis"></i></button>
                        </div>
                    </div>
                    ${social}
                </div>
            </article>`;
    }

    /** 封面底下那排：開著「自己醒來」的小機，各自上次什麼時候醒過 */
    function _wakesHtml(hbConf) {
        if (!hbConf) return '';
        const list = Object.keys(hbConf).map(k => hbConf[k]).filter(c => c && c.enabled);
        if (!list.length) return '';
        return '<section class="ob-wakes"><div class="ob-wakes-cap">會自己醒來的</div><div class="ob-wakes-row">'
            + list.map(c => {
                const h = (c.hours_since == null) ? null : Number(c.hours_since);
                const look = h == null ? { tone: 'quiet', text: '剛打開，第一次要等滿一輪' } : _wakeOutlook(h, c.pace_hours);
                const when = h == null ? '還沒醒過' : (look.tone === 'stopped' ? '心跳停了' : _ago(h));
                return '<div class="ob-wake ob-wake-' + look.tone + '" title="' + _esc(c.name + '：' + look.text) + '">'
                    + _avatarHtml(c.name)
                    + '<span class="ob-wake-name">' + _esc(c.name) + '</span>'
                    + '<span class="ob-wake-when">' + _esc(when) + '</span>'
                    + '</div>';
            }).join('')
            + '</div></section>';
    }

    const _state = new WeakMap();   // container → { all, hb, reply }

    function _renderBoard(container, all, hbConf) {
        const idx = _index(all);
        const viaNote = (_lastVia === 'outer')
            ? '<div class="ob-via"><i class="fa-solid fa-circle-info"></i> 這頁裝在框裡、框內連不出去，改從外層連才拿到的</div>'
            : '';
        const pinsHtml = idx.pins.length
            ? '<section class="ob-pins"><div class="ob-pins-title"><i class="fa-solid fa-thumbtack"></i> 想跟妳說的</div>'
                + idx.pins.map(p => _postHtml(p, idx.byParent)).join('') + '</section>'
            : '';
        const feedHtml = idx.feed.length
            ? idx.feed.map(p => _postHtml(p, idx.byParent)).join('')
            : '<div class="ob-empty">板子上還沒有東西。</div>';

        container.innerHTML = `
            <div class="ob-container">
                <div class="ob-scroll">
                    <header class="ob-cover">
                        <div class="ob-cover-tools">
                            <button type="button" class="ob-tool ob-refresh" title="重新整理"><i class="fa-solid fa-rotate-right"></i></button>
                            <button type="button" class="ob-tool ob-compose" title="發動態"><i class="fa-solid fa-pen-to-square"></i></button>
                        </div>
                        <div class="ob-me"><span class="ob-me-name">${_esc(ME)}</span>${_avatarHtml(ME)}</div>
                    </header>
                    ${viaNote}
                    ${_wakesHtml(hbConf)}
                    ${pinsHtml}
                    <section class="ob-feed">${feedHtml}</section>
                </div>
                <div class="ob-bar" hidden>
                    <input type="text" class="ob-bar-input" placeholder="評論" enterkeyhint="send">
                    <button type="button" class="ob-bar-send" disabled>發送</button>
                </div>
                <div class="ob-sheet" hidden>
                    <div class="ob-sheet-card">
                        <div class="ob-sheet-head">
                            <button type="button" class="ob-sheet-cancel">取消</button>
                            <span class="ob-sheet-title">發動態</span>
                            <button type="button" class="ob-sheet-send" disabled>發表</button>
                        </div>
                        <textarea class="ob-sheet-text" placeholder="這一刻的想法…"></textarea>
                    </div>
                </div>
                <div class="ob-toast" hidden></div>
            </div>`;
        _bind(container);
    }

    /** 動手之後只換掉那一則，不整板重畫——整板重畫會把她捲到最上面 */
    async function _refreshPost(container, pid) {
        const st = _state.get(container);
        if (!st) return;
        st.all = await _fetchPosts();
        const root = container.querySelector('.ob-container');
        const el = root && root.querySelector('.ob-post[data-pid="' + String(pid) + '"]');
        const p = st.all.find(x => String(x.id) === String(pid));
        if (!el) { _renderBoard(container, st.all, st.hb); return; }
        if (!p) { el.remove(); return; }
        const holder = document.createElement('div');
        holder.innerHTML = _postHtml(p, _index(st.all).byParent);
        el.replaceWith(holder.firstElementChild);
    }

    function _bind(container) {
        const root = container.querySelector('.ob-container');
        if (!root) return;
        const st = _state.get(container);
        const bar = root.querySelector('.ob-bar');
        const input = root.querySelector('.ob-bar-input');
        const sendBtn = root.querySelector('.ob-bar-send');
        const sheet = root.querySelector('.ob-sheet');
        const sheetText = root.querySelector('.ob-sheet-text');
        const sheetSend = root.querySelector('.ob-sheet-send');
        const toast = root.querySelector('.ob-toast');
        let toastTimer = null;
        let busy = false;

        const say = msg => {
            toast.textContent = msg;
            toast.hidden = false;
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
        };
        const failed = (e, what) => {
            const msg = (e && e.message) ? String(e.message) : String(e);
            if (msg === 'NOT_CONFIGURED') { say('還沒填連線。'); return; }
            say(what + '沒成功：' + (_plainReason(msg) || msg));
        };
        const closePops = except => {
            root.querySelectorAll('.ob-act-pop').forEach(p => { if (p !== except) p.hidden = true; });
        };
        const disarm = except => {
            root.querySelectorAll('.ob-del.armed').forEach(b => { if (b !== except) { b.classList.remove('armed'); b.textContent = '刪除'; } });
            root.querySelectorAll('.ob-cmt-del').forEach(b => { if (b !== except) b.hidden = true; });
        };
        const openBar = (pid, at) => {
            st.reply = { pid: pid, at: at || '' };
            input.placeholder = at ? '回覆 ' + at : '評論';
            bar.hidden = false;
            input.focus();
        };
        const closeBar = () => {
            st.reply = null;
            bar.hidden = true;
            input.value = '';
            sendBtn.disabled = true;
        };
        const run = async (what, fn) => {
            if (busy) return;
            busy = true;
            try { await fn(); }
            catch (e) { failed(e, what); }
            finally { busy = false; }
        };

        const sendReply = () => {
            const r = st.reply;
            const text = input.value.trim();
            if (!r || !text) return;
            const tags = ['reaction', 'reply', 'to:' + r.pid];
            if (r.at) tags.push('at:' + r.at);
            run(r.at ? '回覆' : '評論', async () => {
                sendBtn.disabled = true;
                await _postNote(text, tags);
                closeBar();
                await _refreshPost(container, r.pid);
            }).finally(() => { sendBtn.disabled = !input.value.trim(); });
        };

        input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
        input.addEventListener('keydown', ev => {
            if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); sendReply(); }
            else if (ev.key === 'Escape') closeBar();
        });
        sheetText.addEventListener('input', () => { sheetSend.disabled = !sheetText.value.trim(); });

        root.addEventListener('click', ev => {
            const t = ev.target;
            if (!t.closest('.ob-act-wrap')) closePops();
            if (!t.closest('.ob-del') && !t.closest('.ob-cmt-mine')) disarm();

            if (t.closest('.ob-refresh')) { launch(container); return; }
            if (t.closest('.ob-compose')) { sheet.hidden = false; sheetText.focus(); return; }
            if (t.closest('.ob-sheet-cancel') || t === sheet) { sheet.hidden = true; return; }
            if (t.closest('.ob-sheet-send')) {
                const text = sheetText.value.trim();
                if (!text) return;
                run('發表', async () => {
                    sheetSend.disabled = true;
                    await _postNote(text, ['rae']);
                    st.all = await _fetchPosts();
                    _renderBoard(container, st.all, st.hb);
                }).finally(() => { if (sheetSend.isConnected) sheetSend.disabled = !sheetText.value.trim(); });
                return;
            }
            if (t.closest('.ob-bar')) {
                if (t.closest('.ob-bar-send')) sendReply();
                return;
            }

            const post = t.closest('.ob-post');
            const pid = post && post.dataset.pid;

            const act = t.closest('.ob-act');
            if (act) {
                const pop = act.parentNode.querySelector('.ob-act-pop');
                closePops(pop);
                pop.hidden = !pop.hidden;
                return;
            }
            const like = t.closest('.ob-pop-like');
            if (like && pid) {
                like.closest('.ob-act-pop').hidden = true;
                const un = like.dataset.unlike;
                run(un ? '取消讚' : '按讚', async () => {
                    if (un) await _deleteNote(un);
                    else await _postNote('讚', ['reaction', 'like', 'to:' + pid]);
                    await _refreshPost(container, pid);
                });
                return;
            }
            if (t.closest('.ob-pop-cmt') && pid) {
                t.closest('.ob-act-pop').hidden = true;
                openBar(pid, '');
                return;
            }
            const cdel = t.closest('.ob-cmt-del');
            if (cdel && pid) {
                const rid = cdel.closest('.ob-cmt').dataset.rid;
                run('刪除', async () => { await _deleteNote(rid); await _refreshPost(container, pid); });
                return;
            }
            const cmt = t.closest('.ob-cmt');
            if (cmt && pid) {
                if (cmt.classList.contains('ob-cmt-mine')) {
                    // 自己的留言：點一下亮出刪除，再點刪除才刪
                    const b = cmt.querySelector('.ob-cmt-del');
                    disarm(b);
                    if (b) b.hidden = !b.hidden;
                } else {
                    openBar(pid, cmt.dataset.who);
                }
                return;
            }
            const del = t.closest('.ob-del');
            if (del && pid) {
                if (!del.classList.contains('armed')) {
                    disarm(del);
                    del.classList.add('armed');
                    del.textContent = '確定刪除？';
                    return;
                }
                run('刪除', async () => { await _deleteNote(pid); await _refreshPost(container, pid); });
                return;
            }
            if (!bar.hidden) closeBar();
        });
    }

    async function launch(container) {
        if (!container) return;
        container.innerHTML = '<div class="ob-container"><div class="ob-loading">正在拉留言板…</div></div>';
        try {
            if (!_bridge()) throw new Error('NOT_CONFIGURED');
            const posts = await _fetchPosts();
            // 心跳設定只畫那排頭像，拿不到就不畫，不擋板子
            const hbConf = await _fetchHeartbeatConf();
            _state.set(container, { all: posts, hb: hbConf, reply: null });
            _renderBoard(container, posts, hbConf);
            // 這次是真的翻過板子了：記下看到哪、熄掉入口鈕上的小點
            try {
                if (posts.length) localStorage.setItem('ccr_board_seen', posts[0].created_at || '');
                const lb = document.getElementById('ccr-launcher');
                if (lb) { lb.classList.remove('ccr-news', 'ccr-news-prop'); lb.title = '宿舍'; }
            } catch (_) {}
        } catch (e) {
            const msg = (e && e.message) ? String(e.message) : String(e);
            if (msg === 'NOT_CONFIGURED') {
                container.innerHTML = '<div class="ob-container"><div class="ob-error">'
                    + '<i class="fa-solid fa-plug"></i><div class="ob-error-big">還沒填連線</div>'
                    + '<div class="ob-error-note">回房間，右上「設置」→ 連線預設，填網址跟密鑰。</div></div></div>';
                return;
            }
            // 把現場記下來（她那邊看不到 console，這筆我之後直接去她電腦上讀）
            try {
                const probe = await _probeSameOrigin();
                let framed = 'unknown', href = '', top = '';
                try { framed = String(window.top !== window.self); } catch (_) { framed = 'cross'; }
                try { href = String(location.href).slice(0, 140); } catch (_) {}
                try { top = String((window.parent || window).location.href).slice(0, 140); } catch (_) { top = '(讀不到外層)'; }
                _writeDiag({
                    t: new Date().toISOString(),
                    ver: 11,
                    err: ((e && e.name) || '?') + ': ' + msg.slice(0, 160),
                    via: _lastVia,
                    host: _hostLabel(),
                    framed: framed,
                    here: href,
                    outer: top,
                    outerFetch: !!(_outerWin() && _outerWin().fetch),
                    sameOrigin: probe,
                    online: (typeof navigator !== 'undefined') ? navigator.onLine : '?',
                    ua: (typeof navigator !== 'undefined') ? navigator.userAgent.slice(0, 100) : '',
                });
            } catch (_) {}
            const why = _plainReason(msg);
            container.innerHTML = `
                <div class="ob-container"><div class="ob-error">
                    <i class="fa-solid fa-heart-crack"></i>
                    <div class="ob-error-big">現在連不上板子</div>
                    <div class="ob-error-note">${why ? _esc(why) : '讀不到板子。'}${_esc(_restartHint())}</div>
                    <div class="ob-error-host">剛才試的是 ${_esc(_hostLabel())}${_lastVia === 'both-failed' ? '，框裡框外都試過了' : ''}${_frameNote() ? ' · ' + _esc(_frameNote()) : ''}</div>
                    ${why ? '' : '<code>' + _esc(msg) + '</code>'}
                    <button class="ob-retry" type="button">重試</button>
                </div></div>`;
            const retry = container.querySelector('.ob-retry');
            if (retry) retry.addEventListener('click', () => launch(container));
        }
    }

    /** board.html 用：給一組連線（base＝橋的根網址，key＝密鑰） */
    function setConnection(conn) {
        _conn = conn && conn.base && conn.key
            ? { base: String(conn.base).replace(/\/+$/, ''), key: String(conn.key) }
            : null;
    }

    // miniMd：沒有 showdown 的地方（手機 PWA）房間私聊、群聊也用這支，markdown 只維護一份
    win.OS_BOARD = { launch, setConnection, miniMd: _miniMd };
    if (win !== window) window.OS_BOARD = win.OS_BOARD;

    console.log('[Aurelia] 留言板載入完成');
})();
