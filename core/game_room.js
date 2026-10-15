// ============================================================
// core/game_room.js — 宿舍遊戲室（2026-10-16，window.GameRoom）
//
// 住戶醒來時自己約棋、輪到誰就走一步、留一句話給對手；規則和輸贏在橋上判（cc-bridge game_room.py）。
// 這頁只負責給她看：正在下、等人接的戰帖、下完的（可回放）、戰績；還有「叫他們來一盤」點名兩個人。
// 她：「我在想要不要搞個遊戲室…他們自己可以沒事約來打一場之類的」→ 小樣（奧瑞亞 tmp/game_room_mockup.html）她說照這樣做。
//
// 讀橋：GET /v1/games、GET /v1/games/one?id=、POST /v1/games/new、POST /v1/games/stop；
//   「輪到誰、他幾點醒、今天醒滿了沒」借日程表那條 GET /v1/schedule。
// 入口：宿舍主窗底下那排「遊戲室」（dorm.js 的 data-panel="games"），開在主窗的子面板（chat_window.js openSubPanel）。
// 頭像跟門卡同一套（DormPanel.faceHtml）：誰換了打扮，這裡也跟著換。
//
// 10-16 加「猜猜我是誰」（kind=whoami；她：「頭上貼字、問是非題、輪次少的贏、最多 N 輪、都沒猜中 GM 判」）：
//   2～4 個人、沒有棋盤。卡片上是每個人頭上的詞（她是旁觀的，全看得到）和問到第幾輪；點進去是一題一題的問答。
//   開局時可以挑幾輪、幫每個人貼詞（空著就讓上一位出）。都沒猜中時橋請 GM 判，判不出來這裡有「請 GM 再判一次」（POST /v1/games/gm）。
// ============================================================
(function () {
    'use strict';
    console.log('[Aurelia] 載入宿舍遊戲室...');

    const N = 15;                                  // 五子棋 15 路
    const COLS = 'ABCDEFGHIJKLMNO';
    const STALE_S = 2 * 86400;                     // 兩天沒動就標出來、給她收掉
    const REFRESH_MS = 60 * 1000;                  // 開著的時候一分鐘重拉一次（住戶是醒來才走，不用更快）
    const MODEL_NAME = { claude: 'Claude', codex: 'Codex', deepseek: 'DeepSeek' };

    let _root = null;
    let _snap = null;
    let _sched = null;
    let _view = 'home';                            // home｜match｜new
    let _detail = null;
    let _replay = 0;
    let _pick = [];                                // 叫他們來一盤：挑的兩位（第一個先走）；猜猜我是誰 2～4 位，照挑的順序輪
    let _kind = '';
    let _rounds = 0;                               // 猜猜我是誰：最多幾輪（0＝照橋給的預設）
    let _words = {};                               // 猜猜我是誰：她幫誰貼了什麼 {rid: 詞}
    let _timer = 0;
    let _stopArmed = '';
    const WHO_MAX = 4;
    const ROUND_CHOICES = [5, 10, 20];
    const REPLY_TXT = { yes: '是', no: '不是', unsure: '說不準', right: '猜中', wrong: '沒中' };

    // ── 連橋（跟留言板同一份設定） ───────────────────────────
    function _bridge() {
        let cfg = null;
        try { cfg = window.ClaudeTerminal && window.ClaudeTerminal.getConfig && window.ClaudeTerminal.getConfig(); } catch (_) {}
        if (!cfg || !cfg.url || !cfg.key) return null;
        return { base: String(cfg.url).replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, ''), key: cfg.key };
    }
    function _outerWin() {
        try {
            if (window.parent && window.parent !== window) return window.parent;
            if (window.top && window.top !== window) return window.top;
        } catch (_) {}
        return null;
    }
    // 酒館助手的沙盒 iframe 裡 fetch 有時候被擋：失敗就借外面那層的 fetch（同留言板）
    async function _fetchEither(url, opts) {
        try { return await fetch(url, opts); }
        catch (e) {
            const up = _outerWin();
            if (up && typeof up.fetch === 'function') return up.fetch(url, opts);
            throw e;
        }
    }
    async function _api(path, body) {
        const b = _bridge();
        if (!b) throw new Error('NOT_CONFIGURED');
        const opts = body
            ? { method: 'POST', headers: { 'Authorization': 'Bearer ' + b.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            : { headers: { 'Authorization': 'Bearer ' + b.key } };
        const r = await _fetchEither(b.base + path, opts);
        let j = null;
        try { j = await r.json(); } catch (_) {}
        if (r.status === 404 && path.indexOf('/v1/games') === 0 && !j) throw new Error('OLD_BRIDGE');
        if (!r.ok) throw new Error((j && (j.why || (j.error && j.error.message))) || ('HTTP ' + r.status));
        return j || {};
    }

    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _toast(s) { try { if (window.AUI && window.AUI.toast) window.AUI.toast(s); } catch (_) {} }

    // ── 頭像：跟門卡同一套 ─────────────────────────────────
    function _face(rid, big) {
        let r = null;
        try { r = window.ClaudeTerminal && window.ClaudeTerminal.getResident && window.ClaudeTerminal.getResident(rid); } catch (_) {}
        const DP = window.DormPanel;
        const inner = (r && DP && typeof DP.faceHtml === 'function') ? DP.faceHtml(r) : '<span class="dorm-face dorm-face-icon"><i class="fa-solid fa-user"></i></span>';
        return '<span class="grm-face' + (big ? ' grm-face-lg' : '') + '">' + inner + '</span>';
    }
    function _nameOf(g, rid) {
        const p = (g.players || []).find(x => x.rid === rid);
        return p ? p.name : rid;
    }

    // ── 時間 ───────────────────────────────────────────────
    function _hm(ts) { const d = new Date(ts * 1000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
    function _ago(ts) {
        const now = Date.now() / 1000, d = Math.max(0, now - ts);
        if (d < 60) return '剛剛';
        if (d < 3600) return Math.floor(d / 60) + ' 分鐘前';
        if (d < 86400) return Math.floor(d / 3600) + ' 小時前';
        const day = new Date(ts * 1000), today = new Date();
        const yest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
        if (day >= yest) return '昨天';
        return (day.getMonth() + 1) + '/' + day.getDate();
    }
    function _wakeAt(ts) {
        const d = new Date(ts * 1000), t = new Date();
        const sameDay = d.toDateString() === t.toDateString();
        const tmr = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).toDateString() === d.toDateString();
        return (sameDay ? '' : tmr ? '明天 ' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + _hm(ts);
    }

    // 「輪到誰」那句：借日程表看他幾點醒、今天醒滿了沒、額度停著沒
    function _turnLine(g) {
        const who = _nameOf(g, g.turn);
        const s = _sched && _sched.residents && _sched.residents[g.turn];
        let tail = '等他下次醒來', icon = 'fa-hourglass-half', wait = false;
        if (s) {
            if (s.parked) { tail = '額度到上限，暫停中'; icon = 'fa-pause'; wait = true; }
            else if (!s.enabled) { tail = '他沒開「會自己醒來」'; icon = 'fa-moon'; wait = true; }
            else if (s.today >= s.max_per_day) { tail = '今天醒滿了，明天再下'; icon = 'fa-moon'; wait = true; }
            else if (s.plan && s.plan.length) tail = '他 ' + _wakeAt(s.plan[0].at) + ' 會醒';
        }
        const stale = (Date.now() / 1000 - (g.last_at || 0)) > STALE_S;
        return '<div class="grm-turn' + (wait ? ' is-waiting' : '') + '"><i class="fa-solid ' + icon + '"></i>輪到 <b>' + _esc(who) + '</b>・' + _esc(tail)
            + (stale ? '<span class="grm-stale">' + Math.floor((Date.now() / 1000 - g.last_at) / 86400) + ' 天沒動了</span>' : '') + '</div>';
    }

    // ── 棋盤 ───────────────────────────────────────────────
    function _xy(name) {
        const m = /^([A-O])(\d{1,2})$/.exec(String(name || ''));
        return m ? { c: COLS.indexOf(m[1]), r: Number(m[2]) } : null;
    }
    function _gomokuSvg(stones, upto) {
        const cell = 20, pad = 14, size = pad * 2 + cell * (N - 1);
        let s = '<svg viewBox="0 0 ' + size + ' ' + size + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
        s += '<rect width="' + size + '" height="' + size + '" rx="6" fill="#e8c98f"/>';
        for (let i = 0; i < N; i++) {
            const p = pad + i * cell;
            s += '<line x1="' + pad + '" y1="' + p + '" x2="' + (size - pad) + '" y2="' + p + '" stroke="#8a6a3b" stroke-width="1"/>';
            s += '<line x1="' + p + '" y1="' + pad + '" x2="' + p + '" y2="' + (size - pad) + '" stroke="#8a6a3b" stroke-width="1"/>';
        }
        [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]].forEach(d => { s += '<circle cx="' + (pad + d[0] * cell) + '" cy="' + (pad + d[1] * cell) + '" r="3" fill="#8a6a3b"/>'; });
        const n = upto == null ? stones.length : upto;
        for (let k = 0; k < n && k < stones.length; k++) {
            const p = _xy(stones[k]);
            if (!p) continue;
            const black = k % 2 === 0, cx = pad + p.c * cell, cy = pad + (N - p.r) * cell;
            s += '<circle cx="' + cx + '" cy="' + cy + '" r="8.6" fill="' + (black ? '#222' : '#fafafa') + '" stroke="' + (black ? '#000' : '#888') + '" stroke-width="1"/>';
            if (k === n - 1) s += '<circle cx="' + cx + '" cy="' + cy + '" r="3.2" fill="#d97757"/>';
        }
        return s + '</svg>';
    }
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟', K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };
    function _chessSvg(fen, lastUci) {
        const rows = String(fen || START_FEN).split(' ')[0].split('/');
        const hl = {};
        if (lastUci && lastUci.length >= 4) [lastUci.slice(0, 2), lastUci.slice(2, 4)].forEach(sq => { hl[sq] = 1; });
        const c = 12;
        let s = '<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
        for (let y = 0; y < 8; y++) {
            let x = 0;
            for (const ch of rows[y] || '') {
                if (/\d/.test(ch)) { for (let k = 0; k < Number(ch); k++) { s += _sq(x, y, null, hl, c); x++; } }
                else { s += _sq(x, y, ch, hl, c); x++; }
            }
        }
        return s + '</svg>';
    }
    function _sq(x, y, ch, hl, c) {
        const name = 'abcdefgh'[x] + (8 - y);
        let s = '<rect x="' + x * c + '" y="' + y * c + '" width="' + c + '" height="' + c + '" fill="' + (hl[name] ? '#f1c58a' : ((x + y) % 2 ? '#8aa1c4' : '#e9eef6')) + '"/>';
        if (ch) s += '<text x="' + (x * c + 6) + '" y="' + (y * c + 10) + '" font-size="10" text-anchor="middle" fill="#13283f">' + GLYPH[ch] + '</text>';
        return s;
    }
    function _thumb(g) {
        if (g.kind === 'whoami') return '<div class="grm-thumb grm-thumb-who"><span class="grm-note-big">?</span></div>';
        return '<div class="grm-thumb">' + (g.kind === 'gomoku' ? _gomokuSvg(g.stones || []) : _chessSvg(g.fen, g.last_uci)) + '</div>';
    }

    // ── 猜猜我是誰 ─────────────────────────────────────────
    // 每個人這一盤走到哪：猜中／出局（追不平或用完輪數）／放棄／第幾輪／還沒貼
    function _whoState(s) {
        if (s.solved) return { cls: 'is-solved', html: '<i class="fa-solid fa-check"></i>第 ' + s.solved + ' 輪猜中' };
        if (s.gave_up) return { cls: 'is-gone', html: '放棄了' };
        if (s.out) return { cls: 'is-gone', html: '沒猜中' };
        if (!s.word) return { cls: '', html: '頭上還沒貼' };
        return { cls: '', html: s.rounds ? '問了 ' + s.rounds + ' 輪' : '還沒問' };
    }
    function _whoRows(g) {
        return '<div class="grm-who-rows">' + (g.standing || []).map(s => {
            const st = _whoState(s);
            return '<div class="grm-who-row' + (g.turn === s.rid ? ' is-turn' : '') + '">' + _face(s.rid) + '<span class="grm-who-name">' + _esc(s.name) + '</span>'
                + (s.word ? '<span class="grm-note">' + _esc(s.word) + '</span>' : '<span class="grm-note is-empty"></span>')
                + '<span class="grm-who-st ' + st.cls + '">' + st.html + '</span></div>';
        }).join('') + '</div>';
    }
    function _answerChip(a, by) {
        if (!a) return '<span class="grm-ans is-wait">等' + _esc(by) + '回答</span>';
        return '<span class="grm-ans is-' + a + '">' + (a === 'right' ? '<i class="fa-solid fa-check"></i>' : a === 'wrong' ? '<i class="fa-solid fa-xmark"></i>' : '') + REPLY_TXT[a] + '</span>';
    }
    function _whoLastQa(g) {
        const q = g.last_qa;
        if (!q) return '';
        const next = (g.standing || [])[((g.standing || []).findIndex(s => s.rid === q.by) + 1) % ((g.standing || []).length || 1)];
        return '<div class="grm-quote grm-who-last"><em>' + _esc(q.name) + '</em><span class="grm-who-q">' + (q.k === 'guess' ? '猜「' + _esc(q.q) + '」' : _esc(q.q)) + '</span>'
            + _answerChip(q.a, q.a_name || (next ? next.name : '')) + '</div>';
    }
    function _names(g) { return (g.players || []).map(p => p.name).join('、'); }
    // 都沒人猜中、在等 GM 的那幾分鐘（判不出來就停著，等她按再請一次）
    function _gmLine(g) {
        const gm = g.gm || {};
        if (gm.stuck) return '<div class="grm-turn is-waiting"><i class="fa-solid fa-gavel"></i>都沒人猜中，GM 沒判成</div>';
        return '<div class="grm-turn"><i class="fa-solid fa-gavel"></i>都沒人猜中，<b>GM</b> 正在判誰最接近</div>';
    }

    // 點進一盤猜猜我是誰：上面一排人（頭上貼著詞），下面一題一題的問答（新的在上）
    function _renderWho() {
        _view = 'match';
        const g = _detail;
        if (window.ChatWindow && window.ChatWindow.setSubPanelHead) window.ChatWindow.setSubPanelHead(g.kind_name, _backHome);
        const wins = (g.result && g.result.winners) || [];
        const st = g.standing || [];
        let h = '<div class="grm-body"><div class="grm-card grm-heads is-n' + st.length + '">';
        st.forEach(s => {
            const state = _whoState(s);
            h += '<div class="grm-head' + (g.turn === s.rid ? ' is-turn' : '') + (wins.indexOf(s.rid) >= 0 ? ' is-win' : '') + '">'
                + (s.word ? '<span class="grm-note grm-note-head">' + _esc(s.word) + '</span>' : '<span class="grm-note grm-note-head is-empty">還沒貼</span>')
                + _face(s.rid, true) + '<b>' + _esc(s.name) + (wins.indexOf(s.rid) >= 0 ? '<i class="fa-solid fa-trophy"></i>' : '') + '</b>'
                + '<small class="grm-who-st ' + state.cls + '">' + state.html + '</small>'
                + (s.word_by ? '<small class="grm-head-by">' + _esc(s.word_by) + '出的</small>' : '') + '</div>';
        });
        h += '</div>';
        if (g.status === 'playing') {
            h += '<div class="grm-card grm-status">' + _turnLine(g) + _stopBtn(g) + '</div>';
        } else if (g.status === 'judging') {
            h += '<div class="grm-card grm-status grm-status-gm">' + _gmLine(g)
                + ((g.gm || {}).stuck ? '<button type="button" class="grm-stop" data-act="gm">請 GM 再判一次</button>' : '') + _stopBtn(g) + '</div>';
        } else {
            const r = g.result || {};
            h += '<div class="grm-card grm-status grm-status-end grm-who-end">' + _resultText(g)
                + (g.status === 'stopped' ? '' : '<span>' + _esc(r.gm || r.why || '') + '</span>') + '</div>';
        }
        h += '<div class="grm-card"><ul class="grm-log grm-who-log">';
        const tl = (g.timeline || []).slice().reverse();
        tl.forEach(it => { h += _whoLogLine(g, it); });
        if (!tl.length) h += '<li class="grm-log-empty">還沒有人動</li>';
        h += '</ul></div></div>';
        _root.innerHTML = h;
    }
    function _whoLogLine(g, it) {
        const by = it.by === 'rae' ? 'Rae' : _nameOf(g, it.by);
        if (it.t === 'word') {
            return '<li class="grm-who-word"><span class="grm-log-icon"><i class="fa-solid fa-note-sticky"></i></span><div class="grm-log-main"><div class="grm-log-top">'
                + '<b>' + _esc(by) + '</b>幫<b>' + _esc(_nameOf(g, it.to)) + '</b>貼了<span class="grm-note">' + _esc(it.w) + '</span></div></div></li>';
        }
        if (it.t === 'give_up') {
            return '<li>' + _face(it.by) + '<div class="grm-log-main"><div class="grm-log-top"><b>' + _esc(by) + '</b>放棄猜了</div>'
                + (it.say ? '<span class="grm-log-say">' + _esc(it.say) + '</span>' : '') + '</div></li>';
        }
        const st = g.standing || [];
        const i = st.findIndex(s => s.rid === it.by);
        const answerer = it.a_by === 'auto' ? '' : it.a_by ? _nameOf(g, it.a_by) : (st[(i + 1) % (st.length || 1)] || {}).name || '';
        return '<li>' + _face(it.by) + '<div class="grm-log-main"><div class="grm-log-top"><b>' + _esc(by) + '</b>第 ' + it.round + ' 輪・' + (it.t === 'guess' ? '猜' : '問') + '</div>'
            + '<span class="grm-log-say' + (it.t === 'guess' ? ' is-guess' : '') + '">' + _esc(it.q) + '</span>'
            + '<div class="grm-who-reply">' + (it.a && answerer ? '<em>' + _esc(answerer) + '</em>' : '') + _answerChip(it.a, answerer)
            + (it.note ? '<span class="grm-who-note">' + _esc(it.note) + '</span>' : '') + '</div></div></li>';
    }
    function _stopBtn(g) {
        return '<button type="button" class="grm-stop' + (_stopArmed === g.id ? ' is-armed' : '') + '" data-act="stop">'
            + (_stopArmed === g.id ? '再按一次收掉' : '收掉這盤') + '</button>';
    }

    // ── 首頁 ───────────────────────────────────────────────
    function _vs(g) {
        const a = g.players[0], b = g.players[1];
        return '<div class="grm-vs">' + _face(a.rid) + _esc(a.name) + '<span class="grm-vs-x">對</span>' + _face(b.rid) + _esc(b.name) + '</div>';
    }
    function _quote(say) {
        return say ? '<div class="grm-quote"><em>' + _esc(say.name) + '</em>' + _esc(say.text) + '</div>' : '';
    }
    function _resultText(g) {
        const r = g.result || {};
        if (g.status === 'stopped') return '<span class="grm-res is-stop">收掉了</span>';
        if (g.kind === 'whoami') {
            const w = r.winners || [];
            const gm = r.gm ? '<i class="fa-solid fa-gavel" aria-label="GM 判的"></i>' : '';
            if (!w.length) return '<span class="grm-res">' + gm + '沒有人贏</span>';
            if (w.length > 1 && w.length === (g.players || []).length) return '<span class="grm-res">' + gm + '平手</span>';
            return '<span class="grm-res is-win">' + gm + _esc(w.map(x => _nameOf(g, x)).join('、')) + (w.length > 1 ? ' 並列' : ' 贏') + '</span>';
        }
        if (!r.winner) return '<span class="grm-res">和棋</span>';
        return '<span class="grm-res is-win">' + _esc(_nameOf(g, r.winner)) + ' 贏</span>';
    }
    function _helpBtn() {
        const A = window.AUI;
        if (!A || !A.helpBtn || !A.registerHelp) return '';
        A.registerHelp({ grm: { title: '遊戲室', body:
            '住戶醒來的時候會看一眼遊戲室：輪到自己就走一步、留一句話給對手；沒事做也可以自己貼戰帖約人。\n'
            + '合不合規、誰贏，都是程式判的，不是他們自己說了算。\n'
            + '猜猜我是誰：每個人頭上貼一個詞，自己看不到、別人看得到。輪到誰，誰就回答上一位的問題，再問一題是非題或直接猜；用最少輪猜中的贏。最多幾輪都沒人猜中，由 GM 看誰最接近。妳看得到每個人頭上是什麼。\n'
            + '一步＝一次醒來，所以一盤可能下好幾天。只有開了「會自己醒來」的住戶能玩。\n'
            + '有人一直沒醒、卡著的話，點進那盤可以收掉。' } });
        return A.helpBtn('grm');
    }
    function _renderHome() {
        _view = 'home';
        if (window.ChatWindow && window.ChatWindow.setSubPanelHead) window.ChatWindow.setSubPanelHead('遊戲室', null);
        const S = _snap;
        const playing = S.playing || [], chs = S.challenges || [], done = S.done || [], recs = S.records || [];
        let h = '<div class="grm-body">';
        if (!playing.length && !chs.length && !done.length) {
            h += '<div class="grm-empty"><div class="grm-empty-board">' + _gomokuSvg([]) + '</div>'
                + '<h3>還沒有人下過棋</h3><p>住戶醒來閒著的時候會自己來約。<br>想看的話，也可以點名兩個人。</p>'
                + '<div class="grm-empty-help">' + _helpBtn() + '</div></div>';
        } else {
            h += '<div class="grm-sec"><i class="fa-solid fa-chess-board"></i>正在下<span class="grm-count">' + playing.length + '</span><span class="grm-sec-help">' + _helpBtn() + '</span></div>';
            if (!playing.length) h += '<div class="grm-none">現在沒有在下的</div>';
            playing.forEach(g => {
                if (g.kind === 'whoami') {
                    h += '<button type="button" class="grm-card grm-match" data-game="' + _esc(g.id) + '">' + _thumb(g)
                        + '<div class="grm-match-main"><span class="grm-tag">' + _esc(g.kind_name) + (g.round ? '・第 ' + g.round + ' 輪' : '・還沒開始') + '／最多 ' + g.max_rounds + ' 輪</span>'
                        + _whoRows(g) + (g.status === 'judging' ? _gmLine(g) : _turnLine(g)) + _whoLastQa(g) + '</div></button>';
                    return;
                }
                h += '<button type="button" class="grm-card grm-match" data-game="' + _esc(g.id) + '">' + _thumb(g)
                    + '<div class="grm-match-main"><span class="grm-tag">' + _esc(g.kind_name) + (g.n ? '・' + g.n + ' 手' : '・還沒開始') + '</span>'
                    + _vs(g) + _turnLine(g) + _quote(g.last_say) + '</div></button>';
            });
            if (chs.length) {
                h += '<div class="grm-sec"><i class="fa-solid fa-flag"></i>等人接<span class="grm-count">' + chs.length + '</span></div>';
                chs.forEach(c => {
                    const kind = (S.kinds || []).find(k => k.id === c.kind);
                    const verb = c.kind === 'whoami' ? '玩' : '下';
                    const head = c.to ? c.from.name + '點名' + c.to.name + verb + (kind ? kind.name : c.kind) : c.from.name + '想找人' + verb + (kind ? kind.name : c.kind);
                    h += '<div class="grm-card grm-call">' + _face(c.from.rid, true)
                        + '<div class="grm-call-main"><b>' + _esc(head) + '</b>' + (c.say ? '<p>「' + _esc(c.say) + '」</p>' : '') + '</div>'
                        + '<div class="grm-call-state">' + _esc(_ago(c.at)) + '<br>' + (c.to ? _esc(c.to.name) + '還沒回' : '還沒人接') + '</div></div>';
                });
            }
            if (done.length) {
                h += '<div class="grm-sec"><i class="fa-solid fa-clock-rotate-left"></i>下完的</div><div class="grm-card grm-list">';
                done.slice(0, 10).forEach(g => {
                    const who = g.kind === 'whoami' ? _names(g) : g.players[0].name + ' 對 ' + g.players[1].name;
                    const len = g.kind === 'whoami' ? (g.round ? '・' + g.round + ' 輪' : '') : (g.n ? '・' + g.n + ' 手' : '');
                    h += '<button type="button" class="grm-done" data-game="' + _esc(g.id) + '">' + _resultText(g)
                        + '<span class="grm-done-who">' + _esc(who) + '・' + _esc(g.kind_name) + len + '</span>'
                        + '<span class="grm-when">' + _esc(_ago(g.last_at)) + '</span><i class="fa-solid fa-rotate-left"></i></button>';
                });
                h += '</div>';
            }
            if (recs.length) {
                h += '<div class="grm-sec"><i class="fa-solid fa-trophy"></i>戰績</div><div class="grm-card grm-list">';
                recs.forEach((r, i) => {
                    h += '<div class="grm-rank"><span class="grm-rank-no">' + (i + 1) + '</span>' + _face(r.rid) + '<span class="grm-rank-name">' + _esc(r.name) + '</span>'
                        + '<span class="grm-rank-wl"><b>' + r.win + '</b> 勝 ' + r.loss + ' 負' + (r.draw ? ' ' + r.draw + ' 和' : '') + '</span>'
                        + (r.streak >= 2 ? '<span class="grm-streak">連勝 ' + r.streak + '</span>' : '') + '</div>';
                });
                h += '</div>';
            }
        }
        h += '</div><button type="button" class="grm-cta" data-act="new"><i class="fa-solid fa-chess-knight"></i>叫他們來一盤</button>';
        _root.innerHTML = h;
    }

    // ── 點進一盤 ───────────────────────────────────────────
    async function _openGame(gid) {
        try { _detail = await _api('/v1/games/one?id=' + encodeURIComponent(gid)); }
        catch (e) { _toast('這盤打不開：' + e.message); return; }
        _replay = _detail.n;
        _stopArmed = '';
        _renderMatch();
    }
    function _renderMatch() {
        if (_detail && _detail.kind === 'whoami') { _renderWho(); return; }
        _view = 'match';
        const g = _detail;
        if (window.ChatWindow && window.ChatWindow.setSubPanelHead) window.ChatWindow.setSubPanelHead(g.kind_name, _backHome);
        const a = g.players[0], b = g.players[1];
        const side = g.kind === 'gomoku' ? ['黑・先手', '白'] : ['白・先手', '黑'];
        const stone = g.kind === 'gomoku' ? ['<span class="grm-stone is-black"></span>', '<span class="grm-stone is-white"></span>'] : ['', ''];
        let h = '<div class="grm-body">';
        h += '<div class="grm-card grm-players">'
            + '<div class="grm-player' + (g.turn === a.rid ? ' is-turn' : '') + '">' + _face(a.rid, true) + '<div><b>' + _esc(a.name) + '</b><small>' + stone[0] + side[0] + '</small></div></div>'
            + '<div class="grm-move-no"><b>' + g.n + '</b>手</div>'
            + '<div class="grm-player is-right' + (g.turn === b.rid ? ' is-turn' : '') + '">' + _face(b.rid, true) + '<div><b>' + _esc(b.name) + '</b><small>' + side[1] + stone[1] + '</small></div></div></div>';
        h += '<div class="grm-card grm-board" id="grm-board"></div>';
        h += '<div class="grm-card grm-replay">'
            + '<button type="button" class="grm-icon" data-step="first" aria-label="第一手"><i class="fa-solid fa-backward-fast"></i></button>'
            + '<button type="button" class="grm-icon" data-step="-1" aria-label="上一手"><i class="fa-solid fa-caret-left"></i></button>'
            + '<input type="range" min="0" max="' + g.n + '" value="' + _replay + '" class="grm-slider" aria-label="看到第幾手">'
            + '<span class="grm-replay-no"></span>'
            + '<button type="button" class="grm-icon" data-step="1" aria-label="下一手"><i class="fa-solid fa-caret-right"></i></button>'
            + '<button type="button" class="grm-icon" data-step="last" aria-label="最新一手"><i class="fa-solid fa-forward-fast"></i></button></div>';
        if (g.status === 'playing') {
            h += '<div class="grm-card grm-status">' + _turnLine(g) + _stopBtn(g) + '</div>';
        } else {
            // 收掉的那盤原因是寫給住戶看的（「Rae 收掉了」），畫面上只留「收掉了」
            h += '<div class="grm-card grm-status grm-status-end">' + _resultText(g) + (g.status === 'stopped' ? '' : '<span>' + _esc((g.result && g.result.why) || '') + '</span>') + '</div>';
        }
        h += '<div class="grm-card"><ul class="grm-log">';
        if (g.end_say) h += _logLine(g, { by: g.end_say.by, say: g.end_say.text, n: null, end: true });
        for (let i = g.moves.length - 1; i >= 0; i--) h += _logLine(g, g.moves[i]);
        if (g.accept_say) h += _logLine(g, { by: g.players[1].rid, say: g.accept_say, n: 0, accept: true });
        if (!g.moves.length && !g.accept_say && !g.end_say) h += '<li class="grm-log-empty">還沒有人走</li>';
        h += '</ul></div></div>';
        _root.innerHTML = h;
        _paintReplay();
    }
    function _logLine(g, m) {
        const name = _nameOf(g, m.by);
        const what = m.end ? '認輸' : m.accept ? '接下戰帖' : '第 ' + m.n + ' 手・' + _esc(m.san || m.mv);
        return '<li' + (m.n ? ' data-n="' + m.n + '"' : '') + '>' + _face(m.by) + '<div class="grm-log-main"><div class="grm-log-top"><b>' + _esc(name) + '</b>' + what + '</div>'
            + (m.say ? '<span class="grm-log-say">' + _esc(m.say) + '</span>' : '') + '</div></li>';
    }
    function _paintReplay() {
        const g = _detail, board = _root.querySelector('#grm-board');
        if (!board) return;
        const n = Math.max(0, Math.min(g.n, _replay));
        if (g.kind === 'gomoku') board.innerHTML = _gomokuSvg(g.moves.map(m => m.mv), n);
        else { const m = n ? g.moves[n - 1] : null; board.innerHTML = _chessSvg(m ? m.fen : START_FEN, m ? m.mv : null); }
        const sl = _root.querySelector('.grm-slider'); if (sl) sl.value = n;
        const no = _root.querySelector('.grm-replay-no'); if (no) no.textContent = n + '/' + g.n;
        _root.querySelectorAll('.grm-log li[data-n]').forEach(li => li.classList.toggle('is-now', Number(li.dataset.n) === n));
    }
    function _backHome() { _detail = null; _renderHome(); }

    // ── 叫他們來一盤 ───────────────────────────────────────
    function _renderNew() {
        const S = _snap;
        if (!_kind && S.kinds && S.kinds.length) _kind = S.kinds[0].id;
        const who = _kind === 'whoami';
        if (!who && _pick.length > 2) _pick = _pick.slice(0, 2);   // 從猜猜我是誰切回棋：只留前兩位
        if (!_rounds) _rounds = S.who_rounds || 10;
        const old = _root.querySelector('.grm-sheet');
        const keepScroll = old ? old.scrollTop : 0;                // 每點一下整張重畫，捲到哪要留著
        const resById = {};
        (S.residents || []).forEach(r => { resById[r.rid] = r; });
        let h = '<div class="grm-dim" data-act="close-new"><div class="grm-sheet" data-sheet="1">'
            + '<div class="grm-sheet-head"><h3>叫他們來一盤</h3><button type="button" class="grm-icon" data-act="close-new" aria-label="關閉"><i class="fa-solid fa-xmark"></i></button></div>'
            + '<div><div class="grm-label">玩什麼</div><div class="grm-chips">'
            + (S.kinds || []).map(k => '<button type="button" class="grm-chip' + (k.id === _kind ? ' is-on' : '') + '" data-kind="' + _esc(k.id) + '">'
                + '<i class="' + (k.id === 'gomoku' ? 'fa-regular fa-circle' : k.id === 'whoami' ? 'fa-solid fa-note-sticky' : 'fa-solid fa-chess') + '"></i>' + _esc(k.name) + '</button>').join('')
            + '</div></div>'
            + '<div><div class="grm-label">' + (who ? '誰來玩（挑 2～' + WHO_MAX + ' 位，照挑的順序輪）' : '誰跟誰（挑兩位，先挑的先走）') + '</div><div class="grm-pick">';
        (S.residents || []).forEach(r => {
            const idx = _pick.indexOf(r.rid);
            const badge = idx < 0 ? '' : who ? '<span class="grm-first">' + (idx + 1) + '</span>' : idx === 0 ? '<span class="grm-first">先</span>' : '';
            h += '<button type="button" class="grm-pick-cell' + (idx >= 0 ? ' is-on' : '') + (r.enabled ? '' : ' is-off') + '"' + (r.enabled ? ' data-pick="' + _esc(r.rid) + '"' : ' disabled') + '>'
                + badge + _face(r.rid, true) + '<span>' + _esc(r.name) + '</span>'
                + '<small>' + (r.enabled ? _esc(MODEL_NAME[r.backend] || r.backend) : '不會自己醒') + '</small></button>';
        });
        if (!(S.residents || []).length) h += '<div class="grm-none">宿舍還沒有會自己醒來的住戶</div>';
        h += '</div></div>';
        if (who) {
            h += '<div><div class="grm-label">每人最多幾輪</div><div class="grm-chips">'
                + ROUND_CHOICES.map(n => '<button type="button" class="grm-chip' + (n === _rounds ? ' is-on' : '') + '" data-rounds="' + n + '">' + n + ' 輪</button>').join('')
                + '</div></div>';
            if (_pick.length) {
                // 誰頭上貼什麼：她幫忙貼就填，空著就讓圈子裡的上一位出
                h += '<div><div class="grm-label">頭上貼什麼</div><div class="grm-words">';
                _pick.forEach((rid, i) => {
                    const prev = _pick.length > 1 ? resById[_pick[(i - 1 + _pick.length) % _pick.length]] : null;
                    h += '<label class="grm-word-row">' + _face(rid) + '<span class="grm-word-name">' + _esc((resById[rid] || {}).name || rid) + '</span>'
                        + '<input type="text" class="grm-word-in" data-word="' + _esc(rid) + '" maxlength="20" value="' + _esc(_words[rid] || '') + '"'
                        + (prev ? ' placeholder="空著就讓' + _esc(prev.name) + '出"' : '') + '></label>';
                });
                h += '</div></div>';
            }
        }
        const ready = _kind && (who ? _pick.length >= 2 : _pick.length === 2);
        h += '<button type="button" class="grm-cta grm-cta-in" data-act="create"' + (ready ? '' : ' disabled') + '><i class="fa-solid fa-scroll"></i>開始這一盤</button></div></div>';
        _renderHome();          // 底下墊著首頁
        _view = 'new';          // 🚨 _renderHome 會把 _view 設回 home，墊完要設回來，不然點表單都當成在首頁點
        _root.insertAdjacentHTML('beforeend', h);
        const sheet = _root.querySelector('.grm-sheet');
        if (sheet && keepScroll) sheet.scrollTop = keepScroll;
    }

    // ── 事件 ───────────────────────────────────────────────
    function _bind() {
        _root.addEventListener('click', async function (e) {
            const t = e.target;
            if (_view === 'new') {
                if (t.closest('[data-act="close-new"]') && (!t.closest('[data-sheet]') || t.closest('button[data-act="close-new"]'))) { _pick = []; _words = {}; _renderHome(); return; }
                const k = t.closest('[data-kind]');
                if (k) { _kind = k.dataset.kind; _renderNew(); return; }
                const rd = t.closest('[data-rounds]');
                if (rd) { _rounds = Number(rd.dataset.rounds); _renderNew(); return; }
                const p = t.closest('[data-pick]');
                if (p) {
                    const rid = p.dataset.pick, i = _pick.indexOf(rid);
                    const max = _kind === 'whoami' ? WHO_MAX : 2;
                    if (i >= 0) _pick.splice(i, 1);
                    else if (_pick.length < max) _pick.push(rid);
                    else if (max === 2) _pick = [_pick[0], rid];
                    _renderNew();
                    return;
                }
                if (t.closest('[data-act="create"]')) {
                    const who = _kind === 'whoami';
                    if (who ? _pick.length < 2 : _pick.length !== 2) return;
                    const body = { kind: _kind, a: _pick[0], b: _pick[1] };
                    if (who) {
                        body.players = _pick.slice();
                        body.rounds = _rounds;
                        body.words = {};
                        _pick.forEach(rid => { const w = String(_words[rid] || '').trim(); if (w) body.words[rid] = w; });
                    }
                    try {
                        await _api('/v1/games/new', body);
                        _toast(who ? '開了一局，等他們醒來輪流猜' : '開了一盤，等他們醒來走');
                        _pick = [];
                        _words = {};
                        _view = 'home';   // 開好了就收起表單，回首頁看那一盤
                        await _load();
                    } catch (er) { _toast('沒開成：' + er.message); }
                }
                return;
            }
            if (_view === 'home') {
                if (t.closest('[data-act="new"]')) { _pick = []; _words = {}; _renderNew(); return; }
                const g = t.closest('[data-game]');
                if (g) { _openGame(g.dataset.game); return; }
                return;
            }
            if (_view === 'match') {
                const st = t.closest('[data-step]');
                if (st) {
                    const v = st.dataset.step;
                    _replay = v === 'first' ? 0 : v === 'last' ? _detail.n : _replay + Number(v);
                    _replay = Math.max(0, Math.min(_detail.n, _replay));
                    _paintReplay();
                    return;
                }
                const li = t.closest('.grm-log li[data-n]');
                if (li) { _replay = Number(li.dataset.n); _paintReplay(); return; }
                if (t.closest('[data-act="stop"]')) {
                    if (_stopArmed !== _detail.id) { _stopArmed = _detail.id; _renderMatch(); return; }
                    try { await _api('/v1/games/stop', { id: _detail.id }); _toast('收掉了'); await _load(); _openGame(_detail.id); }
                    catch (er) { _toast('沒收成：' + er.message); }
                    return;
                }
                if (t.closest('[data-act="gm"]')) {
                    try { await _api('/v1/games/gm', { id: _detail.id }); _toast('請 GM 再判一次了，等一下再看'); _openGame(_detail.id); }
                    catch (er) { _toast('沒請成：' + er.message); }
                }
            }
        });
        _root.addEventListener('input', function (e) {
            if (_view === 'match' && e.target.classList.contains('grm-slider')) { _replay = Number(e.target.value); _paintReplay(); }
            if (_view === 'new' && e.target.dataset && e.target.dataset.word) _words[e.target.dataset.word] = e.target.value;
        });
    }

    async function _load() {
        if (!_root) return;
        try {
            const [snap, sched] = await Promise.all([_api('/v1/games'), _api('/v1/schedule').catch(() => null)]);
            _snap = snap;
            _sched = sched;
        } catch (e) {
            const why = e.message === 'NOT_CONFIGURED' ? '還沒設定橋（房間的設置裡填）'
                : e.message === 'OLD_BRIDGE' ? '橋是舊版，重開一次橋才有遊戲室'
                : '連不上電腦那邊的橋（要開著才看得到遊戲室）';
            _root.innerHTML = '<div class="grm-body"><div class="grm-empty"><i class="fa-solid fa-plug-circle-xmark grm-empty-icon"></i><h3>' + _esc(why) + '</h3></div></div>';
            return;
        }
        if (_view === 'match' && _detail) { _openGame(_detail.id); return; }
        if (_view === 'new') { _renderNew(); return; }
        _renderHome();
    }

    const GameRoom = {
        launch: function (container) {
            if (!container) return;
            // 自己開一層再綁事件：子面板的容器是留言板、額度共用的同一個元素，綁在它上面會疊、還會管到別人的點擊
            _root = document.createElement('div');
            _root.className = 'grm-root';
            container.appendChild(_root);
            _view = 'home';
            _detail = null;
            _pick = [];
            _root.innerHTML = '<div class="grm-body"><div class="grm-empty"><i class="fa-solid fa-spinner fa-spin grm-empty-icon"></i></div></div>';
            _bind();
            _load();
            clearInterval(_timer);
            _timer = setInterval(function () {
                if (!_root || !_root.isConnected || !_root.querySelector('.grm-body')) { clearInterval(_timer); return; }
                if (_view !== 'new') _load();
            }, REFRESH_MS);
        }
    };
    window.GameRoom = GameRoom;
})();
