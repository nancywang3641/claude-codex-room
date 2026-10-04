/**
 * core/xiaoji_memory.js — 小機「它記得的事」（window.XiaojiMemory，子面板 xiaoji_memory）
 * ------------------------------------------------------------------
 * 10-05 她：「重要的事＞＞自己記，聊天紀錄可以學微信」。小機在聊天裡自己記下她的事（奧瑞亞 OS_XIAOJI 的 rec.notes），
 * 舊聊天每 30 則整理成一節（OS_XIAOJI.sumGet，一串會話一份）。這個面板給她看、幫它改：
 *   上面一張橫線紙，一行一條它記得的事：點筆改字、點垃圾桶刪（再按一次才刪），最底下「幫它記一條」；
 *   下面「更早的聊天」：這一串整理過的那幾節，只給看、能刪一節（刪了就真的忘了，不會重寫）。
 *   最上面「它是什麼樣的」：領養時她寫的那段（rec.about，每一句都帶給它），以前寫了就改不到（10-05 她：「羽毛筆面板加一格可以改介紹好了」）。
 * 入口是小機房間圖右下、衣櫃旁邊那顆（chat_window.js 的 #cw-room-memo，只有小機）。
 * 資料都在奧瑞亞那邊：noteAct／sumRemove／save 改完重畫，不在這裡存任何東西。
 * ------------------------------------------------------------------
 */
(function (XiaojiMemory) {
    'use strict';

    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    function _XJ() { return window.OS_XIAOJI || (window.parent && window.parent.OS_XIAOJI) || null; }
    function _CT() { return window.ClaudeTerminal || null; }
    function _date(ms) {
        if (!ms) return '';
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return p(d.getMonth() + 1) + '/' + p(d.getDate());
    }

    let S = null;   // { body, rid, conv, about, aboutEdit, aboutMsg, notes, nodes, editing, adding, armed, busy, msg }
    const ABOUT_LEN = 300;   // 同奧瑞亞 os_xiaoji adopt 存的上限

    /** 只有小機、而且奧瑞亞那邊認得記事 */
    XiaojiMemory.can = function (provider) {
        const X = _XJ();
        return provider === 'xiaoji' && !!(X && X.noteAct);
    };

    XiaojiMemory.launch = async function (body) {
        const CT = _CT(), X = _XJ();
        const r = (CT && CT.getActiveResident) ? CT.getActiveResident('xiaoji') : null;
        if (!X || !X.noteAct || !r || !r.id) { body.innerHTML = '<div class="cw-sub-missing">小機的記憶要在奧瑞亞裡才看得到</div>'; return; }
        let conv = null;
        try { conv = CT.getActiveConvId ? CT.getActiveConvId(CT.getActiveTab()) : null; } catch (_) {}
        S = { body: body, rid: r.id, name: r.name || '它', conv: conv, about: '', aboutEdit: false, aboutMsg: '', notes: null, nodes: [], editing: null, adding: false, armed: null, busy: false, msg: '' };
        body.innerHTML = '<div class="xjm-wrap"><div class="xjm-scroll"></div></div>';
        body.querySelector('.xjm-wrap').addEventListener('click', _onClick);
        await _load();
    };

    async function _load() {
        const X = _XJ();
        try { const rec = await X.get(S.rid); S.notes = X.notesOf(rec); S.about = String((rec && rec.about) || ''); } catch (_) { S.notes = []; }
        try { S.nodes = (S.conv && X.sumGet) ? ((await X.sumGet(S.conv)).nodes || []) : []; } catch (_) { S.nodes = []; }
        _render();
    }

    function _noteRow(n) {
        if (S.editing === n.id) {
            return '<div class="xjm-note is-edit" data-id="' + n.id + '">'
                + '<textarea class="xjm-input" rows="' + Math.max(2, Math.min(5, Math.ceil(String(n.text).length / 16))) + '" maxlength="' + _max() + '">' + esc(n.text) + '</textarea>'
                + '<div class="xjm-edit-acts">'
                + '<button type="button" class="xjm-btn" data-act="cancel">取消</button>'
                + '<button type="button" class="xjm-btn is-main" data-act="save" data-id="' + n.id + '">存好</button></div></div>';
        }
        const armed = S.armed === 'n' + n.id;
        return '<div class="xjm-note" data-id="' + n.id + '">'
            + '<span class="xjm-dot"></span>'
            + '<span class="xjm-txt">' + esc(n.text) + '</span>'
            + '<span class="xjm-when">' + esc(_date(n.at)) + '</span>'
            + '<button type="button" class="xjm-ic" data-act="edit" data-id="' + n.id + '" title="改"><i class="fa-solid fa-pen"></i></button>'
            + '<button type="button" class="xjm-ic' + (armed ? ' is-armed' : '') + '" data-act="del" data-id="' + n.id + '" title="' + (armed ? '再按一次刪掉' : '刪掉') + '">'
            + (armed ? '<span>刪掉？</span>' : '<i class="fa-solid fa-trash-can"></i>') + '</button></div>';
    }
    function _aboutCard() {
        const ttl = '<span class="xjm-about-ttl"><i class="fa-solid fa-id-card"></i> ' + esc(S.name) + ' 是什麼樣的</span>';
        if (S.aboutEdit) {
            const v = S.aboutDraft != null ? S.aboutDraft : S.about;
            return '<div class="xjm-about is-edit">'
                + '<div class="xjm-about-head">' + ttl + '</div>'
                + '<textarea class="xjm-input" rows="' + Math.max(3, Math.min(8, Math.ceil(v.length / 16))) + '" maxlength="' + ABOUT_LEN + '">' + esc(v) + '</textarea>'
                + (S.aboutMsg ? '<div class="xjm-flash">' + esc(S.aboutMsg) + '</div>' : '')
                + '<div class="xjm-edit-acts">'
                + '<button type="button" class="xjm-btn" data-act="cancel">取消</button>'
                + '<button type="button" class="xjm-btn is-main" data-act="about-save">存好</button></div></div>';
        }
        return '<div class="xjm-about">'
            + '<div class="xjm-about-head">' + ttl
            + '<button type="button" class="xjm-ic" data-act="about-edit" title="改"><i class="fa-solid fa-pen"></i></button></div>'
            + (S.about.trim()
                ? '<div class="xjm-about-txt">' + esc(S.about) + '</div>'
                : '<div class="xjm-about-txt is-empty">還沒寫</div>')
            + '</div>';
    }
    function _max() { const X = _XJ(); return (X && X.MEMO && X.MEMO.NOTE_LEN) || 120; }
    function _cap() { const X = _XJ(); return (X && X.MEMO && X.MEMO.NOTES_MAX) || 30; }

    function _render() {
        if (!S || !S.body) return;
        const sc = S.body.querySelector('.xjm-scroll');
        if (!sc) return;
        // 改介紹打到一半別的地方重畫（刪掉？三秒收回、存失敗）：打的字留著
        const open = sc.querySelector('.xjm-about.is-edit .xjm-input');
        S.aboutDraft = (S.aboutEdit && open) ? open.value : (S.aboutEdit ? S.aboutDraft : null);
        if (S.notes === null) { sc.innerHTML = '<div class="xjm-msg">翻開筆記…</div>'; return; }
        const full = S.notes.length >= _cap();
        let h = _aboutCard() + '<div class="xjm-paper">'
            + '<div class="xjm-paper-head"><span class="xjm-paper-ttl"><i class="fa-solid fa-feather-pointed"></i> ' + esc(S.name) + ' 記得你的事</span>'
            + '<span class="xjm-count">' + S.notes.length + '／' + _cap() + '</span></div>';
        if (!S.notes.length && !S.adding) {
            h += '<div class="xjm-empty"><i class="fa-regular fa-note-sticky"></i><span>還沒記住什麼，跟它多聊聊吧</span></div>';
        } else {
            h += '<div class="xjm-lines">' + S.notes.map(_noteRow).join('') + '</div>';
        }
        if (S.adding) {
            h += '<div class="xjm-note is-edit is-new">'
                + '<textarea class="xjm-input" rows="2" maxlength="' + _max() + '" placeholder="一件事，一句話寫清楚"></textarea>'
                + '<div class="xjm-edit-acts">'
                + '<button type="button" class="xjm-btn" data-act="cancel">取消</button>'
                + '<button type="button" class="xjm-btn is-main" data-act="add-save">記下</button></div></div>';
        } else {
            h += '<button type="button" class="xjm-add" data-act="add"' + (full ? ' disabled' : '') + '><i class="fa-solid fa-plus"></i> '
                + (full ? '滿了，先刪一條' : '幫它記一條') + '</button>';
        }
        if (S.msg) h += '<div class="xjm-flash">' + esc(S.msg) + '</div>';
        h += '</div>';

        h += '<div class="xjm-sec-head"><i class="fa-solid fa-clock-rotate-left"></i> 更早的聊天</div>';
        if (!S.nodes.length) {
            h += '<div class="xjm-empty is-soft"><span>這一串還沒有整理過的舊對話。聊得夠久，最舊的那些會整理成一節一節放在這裡。</span></div>';
        } else {
            h += S.nodes.map(n => {
                const armed = S.armed === 's' + n.id;
                return '<div class="xjm-node">'
                    + '<div class="xjm-node-txt">' + esc(n.text) + '</div>'
                    + '<div class="xjm-node-foot"><span>' + esc(_date(n.at)) + (n.combined ? '・併了 ' + n.combined + ' 節' : '') + '</span>'
                    + '<button type="button" class="xjm-ic' + (armed ? ' is-armed' : '') + '" data-act="sdel" data-id="' + esc(n.id) + '" title="' + (armed ? '再按一次刪掉' : '刪掉這一節') + '">'
                    + (armed ? '<span>刪掉？</span>' : '<i class="fa-solid fa-trash-can"></i>') + '</button></div></div>';
            }).join('');
        }
        sc.innerHTML = h;
        const ta = sc.querySelector('.is-edit .xjm-input');
        if (ta) { try { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }
    }

    let _armTimer = null;
    function _arm(key) {
        S.armed = key;
        clearTimeout(_armTimer);
        _armTimer = setTimeout(() => { if (S && S.armed === key) { S.armed = null; _render(); } }, 3000);
    }

    async function _onClick(e) {
        const b = e.target.closest('[data-act]');
        if (!b || !S || S.busy) return;
        const act = b.dataset.act, X = _XJ();
        const id = b.dataset.id;
        S.msg = ''; S.aboutMsg = '';
        if (act === 'edit') { S.editing = parseInt(id, 10); S.adding = false; S.aboutEdit = false; S.armed = null; _render(); return; }
        if (act === 'add') { S.adding = true; S.editing = null; S.aboutEdit = false; S.armed = null; _render(); return; }
        if (act === 'about-edit') { S.aboutEdit = true; S.editing = null; S.adding = false; S.armed = null; _render(); return; }
        if (act === 'cancel') { S.editing = null; S.adding = false; S.aboutEdit = false; _render(); return; }
        if (act === 'about-save') {
            const ta = S.body.querySelector('.xjm-about.is-edit .xjm-input');
            const text = (ta ? ta.value : '').trim().slice(0, ABOUT_LEN);   // 可以不寫：空的就存空的
            S.busy = true;
            try {
                if (!X.save) throw new Error('奧瑞亞那邊還不認得');
                await X.save(S.rid, { about: text });
                S.aboutEdit = false;
            } catch (err) {
                S.aboutMsg = '沒存成：' + ((err && err.message) || err);
                S.busy = false; _render(); return;
            }
            S.busy = false;
            await _load();
            return;
        }
        if (act === 'del' || act === 'sdel') {
            const key = (act === 'del' ? 'n' : 's') + id;
            if (S.armed !== key) { _arm(key); _render(); return; }
            S.armed = null;
        }
        S.busy = true;
        try {
            if (act === 'save' || act === 'add-save') {
                const ta = S.body.querySelector('.xjm-note.is-edit .xjm-input');
                const text = ta ? ta.value : '';
                const res = await X.noteAct(S.rid, act === 'save' ? 'edit' : 'add', act === 'save' ? parseInt(id, 10) : null, text);
                if (!res[0]) { S.msg = res[1]; S.busy = false; _render(); return; }
                S.editing = null; S.adding = false;
            } else if (act === 'del') {
                await X.noteAct(S.rid, 'remove', parseInt(id, 10));
            } else if (act === 'sdel') {
                if (S.conv && X.sumRemove) await X.sumRemove(S.conv, id);
            }
        } catch (err) {
            S.msg = '沒存成：' + ((err && err.message) || err);
        }
        S.busy = false;
        await _load();
    }

})(window.XiaojiMemory = window.XiaojiMemory || {});
