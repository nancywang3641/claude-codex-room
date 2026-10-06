/**
 * core/collection.js — 收藏（window.RoomCollection，子面板 collection）
 * ------------------------------------------------------------------
 * 10-06 她：「技能小劇場可以先做進收藏室」。
 * 入口是房間圖右下、羽毛筆左邊那顆星（chat_window.js 的 #cw-room-fav）。
 * 現在一區：小劇場——小機學會一門課、看過的那一場（存在奧瑞亞 OS_XIAOJI 那門課底下 rec.skills[id].theater），
 * 一場一張票，點了照原本那份重播（OS_XIAOJI.replay），不叫模型。新的在上面。
 * 學會了還沒看的不放票：底下一行「還有幾門」＋去培養室（第一次看會叫模型，那顆鈕留在結業頁）。
 * 之後語音（長按收藏）也放這頁，一區一種。這裡不存任何東西。
 * ------------------------------------------------------------------
 */
(function (RoomCollection) {
    'use strict';

    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    function _g(k) { const w = window.parent || window; return w[k] || window[k] || null; }
    const _X = () => _g('OS_XIAOJI'), _L = () => _g('OS_XIAOJI_LESSONS');
    const pad = n => String(n).padStart(2, '0');
    function _date(ms) { if (!ms) return ''; const d = new Date(ms); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()); }
    // 老師的臉：大廳那套立繪（同培養室）
    function _portrait(key) {
        const N = _g('LobbyNpcs');
        try {
            const t = !N ? null : (key === 'dan' ? (N.snResident && N.snResident('dan')) : (N.staff && N.staff(key)));
            return (t && t.portrait) || '';
        } catch (_) { return ''; }
    }

    const A0 = _g('AUI');
    if (A0 && A0.registerHelp) A0.registerHelp({ room_collection: { title: '收藏',
        body: '小劇場：它在培養室學會一門課、看過的那一場，會收在這裡。點一張就重看，不會叫模型。\n'
            + '學會了還沒看的，到培養室那門課看（第一次看會叫 1 次模型），看完就會收進來。' } });

    /** 只有小機（小劇場只有小機有） */
    RoomCollection.can = function (provider) { return provider === 'xiaoji' && !!_X(); };

    RoomCollection.launch = async function (body) {
        const CT = window.ClaudeTerminal, X = _X(), L = _L();
        const r = (CT && CT.getActiveResident) ? CT.getActiveResident('xiaoji') : null;
        if (!X || !L || !r || !r.id) { body.innerHTML = '<div class="cw-sub-missing">收藏要在奧瑞亞裡才看得到</div>'; return; }
        body.innerHTML = '<div class="rcol-wrap"><div class="rcol-msg"><i class="fa-solid fa-spinner fa-spin"></i></div></div>';
        let rec = null;
        try { rec = await X.get(r.id); } catch (e) { console.warn('[RoomCollection] 讀不到小機', e); }
        if (!body.isConnected) return;
        const skills = (rec && rec.skills) || {};
        const tix = [], unseen = [];
        for (const sk of (L.SKILLS || [])) {
            const ent = skills[sk.id];
            if (!ent) continue;   // 沒學會
            if (ent.theater && ent.theater.content) tix.push({ sk, t: ent.theater });
            else unseen.push(sk);
        }
        tix.sort((a, b) => (b.t.at || 0) - (a.t.at || 0));
        const canWatch = !!(rec && rec.theater);   // 門卡關了小劇場：沒看過的也看不了，不叫她去
        _render(body, r.id, tix, canWatch ? unseen.length : 0);
    };

    function _render(body, rid, tix, unseenN) {
        const L = _L(), A = _g('AUI');
        const help = (A && A.helpBtn) ? A.helpBtn('room_collection') : '';
        const go = '<button type="button" class="rcol-go"><i class="fa-solid fa-chalkboard-user"></i> 去培養室</button>';
        let inner;
        if (!tix.length) {
            inner = '<div class="rcol-empty"><i class="fa-solid fa-masks-theater"></i>'
                + '<div class="rcol-empty-ttl">還沒有收藏</div>'
                + '<div class="rcol-soft">它在培養室學會一門課、看過那場小劇場，就會收在這裡。</div>'
                + (unseenN ? go : '') + '</div>';
        } else {
            inner = tix.map(({ sk, t }) => {
                const T = (L.TEACHERS || {})[sk.teacher] || {};
                const face = _portrait(sk.teacher);
                return '<button type="button" class="rcol-tix" data-sid="' + esc(sk.id) + '">'
                    + '<span class="rcol-face">' + (face ? '<img src="' + esc(face) + '" alt="">' : '<i class="fa-solid fa-user"></i>') + '</span>'
                    + '<span class="rcol-txt"><span class="rcol-ttl">' + esc(t.title || (sk.label + '的小劇場')) + '</span>'
                    + '<span class="rcol-sub">' + esc((T.name ? T.name + '的課：' : '') + sk.label) + (T.place ? '<span class="rcol-dot">·</span>' + esc(T.place) : '') + '</span></span>'
                    + '<span class="rcol-end"><span class="rcol-date">' + esc(_date(t.at)) + '</span><i class="fa-solid fa-play"></i></span>'
                    + '</button>';
            }).join('')
                + (unseenN ? '<div class="rcol-more"><span>還有 ' + unseenN + ' 門學會了，小劇場還沒看</span>' + go + '</div>' : '')
                + '<div class="rcol-hint"></div>';
        }
        body.innerHTML = '<div class="rcol-wrap">'
            + '<div class="rcol-top"><span class="rcol-sec"><i class="fa-solid fa-masks-theater"></i> 小劇場'
            + (tix.length ? '<span class="rcol-n">' + tix.length + '</span>' : '') + '</span>' + help + '</div>'
            + '<div class="rcol-scroll">' + inner + '</div></div>';

        // 全身立繪跟丹那張半身比例不一樣：載完看比例掛 is-half（同培養室 _sizeWho）
        body.querySelectorAll('.rcol-face img').forEach(img => {
            const fit = () => { const r = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0; if (r) img.classList.toggle('is-half', r < 1.7); };
            if (img.complete) fit();
            img.addEventListener('load', fit);
        });
        body.querySelectorAll('.rcol-go').forEach(b => b.addEventListener('click', () => {
            const CW = window.ChatWindow;
            if (CW && CW.openSubPanel) CW.openSubPanel('xiaoji_train');
        }));
        const hint = body.querySelector('.rcol-hint');
        body.querySelectorAll('.rcol-tix').forEach(b => b.addEventListener('click', async () => {
            if (body.querySelector('.rcol-tix.is-busy')) return;
            b.classList.add('is-busy');
            if (hint) hint.textContent = '';
            let ok = false;
            try { ok = await _X().replay(rid, b.dataset.sid); } catch (e) { console.warn('[RoomCollection] 重播失敗', e); }
            b.classList.remove('is-busy');
            // 小劇場在 VN 播放器播：把窗收起來，不然擋在播放器前面（同培養室結業頁）
            if (ok) { if (window.ChatWindow && ChatWindow.close) ChatWindow.close(); return; }
            if (hint) hint.textContent = '播不出來，等一下再試';
        }));
    }
})(window.RoomCollection = window.RoomCollection || {});
