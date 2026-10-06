/**
 * core/xiaoji_memory.js — 小機的記憶（window.XiaojiMemory，子面板 xiaoji_memory）
 * ------------------------------------------------------------------
 * 10-06 起資料全在奧瑞亞 OS_XIAOJI_MEM（經歷簿、記憶、性格、整理；設計 docs/superpowers/specs/2026-10-06-xiaoji-memory-design.md）。
 * 這裡三頁：
 *   記得的事：它是什麼樣的（rec.about）＋「每句都帶著」（釘住的）＋「聊到才想起」＋「記錯的、收起的」。
 *             每條附出處原話、改過幾次（點開看每一版）；能改、標記錯、收起、放回去；幫它記一條。
 *   變成這樣：四欄（講話、喜好、跟你、做事），每條寫「因為哪天的事」，能拿掉（她定的：性格能刪不能改）。
 *   經歷簿：一天一天往回翻；選幾行抹掉（抹掉前列出出處全在這幾行的記憶與樣子，勾了一起收起／拿掉）；最底下這一串整理過的舊聊天。
 *   最上面一行：上次整理記了什麼（能看、能退回）、整理沒成功的原因、還在記熟以前的事的進度；右上匯出成一個檔。
 * 入口是小機房間圖右下、衣櫃旁邊那顆羽毛筆（chat_window.js 的 #cw-room-memo，只有小機）。
 * 舊版奧瑞亞（沒有 OS_XIAOJI_MEM）：整頁一句話，說要更新奧瑞亞。這裡不存任何東西。
 * ------------------------------------------------------------------
 */
(function (XiaojiMemory) {
    'use strict';

    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    function _XJ() { return window.OS_XIAOJI || (window.parent && window.parent.OS_XIAOJI) || null; }
    function _MEM() { return window.OS_XIAOJI_MEM || (window.parent && window.parent.OS_XIAOJI_MEM) || null; }
    function _CT() { return window.ClaudeTerminal || null; }
    function _A() { return window.AUI || (window.parent && window.parent.AUI) || null; }
    const pad = n => String(n).padStart(2, '0');
    function _date(ms) { if (!ms) return ''; const d = new Date(ms); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()); }
    function _time(ms) { if (!ms) return ''; const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
    function _day(ms) { const d = new Date(ms || 0); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '（' + '日一二三四五六'[d.getDay()] + '）'; }
    function _clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }

    const ABOUT_UI = { user: '關於你', self: '它自己', story: '故事裡的', other: '別人' };
    const KIND_UI = { user: '你是什麼樣的人', promise: '約定', event: '發生過的事', work: '做過的東西', legacy: '以前記的' };
    const TRAIT_UI = [
        { k: 'talk', name: '講話', icon: 'fa-comment' },
        { k: 'taste', name: '喜好', icon: 'fa-heart' },
        { k: 'bond', name: '跟你', icon: 'fa-hand-holding-heart' },
        { k: 'work', name: '做事', icon: 'fa-screwdriver-wrench' }];
    const BY_UI = { self: '它', tidy: '它（整理時）', rae: '你', import: '搬家時' };
    const WHY_UI = { add: '記下', update: '改成', fix: '更正成', revert: '退回成', drop: '不再', remove: '拿掉' };
    const EV_ICON = { chat: 'fa-comment', mem: 'fa-feather-pointed', trait: 'fa-seedling', tidy: 'fa-broom', lesson: 'fa-chalkboard-user', exam: 'fa-graduation-cap',
        hw: 'fa-file-lines', theater: 'fa-masks-theater', wear: 'fa-shirt', room: 'fa-couch', bubble: 'fa-comment-dots', born: 'fa-box-open',
        sum: 'fa-clock-rotate-left', prop: 'fa-file-signature', import: 'fa-truck-ramp-box', erase: 'fa-eraser', rae: 'fa-hand' };
    const ERASABLE = { chat: 1, prop: 1, lesson: 1, exam: 1, hw: 1, theater: 1, wear: 1, room: 1, bubble: 1, sum: 1, born: 1, rae: 1 };
    const EV_PAGE = 40;
    const TAB_KEY = 'xjm_tab';
    const ABOUT_LEN = 300;

    const A0 = _A();
    if (A0 && A0.registerHelp) A0.registerHelp({ xiaoji_memory: { title: '它的記憶',
        body: '記得的事：它自己記的筆記。「每句都帶著」的每一句話都會想到；「聊到才想起」的，聊到相關的事才會想起來。\n'
            + '改：以前是對的，後來變了，舊的會留著當「以前」。\n記錯了：當初就記錯，那一條以後不會再被當成真的；可以順手寫正確的。\n'
            + '收起：不重要了，平常不帶，放回去就回來。沒有真的刪掉。\n\n'
            + '變成這樣：它跟你相處下來長成的樣子，每一條都寫了是哪天的事看出來的。不喜歡的可以拿掉，它不會馬上又長回來。\n\n'
            + '經歷簿：它經歷過的每一件事，原話都在。選幾行可以抹掉：抹掉的只剩「這裡被抹掉了」，它找不到、也不會再拿來長樣子。\n\n'
            + '它每多大約 20 件事，會自己整理一次（會叫一次模型）。最上面那行看得到它上次整理改了什麼，覺得改錯了可以退回。' } });

    let S = null;

    /** 只有小機（舊版奧瑞亞也讓羽毛筆出現，點開會說要更新） */
    XiaojiMemory.can = function (provider) { return provider === 'xiaoji' && !!_XJ(); };

    XiaojiMemory.launch = async function (body) {
        const CT = _CT(), X = _XJ(), M = _MEM();
        const r = (CT && CT.getActiveResident) ? CT.getActiveResident('xiaoji') : null;
        if (!X || !r || !r.id) { body.innerHTML = '<div class="cw-sub-missing">小機的記憶要在奧瑞亞裡才看得到</div>'; return; }
        if (!M) { body.innerHTML = '<div class="cw-sub-missing">這本要奧瑞亞更新到新版才翻得開（它的記憶照樣在，只是這裡看不到）</div>'; return; }
        let conv = null;
        try { conv = CT.getActiveConvId ? CT.getActiveConvId(CT.getActiveTab()) : null; } catch (_) {}
        let tab = 'mem';
        try { const t = localStorage.getItem(TAB_KEY); if (t === 'mem' || t === 'trait' || t === 'life') tab = t; } catch (_) {}
        S = { body, rid: r.id, name: r.name || '它', resident: r, conv, tab, about: '', aboutEdit: false, aboutDraft: null, aboutMsg: '',
            mems: null, traits: [], status: null, over: new Set(), all: [], evMap: new Map(), nodes: [], evShown: EV_PAGE,
            ui: { editing: null, wrongFor: null, adding: false, addAbout: 'user', openSrc: new Set(), openVer: new Set(), armed: null,
                selecting: false, sel: new Set(), eraseAsk: null, showTidy: false }, busy: false, msg: '' };
        const A = _A();
        const help = (A && A.helpBtn) ? A.helpBtn('xiaoji_memory') : '';
        body.innerHTML = '<div class="xjm-wrap">'
            + '<div class="xjm-top"><nav class="xjm-tabs">'
            +   '<button type="button" class="xjm-tab" data-tab="mem">記得的事</button>'
            +   '<button type="button" class="xjm-tab" data-tab="trait">變成這樣</button>'
            +   '<button type="button" class="xjm-tab" data-tab="life">經歷簿</button>'
            + '</nav><span class="xjm-top-r">' + help
            +   '<button type="button" class="xjm-ic" data-act="export" title="匯出成一個檔"><i class="fa-solid fa-file-export"></i></button></span></div>'
            + '<div class="xjm-status"></div>'
            + '<div class="xjm-scroll"></div>'
            + '<div class="xjm-bar" hidden></div>'
            + '</div>';
        body.querySelector('.xjm-wrap').addEventListener('click', _onClick);
        await _load();
    };

    async function _load() {
        const X = _XJ(), M = _MEM();
        try { const rec = await X.get(S.rid); S.about = String((rec && rec.about) || ''); } catch (_) { S.about = ''; }
        try { S.mems = (await M.mems(S.rid)).items; } catch (_) { S.mems = []; }
        try { S.traits = (await M.traits(S.rid)).items; } catch (_) { S.traits = []; }
        try { S.over = new Set((await M.pinnedText(S.rid)).over || []); } catch (_) { S.over = new Set(); }
        try { S.all = await M.allEvents(S.rid); } catch (_) { S.all = []; }
        S.evMap = new Map(S.all.map(e => [e.id, e]));
        try { S.status = await M.status(S.rid); } catch (_) { S.status = null; }
        try { S.nodes = (S.conv && M.sumGet) ? ((await M.sumGet(S.conv)).nodes || []) : []; } catch (_) { S.nodes = []; }
        _render();
        _watchEmbed();
    }
    // 還在記熟以前的事（背景算向量）：每幾秒更新那一行，算完就停
    let _embedTimer = null;
    function _watchEmbed() {
        clearTimeout(_embedTimer);
        const st = S && S.status;
        if (!st || !st.embed || st.embed.ready || !st.embed.total) return;
        _embedTimer = setTimeout(async () => {
            if (!S || !S.body || !S.body.isConnected) return;
            try { S.status.embed = await _MEM().embedStatus(S.rid); } catch (_) { return; }
            _renderStatus();
            _watchEmbed();
        }, 4000);
    }

    // ── 最上面那行 ──────────────────────────────────────────
    function _renderStatus() {
        const el = S.body.querySelector('.xjm-status');
        if (!el) return;
        const st = S.status;
        if (!st) { el.innerHTML = ''; return; }
        let h = '';
        const t = st.lastTidy;
        if (t) {
            const ch = t.changes || [];
            const n = v => ch.filter(c => v(c)).length;
            const add = n(c => c.type === 'mem' && c.verb === 'add'), fix = n(c => c.type === 'mem' && c.verb !== 'add'), tr = n(c => c.type === 'trait');
            const u = t.usage ? ((t.usage.input || 0) + (t.usage.output || 0)) : 0;
            h += '<div class="xjm-st-line"><i class="fa-solid fa-broom"></i><span class="xjm-st-txt">上次整理 ' + esc(_date(t.at)) + '：'
                + (ch.length ? '記了 ' + add + ' 條、改了 ' + fix + ' 條、樣子 ' + tr + ' 條' : '沒有要改的')
                + (u ? '（約 ' + u.toLocaleString() + ' 字）' : '') + (t.reverted ? '・你退回了' : '') + '</span>';
            if (ch.length) h += '<button type="button" class="xjm-st-btn" data-act="tidy-show">' + (S.ui.showTidy ? '收起' : '看是哪些') + '</button>';
            if (ch.length && !t.reverted) {
                const armed = S.ui.armed === 'tidy';
                h += '<button type="button" class="xjm-st-btn' + (armed ? ' is-armed' : '') + '" data-act="tidy-revert">' + (armed ? '確定退回？' : '退回') + '</button>';
            }
            h += '</div>';
            if (S.ui.showTidy && ch.length) h += '<ul class="xjm-st-list">' + ch.map(_tidyChangeLine).join('') + '</ul>';
        } else {
            const left = Math.max(1, (st.every || 20) - (st.pending || 0));
            h += '<div class="xjm-st-line is-soft"><i class="fa-solid fa-broom"></i><span class="xjm-st-txt">再 ' + left + ' 件事，它會第一次整理自己的記憶</span></div>';
        }
        if (st.tidyStopped) {
            h += '<div class="xjm-st-line is-bad"><i class="fa-solid fa-triangle-exclamation"></i><span class="xjm-st-txt">整理連續 ' + st.tidyFails + ' 次沒成功，先停下來了（不會再自己叫模型）：' + esc(st.tidyErr || '') + '</span>'
                + '<button type="button" class="xjm-st-btn" data-act="tidy-retry"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? '整理中…' : '再試一次') + '</button></div>';
        } else if (st.tidyFails > 0) {
            h += '<div class="xjm-st-line is-bad"><i class="fa-solid fa-triangle-exclamation"></i><span class="xjm-st-txt">整理沒成功：' + esc(st.tidyErr || '') + '（多聊一陣子會再試）</span></div>';
        }
        const em = st.embed;
        if (em && em.total && !em.ready) {
            h += '<div class="xjm-st-line is-soft"><i class="fa-solid fa-book-open"></i><span class="xjm-st-txt">正在記熟以前的事 ' + em.done + '／' + em.total + '（好了之後換個說法問，它也想得起來）</span></div>'
                + '<progress class="xjm-prog" max="' + em.total + '" value="' + em.done + '"></progress>';
        }
        el.innerHTML = h;
    }
    function _tidyChangeLine(c) {
        if (c.type === 'mem') {
            const m = (S.mems || []).find(x => x.id === c.id);
            const now = m ? m.text : '';
            if (c.verb === 'add') return '<li>記下「' + esc(_clip(now, 40)) + '」</li>';
            return '<li>「' + esc(_clip(c.prev && c.prev.text, 30)) + '」' + (c.verb === 'fix' ? '更正成' : '改成') + '「' + esc(_clip(now, 30)) + '」</li>';
        }
        const t = S.traits.find(x => x.id === c.id);
        if (c.verb === 'drop') return '<li>不再「' + esc(_clip(c.prev && c.prev.text, 40)) + '」</li>';
        return '<li>' + (c.verb === 'add' ? '長出樣子' : '樣子改成') + '「' + esc(_clip(t ? t.text : '', 40)) + '」</li>';
    }

    // ── 畫 ──────────────────────────────────────────────────
    function _render() {
        if (!S || !S.body) return;
        const sc = S.body.querySelector('.xjm-scroll');
        if (!sc) return;
        const open = sc.querySelector('.xjm-about.is-edit .xjm-input');
        S.aboutDraft = (S.aboutEdit && open) ? open.value : (S.aboutEdit ? S.aboutDraft : null);
        S.body.querySelectorAll('.xjm-tab').forEach(b => b.classList.toggle('is-on', b.dataset.tab === S.tab));
        _renderStatus();
        if (S.mems === null) { sc.innerHTML = '<div class="xjm-msg">翻開筆記…</div>'; return; }
        sc.innerHTML = S.tab === 'trait' ? _traitPage() : S.tab === 'life' ? _lifePage() : _memPage();
        _renderBar();
        const ta = sc.querySelector('.is-edit .xjm-input');
        if (ta) { try { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }
    }

    // 記得的事
    function _srcText(id) {
        const e = S.evMap.get(id);
        if (!e) return '（找不到這一行）';
        if (e.state === 'erased') return '這裡被抹掉了';
        if (e.kind === 'chat') return [e.user ? '你：' + e.user : '', e.reply ? '它：' + e.reply : ''].filter(Boolean).join('　');
        if (e.kind === 'rae') return '你：' + (e.text || '');
        if (e.kind === 'import') return '從舊版搬過來的';
        const M = _MEM();
        return (M && M.evText) ? (M.evText(Object.assign({}, e, { state: 'ok' }), '它') || e.text || '') : (e.text || '');
    }
    function _noteRow(m, mode) {
        const id = m.id;
        if (S.ui.editing === id) {
            return '<div class="xjm-note is-edit" data-id="' + esc(id) + '">'
                + '<textarea class="xjm-input" rows="' + Math.max(2, Math.min(5, Math.ceil(String(m.text).length / 16))) + '" maxlength="' + _max() + '">' + esc(m.text) + '</textarea>'
                + '<div class="xjm-hint">以前是對的、後來變了才用「改」；當初就記錯，請用旗子那顆。</div>'
                + '<div class="xjm-edit-acts"><button type="button" class="xjm-btn" data-act="cancel">取消</button>'
                + '<button type="button" class="xjm-btn is-main" data-act="save" data-id="' + esc(id) + '">存好</button></div></div>';
        }
        if (S.ui.wrongFor === id) {
            return '<div class="xjm-note is-edit" data-id="' + esc(id) + '">'
                + '<div class="xjm-txt is-struck">' + esc(m.text) + '</div>'
                + '<textarea class="xjm-input" rows="2" maxlength="' + _max() + '" placeholder="正確的是…（可以不寫）"></textarea>'
                + '<div class="xjm-edit-acts"><button type="button" class="xjm-btn" data-act="cancel">取消</button>'
                + '<button type="button" class="xjm-btn is-main" data-act="wrong-save" data-id="' + esc(id) + '">記錯了</button></div></div>';
        }
        const vers = (m.versions || []).length;
        const srcOpen = S.ui.openSrc.has(id), verOpen = S.ui.openVer.has(id);
        let h = '<div class="xjm-note' + (mode === 'off' ? ' is-off' : '') + '" data-id="' + esc(id) + '">'
            + '<span class="xjm-dot' + (m.kind === 'promise' ? ' is-promise' : '') + '"></span>'
            + '<div class="xjm-nbody"><div class="xjm-txt">' + esc(m.text) + '</div>'
            + '<div class="xjm-meta">'
            + (mode === 'off' ? '<span class="xjm-chip is-off">' + (m.state === 'wrong' ? '記錯了' : '收起了') + '</span>' : '')
            + '<span>' + esc(KIND_UI[m.kind] || m.kind) + (m.about === 'user' && (m.kind === 'user' || m.kind === 'legacy') ? '' : '・' + esc(ABOUT_UI[m.about] || m.about)) + '・' + esc(_date(m.at)) + '</span>'
            + (S.over.has(id) ? '<span class="xjm-chip">太多了，聊到才想起</span>' : '')
            + ((m.from || []).length ? '<button type="button" class="xjm-link" data-act="src" data-id="' + esc(id) + '">' + (srcOpen ? '收起原話' : '原話') + '</button>' : '')
            + (vers > 1 ? '<button type="button" class="xjm-link" data-act="ver" data-id="' + esc(id) + '">' + (verOpen ? '收起' : '改過 ' + (vers - 1) + ' 次') + '</button>' : '')
            + '</div>';
        if (srcOpen) h += '<div class="xjm-src">' + (m.from || []).slice(-3).map(f => '<div class="xjm-src-line"><span class="xjm-src-d">' + esc(_date((S.evMap.get(f) || {}).at)) + '</span>「' + esc(_clip(_srcText(f), 120)) + '」</div>').join('') + '</div>';
        if (verOpen) h += '<ol class="xjm-vers">' + (m.versions || []).map(v => '<li><span class="xjm-src-d">' + esc(_date(v.at)) + '</span>' + esc(BY_UI[v.by] || v.by) + esc(WHY_UI[v.why] || v.why) + '「' + esc(v.text) + '」</li>').join('') + '</ol>';
        h += '</div><div class="xjm-acts">';
        if (mode === 'off') {
            h += '<button type="button" class="xjm-ic" data-act="unstow" data-id="' + esc(id) + '" title="放回去"><i class="fa-solid fa-rotate-left"></i></button>';
        } else {
            const armed = S.ui.armed === 'stow' + id;
            h += '<button type="button" class="xjm-ic" data-act="edit" data-id="' + esc(id) + '" title="改"><i class="fa-solid fa-pen"></i></button>'
                + '<button type="button" class="xjm-ic" data-act="wrong" data-id="' + esc(id) + '" title="記錯了"><i class="fa-solid fa-flag"></i></button>'
                + '<button type="button" class="xjm-ic' + (armed ? ' is-armed' : '') + '" data-act="stow" data-id="' + esc(id) + '" title="' + (armed ? '再按一次收起' : '收起') + '">'
                + (armed ? '<span>收起？</span>' : '<i class="fa-solid fa-box-archive"></i>') + '</button>';
        }
        return h + '</div></div>';
    }
    function _max() { const M = _MEM(); return (M && M.LIMITS && M.LIMITS.MEM_LEN) || 120; }
    function _aboutCard() {
        const ttl = '<span class="xjm-about-ttl"><i class="fa-solid fa-id-card"></i> ' + esc(S.name) + ' 是什麼樣的</span>';
        if (S.aboutEdit) {
            const v = S.aboutDraft != null ? S.aboutDraft : S.about;
            return '<div class="xjm-about is-edit"><div class="xjm-about-head">' + ttl + '</div>'
                + '<textarea class="xjm-input" rows="' + Math.max(3, Math.min(8, Math.ceil(v.length / 16))) + '" maxlength="' + ABOUT_LEN + '">' + esc(v) + '</textarea>'
                + (S.aboutMsg ? '<div class="xjm-flash">' + esc(S.aboutMsg) + '</div>' : '')
                + '<div class="xjm-edit-acts"><button type="button" class="xjm-btn" data-act="cancel">取消</button>'
                + '<button type="button" class="xjm-btn is-main" data-act="about-save">存好</button></div></div>';
        }
        return '<div class="xjm-about"><div class="xjm-about-head">' + ttl
            + '<button type="button" class="xjm-ic" data-act="about-edit" title="改"><i class="fa-solid fa-pen"></i></button></div>'
            + (S.about.trim() ? '<div class="xjm-about-txt">' + esc(S.about) + '</div>' : '<div class="xjm-about-txt is-empty">還沒寫</div>') + '</div>';
    }
    function _memPage() {
        const M = _MEM();
        const ok = S.mems.filter(m => m.state === 'ok').sort((a, b) => b.at - a.at);
        const pinned = ok.filter(m => M.isPinned(m)), rest = ok.filter(m => !M.isPinned(m));
        const off = S.mems.filter(m => m.state !== 'ok').sort((a, b) => b.at - a.at);
        let h = _aboutCard();
        h += '<div class="xjm-paper"><div class="xjm-paper-head"><span class="xjm-paper-ttl"><i class="fa-solid fa-thumbtack"></i> 每句都帶著</span><span class="xjm-count">' + pinned.length + ' 條</span></div>';
        h += pinned.length ? '<div class="xjm-lines">' + pinned.map(m => _noteRow(m)).join('') + '</div>'
            : '<div class="xjm-empty is-soft"><span>你的事和它答應過的事會記在這裡。跟它多聊聊吧。</span></div>';
        h += _addForm() + '</div>';
        h += '<div class="xjm-paper is-second"><div class="xjm-paper-head"><span class="xjm-paper-ttl"><i class="fa-solid fa-lightbulb"></i> 聊到才想起</span><span class="xjm-count">' + rest.length + ' 條</span></div>';
        h += rest.length ? '<div class="xjm-lines">' + rest.map(m => _noteRow(m)).join('') + '</div>'
            : '<div class="xjm-empty is-soft"><span>發生過的事、它做過的東西、故事裡的事，聊到相關的時候才會想起來。</span></div>';
        h += '</div>';
        if (off.length) {
            h += '<div class="xjm-sec-head"><i class="fa-solid fa-box-archive"></i> 記錯的、收起的</div>'
                + '<div class="xjm-paper is-off"><div class="xjm-lines">' + off.map(m => _noteRow(m, 'off')).join('') + '</div></div>';
        }
        if (S.msg) h += '<div class="xjm-flash">' + esc(S.msg) + '</div>';
        return h;
    }
    function _addForm() {
        if (!S.ui.adding) return '<button type="button" class="xjm-add" data-act="add"><i class="fa-solid fa-plus"></i> 幫它記一條</button>';
        return '<div class="xjm-note is-edit is-new"><div class="xjm-pick">'
            + ['user', 'self', 'story', 'other'].map(a => '<button type="button" class="xjm-pick-b' + (S.ui.addAbout === a ? ' is-on' : '') + '" data-act="add-about" data-about="' + a + '">' + ABOUT_UI[a] + '</button>').join('')
            + '</div><textarea class="xjm-input" rows="2" maxlength="' + _max() + '" placeholder="一件事，一句話寫清楚"></textarea>'
            + '<div class="xjm-edit-acts"><button type="button" class="xjm-btn" data-act="cancel">取消</button>'
            + '<button type="button" class="xjm-btn is-main" data-act="add-save">記下</button></div></div>';
    }

    // 變成這樣
    function _traitPage() {
        const ok = S.traits.filter(t => t.state === 'ok');
        const gone = S.traits.filter(t => t.state !== 'ok').sort((a, b) => b.at - a.at);
        let h = '';
        if (!ok.length) h += '<div class="xjm-empty"><i class="fa-solid fa-seedling"></i><span>還沒長出樣子。<br>跟它多相處，它會慢慢變成自己的樣子。</span></div>';
        TRAIT_UI.forEach(g => {
            const xs = ok.filter(t => t.kind === g.k).sort((a, b) => b.at - a.at);
            h += '<div class="xjm-tsec"><div class="xjm-tsec-head"><i class="fa-solid ' + g.icon + '"></i> ' + g.name + '</div>';
            if (!xs.length) { h += '<div class="xjm-tnone">還沒有</div></div>'; return; }
            xs.forEach(t => {
                const armed = S.ui.armed === 'trait' + t.id, srcOpen = S.ui.openSrc.has(t.id);
                const days = Array.from(new Set((t.from || []).map(f => _date((S.evMap.get(f) || {}).at)).filter(Boolean)));
                h += '<div class="xjm-trait"><div class="xjm-trait-txt">' + esc(t.text) + '</div>'
                    + '<div class="xjm-meta"><span>因為 ' + esc(days.slice(-3).join('、') || '以前') + ' 的事</span>'
                    + '<button type="button" class="xjm-link" data-act="src" data-id="' + esc(t.id) + '">' + (srcOpen ? '收起原話' : '原話') + '</button>'
                    + '<button type="button" class="xjm-ic xjm-trait-x' + (armed ? ' is-armed' : '') + '" data-act="trait-remove" data-id="' + esc(t.id) + '" title="' + (armed ? '再按一次拿掉' : '拿掉') + '">'
                    + (armed ? '<span>拿掉？</span>' : '<i class="fa-solid fa-xmark"></i>') + '</button></div>'
                    + (srcOpen ? '<div class="xjm-src">' + (t.from || []).slice(-3).map(f => '<div class="xjm-src-line"><span class="xjm-src-d">' + esc(_date((S.evMap.get(f) || {}).at)) + '</span>「' + esc(_clip(_srcText(f), 120)) + '」</div>').join('') + '</div>' : '')
                    + '</div>';
            });
            h += '</div>';
        });
        if (gone.length) {
            h += '<div class="xjm-sec-head"><i class="fa-solid fa-leaf"></i> 以前有、現在沒有的</div><div class="xjm-gone">'
                + gone.map(t => '<div class="xjm-gone-line"><span class="xjm-chip is-off">' + (t.state === 'removed' ? '你拿掉的' : '它不再這樣') + '</span>' + esc(t.text) + '<span class="xjm-src-d">' + esc(_date(t.at)) + '</span></div>').join('') + '</div>';
        }
        if (S.msg) h += '<div class="xjm-flash">' + esc(S.msg) + '</div>';
        return h;
    }

    // 經歷簿
    function _evText(e) {
        if (e.state === 'erased') return '<span class="xjm-void">這裡被抹掉了</span>';
        const by = BY_UI[e.by] || '它';
        switch (e.kind) {
            case 'chat': return '<div class="xjm-ev-say"><b>你</b>' + esc(_clip(e.user, 80)) + '</div>' + (e.reply ? '<div class="xjm-ev-say"><b>它</b>' + esc(_clip(e.reply, 80)) + '</div>' : '');
            case 'mem': {
                const t = { add: '記下「' + _clip(e.text, 40) + '」', update: '把「' + _clip(e.prev && e.prev.text, 24) + '」改成「' + _clip(e.text, 24) + '」',
                    fix: '把「' + _clip(e.prev && e.prev.text, 24) + '」更正成「' + _clip(e.text, 24) + '」', wrong: '把「' + _clip(e.prev && e.prev.text, 40) + '」標成記錯了',
                    stow: '收起「' + _clip(e.prev && e.prev.text, 40) + '」', unstow: '放回「' + _clip(e.prev && e.prev.text, 40) + '」', revert: '退回成「' + _clip(e.text, 40) + '」' }[e.verb] || e.verb;
                return esc(by + t);
            }
            case 'trait': {
                const t = { add: '長出樣子「' + _clip(e.text, 40) + '」', update: '樣子改成「' + _clip(e.text, 40) + '」', drop: '不再「' + _clip(e.prev && e.prev.text, 40) + '」',
                    remove: '拿掉了樣子「' + _clip(e.prev && e.prev.text, 40) + '」', revert: '樣子退回「' + _clip(e.text, 40) + '」' }[e.verb] || e.verb;
                return esc((e.by === 'rae' ? '你' : '它') + t);
            }
            case 'tidy': {
                const ch = e.changes || [];
                return esc('整理了一次：' + (ch.length ? '動了 ' + ch.length + ' 處' : '沒有要改的') + (e.reverted ? '（你退回了）' : ''));
            }
            case 'import': return esc('從舊版搬過來（' + (e.what === 'notes' ? '以前的記事' : '舊資料') + '）');
            case 'erase': return esc('你抹掉了 ' + ((e.ids || []).length) + ' 行');
            case 'rae': return esc('你：' + (e.text || ''));
            default: return esc(_clip(_srcText(e.id), 120));
        }
    }
    function _lifePage() {
        const list = S.all.slice().reverse();
        const shown = list.slice(0, S.evShown);
        let h = '<div class="xjm-life-head"><span class="xjm-count">' + S.all.length + ' 件事</span>'
            + (S.all.length ? '<button type="button" class="xjm-st-btn' + (S.ui.selecting ? ' is-on' : '') + '" data-act="select">' + (S.ui.selecting ? '不選了' : '選取') + '</button>' : '') + '</div>';
        if (!list.length) h += '<div class="xjm-empty"><i class="fa-solid fa-book"></i><span>還沒有經歷。它跟你聊的每一句、上的每一堂課，都會記在這裡。</span></div>';
        let lastDay = '';
        shown.forEach(e => {
            const d = _day(e.at);
            if (d !== lastDay) { h += '<div class="xjm-day">' + esc(d) + '</div>'; lastDay = d; }
            const can = S.ui.selecting && ERASABLE[e.kind] && e.state !== 'erased';
            const on = S.ui.sel.has(e.id);
            h += '<div class="xjm-ev' + (e.state !== 'ok' ? ' is-void' : '') + (on ? ' is-sel' : '') + '"' + (can ? ' data-act="pick" data-id="' + esc(e.id) + '"' : '') + '>'
                + (S.ui.selecting ? '<span class="xjm-check' + (can ? '' : ' is-na') + (on ? ' is-on' : '') + '"><i class="fa-solid fa-check"></i></span>' : '')
                + '<span class="xjm-ev-t">' + esc(_time(e.at)) + '</span>'
                + '<i class="xjm-ev-ic fa-solid ' + (EV_ICON[e.kind] || 'fa-circle') + '"></i>'
                + '<div class="xjm-ev-body">' + _evText(e) + (e.state === 'withdrawn' ? '<span class="xjm-chip is-off">不算數</span>' : '') + '</div></div>';
        });
        if (list.length > S.evShown) h += '<button type="button" class="xjm-add" data-act="more"><i class="fa-solid fa-angles-down"></i> 再往前</button>';
        h += '<div class="xjm-sec-head"><i class="fa-solid fa-clock-rotate-left"></i> 這一串更早的聊天</div>';
        if (!S.nodes.length) h += '<div class="xjm-empty is-soft"><span>這一串還沒有整理過的舊對話。聊得夠久，最舊的那些會整理成一節一節放在這裡。</span></div>';
        else h += S.nodes.map(n => {
            const armed = S.ui.armed === 's' + n.id;
            return '<div class="xjm-node"><div class="xjm-node-txt">' + esc(n.text) + '</div>'
                + '<div class="xjm-node-foot"><span>' + esc(_date(n.at)) + (n.combined ? '・併了 ' + n.combined + ' 節' : '') + '</span>'
                + '<button type="button" class="xjm-ic' + (armed ? ' is-armed' : '') + '" data-act="sdel" data-id="' + esc(n.id) + '" title="' + (armed ? '再按一次刪掉' : '刪掉這一節') + '">'
                + (armed ? '<span>刪掉？</span>' : '<i class="fa-solid fa-trash-can"></i>') + '</button></div></div>';
        }).join('');
        if (S.msg) h += '<div class="xjm-flash">' + esc(S.msg) + '</div>';
        return h;
    }
    // 經歷簿選了幾行：底下一條；按了抹掉先列出會受影響的
    function _renderBar() {
        const bar = S.body.querySelector('.xjm-bar');
        if (!bar) return;
        const on = S.tab === 'life' && S.ui.selecting;
        bar.hidden = !on;
        if (!on) { bar.innerHTML = ''; return; }
        const n = S.ui.sel.size;
        const ask = S.ui.eraseAsk;
        if (!ask) {
            bar.innerHTML = '<span class="xjm-bar-txt">選了 ' + n + ' 行</span>'
                + '<button type="button" class="xjm-btn is-danger" data-act="erase-ask"' + (n ? '' : ' disabled') + '><i class="fa-solid fa-eraser"></i> 抹掉這幾行</button>';
            return;
        }
        let h = '<div class="xjm-confirm"><div class="xjm-confirm-ttl">抹掉 ' + n + ' 行？抹掉的只剩「這裡被抹掉了」，救不回來。</div>';
        if (ask.mems.length || ask.traits.length) {
            h += '<div class="xjm-confirm-sub">這些是從那幾行來的，要不要一起收起／拿掉？（不勾就照留）</div>';
            ask.mems.forEach(m => { h += '<button type="button" class="xjm-confirm-row' + (ask.chkM.has(m.id) ? ' is-on' : '') + '" data-act="ask-m" data-id="' + esc(m.id) + '"><span class="xjm-check' + (ask.chkM.has(m.id) ? ' is-on' : '') + '"><i class="fa-solid fa-check"></i></span>記得的事：' + esc(_clip(m.text, 40)) + '</button>'; });
            ask.traits.forEach(t => { h += '<button type="button" class="xjm-confirm-row' + (ask.chkT.has(t.id) ? ' is-on' : '') + '" data-act="ask-t" data-id="' + esc(t.id) + '"><span class="xjm-check' + (ask.chkT.has(t.id) ? ' is-on' : '') + '"><i class="fa-solid fa-check"></i></span>樣子：' + esc(_clip(t.text, 40)) + '</button>'; });
        }
        h += '<div class="xjm-edit-acts"><button type="button" class="xjm-btn" data-act="erase-cancel">先不要</button>'
            + '<button type="button" class="xjm-btn is-danger" data-act="erase-go">抹掉</button></div></div>';
        bar.innerHTML = h;
    }

    // ── 按 ──────────────────────────────────────────────────
    let _armTimer = null;
    function _arm(key) {
        S.ui.armed = key;
        clearTimeout(_armTimer);
        _armTimer = setTimeout(() => { if (S && S.ui.armed === key) { S.ui.armed = null; _render(); } }, 3000);
    }
    function _resetUi() { S.ui.editing = null; S.ui.wrongFor = null; S.ui.adding = false; S.aboutEdit = false; S.ui.armed = null; }

    async function _onClick(e) {
        const tabBtn = e.target.closest('.xjm-tab');
        if (tabBtn && S) {
            S.tab = tabBtn.dataset.tab; _resetUi(); S.msg = ''; S.ui.selecting = false; S.ui.sel.clear(); S.ui.eraseAsk = null;
            try { localStorage.setItem(TAB_KEY, S.tab); } catch (_) {}
            _render();
            const sc = S.body.querySelector('.xjm-scroll'); if (sc) sc.scrollTop = 0;
            return;
        }
        const b = e.target.closest('[data-act]');
        if (!b || !S || S.busy) return;
        const act = b.dataset.act, id = b.dataset.id, M = _MEM(), X = _XJ();
        S.msg = ''; S.aboutMsg = '';
        // 只改畫面的
        if (act === 'src' || act === 'ver') { const set = act === 'src' ? S.ui.openSrc : S.ui.openVer; set.has(id) ? set.delete(id) : set.add(id); _render(); return; }
        if (act === 'edit') { _resetUi(); S.ui.editing = id; _render(); return; }
        if (act === 'wrong') { _resetUi(); S.ui.wrongFor = id; _render(); return; }
        if (act === 'add') { _resetUi(); S.ui.adding = true; _render(); return; }
        if (act === 'add-about') { S.ui.addAbout = b.dataset.about; const ta = S.body.querySelector('.xjm-note.is-new .xjm-input'); const keep = ta ? ta.value : ''; _render(); const ta2 = S.body.querySelector('.xjm-note.is-new .xjm-input'); if (ta2) ta2.value = keep; return; }
        if (act === 'about-edit') { _resetUi(); S.aboutEdit = true; _render(); return; }
        if (act === 'cancel') { _resetUi(); _render(); return; }
        if (act === 'tidy-show') { S.ui.showTidy = !S.ui.showTidy; _renderStatus(); return; }
        if (act === 'select') { S.ui.selecting = !S.ui.selecting; S.ui.sel.clear(); S.ui.eraseAsk = null; _render(); return; }
        if (act === 'pick') { S.ui.sel.has(id) ? S.ui.sel.delete(id) : S.ui.sel.add(id); S.ui.eraseAsk = null; _render(); return; }
        if (act === 'more') { S.evShown += EV_PAGE; _render(); return; }
        if (act === 'erase-ask') {
            const ids = S.ui.sel;
            const inside = x => (x.from || []).length && x.from.every(f => ids.has(f));
            S.ui.eraseAsk = { mems: S.mems.filter(m => m.state === 'ok' && inside(m)), traits: S.traits.filter(t => t.state === 'ok' && inside(t)), chkM: new Set(), chkT: new Set() };
            _renderBar(); return;
        }
        if (act === 'ask-m' || act === 'ask-t') { const set = act === 'ask-m' ? S.ui.eraseAsk.chkM : S.ui.eraseAsk.chkT; set.has(id) ? set.delete(id) : set.add(id); _renderBar(); return; }
        if (act === 'erase-cancel') { S.ui.eraseAsk = null; _renderBar(); return; }
        // 按兩次才做的
        if (act === 'stow' && S.ui.armed !== 'stow' + id) { _arm('stow' + id); _render(); return; }
        if (act === 'trait-remove' && S.ui.armed !== 'trait' + id) { _arm('trait' + id); _render(); return; }
        if (act === 'sdel' && S.ui.armed !== 's' + id) { _arm('s' + id); _render(); return; }
        if (act === 'tidy-revert' && S.ui.armed !== 'tidy') { _arm('tidy'); _renderStatus(); return; }
        if (act === 'export') { await _export(); return; }
        if (act === 'tidy-retry') {
            if (!X || !X.tidyNow) { S.msg = '要奧瑞亞更新到新版才能再試'; _render(); return; }
            S.busy = true; _renderStatus();
            try { const r = await X.tidyNow(S.rid); if (r && r.tidy && !r.tidy.ok) S.msg = '還是沒成功：' + (r.tidy.why || ''); }
            catch (err) { S.msg = '還是沒成功：' + ((err && err.message) || err); }
            S.busy = false;
            await _load();
            return;
        }
        S.ui.armed = null;
        S.busy = true;
        try {
            let r = { ok: true };
            const text = () => { const ta = S.body.querySelector('.is-edit .xjm-input'); return ta ? ta.value.trim() : ''; };
            if (act === 'save') r = await M.memDo(S.rid, 'update', { id, text: text(), by: 'rae' });
            else if (act === 'wrong-save') { const t = text(); r = t ? await M.memDo(S.rid, 'fix', { id, text: t, by: 'rae' }) : await M.memDo(S.rid, 'wrong', { id, by: 'rae' }); }
            else if (act === 'stow') r = await M.memDo(S.rid, 'stow', { id, by: 'rae' });
            else if (act === 'unstow') r = await M.memDo(S.rid, 'unstow', { id, by: 'rae' });
            else if (act === 'add-save') {
                const t = text();
                if (!t) r = { ok: false, why: '要寫內容' };
                else { const ev = await M.log(S.rid, { kind: 'rae', text: '幫它記了：' + t }); r = await M.memDo(S.rid, 'add', { about: S.ui.addAbout, text: t, from: [ev], by: 'rae' }); }
            } else if (act === 'trait-remove') r = await M.traitDo(S.rid, 'remove', { id, by: 'rae' });
            else if (act === 'tidy-revert') r = await M.revertTidy(S.rid, S.status && S.status.lastTidy && S.status.lastTidy.id);
            else if (act === 'sdel') { if (S.conv && M.sumRemove) await M.sumRemove(S.conv, id); }
            else if (act === 'about-save') {
                const ta = S.body.querySelector('.xjm-about.is-edit .xjm-input');
                await X.save(S.rid, { about: (ta ? ta.value : '').trim().slice(0, ABOUT_LEN) });
            } else if (act === 'erase-go') {
                const ask = S.ui.eraseAsk, ids = Array.from(S.ui.sel);
                await M.erase(S.rid, ids);
                for (const mid of (ask ? ask.chkM : [])) await M.memDo(S.rid, 'stow', { id: mid, by: 'rae' });
                for (const tid of (ask ? ask.chkT : [])) await M.traitDo(S.rid, 'remove', { id: tid, by: 'rae' });
                S.ui.sel.clear(); S.ui.eraseAsk = null; S.ui.selecting = false;
            }
            if (r && r.ok === false) {
                if (act === 'about-save') S.aboutMsg = r.why; else S.msg = '沒做成：' + r.why;
                S.busy = false; _render(); return;
            }
            _resetUi();
        } catch (err) {
            S.msg = '沒存成：' + ((err && err.message) || err);
        }
        S.busy = false;
        await _load();
    }

    async function _export() {
        const M = _MEM(), CT = _CT();
        S.busy = true;
        try {
            const convs = (CT && CT.xiaojiConvList) ? CT.xiaojiConvList(S.rid) : [];
            const data = await M.exportOne(S.rid, { resident: S.resident, convs });
            const d = new Date(), stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
            const name = '小機-' + S.name + '-' + stamp + '.json';
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            S.msg = '匯出好了：' + name + '（換電腦時，在宿舍大廳按「帶小機回來」選這個檔）';
        } catch (err) { S.msg = '沒匯出成：' + ((err && err.message) || err); }
        S.busy = false;
        _render();
    }

})(window.XiaojiMemory = window.XiaojiMemory || {});
