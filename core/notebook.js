/**
 * core/notebook.js — 紀錄（window.RoomNotebook）：記事本＋相簿＋找話
 * ------------------------------------------------------------------
 * 她 10-02：「紀錄感覺也能做成備忘錄? 就像微信的記事本那樣，還能做相簿，感覺紀錄可以做兩個TAB，
 *            一個可以查看我們之前發的媒體，可以搜尋? 不過我們這個一堆會話分層，會不會找不到消息紀錄?」
 * 10-03：「把想跟妳說的這個收進聊天室感覺更好一點?」「這其實算記事本吧?」
 *
 * 照 LINE 的記事本：一間聊天室一本，只有她跟那間的人看得到。丹的房間一本、阿洛的一本、群聊一本。
 *   記事本 —— 她從對話長按「收進記事本」的、她自己寫的、他寫給她的「想跟妳說的」（留言板上帶 proposal 的紙條，
 *             以前在留言板那個分頁，現在收在他房間這裡；底下照樣能回他）
 *   相簿   —— 這間每一串對話裡發過的照片（她傳的、他生的、他貼的電腦上的圖；表情包不算），點了能跳回那一則
 *   上面那格找字 —— 記事本與這間所有對話一起找；私聊每一串都在橋上（不分 Max／API），群聊只有這台裝置上那串
 * 資料：橋 /v1/notebook（她的）、/v1/room/media、/v1/room/search（私聊的對話）；群聊的對話在 ChatGroup。
 * 長按對話裡的一則 → 小窗「收進記事本｜複製」：委派綁在 #claude-chat-stream（私聊、群聊共用那一條），
 *   那則訊息是畫泡泡時掛在外框上的 _ccrMsg（chat_room／chat_group 掛的）。
 * ------------------------------------------------------------------
 */
(function (RoomNotebook) {
    'use strict';

    const ME = 'Rae';            // 回「想跟妳說的」時署的名（留言板同一個）
    const SEEN_KEY = 'ccr_nb_seen';   // { 名字: 看過的最新一則「想跟妳說的」的時間（板子的 created_at 字串） }
    const MEDIA_PAGE = 30;

    const A0 = window.AUI || (window.parent && window.parent.AUI);
    if (A0 && A0.registerHelp) A0.registerHelp({ room_notebook: { title: '紀錄',
        body: '這間聊天室的記事本，只有你跟他看得到；每個房間各一本，群聊也有一本。\n'
            + '長按對話裡的一則，選「收進記事本」，那一則就收進來，點開能跳回去那段對話。也可以按右下角自己寫一則、放照片。\n'
            + '他想跟你說的話也收在這裡，點開能直接回他。\n'
            + '相簿是這間每一串對話裡發過的照片，表情包不算。點一張按「引用」，會放回輸入框上面，送出時他就再看一次（換了新會話也一樣）。\n'
            + '最上面那格找字，會連同所有對話一起找；群聊只找得到這台裝置上的。' } });

    // ---------- 小工具 ----------
    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _CT() { return window.ClaudeTerminal || null; }
    function _CW() { return window.ChatWindow || null; }
    function _bridge() {
        const OS = window.OS_SETTINGS;
        const p = (OS && typeof OS.getActiveClaudePreset === 'function') ? OS.getActiveClaudePreset() : null;
        if (!p || !p.url || !p.key) return null;
        return { base: String(p.url).replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, ''), key: p.key };
    }
    async function _api(path, body) {
        const b = _bridge();
        if (!b) throw new Error('NO_BRIDGE');
        const r = await fetch(b.base + path, body ? {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + b.key, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        } : { headers: { 'Authorization': 'Bearer ' + b.key } });
        if (r.status === 404) throw new Error('OLD_BRIDGE');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }
    function _failText(e, what) {
        const m = e && e.message;
        if (m === 'OLD_BRIDGE') return '橋還是舊的那版，重開一次橋就有' + what + '了';
        if (m === 'NO_BRIDGE') return '要先在設置填好橋，才打得開' + what;
        return '連不上橋，' + what + '打不開';
    }
    /** 這個人的「想跟妳說的」看到哪一則。紀錄頁還沒開過他的：搬家前在留言板翻過的就算看過（ccr_board_seen） */
    function _seenOf(seen, name) {
        if (seen && seen[name]) return seen[name];
        try { return localStorage.getItem('ccr_board_seen') || ''; } catch (_) { return ''; }
    }
    function _lsGet(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (_) { return fb; } }
    function _lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

    /** 板子的時間是 UTC 的 'YYYY-MM-DD HH:MM:SS'；記事本與訊息是毫秒或秒 */
    function _ms(t) {
        if (t == null || t === '') return 0;
        if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
        const d = Date.parse(String(t).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? '' : 'Z'));
        return isNaN(d) ? 0 : d;
    }
    function _when(ms) {
        if (!ms) return '';
        const d = new Date(ms), now = new Date();
        const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
        const y = new Date(now); y.setDate(now.getDate() - 1);
        if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
        if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
        return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
    }
    function _month(ms) {
        const d = new Date(ms || 0);
        return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月';
    }
    /** 卡片與找字用的純文字：圖換成［圖］、連結留字、markdown 記號拿掉、標籤拿掉 */
    function _plain(s) {
        return String(s == null ? '' : s)
            .replace(/!\[[^\]\n]*\]\([^)]*\)/g, '［圖］')
            .replace(/\[([^\]\n]*)\]\([^)]*\)/g, '$1')
            .replace(/<\s*\/?\s*[A-Za-z_][\w:-]*(?:\s[^<>]*)?\/?\s*>/g, '')
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
            .replace(/[*_~`]+/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }
    function _mark(text, q) {
        const t = String(text || '');
        if (!q) return _esc(t);
        const lo = t.toLowerCase(), ql = q.toLowerCase();
        let out = '', at = 0, k;
        while ((k = lo.indexOf(ql, at)) >= 0) {
            out += _esc(t.slice(at, k)) + '<mark class="nb-hit">' + _esc(t.slice(k, k + q.length)) + '</mark>';
            at = k + q.length;
        }
        return out + _esc(t.slice(at));
    }
    function _richHtml(text, fromThem) {
        if (fromThem) {
            const R = window.VoidClaudeRoom;
            const h = (R && typeof R.markdownToSafeHtml === 'function') ? R.markdownToSafeHtml(String(text || '')) : null;
            if (h !== null && h !== undefined) return '<div class="nb-rich claude-bubble-md">' + h + '</div>';
        }
        return '<div class="nb-rich nb-plain">' + _esc(text) + '</div>';
    }

    // ---------- 這一本是誰的 ----------
    function _bookNow() {
        const CW = _CW(), CT = _CT();
        const provider = (CW && typeof CW.getProvider === 'function') ? CW.getProvider() : 'claude';
        if (provider === 'group') return { book: 'group', group: true, names: [], name: '群聊' };
        const r = (CT && typeof CT.getActiveResident === 'function') ? CT.getActiveResident(provider) : null;
        const rid = r ? r.id : ((CT && CT.getActiveResidentId) ? CT.getActiveResidentId() : '');
        const name = (r && r.name) || '';
        return { book: rid, rid: rid, name: name, names: name ? [name] : [], provider: provider, resident: r };
    }
    function _resident(id) {
        const CT = _CT();
        return (CT && typeof CT.getResident === 'function') ? CT.getResident(id) : null;
    }
    function _residentByName(name) {
        const CT = _CT();
        const list = (CT && typeof CT.listResidents === 'function') ? CT.listResidents() : [];
        return list.find(r => r && r.name === name) || null;
    }
    /** 誰說的 → 名字（她是「妳」）。私聊的 them 就是這間的主人；群聊的是住戶 id */
    function _whoName(who, bk) {
        if (!who || who === 'rae') return '妳';
        if (who === 'them') return (bk && bk.name) || '他';
        const r = _resident(who);
        return (r && r.name) || who;
    }
    function _avHtml(r, fallback) {
        const D = window.DormPanel;
        if (r && D && typeof D.faceHtml === 'function') {
            try { return '<span class="nb-av nb-av-face">' + D.faceHtml(r) + '</span>'; } catch (_) {}
        }
        return '<span class="nb-av nb-av-letter">' + _esc(Array.from(String(fallback || '?'))[0] || '?') + '</span>';
    }

    // ---------- 照片：縮圖直接用；電腦上的圖經橋拿；網址的直接用 ----------
    const _localUrls = new Map();
    function _photoSrcNow(p) { return (p && (p.thumb || p.url)) || ''; }
    function _localUrl(path) {
        if (!_localUrls.has(path)) {
            const CT = _CT();
            _localUrls.set(path, (CT && typeof CT.fetchLocalImage === 'function') ? CT.fetchLocalImage(path) : Promise.resolve(null));
        }
        return _localUrls.get(path);
    }
    /** 畫面上 img[data-nb-path] 換成經橋拿到的圖 */
    function _hydratePaths(root) {
        if (!root) return;
        root.querySelectorAll('img[data-nb-path]').forEach(im => {
            const path = im.getAttribute('data-nb-path');
            im.removeAttribute('data-nb-path');
            _localUrl(path).then(u => {
                if (u) { im.src = u; im.classList.remove('nb-img-wait'); }
                else im.classList.add('nb-img-gone');
            });
        });
    }
    function _imgTag(p, cls) {
        const now = _photoSrcNow(p);
        if (now) return '<img class="' + cls + '" src="' + _esc(now) + '" alt="" loading="lazy">';
        if (p && p.path) return '<img class="' + cls + ' nb-img-wait" data-nb-path="' + _esc(p.path) + '" alt="">';
        return '';
    }
    function _bigView(src) {
        const ov = document.createElement('div');
        ov.className = 'cg-img-overlay';
        const im = document.createElement('img');
        im.src = src;
        ov.appendChild(im);
        ov.addEventListener('click', () => ov.remove());
        document.body.appendChild(ov);
    }

    // ---------- 小提示（收好了、找不到那一則） ----------
    function _toast(text) {
        const win = document.getElementById('aurelia-chat-window');
        if (!win) return;
        const old = win.querySelector('.nb-toast');
        if (old) old.remove();
        const t = document.createElement('div');
        t.className = 'nb-toast';
        t.textContent = text;
        win.appendChild(t);
        setTimeout(() => t.classList.add('nb-toast-out'), 1800);
        setTimeout(() => t.remove(), 2300);
    }

    // =====================================================================
    // 面板
    // =====================================================================
    let S = null;   // { host, bk, tab, q, items, props, err, loading, media:{items,more,offset,loading,err}, page, qRes }

    RoomNotebook.launch = function (body) {
        S = {
            host: body, bk: _bookNow(), tab: 'note', q: '',
            items: null, props: [], err: '',
            media: null, page: null, qRes: null, qSeq: 0,
        };
        body.innerHTML = '<div class="nb-wrap">'
            + '<div class="nb-top">'
            +   '<label class="nb-find"><i class="fa-solid fa-magnifying-glass"></i><input type="search" class="nb-q" placeholder="找" enterkeyhint="search"></label>'
            +   '<div class="nb-tabrow"><nav class="nb-tabs">'
            +     '<button type="button" class="nb-tab is-on" data-tab="note">記事本</button>'
            +     '<button type="button" class="nb-tab" data-tab="album">相簿</button>'
            +   '</nav>' + ((A0 && A0.helpBtn) ? '<span class="nb-help">' + A0.helpBtn('room_notebook') + '</span>' : '') + '</div>'
            + '</div>'
            + '<div class="nb-scroll"></div>'
            + '<button type="button" class="nb-fab" title="寫一則"><i class="fa-solid fa-plus"></i></button>'
            + '<div class="nb-page" hidden></div>'
            + '</div>';
        _bindShell(body);
        _renderList();
        _loadNotes();
    };

    function _el(sel) { return S && S.host ? S.host.querySelector(sel) : null; }
    function _alive(s) { return S === s && s.host && s.host.isConnected; }

    function _bindShell(body) {
        const wrap = body.querySelector('.nb-wrap');
        wrap.querySelectorAll('.nb-tab').forEach(b => b.addEventListener('click', () => {
            if (S.tab === b.dataset.tab) return;
            S.tab = b.dataset.tab;
            wrap.querySelectorAll('.nb-tab').forEach(x => x.classList.toggle('is-on', x === b));
            _renderList();
            if (S.tab === 'album' && !S.media) _loadMedia();
        }));
        let t = null;
        const q = wrap.querySelector('.nb-q');
        q.addEventListener('input', () => {
            clearTimeout(t);
            t = setTimeout(() => { S.q = q.value.trim(); _runSearch(); }, 280);
        });
        q.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(t); S.q = q.value.trim(); _runSearch(); } });
        wrap.querySelector('.nb-fab').addEventListener('click', () => _openEditor(null));
        const sc = wrap.querySelector('.nb-scroll');
        sc.addEventListener('scroll', () => {
            if (S.tab !== 'album' || S.q || !S.media || !S.media.more || S.media.loading) return;
            if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 300) _loadMedia(true);
        });
        sc.addEventListener('click', _onListClick);
    }

    // ---------- 記事本：資料 ----------
    async function _loadNotes() {
        const s = S;
        s.err = '';
        try {
            const q = '/v1/notebook?book=' + encodeURIComponent(s.bk.book) + '&names=' + encodeURIComponent(s.bk.names.join(','));
            const d = await _api(q);
            if (!_alive(s)) return;
            s.items = Array.isArray(d.items) ? d.items : [];
            s.props = Array.isArray(d.proposals) ? d.proposals : [];
        } catch (e) {
            if (!_alive(s)) return;
            s.items = s.items || [];
            s.err = _failText(e, '記事本');
        }
        s.seenBefore = Object.assign({}, _lsGet(SEEN_KEY, {}));
        _markSeen(s.props);
        if (s.tab === 'note' && !s.q) _renderList();
        if (s.q) _runSearch();
    }
    function _markSeen(props) {
        if (!props || !props.length) return;
        const seen = _lsGet(SEEN_KEY, {});
        props.forEach(p => { if ((p.created_at || '') > (seen[p.author] || '')) seen[p.author] = p.created_at; });
        _lsSet(SEEN_KEY, seen);
        RoomNotebook.paintRoomDot(false);
        try {
            const lb = document.getElementById('ccr-launcher');
            if (lb) lb.classList.remove('ccr-news-prop');
        } catch (_) {}
    }

    /** 記事本那頁的一張張卡：新到舊，她的與他的混在一起排 */
    function _entries() {
        const out = [];
        (S.props || []).forEach(p => out.push({ type: 'prop', key: 'p' + p.id, at: _ms(p.created_at), p: p }));
        (S.items || []).forEach(it => out.push({ type: it.kind === 'saved' ? 'saved' : 'note', key: 'n' + it.id, at: (it.createdAt || 0) * 1000, it: it }));
        out.sort((a, b) => b.at - a.at);
        return out;
    }

    // ---------- 畫清單 ----------
    function _renderList() {
        const sc = _el('.nb-scroll');
        const fab = _el('.nb-fab');
        const tabs = _el('.nb-tabrow');
        if (!sc) return;
        if (tabs) tabs.hidden = !!S.q;
        if (fab) fab.hidden = !!S.q || S.tab !== 'note';
        if (S.q) { sc.innerHTML = _searchHtml(); _hydratePaths(sc); return; }
        if (S.tab === 'album') { sc.innerHTML = _albumHtml(); _hydratePaths(sc); return; }
        if (S.items === null) { sc.innerHTML = '<div class="nb-msg">打開記事本…</div>'; return; }
        const list = _entries();
        let h = S.err ? '<div class="nb-err">' + _esc(S.err) + '</div>' : '';
        if (!list.length) {
            h += '<div class="nb-empty"><i class="fa-regular fa-bookmark"></i>'
                + '<div class="nb-empty-t">還沒有東西</div>'
                + '<div class="nb-empty-s">長按對話裡的一則，就能收進來</div></div>';
        } else {
            h += '<div class="nb-cards">' + list.map(_cardHtml).join('') + '</div>';
        }
        sc.innerHTML = h;
        _hydratePaths(sc);
    }

    /** 卡片與找字結果上寫的：誰的、什麼時候（收進來的寫那句話說出口的時間） */
    function _entryLabel(e) {
        if (e.type === 'prop') return e.p.author + ' 想跟妳說的';
        if (e.type === 'note') return '妳寫的';
        const src = e.it.src || {};
        return (src.whoName || _whoName(src.who, S.bk)) + '說的';
    }
    /** 卡片與找字看的字：住戶寫的剝掉格式記號；她自己寫的、她說的原樣（「1. 小島咖啡」的 1. 不能被當清單吃掉） */
    function _entryText(e) {
        if (e.type === 'prop') return _plain(e.p.content);
        const mine = e.type === 'note' || (e.it.src && e.it.src.who === 'rae');
        return mine ? String(e.it.text || '').trim() : _plain(e.it.text);
    }
    function _entryAt(e) {
        return (e.type === 'saved' && e.it.src && e.it.src.ts) ? e.it.src.ts : e.at;
    }

    function _cardHtml(e) {
        if (e.type === 'prop') {
            const p = e.p;
            const fresh = (p.created_at || '') > _seenOf(S.seenBefore, p.author);
            const n = (p.reactions || []).filter(r => !r.like).length;
            return '<button type="button" class="nb-card nb-card-prop" data-k="' + e.key + '">'
                + '<div class="nb-card-head">' + _avHtml(_residentByName(p.author), p.author)
                + '<span class="nb-card-who">' + _esc(p.author) + '<em>想跟妳說的</em></span>'
                + (fresh ? '<span class="nb-new">新</span>' : '') + '</div>'
                + '<div class="nb-card-text">' + _esc(_plain(p.content)) + '</div>'
                + '<div class="nb-card-foot"><span>' + _esc(_when(e.at)) + '</span>'
                + (n ? '<span class="nb-card-n"><i class="fa-regular fa-comment"></i>' + n + '</span>' : '') + '</div>'
                + '</button>';
        }
        const it = e.it;
        const photos = it.photos || [];
        const pic = photos.length
            ? '<div class="nb-card-pic">' + _imgTag(photos[0], 'nb-card-img') + (photos.length > 1 ? '<span class="nb-card-more">+' + (photos.length - 1) + '</span>' : '') + '</div>'
            : '';
        let head;
        if (e.type === 'saved') {
            const src = it.src || {};
            const who = src.whoName || _whoName(src.who, S.bk);
            head = '<div class="nb-card-head nb-card-head-saved"><i class="fa-solid fa-bookmark"></i><span class="nb-card-who">' + _esc(who) + '說的</span></div>';
        } else {
            head = '<div class="nb-card-head nb-card-head-note"><i class="fa-solid fa-pen"></i><span class="nb-card-who">妳寫的</span></div>';
        }
        const text = _entryText(e);
        const at = _entryAt(e);
        return '<button type="button" class="nb-card nb-card-' + e.type + '" data-k="' + e.key + '">'
            + head + pic
            + (text ? '<div class="nb-card-text">' + _esc(text) + '</div>' : '')
            + '<div class="nb-card-foot"><span>' + _esc(_when(at)) + '</span></div>'
            + '</button>';
    }

    function _find(key) {
        if (!key) return null;
        if (key[0] === 'p') return { type: 'prop', p: (S.props || []).find(p => 'p' + p.id === key) };
        const it = (S.items || []).find(x => 'n' + x.id === key);
        return it ? { type: it.kind === 'saved' ? 'saved' : 'note', it: it } : null;
    }

    function _onListClick(ev) {
        const card = ev.target.closest('[data-k]');
        if (card) {
            const f = _find(card.dataset.k);
            if (!f) return;
            if (f.type === 'prop' && f.p) _openProp(f.p);
            else if (f.type === 'saved') _openSaved(f.it);
            else if (f.type === 'note') _openEditor(f.it);
            return;
        }
        const tile = ev.target.closest('[data-mi]');
        if (tile && S.media) { _openPhoto(S.media.items[Number(tile.dataset.mi)]); return; }
        const hit = ev.target.closest('[data-hit]');
        if (hit && S.qRes) { const h = S.qRes.hits[Number(hit.dataset.hit)]; if (h) _jump(h); return; }
        const more = ev.target.closest('.nb-more');
        if (more) { more.disabled = true; _loadMedia(true); }
    }

    // =====================================================================
    // 單頁（蓋在清單上，自己帶返回）
    // =====================================================================
    // 單頁借房間子面板那條標題列：標題換成這一頁的，「返回」退回紀錄（不另畫一條，免得兩個返回疊在一起）
    function _pageOpen(title, bodyHtml, footHtml) {
        const pg = _el('.nb-page');
        if (!pg) return null;
        pg.innerHTML = '<div class="nb-page-body">' + bodyHtml + '</div>'
            + (footHtml ? '<div class="nb-page-foot">' + footHtml + '</div>' : '');
        pg.hidden = false;
        S.onBack = null;
        const CW = _CW();
        if (CW && typeof CW.setSubPanelHead === 'function') {
            CW.setSubPanelHead(title, () => { if (!S || !S.onBack || S.onBack() !== false) _pageClose(); });
        }
        _hydratePaths(pg);
        pg.querySelectorAll('.nb-photo-big, .nb-gal-img').forEach(im => im.addEventListener('click', () => { if (im.src) _bigView(im.src); }));
        return pg;
    }
    function _pageClose() {
        const pg = _el('.nb-page');
        if (pg) { pg.hidden = true; pg.innerHTML = ''; }
        S.onBack = null;
        const CW = _CW();
        if (CW && typeof CW.setSubPanelHead === 'function') CW.setSubPanelHead('', null);
        _renderList();
    }
    function _armDelete(btn, run) {
        btn.addEventListener('click', () => {
            if (btn.dataset.armed === '1') { run(); return; }
            btn.dataset.armed = '1';
            btn.classList.add('is-armed');
            btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 再按一次刪掉';
            setTimeout(() => {
                if (!btn.isConnected) return;
                btn.dataset.armed = '';
                btn.classList.remove('is-armed');
                btn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 刪掉';
            }, 3500);
        });
    }
    function _galleryHtml(photos) {
        if (!photos || !photos.length) return '';
        return '<div class="nb-gal nb-gal-' + Math.min(photos.length, 3) + '">' + photos.map(p => _imgTag(p, 'nb-gal-img')).join('') + '</div>';
    }

    // ---------- 收進來的那則 ----------
    function _openSaved(it) {
        const src = it.src || {};
        const who = src.whoName || _whoName(src.who, S.bk);
        const fromThem = src.who && src.who !== 'rae';
        const r = src.who === 'rae' ? null : (src.who === 'them' ? S.bk.resident : _resident(src.who));
        const where = S.bk.group ? '群聊' : ('「' + (src.convTitle || '那一串') + '」');
        const body = '<div class="nb-meta">' + (src.who === 'rae' ? '<span class="nb-av nb-av-letter nb-av-me">妳</span>' : _avHtml(r, who))
            + '<div class="nb-meta-t"><div class="nb-meta-name">' + _esc(who) + '</div>'
            + '<div class="nb-meta-sub">' + _esc(_when(src.ts || it.createdAt * 1000)) + ' · ' + _esc(where) + '</div></div></div>'
            + _galleryHtml(it.photos)
            + (it.text ? _richHtml(it.text, fromThem) : '');
        const foot = '<button type="button" class="nb-btn nb-del"><i class="fa-solid fa-trash-can"></i> 刪掉</button>'
            + (src.ts || src.i != null ? '<button type="button" class="nb-btn nb-btn-main nb-go"><i class="fa-solid fa-arrow-turn-up"></i> 回到那段對話</button>' : '');
        const pg = _pageOpen('收進來的', body, foot);
        if (!pg) return;
        const go = pg.querySelector('.nb-go');
        if (go) go.addEventListener('click', () => _jump(src));
        _armDelete(pg.querySelector('.nb-del'), () => _deleteItem(it));
    }

    async function _deleteItem(it) {
        try {
            await _api('/v1/notebook/delete', { id: it.id });
            S.items = (S.items || []).filter(x => x.id !== it.id);
            _pageClose();
        } catch (e) {
            _toast(_failText(e, '記事本'));
        }
    }

    // ---------- 她自己寫的（新寫一則也是這頁） ----------
    function _openEditor(it) {
        const draft = { text: it ? it.text : '', photos: it ? (it.photos || []).slice() : [] };
        const foot = (it ? '<button type="button" class="nb-btn nb-del"><i class="fa-solid fa-trash-can"></i> 刪掉</button>' : '<span class="nb-grow"></span>')
            + '<button type="button" class="nb-btn nb-btn-main nb-done"><i class="fa-solid fa-check"></i> 存好</button>';
        const body = '<textarea class="nb-ed-text" placeholder="寫點什麼…" rows="6"></textarea>'
            + '<div class="nb-ed-photos"></div>'
            + '<input type="file" class="nb-ed-file" accept="image/*" multiple hidden>';
        const pg = _pageOpen(it ? '妳寫的' : '寫一則', body, foot);
        if (!pg) return;
        const ta = pg.querySelector('.nb-ed-text');
        ta.value = draft.text;
        const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 420) + 'px'; };
        ta.addEventListener('input', () => { draft.text = ta.value; fit(); });
        setTimeout(fit, 0);
        const box = pg.querySelector('.nb-ed-photos');
        const file = pg.querySelector('.nb-ed-file');
        const paint = () => {
            box.innerHTML = draft.photos.map((p, i) => '<div class="nb-ed-ph">' + _imgTag(p, 'nb-ed-img')
                + '<button type="button" class="nb-ed-x" data-x="' + i + '" title="拿掉"><i class="fa-solid fa-xmark"></i></button></div>').join('')
                + (draft.photos.length < 9 ? '<button type="button" class="nb-ed-add"><i class="fa-regular fa-image"></i><span>照片</span></button>' : '');
            _hydratePaths(box);
        };
        paint();
        box.addEventListener('click', ev => {
            const x = ev.target.closest('[data-x]');
            if (x) { draft.photos.splice(Number(x.dataset.x), 1); paint(); return; }
            if (ev.target.closest('.nb-ed-add')) file.click();
        });
        const addFiles = async (files) => {
            const imgs = Array.from(files || []).filter(f => f && f.type && f.type.indexOf('image/') === 0).slice(0, 9 - draft.photos.length);
            for (const f of imgs) {
                const t = await _thumb(f, 1080);
                if (t) draft.photos.push({ thumb: t });
            }
            paint();
        };
        file.addEventListener('change', () => { addFiles(file.files); file.value = ''; });
        ta.addEventListener('paste', ev => {
            const fs = Array.from((ev.clipboardData && ev.clipboardData.files) || []).filter(f => f.type && f.type.indexOf('image/') === 0);
            if (fs.length) { ev.preventDefault(); addFiles(fs); }
        });
        const dirty = () => draft.text !== (it ? it.text : '') || JSON.stringify(draft.photos) !== JSON.stringify(it ? (it.photos || []) : []);
        const save = async () => {
            if (!draft.text.trim() && !draft.photos.length) { _pageClose(); return; }
            if (!dirty()) { _pageClose(); return; }
            const done = pg.querySelector('.nb-done');
            if (done) done.disabled = true;
            try {
                const d = await _api('/v1/notebook/save', { book: S.bk.book, item: { id: it ? it.id : undefined, kind: 'note', text: draft.text, photos: draft.photos } });
                if (d && d.item) {
                    S.items = (S.items || []).filter(x => x.id !== d.item.id);
                    S.items.unshift(d.item);
                }
                _pageClose();
            } catch (e) {
                if (done) done.disabled = false;
                _toast(_failText(e, '記事本'));
            }
        };
        pg.querySelector('.nb-done').addEventListener('click', save);
        // 按返回＝寫好的照樣存（跟手機的備忘錄一樣，不會因為忘了按存好就不見）
        S.onBack = () => { save(); return false; };
        const del = pg.querySelector('.nb-del');
        if (del) _armDelete(del, () => _deleteItem(it));
        if (!it) setTimeout(() => { try { ta.focus({ preventScroll: true }); } catch (_) {} }, 60);
    }

    function _thumb(file, maxEdge) {
        return new Promise(resolve => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                let w = img.naturalWidth || 1, h = img.naturalHeight || 1;
                const k = Math.min(1, maxEdge / Math.max(w, h));
                w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
                try {
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    c.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve(c.toDataURL('image/jpeg', 0.85));
                } catch (_) { resolve(null); }
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        });
    }

    // ---------- 想跟妳說的 ----------
    function _openProp(p) {
        const r = _residentByName(p.author);
        const likes = (p.reactions || []).filter(x => x.like);
        const cmts = (p.reactions || []).filter(x => !x.like);
        const body = '<div class="nb-meta">' + _avHtml(r, p.author)
            + '<div class="nb-meta-t"><div class="nb-meta-name">' + _esc(p.author) + '</div>'
            + '<div class="nb-meta-sub">' + _esc(_when(_ms(p.created_at))) + ' · 想跟妳說的</div></div></div>'
            + _richHtml(p.content, true)
            + ((likes.length || cmts.length) ? '<div class="nb-social">'
                + (likes.length ? '<div class="nb-likes"><i class="fa-regular fa-heart"></i>' + likes.map(x => _esc(x.author === ME ? '妳' : x.author)).join('、') + '</div>' : '')
                + cmts.map(x => '<div class="nb-cmt"><b>' + _esc(x.author === ME ? '妳' : x.author) + (x.at ? ' 回 ' + _esc(x.at === ME ? '妳' : x.at) : '') + '</b>' + _esc(x.content) + '</div>').join('')
                + '</div>' : '');
        const foot = '<textarea class="nb-reply" rows="1" placeholder="回他…"></textarea>'
            + '<button type="button" class="nb-btn nb-btn-main nb-send" title="送出"><i class="fa-solid fa-paper-plane"></i></button>';
        const pg = _pageOpen('想跟妳說的', body, foot);
        if (!pg) return;
        pg.querySelector('.nb-page-foot').classList.add('nb-page-foot-reply');
        const ta = pg.querySelector('.nb-reply');
        const btn = pg.querySelector('.nb-send');
        ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
        btn.addEventListener('click', async () => {
            const text = ta.value.trim();
            if (!text) return;
            btn.disabled = true;
            try {
                await _api('/v1/board/post', { author: ME, content: text, tags: ['reaction', 'reply', 'to:' + p.id] });
                const d = await _api('/v1/notebook?book=' + encodeURIComponent(S.bk.book) + '&names=' + encodeURIComponent(S.bk.names.join(',')));
                S.props = Array.isArray(d.proposals) ? d.proposals : S.props;
                const again = S.props.find(x => x.id === p.id);
                if (again) _openProp(again);
            } catch (e) {
                btn.disabled = false;
                _toast(_failText(e, '回覆'));
            }
        });
    }

    // =====================================================================
    // 相簿
    // =====================================================================
    async function _loadMedia(more) {
        const s = S;
        if (!s.media) s.media = { items: [], more: false, offset: 0, loading: false, err: '' };
        const m = s.media;
        if (m.loading) return;
        m.loading = true;
        if (!more) _renderList();
        try {
            if (s.bk.group) {
                m.items = _groupMedia();
                m.more = false;
            } else {
                const d = await _api('/v1/room/media?rid=' + encodeURIComponent(s.bk.rid) + '&offset=' + m.offset + '&limit=' + MEDIA_PAGE);
                if (!_alive(s)) return;
                m.items = m.items.concat(Array.isArray(d.items) ? d.items : []);
                m.offset += MEDIA_PAGE;
                m.more = !!d.more;
            }
            m.err = '';
        } catch (e) {
            m.err = _failText(e, '相簿');
        }
        m.loading = false;
        if (_alive(s) && s.tab === 'album' && !s.q) {
            const sc = _el('.nb-scroll');
            const keep = sc ? sc.scrollTop : 0;
            _renderList();
            if (sc) sc.scrollTop = keep;
        }
    }

    /** 群聊的照片：記錄在這台裝置（ChatGroup），一樣新到舊 */
    function _groupMedia() {
        const G = window.ChatGroup;
        const tr = (G && typeof G.transcript === 'function') ? G.transcript() : [];
        const out = [];
        tr.forEach((m, i) => {
            if (!m || !Array.isArray(m.attachments)) return;
            m.attachments.forEach((a, k) => {
                if (!a || !a.thumb || (a.mime && a.mime.indexOf('image/') !== 0)) return;
                out.push({ conv: 'group', i: i, k: k, ts: m.ts || 0, who: m.speaker === 'rae' ? 'rae' : m.speaker, thumb: a.thumb });
            });
        });
        return out.reverse();
    }

    function _albumHtml() {
        const m = S.media;
        if (!m || (m.loading && !m.items.length)) return '<div class="nb-msg">翻相簿…</div>';
        if (m.err && !m.items.length) return '<div class="nb-msg">' + _esc(m.err) + '</div>';
        if (!m.items.length) {
            return '<div class="nb-empty"><i class="fa-regular fa-images"></i><div class="nb-empty-t">還沒有照片</div></div>';
        }
        let h = '', cur = '';
        m.items.forEach((x, i) => {
            const mon = _month(x.ts);
            if (mon !== cur) {
                if (cur) h += '</div>';
                h += '<div class="nb-mon">' + _esc(mon) + '</div><div class="nb-grid">';
                cur = mon;
            }
            h += '<button type="button" class="nb-tile" data-mi="' + i + '">' + _imgTag(x, 'nb-tile-img') + '</button>';
        });
        h += '</div>';
        if (m.more) h += '<button type="button" class="nb-more"' + (m.loading ? ' disabled' : '') + '>' + (m.loading ? '翻相簿…' : '再多看一些') + '</button>';
        return h;
    }

    function _openPhoto(x) {
        if (!x) return;
        const who = _whoName(x.who, S.bk);
        const where = S.bk.group ? '群聊' : ('「' + (x.convTitle || '那一串') + '」');
        const body = '<div class="nb-photo">' + _imgTag(x, 'nb-photo-big') + '</div>'
            + '<div class="nb-photo-cap">' + _esc(who) + ' · ' + _esc(_when(x.ts)) + ' · ' + _esc(where) + '</div>';
        const foot = '<button type="button" class="nb-btn nb-quote"><i class="fa-solid fa-quote-left"></i> 引用</button>'
            + '<button type="button" class="nb-btn nb-btn-main nb-go"><i class="fa-solid fa-arrow-turn-up"></i> 回到那段對話</button>';
        const pg = _pageOpen('照片', body, foot);
        if (!pg) return;
        pg.querySelector('.nb-go').addEventListener('click', () => _jump(x));
        pg.querySelector('.nb-quote').addEventListener('click', ev => _quote(x, ev.currentTarget));
    }

    /** 引用（10-03 她：「用戶可以在相簿引用當初的圖片…真的需要再討論的時候再去拿回來就好」）：
     *  把這張圖放回現在這間的輸入框上面，跟她剛貼上的一樣，送出時他就重新看得到（換了新會話也一樣）。
     *  一律重新傳一份：電腦上的原圖經橋拿（原尺寸），只剩縮圖的就傳縮圖；傳的路跟她平常附圖同一條。 */
    async function _quote(x, btn) {
        if (btn) btn.disabled = true;
        let blob = null;
        try {
            if (x.path) {
                const u = await _localUrl(x.path);
                if (u) blob = await (await fetch(u)).blob();
            }
            if (!blob && (x.thumb || x.url)) blob = await (await fetch(x.thumb || x.url)).blob();
        } catch (_) { blob = null; }
        if (!blob || !blob.size) {
            if (btn) btn.disabled = false;
            _toast('這張拿不到，沒辦法引用');
            return;
        }
        const type = blob.type && blob.type.indexOf('image/') === 0 ? blob.type : 'image/jpeg';
        const ext = (type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const d = new Date(x.ts || Date.now());
        const file = new File([blob], '引用 ' + (d.getMonth() + 1) + '-' + d.getDate() + '.' + ext, { type: type });
        const bk = S ? S.bk : _bookNow();
        const CW = _CW();
        if (CW) CW.closeSubPanel();
        const G = window.ChatGroup, R = window.VoidClaudeRoom;
        if (bk.group) { if (G && typeof G.handleFilePick === 'function') G.handleFilePick([file]); }
        else if (R && typeof R.handleFilePick === 'function') R.handleFilePick([file]);
        _toast('放好了，送出時他就看得到');
    }

    // =====================================================================
    // 找字：記事本＋這間所有對話
    // =====================================================================
    async function _runSearch() {
        const s = S;
        const seq = ++s.qSeq;
        if (!s.q) { s.qRes = null; _renderList(); return; }
        s.qRes = { q: s.q, hits: [], loading: !s.bk.group, err: '' };
        if (s.bk.group) s.qRes.hits = _groupSearch(s.q);
        _renderList();
        if (s.bk.group) return;
        try {
            const d = await _api('/v1/room/search?rid=' + encodeURIComponent(s.bk.rid) + '&q=' + encodeURIComponent(s.q));
            if (!_alive(s) || seq !== s.qSeq) return;
            s.qRes.hits = Array.isArray(d.hits) ? d.hits : [];
            s.qRes.total = d.total || s.qRes.hits.length;
        } catch (e) {
            if (!_alive(s) || seq !== s.qSeq) return;
            s.qRes.err = _failText(e, '找字');
        }
        s.qRes.loading = false;
        _renderList();
    }

    function _groupSearch(q) {
        const G = window.ChatGroup;
        const tr = (G && typeof G.transcript === 'function') ? G.transcript() : [];
        const ql = q.toLowerCase();
        const out = [];
        tr.forEach((m, i) => {
            if (!m || m.speaker === 'sys' || m.speaker === 'recap' || typeof m.content !== 'string') return;
            if (m.speaker === 'rae' && m.content.indexOf('（系統）') === 0) return;
            const plain = _plain(m.content).replace(/\s+/g, ' ');
            const at = plain.toLowerCase().indexOf(ql);
            if (at < 0) return;
            const a = Math.max(0, at - 30), b = Math.min(plain.length, at + q.length + 60);
            out.push({ conv: 'group', i: i, ts: m.ts || 0, who: m.speaker === 'rae' ? 'rae' : m.speaker,
                text: (a ? '…' : '') + plain.slice(a, b) + (b < plain.length ? '…' : '') });
        });
        return out.reverse().slice(0, 80);
    }

    function _searchHtml() {
        const q = S.q, ql = q.toLowerCase();
        const notes = _entries().filter(e => _entryText(e).toLowerCase().indexOf(ql) >= 0);
        const r = S.qRes || { hits: [] };
        let h = '';
        if (notes.length) {
            h += '<div class="nb-sec">記事本</div><div class="nb-rows">' + notes.map(e => {
                const t = _entryText(e).replace(/\s+/g, ' ');
                const at = t.toLowerCase().indexOf(ql);
                const a = Math.max(0, at - 20);
                const snip = (a ? '…' : '') + t.slice(a, at + q.length + 50);
                return '<button type="button" class="nb-row" data-k="' + e.key + '"><div class="nb-row-top"><span class="nb-row-who">' + _esc(_entryLabel(e)) + '</span>'
                    + '<span class="nb-row-when">' + _esc(_when(_entryAt(e))) + '</span></div><div class="nb-row-text">' + _mark(snip, q) + '</div></button>';
            }).join('') + '</div>';
        }
        h += '<div class="nb-sec">對話' + (r.total > r.hits.length ? '<span>（最近 ' + r.hits.length + ' 則）</span>' : '') + '</div>';
        if (r.loading) h += '<div class="nb-msg nb-msg-s">找…</div>';
        else if (r.err) h += '<div class="nb-msg nb-msg-s">' + _esc(r.err) + '</div>';
        else if (!r.hits.length) h += '<div class="nb-msg nb-msg-s">對話裡沒有「' + _esc(q) + '」</div>';
        else {
            h += '<div class="nb-rows">' + r.hits.map((x, i) => {
                const where = S.bk.group ? '' : ' · ' + (x.convTitle || '');
                return '<button type="button" class="nb-row" data-hit="' + i + '"><div class="nb-row-top"><span class="nb-row-who">' + _esc(_whoName(x.who, S.bk)) + '</span>'
                    + '<span class="nb-row-when">' + _esc(_when(x.ts) + where) + '</span></div><div class="nb-row-text">' + _mark(x.text, q) + '</div></button>';
            }).join('') + '</div>';
        }
        return h;
    }

    // =====================================================================
    // 跳回那一則
    // =====================================================================
    async function _jump(t) {
        const CW = _CW(), CT = _CT();
        if (!t || !CW) return;
        const bk = S ? S.bk : _bookNow();
        if (bk.group) {
            CW.closeSubPanel();
            const G = window.ChatGroup;
            _scrollTo((G && typeof G.transcript === 'function') ? G.transcript() : [], t);
            return;
        }
        if (t.conv && CT) {
            const curTab = CT.getActiveTab();
            const cur = CT.getActiveConvId(curTab);
            if (t.conv !== cur || (t.tab && t.tab !== curTab)) {
                let ok = false;
                try { ok = typeof CT.gotoConv === 'function' && await CT.gotoConv(t.tab || curTab, t.conv); } catch (_) {}
                if (!ok) { _toast('那一串已經不在了'); return; }
                if (typeof CW.reloadRoom === 'function') await CW.reloadRoom();
            }
        }
        CW.closeSubPanel();
        const R = window.VoidClaudeRoom;
        _scrollTo((R && typeof R.getHistory === 'function') ? R.getHistory() : [], t);
    }

    function _scrollTo(hist, t) {
        hist = hist || [];
        let m = (t.i != null && hist[t.i] && (!t.ts || hist[t.i].ts === t.ts)) ? hist[t.i] : null;
        if (!m && t.ts) m = hist.find(x => x && x.ts === t.ts) || null;
        const stream = document.getElementById('claude-chat-stream');
        const wrap = (m && stream) ? Array.from(stream.children).find(w => w._ccrMsg === m) : null;
        if (!wrap) { _toast('那一則已經不在了'); return; }
        // 手機上房間圖蓋在聊天上面：先收成小橫幅，捲簾收完再對準（不然那一則會停在房間圖底下）
        const body = document.querySelector('#aurelia-chat-window #cw-body');
        const was = !!(body && body.classList.contains('cw-room-collapsed'));
        const CW = _CW();
        if (CW && typeof CW.setRoomCollapsed === 'function') CW.setRoomCollapsed(true);
        const moved = !was && !!(body && body.classList.contains('cw-room-collapsed'));
        // 用 setTimeout 不用 rAF：視窗在背景時 rAF 不會跑
        setTimeout(() => {
            const area = document.querySelector('#aurelia-chat-window .claude-portrait-area');
            const sr = stream.getBoundingClientRect();
            const ar = area ? area.getBoundingClientRect() : null;
            const top = (ar && ar.height && ar.bottom > sr.top && ar.bottom < sr.bottom) ? ar.bottom : sr.top;
            const room = sr.bottom - top;
            const wr = wrap.getBoundingClientRect();
            stream.scrollTop += (wr.top - top) - Math.max(8, (room - wr.height) / 2);
            wrap.classList.remove('nb-flash');
            void wrap.offsetWidth;
            wrap.classList.add('nb-flash');
            setTimeout(() => wrap.classList.remove('nb-flash'), 2400);
        }, moved ? 420 : 40);
    }

    // =====================================================================
    // 長按對話裡的一則 → 收進記事本｜複製
    // =====================================================================
    const LP_MS = 480;
    let _lp = null;          // { t, x, y, wrap }
    let _lpAt = 0;           // 小窗打開的時間：放開手指那一下補的 click 要吃掉
    let _menu = null;

    function _msgOf(target) {
        const wrap = target && target.closest && target.closest('.claude-bubble-wrap, .cg-bubble-wrap');
        return (wrap && wrap._ccrMsg) ? wrap : null;
    }

    RoomNotebook.bind = function (winEl) {
        const stream = winEl && winEl.querySelector('#claude-chat-stream');
        if (!stream || stream._nbBound) return;
        stream._nbBound = true;
        stream.addEventListener('pointerdown', ev => {
            if (ev.button !== 0) return;
            // 語音那顆播放鍵可以長按（收藏語音）；其他按鈕照舊不算
            const vrow = ev.target.closest('.claude-voice-row');
            if (!vrow && ev.target.closest('button, a, input, textarea, select, iframe, audio, .claude-tool-summary, .claude-thinking')) return;
            const wrap = _msgOf(ev.target);
            if (!wrap) return;
            const voice = vrow ? vrow.closest('.claude-voice') : null;
            clearTimeout(_lp && _lp.t);
            _lp = { x: ev.clientX, y: ev.clientY, wrap: wrap, t: setTimeout(() => { _lp = null; _openMenu(wrap, voice); }, LP_MS) };
        });
        const cancel = () => { if (_lp) { clearTimeout(_lp.t); _lp = null; } };
        stream.addEventListener('pointermove', ev => {
            if (_lp && (Math.abs(ev.clientX - _lp.x) > 8 || Math.abs(ev.clientY - _lp.y) > 8)) cancel();
        });
        stream.addEventListener('pointerup', cancel);
        stream.addEventListener('pointercancel', cancel);
        stream.addEventListener('scroll', () => { cancel(); _closeMenu(); }, { passive: true });
        stream.addEventListener('contextmenu', ev => {
            const wrap = _msgOf(ev.target);
            if (!wrap || ev.target.closest('a, input, textarea')) return;
            ev.preventDefault();
            cancel();
            _openMenu(wrap, ev.target.closest('.claude-voice'));
        });
        // 長按放開那一下會補一個 click（點到圖會放大、點到語音會播）：小窗剛開的 700ms 內吃掉
        stream.addEventListener('click', ev => {
            if (Date.now() - _lpAt < 700) { ev.stopPropagation(); ev.preventDefault(); }
        }, true);
    };

    function _closeMenu() {
        if (_menu) { _menu.remove(); _menu = null; }
    }

    function _openMenu(wrap, voice) {
        _closeMenu();
        const msg = wrap._ccrMsg;
        const win = document.getElementById('aurelia-chat-window');
        if (!msg || !win) return;
        _lpAt = Date.now();
        const text = _msgText(msg);
        // ⭐ 按在他的語音上：收藏語音（存下聲音，之後重播不用再合成）；收過的變成取消收藏
        const RC = window.RoomCollection;
        const fav = (voice && RC && typeof RC.voiceState === 'function') ? RC.voiceState(voice) : null;   // null＝這顆不能收
        const m = document.createElement('div');
        m.className = 'nb-menu';
        m.innerHTML = (fav ? '<button type="button" data-act="fav"><i class="fa-' + (fav === 'kept' ? 'solid' : 'regular') + ' fa-star"></i><span>'
                + (fav === 'kept' ? '取消收藏' : '收藏語音') + '</span></button>' : '')
            + '<button type="button" data-act="keep"><i class="fa-regular fa-bookmark"></i><span>收進記事本</span></button>'
            + (text ? '<button type="button" data-act="copy"><i class="fa-regular fa-copy"></i><span>複製</span></button>' : '');
        win.appendChild(m);
        const wr = win.getBoundingClientRect();
        const bubble = voice || wrap.querySelector('.claude-bubble, .cg-bubble') || wrap;
        const br = bubble.getBoundingClientRect();
        const mw = m.offsetWidth, mh = m.offsetHeight;
        let left = br.left + br.width / 2 - mw / 2 - wr.left;
        left = Math.max(8, Math.min(left, wr.width - mw - 8));
        let top = br.top - wr.top - mh - 8;
        if (top < 44) { top = br.bottom - wr.top + 8; m.classList.add('nb-menu-below'); }
        m.style.left = left + 'px';
        m.style.top = top + 'px';
        _menu = m;
        wrap.classList.add('nb-picked');
        m.addEventListener('click', async ev => {
            const b = ev.target.closest('[data-act]');
            if (!b) return;
            _closeMenu();
            wrap.classList.remove('nb-picked');
            if (b.dataset.act === 'copy') _copy(text);
            else if (b.dataset.act === 'fav') _toast(await RC.voiceToggle(voice));
            else await _keep(msg);
        });
        const off = () => { wrap.classList.remove('nb-picked'); };
        setTimeout(() => document.addEventListener('pointerdown', function h(ev) {
            if (_menu && _menu.contains(ev.target)) return;
            document.removeEventListener('pointerdown', h, true);
            off();
            _closeMenu();
        }, true), 0);
    }

    /** 那則的字：留言板標籤剝掉；她說的語音拿掉「（語音）」開頭 */
    function _msgText(msg) {
        let t = String((msg && msg.content) || '');
        const mine = msg.role === 'user' || msg.speaker === 'rae';
        if (!mine) {
            const CT = _CT();
            if (CT && typeof CT.stripBoardTags === 'function') t = CT.stripBoardTags(t) || '';
        } else {
            t = t.replace(/^（語音）\s*/, '');
        }
        return t.trim();
    }

    function _copy(text) {
        const fallback = () => {
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.className = 'nb-copy-tmp';
                document.body.appendChild(ta);
                ta.select();
                const ok = document.execCommand('copy');
                ta.remove();
                _toast(ok ? '複製好了' : '這裡不讓複製');
            } catch (_) { _toast('這裡不讓複製'); }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => _toast('複製好了'), fallback);
        else fallback();
    }

    async function _keep(msg) {
        const bk = _bookNow();
        const CT = _CT();
        const photos = (Array.isArray(msg.attachments) ? msg.attachments : [])
            .filter(a => a && (!a.mime || a.mime.indexOf('image/') === 0) && (a.thumb || (a.path && a.mime)))
            .map(a => a.thumb ? { thumb: a.thumb } : { path: a.path });
        const text = _msgText(msg);
        if (!text && !photos.length) { _toast('這一則沒有能收的東西'); return; }
        let src;
        if (bk.group) {
            const G = window.ChatGroup;
            const tr = (G && typeof G.transcript === 'function') ? G.transcript() : [];
            const who = msg.speaker === 'rae' ? 'rae' : msg.speaker;
            src = { conv: 'group', i: tr.indexOf(msg), ts: msg.ts || 0, who: who, whoName: _whoName(who, bk) };
        } else {
            const R = window.VoidClaudeRoom;
            const hist = (R && typeof R.getHistory === 'function') ? R.getHistory() : [];
            const tab = CT ? CT.getActiveTab() : '';
            const conv = CT ? CT.getActiveConvId(tab) : '';
            const found = (CT && conv) ? CT.findConv(conv) : null;
            const who = msg.role === 'user' ? 'rae' : 'them';
            src = { conv: conv || '', tab: tab, i: hist.indexOf(msg), ts: msg.ts || 0, who: who, whoName: _whoName(who, bk),
                    convTitle: (found && found.meta && found.meta.title) || '' };
        }
        if (src.i < 0) delete src.i;
        try {
            await _api('/v1/notebook/save', { book: bk.book, item: { kind: 'saved', text: text, photos: photos, src: src } });
            _toast('收進記事本了');
        } catch (e) {
            _toast(e && e.message === 'OLD_BRIDGE' ? '橋還是舊的那版，重開一次橋才收得進來' : '連不上橋，這則沒收進去');
        }
    }

    // =====================================================================
    // 有新的「想跟妳說的」：房間裡紀錄那顆、宿舍門卡上點一顆
    // =====================================================================
    // 宿舍一打開會連畫好幾次（先畫、拉完心跳再畫），同一組名字 20 秒內只問一次
    let _peekMemo = { key: '', at: 0, p: null };
    function _peek(names) {
        if (!names.length) return Promise.resolve({});
        const key = names.join(',');
        if (_peekMemo.key === key && Date.now() - _peekMemo.at < 20000 && _peekMemo.p) return _peekMemo.p;
        const p = _api('/v1/notebook?peek=1&names=' + encodeURIComponent(key))
            .then(d => (d && d.latest) || {}, () => ({}));
        _peekMemo = { key: key, at: Date.now(), p: p };
        return p;
    }
    function _isNew(latest, name) {
        return !!(latest[name] && latest[name] > _seenOf(_lsGet(SEEN_KEY, {}), name));
    }

    /** 進房間時問一次：這位有沒有沒看過的「想跟妳說的」 */
    RoomNotebook.peekRoom = async function () {
        const bk = _bookNow();
        if (bk.group || !bk.name) { RoomNotebook.paintRoomDot(false); return; }
        const latest = await _peek([bk.name]);
        if (_bookNow().book !== bk.book) return;
        RoomNotebook.paintRoomDot(_isNew(latest, bk.name));
    };
    RoomNotebook.paintRoomDot = function (on) {
        const b = document.querySelector('#aurelia-chat-window .cw-tool-btn[data-panel="notebook"]');
        if (b) b.classList.toggle('nb-has-new', !!on);
    };

    /** 宿舍畫好之後：誰有沒看過的，門卡上點一顆 */
    RoomNotebook.markDoors = async function (container) {
        const CT = _CT();
        if (!container || !CT || typeof CT.listResidents !== 'function') return;
        const list = CT.listResidents().filter(r => r && r.name && r.provider !== 'group');
        const latest = await _peek(list.map(r => r.name));
        list.forEach(r => {
            const card = container.querySelector('.dorm-card[data-id="' + String(r.id).replace(/"/g, '') + '"]');
            if (card) card.classList.toggle('nb-door-new', _isNew(latest, r.name));
        });
    };

    console.log('✅ RoomNotebook（紀錄：記事本＋相簿）模組就緒');
})(window.RoomNotebook = window.RoomNotebook || {});
