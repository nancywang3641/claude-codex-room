/**
 * core/collection.js — 收藏（window.RoomCollection，子面板 collection）
 * ------------------------------------------------------------------
 * 10-06 她：「技能小劇場可以先做進收藏室」「語音可以長按給個收藏選項，這樣用戶想要存語音可以存來紀念，
 *   就不用每次打開都得重新呼叫11lab來重聽了」。
 * 入口是房間圖右下那排小圓鈕最左邊那顆星（chat_window.js 的 #cw-room-fav；群聊沒有）。兩區：
 *   小劇場（只有小機）：學會一門課、看過的那一場（存在奧瑞亞 OS_XIAOJI 那門課底下 rec.skills[id].theater），
 *     一場一張票，點了照原本那份重播（OS_XIAOJI.replay），不叫模型。新的在上面。
 *     學會了還沒看的不放票：底下一行「還有幾門」＋去培養室（第一次看會叫模型，那顆鈕留在結業頁）。
 *   語音：長按他的語音泡泡「收藏語音」（notebook.js 的長按小窗）。聲音存進奧瑞亞 OS_DB 圖庫（aud_fav_…，
 *     跟她按住說話的錄音同一個地方），清單在 OS_DB app 資料 room_fav_voice／住戶 id。
 *     收藏過的那句在聊天裡掛一顆星，按播放直接播存下來那份（chat_room.js 的 _toggleVoice 先問 voiceUrl），不再合成。
 *     認那一句用住戶 id＋原句（含語氣標籤）。圖庫是二進位，全量備份不帶（同她的錄音）。
 * ------------------------------------------------------------------
 */
(function (RoomCollection) {
    'use strict';

    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    function _g(k) { const w = window.parent || window; return w[k] || window[k] || null; }
    const _X = () => _g('OS_XIAOJI'), _L = () => _g('OS_XIAOJI_LESSONS'), _DB = () => _g('OS_DB');
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
            + '學會了還沒看的，到培養室那門課看（第一次看會叫 1 次模型），看完就會收進來。\n\n'
            + '語音：長按他的語音泡泡，選「收藏語音」，那段聲音就存下來。之後在聊天裡、在這裡重聽都不會再花錢；'
            + '還沒聽過的那句，收藏時會先念一次（跟按播放一樣）。\n'
            + '收藏的語音存在這台裝置上，換一台、或還原備份都不會跟過去。' } });

    /** 群聊以外的房間都有（小劇場那區只有小機） */
    RoomCollection.can = function (provider) { return !!provider && provider !== 'group' && !!_DB(); };

    // ============================================================
    // 語音：存、拿、取消
    // ============================================================
    const VAPP = 'room_fav_voice';
    const _vload = new Map();   // 住戶 id → 讀清單的那一趟（Promise）
    const _vnow = new Map();    // 住戶 id → 讀好的清單（長按小窗要同步判斷）
    function _list(rid) {
        if (!_vload.has(rid)) _vload.set(rid, (async () => {
            const D = _DB();
            let l = null;
            try { l = (D && D.getAppData) ? await D.getAppData(VAPP, rid) : null; } catch (e) { console.warn('[RoomCollection] 讀不到收藏的語音', e); }
            l = Array.isArray(l) ? l : [];
            _vnow.set(rid, l);
            return l;
        })());
        return _vload.get(rid);
    }
    async function _put(rid, list) {
        _vnow.set(rid, list);
        _vload.set(rid, Promise.resolve(list));
        const D = _DB();
        if (D && D.saveAppData) await D.saveAppData(VAPP, rid, list);
    }
    function _secOf(text) { return Math.max(1, Math.round(String(text || '').replace(/\[[^\]\n]{1,40}\]/g, '').replace(/\s/g, '').length / 4.5)); }
    /** 這顆語音能不能收：他的話（不是她的錄音）、知道是哪位住戶、有字 */
    function _voiceOf(box) {
        const d = box && box._ccrVoice;
        if (!d || !d.v || d.v.audioId || !d.v.rid || !String(d.text || '').trim()) return null;
        return d;
    }
    function _paintStar(box, on) {
        box.classList.toggle('rcol-faved', !!on);
        const bar = box.querySelector('.claude-voice-bar');
        if (on && bar && !bar.querySelector('.rcol-vstar')) {
            const i = document.createElement('i');
            i.className = 'fa-solid fa-star rcol-vstar';
            i.title = '收藏了';
            bar.appendChild(i);
        }
    }
    function _paintAll(rid, text, on) {
        document.querySelectorAll('.claude-voice').forEach(b => {
            const d = _voiceOf(b);
            if (d && d.v.rid === rid && d.text === text) _paintStar(b, on);
        });
    }
    /** 畫一顆語音時叫：收藏過的掛星 */
    RoomCollection.voiceMark = function (box) {
        const d = _voiceOf(box);
        if (!d) return;
        _list(d.v.rid).then(l => { if (l.some(x => x.text === d.text)) _paintStar(box, true); }).catch(() => {});
    };
    /** 長按小窗用：'kept' 收過、'none' 沒收過、null 這顆不能收 */
    RoomCollection.voiceState = function (box) {
        const d = _voiceOf(box);
        if (!d) return null;
        const l = _vnow.get(d.v.rid) || [];
        return l.some(x => x.text === d.text) ? 'kept' : 'none';
    };
    /** 收或取消；回一句給她看的話 */
    RoomCollection.voiceToggle = async function (box) {
        const d = _voiceOf(box), D = _DB();
        if (!d || !D) return '這段收不了';
        const rid = d.v.rid;
        const list = (await _list(rid)).slice();
        const at = list.findIndex(x => x.text === d.text);
        if (at >= 0) {
            const gone = list.splice(at, 1)[0];
            await _put(rid, list);
            if (gone.audio && D.deleteCharImage) { try { await D.deleteCharImage(gone.audio); } catch (_) {} }
            _paintAll(rid, d.text, false);
            return '取消收藏了';
        }
        const R = window.VoidClaudeRoom;
        if (!R || typeof R.voiceBlob !== 'function' || !D.saveImage) return '這裡存不了聲音，要在奧瑞亞裡打開房間';
        const row = box.querySelector('.claude-voice-row');
        if (row) row.classList.add('loading');
        let got;
        try { got = await R.voiceBlob(d.text, d.v); }
        catch (e) { return (R.voiceWhy ? R.voiceWhy(e, d.v.who || '他', (e && e.src) || 'minimax') : '沒存成') + '，這段沒收藏'; }
        finally { if (row) row.classList.remove('loading'); }
        const id = 'aud_fav_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        try { await D.saveImage(id, got.blob); }
        catch (e) { return '這台裝置存不下了，這段沒收藏'; }
        const fresh = (await _list(rid)).slice();   // 合成的時候可能別的地方也收了
        if (fresh.some(x => x.text === d.text)) { try { await D.deleteCharImage(id); } catch (_) {} _paintAll(rid, d.text, true); return '收藏好了'; }
        fresh.unshift({ id: id, text: d.text, who: d.v.who || '', at: Date.now(), audio: id, src: got.src || '', sec: _secOf(d.text) });
        await _put(rid, fresh);
        _paintAll(rid, d.text, true);
        return '收藏好了，之後重聽不會再花錢';
    };
    /** 聊天裡按播放：收藏過的回存下來那份的網址（用完由呼叫的人收），沒有回 null */
    RoomCollection.voiceUrl = async function (rid, text) {
        if (!rid) return null;
        const it = (await _list(rid)).find(x => x.text === text);
        const D = _DB();
        if (!it || !D || !D.getImage) return null;
        try { return await D.getImage(it.audio); } catch (_) { return null; }
    };

    // ============================================================
    // 收藏那一頁
    // ============================================================
    let _player = null, _playing = null;   // 這頁的播放器、正在播的那顆
    function _stopPage() {
        if (_player) { try { _player.pause(); } catch (_) {} if (_player._url) { URL.revokeObjectURL(_player._url); _player._url = null; } }
        if (_playing) { _playing.classList.remove('is-on'); const i = _playing.querySelector('i'); if (i) i.className = 'fa-solid fa-play'; }
        _playing = null;
    }

    /** 換頁、關頁時 chat_window 叫：這頁在播的語音停掉 */
    RoomCollection.stop = _stopPage;

    RoomCollection.launch = async function (body) {
        _stopPage();
        const CT = window.ClaudeTerminal, CW = window.ChatWindow;
        const provider = (CW && CW.getProvider) ? CW.getProvider() : '';
        const r = (CT && CT.getActiveResident) ? CT.getActiveResident(provider) : null;
        if (!r || !r.id || !_DB()) { body.innerHTML = '<div class="cw-sub-missing">收藏要在奧瑞亞裡才看得到</div>'; return; }
        body.innerHTML = '<div class="rcol-wrap"><div class="rcol-msg"><i class="fa-solid fa-spinner fa-spin"></i></div></div>';
        // 小劇場：只有小機
        let th = null;
        const X = _X(), L = _L();
        if (provider === 'xiaoji' && X && L) {
            let rec = null;
            try { rec = await X.get(r.id); } catch (e) { console.warn('[RoomCollection] 讀不到小機', e); }
            const skills = (rec && rec.skills) || {};
            const tix = [], unseen = [];
            for (const sk of (L.SKILLS || [])) {
                const ent = skills[sk.id];
                if (!ent) continue;   // 沒學會
                if (ent.theater && ent.theater.content) tix.push({ sk, t: ent.theater });
                else unseen.push(sk);
            }
            tix.sort((a, b) => (b.t.at || 0) - (a.t.at || 0));
            th = { tix, unseenN: (rec && rec.theater) ? unseen.length : 0 };   // 門卡關了小劇場：沒看過的也看不了，不叫她去
        }
        const voices = await _list(r.id);
        if (!body.isConnected) return;
        _render(body, r, th, voices);
    };

    function _theaterHtml(th, help) {
        const L = _L();
        const go = '<button type="button" class="rcol-go"><i class="fa-solid fa-chalkboard-user"></i> 去培養室</button>';
        let inner;
        if (!th.tix.length) {
            inner = '<div class="rcol-empty"><i class="fa-solid fa-masks-theater"></i>'
                + '<div class="rcol-empty-ttl">還沒有收藏的小劇場</div>'
                + '<div class="rcol-soft">它在培養室學會一門課、看過那場小劇場，就會收在這裡。</div>'
                + (th.unseenN ? go : '') + '</div>';
        } else {
            inner = th.tix.map(({ sk, t }) => {
                const T = (L.TEACHERS || {})[sk.teacher] || {};
                const face = _portrait(sk.teacher);
                return '<button type="button" class="rcol-tix" data-sid="' + esc(sk.id) + '">'
                    + '<span class="rcol-face">' + (face ? '<img src="' + esc(face) + '" alt="">' : '<i class="fa-solid fa-user"></i>') + '</span>'
                    + '<span class="rcol-txt"><span class="rcol-ttl">' + esc(t.title || (sk.label + '的小劇場')) + '</span>'
                    + '<span class="rcol-sub">' + esc((T.name ? T.name + '的課：' : '') + sk.label) + (T.place ? '<span class="rcol-dot">·</span>' + esc(T.place) : '') + '</span></span>'
                    + '<span class="rcol-end"><span class="rcol-date">' + esc(_date(t.at)) + '</span><i class="fa-solid fa-play"></i></span>'
                    + '</button>';
            }).join('')
                + (th.unseenN ? '<div class="rcol-more"><span>還有 ' + th.unseenN + ' 門學會了，小劇場還沒看</span>' + go + '</div>' : '')
                + '<div class="rcol-hint rcol-th-hint"></div>';
        }
        return '<section class="rcol-part"><div class="rcol-head"><span class="rcol-sec"><i class="fa-solid fa-masks-theater"></i> 小劇場'
            + (th.tix.length ? '<span class="rcol-n">' + th.tix.length + '</span>' : '') + '</span>' + help + '</div>' + inner + '</section>';
    }

    function _voiceHtml(r, voices, help) {
        let inner;
        if (!voices.length) {
            inner = '<div class="rcol-empty rcol-empty-sm"><i class="fa-solid fa-microphone-lines"></i>'
                + '<div class="rcol-empty-ttl">還沒有收藏的語音</div>'
                + '<div class="rcol-soft">長按' + esc(r.name || '他') + '的語音泡泡，選「收藏語音」。</div></div>';
        } else {
            inner = voices.map(v => {
                const said = String(v.text || '').replace(/\[[^\]\n]{1,40}\]\s*/g, '').trim();
                return '<div class="rcol-voice" data-id="' + esc(v.id) + '">'
                    + '<button type="button" class="rcol-vplay" title="播放"><i class="fa-solid fa-play"></i></button>'
                    + '<div class="rcol-vtxt"><div class="rcol-vsaid">' + esc(said) + '</div>'
                    + '<div class="rcol-vmeta">' + esc(v.who || r.name || '') + '<span class="rcol-dot">·</span>' + esc(_date(v.at))
                    + '<span class="rcol-dot">·</span>' + esc((v.sec || _secOf(v.text)) + '″') + '</div></div>'
                    + '<button type="button" class="rcol-vdel" title="取消收藏"><i class="fa-solid fa-xmark"></i></button>'
                    + '</div>';
            }).join('') + '<div class="rcol-hint rcol-v-hint"></div>';
        }
        return '<section class="rcol-part"><div class="rcol-head"><span class="rcol-sec"><i class="fa-solid fa-microphone-lines"></i> 語音'
            + (voices.length ? '<span class="rcol-n">' + voices.length + '</span>' : '') + '</span>' + help + '</div>' + inner + '</section>';
    }

    function _render(body, r, th, voices) {
        const A = _g('AUI');
        const help = (A && A.helpBtn) ? A.helpBtn('room_collection') : '';
        body.innerHTML = '<div class="rcol-wrap"><div class="rcol-scroll">'
            + (th ? _theaterHtml(th, help) + _voiceHtml(r, voices, '') : _voiceHtml(r, voices, help)) + '</div></div>';

        // 全身立繪跟丹那張半身比例不一樣：載完看比例掛 is-half（同培養室 _sizeWho）
        body.querySelectorAll('.rcol-face img').forEach(img => {
            const fit = () => { const k = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0; if (k) img.classList.toggle('is-half', k < 1.7); };
            if (img.complete) fit();
            img.addEventListener('load', fit);
        });
        body.querySelectorAll('.rcol-go').forEach(b => b.addEventListener('click', () => {
            const CW = window.ChatWindow;
            if (CW && CW.openSubPanel) CW.openSubPanel('xiaoji_train');
        }));
        const thHint = body.querySelector('.rcol-th-hint');
        body.querySelectorAll('.rcol-tix').forEach(b => b.addEventListener('click', async () => {
            if (body.querySelector('.rcol-tix.is-busy')) return;
            _stopPage();
            b.classList.add('is-busy');
            if (thHint) thHint.textContent = '';
            let ok = false;
            try { ok = await _X().replay(r.id, b.dataset.sid); } catch (e) { console.warn('[RoomCollection] 重播失敗', e); }
            b.classList.remove('is-busy');
            // 小劇場在 VN 播放器播：把窗收起來，不然擋在播放器前面（同培養室結業頁）
            if (ok) { if (window.ChatWindow && ChatWindow.close) ChatWindow.close(); return; }
            if (thHint) thHint.textContent = '播不出來，等一下再試';
        }));

        const vHint = body.querySelector('.rcol-v-hint');
        body.querySelectorAll('.rcol-voice').forEach(row => {
            const id = row.dataset.id;
            const play = row.querySelector('.rcol-vplay'), del = row.querySelector('.rcol-vdel');
            play.addEventListener('click', async () => {
                if (_playing === play) { _stopPage(); return; }
                _stopPage();
                if (!_player) _player = new Audio();
                const it = (_vnow.get(r.id) || []).find(x => x.id === id);
                const D = _DB();
                let url = null;
                try { url = (it && D && D.getImage) ? await D.getImage(it.audio) : null; } catch (_) {}
                if (!url) { if (vHint) vHint.textContent = '這段聲音找不到了'; return; }
                if (vHint) vHint.textContent = '';
                _player._url = url;
                _player.src = url;
                _player.onended = () => { if (_playing === play) _stopPage(); };
                _playing = play;
                play.classList.add('is-on');
                play.querySelector('i').className = 'fa-solid fa-pause';
                try { await _player.play(); } catch (_) { _stopPage(); }
            });
            // 取消收藏：按一下變「確定拿掉」，三秒內再按才拿掉（聲音刪了就要重新花錢念）
            let armed = null;
            del.addEventListener('click', async () => {
                if (!armed) {
                    del.classList.add('is-armed');
                    del.innerHTML = '確定拿掉';
                    armed = setTimeout(() => { armed = null; del.classList.remove('is-armed'); del.innerHTML = '<i class="fa-solid fa-xmark"></i>'; }, 3000);
                    return;
                }
                clearTimeout(armed);
                armed = null;
                if (_playing === play) _stopPage();
                const list = (await _list(r.id)).slice();
                const at = list.findIndex(x => x.id === id);
                if (at >= 0) {
                    const gone = list.splice(at, 1)[0];
                    await _put(r.id, list);
                    const D = _DB();
                    if (gone.audio && D && D.deleteCharImage) { try { await D.deleteCharImage(gone.audio); } catch (_) {} }
                    _paintAll(r.id, gone.text, false);
                }
                RoomCollection.launch(body);
            });
        });
    }
})(window.RoomCollection = window.RoomCollection || {});
