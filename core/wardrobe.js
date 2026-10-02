/**
 * core/wardrobe.js — 衣櫃（window.RoomWardrobe）
 * ------------------------------------------------------------------
 * 她 10-02：「換裝的好像沒保存，以後會不會變一次性? 要不要做衣櫃?」
 * 一套＝身體顏色＋身上的東西＋形象。住戶換裝時，舊的那套穿了一陣子就自動收進來（規則在橋 room_decor：
 * 穿超過 20 分鐘的才收，連著換幾件的中間樣子不收）；他自己也能寫 wear_outfit 換回去、wear_keep 取名。
 * 這頁：現在穿的、收著的、現成的（原本的樣子；阿洛多一套 Codex 工作服）。點一套 → 底下那排「穿上／改名／丟掉」，
 * 改名、丟掉都在那排裡做完，不跳窗。她換的，橋會在他下一輪跟他說一聲。
 * 資料在橋 GET／POST /v1/wardrobe；每套的小圖借 ClawdPortrait.renderStill 畫一格定格。
 * 只有會打扮的住戶有（Claude 住戶的預設是小螃蟹、阿洛是洛德）；小機的打扮另外做。
 * ------------------------------------------------------------------
 */
(function (RoomWardrobe) {
    'use strict';

    const A0 = window.AUI || (window.parent && window.parent.AUI);
    if (A0 && A0.registerHelp) A0.registerHelp({ room_wardrobe: { title: '衣櫃',
        body: '他換裝的時候，換下來的那套會自動收進來（穿了一陣子的才收；他一次換一件，連著換好幾件的中間樣子不收）。\n'
            + '點一套就能幫他換上，他下一次跟你說話時會知道是你換的。他自己也能從衣櫃換回去、幫一套取名。\n'
            + '一套是整個樣子：身體顏色、身上戴的東西、自己畫的形象一起換。\n'
            + '衣櫃最多放 30 套，滿了先丟最久沒穿、沒取名的那套。' } });

    RoomWardrobe.canDress = function (provider) { return provider === 'claude' || provider === 'codex'; };

    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function _bridge() {
        const OS = window.OS_SETTINGS;
        const p = (OS && typeof OS.getActiveClaudePreset === 'function') ? OS.getActiveClaudePreset() : null;
        if (!p || !p.url || !p.key) return null;
        return { base: String(p.url).replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, ''), key: p.key };
    }
    function _who() {
        const CT = window.ClaudeTerminal, CW = window.ChatWindow;
        const provider = (CW && typeof CW.getProvider === 'function') ? CW.getProvider() : 'claude';
        const rid = (CT && typeof CT.getActiveResidentId === 'function') ? CT.getActiveResidentId() : '';
        return { rid, provider, base: provider === 'codex' ? 'lorde' : 'crab' };
    }
    async function _call(b, who, body) {
        const url = b.base + '/v1/wardrobe' + (body ? '' : '?rid=' + encodeURIComponent(who.rid) + '&base=' + who.base);
        const r = await fetch(url, body ? {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + b.key, 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ rid: who.rid, base: who.base }, body)),
        } : { headers: { 'Authorization': 'Bearer ' + b.key } });
        if (r.status === 404) throw new Error('OLD_BRIDGE');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }

    // 每套的小圖：同一身打扮只畫一次
    const _pics = new Map();
    function _pic(wear, base) {
        const key = base + '|' + JSON.stringify(wear || null);
        if (!_pics.has(key)) {
            _pics.set(key, (async () => {
                const CP = window.ClawdPortrait;
                if (!CP || typeof CP.renderStill !== 'function') return '';
                const cv = document.createElement('canvas');
                await CP.renderStill(cv, wear, 'idle', 1, base);
                return CP.crop(cv);
            })().catch(() => ''));
        }
        return _pics.get(key);
    }

    let _host = null, _who0 = null, _data = null;
    let _sel = null;          // { kind: 'outfit'|'preset'|'current', id?, key? }
    let _mode = '';           // '' | 'rename' | 'discard'
    let _busy = false;
    let _note = '';           // 底下那排剛做完的那句

    RoomWardrobe.launch = async function (body) {
        _host = body;
        _who0 = _who();
        _sel = null; _mode = ''; _note = ''; _data = null;
        body.innerHTML = '<div class="wd-wrap"><div class="wd-msg">打開衣櫃…</div></div>';
        const b = _bridge();
        if (!b) { body.innerHTML = '<div class="wd-wrap"><div class="wd-msg">要先在設置填好橋，才打得開衣櫃</div></div>'; return; }
        try {
            _data = await _call(b, _who0);
        } catch (e) {
            body.innerHTML = '<div class="wd-wrap"><div class="wd-msg">'
                + (e && e.message === 'OLD_BRIDGE' ? '橋還是舊的那版，重開一次橋就有衣櫃了' : '連不上橋，衣櫃打不開') + '</div></div>';
            return;
        }
        if (_host === body) _render();
    };

    function _nowName() {
        const o = _data.outfits.find(x => x.now);
        if (o) return o.label;
        const p = _data.presets.find(x => x.now);
        return p ? p.name : '';
    }

    function _selected() {
        if (!_sel || !_data) return null;
        if (_sel.kind === 'outfit') return _data.outfits.find(o => o.id === _sel.id) || null;
        if (_sel.kind === 'preset') return _data.presets.find(p => p.key === _sel.key) || null;
        return _sel.kind === 'current' ? { now: true, label: '' } : null;
    }

    function _card(kind, x, label) {
        const k = kind === 'outfit' ? 'o:' + x.id : 'p:' + x.key;
        const on = _sel && ((kind === 'outfit' && _sel.kind === 'outfit' && _sel.id === x.id)
            || (kind === 'preset' && _sel.kind === 'preset' && _sel.key === x.key));
        return '<button type="button" class="wd-card' + (on ? ' is-sel' : '') + (x.now ? ' is-now' : '') + '" data-k="' + k + '">'
            + '<span class="wd-pic"><img alt=""></span>'
            + '<span class="wd-name">' + _esc(label) + '</span>'
            + (x.now ? '<span class="wd-badge">穿著</span>' : '')
            + '</button>';
    }

    function _render() {
        if (!_host || !_data) return;
        const base = _who0.base;
        const oldScroll = _host.querySelector('.wd-scroll');
        const keepTop = oldScroll ? oldScroll.scrollTop : 0;      // 整頁重畫：捲到哪裡留著，點下面那幾套不會跳回最上面
        const nowName = _nowName();
        const help = (A0 && A0.helpBtn) ? A0.helpBtn('room_wardrobe') : '';
        const canKeepNow = !_data.current.plain && !_data.outfits.some(o => o.now);
        let h = '<div class="wd-wrap"><div class="wd-scroll">';
        h += '<div class="wd-now">'
            + '<span class="wd-now-pic"><img alt=""></span>'
            + '<div class="wd-now-info"><div class="wd-now-lab">現在穿的</div>'
            + '<div class="wd-now-name">' + _esc(nowName || '還沒收進衣櫃') + '</div>'
            + (canKeepNow ? '<button type="button" class="wd-keep" data-act="keep"><i class="fa-solid fa-tag"></i>取名收好</button>' : '')
            + '</div><span class="wd-help">' + help + '</span></div>';
        h += '<div class="wd-h">收著的<span class="wd-n">' + (_data.outfits.length ? _data.outfits.length + ' 套' : '') + '</span></div>';
        h += _data.outfits.length
            ? '<div class="wd-grid">' + _data.outfits.map(o => _card('outfit', o, o.label)).join('') + '</div>'
            : '<div class="wd-empty"><i class="fa-solid fa-shirt"></i>他換下來的衣服會自動收在這裡</div>';
        h += '<div class="wd-h">現成的</div>';
        h += '<div class="wd-grid">' + _data.presets.map(p => _card('preset', p, p.name)).join('') + '</div>';
        h += '</div>' + _barHtml() + '</div>';
        _host.innerHTML = h;
        const sc = _host.querySelector('.wd-scroll');
        if (sc && keepTop) sc.scrollTop = keepTop;
        const selCard = _host.querySelector('.wd-card.is-sel');      // 底下那排冒出來時別把選到的那套蓋住
        if (selCard && selCard.scrollIntoView) selCard.scrollIntoView({ block: 'nearest' });

        // 小圖
        const nowImg = _host.querySelector('.wd-now-pic img');
        _pic(_data.current.wear, base).then(u => { if (u && nowImg) nowImg.src = u; });
        _host.querySelectorAll('.wd-card').forEach(c => {
            const [t, id] = c.dataset.k.split(':');
            const x = t === 'o' ? _data.outfits.find(o => String(o.id) === id) : _data.presets.find(p => p.key === id);
            const img = c.querySelector('img');
            if (x) _pic(x.wear, base).then(u => { if (u && img) img.src = u; });
            c.addEventListener('click', () => {
                if (_busy) return;
                const same = _sel && ((t === 'o' && _sel.kind === 'outfit' && String(_sel.id) === id)
                    || (t === 'p' && _sel.kind === 'preset' && _sel.key === id));
                _sel = same ? null : (t === 'o' ? { kind: 'outfit', id: +id } : { kind: 'preset', key: id });
                _mode = ''; _note = '';
                _render();
            });
        });
        const keep = _host.querySelector('[data-act="keep"]');
        if (keep) keep.addEventListener('click', () => { _sel = { kind: 'current' }; _mode = 'rename'; _note = ''; _render(); });
        _bindBar();
        if (_mode === 'rename') {
            const inp = _host.querySelector('.wd-input');
            if (inp) { inp.focus({ preventScroll: true }); inp.select(); }
        }
    }

    function _barHtml() {
        const x = _selected();
        if (!x) return _note ? '<div class="wd-bar"><span class="wd-bar-note">' + _esc(_note) + '</span></div>' : '';
        if (_mode === 'rename') {
            const v = _sel.kind === 'outfit' ? (x.name || '') : '';
            return '<div class="wd-bar"><input class="wd-input" type="text" maxlength="20" placeholder="幫這套取個名字" value="' + _esc(v) + '">'
                + '<button type="button" class="wd-btn is-main" data-act="rename-ok">好</button>'
                + '<button type="button" class="wd-btn" data-act="cancel">取消</button></div>';
        }
        if (_mode === 'discard') {
            return '<div class="wd-bar"><span class="wd-bar-note">丟掉「' + _esc(x.label) + '」？</span>'
                + '<button type="button" class="wd-btn is-danger" data-act="discard-ok">丟掉</button>'
                + '<button type="button" class="wd-btn" data-act="cancel">取消</button></div>';
        }
        let h = '<div class="wd-bar">';
        h += x.now
            ? '<span class="wd-bar-note">他現在就穿著這套</span>'
            : '<button type="button" class="wd-btn is-main" data-act="wear"><i class="fa-solid fa-shirt"></i>穿上這套</button>';
        if (_sel.kind === 'outfit') {
            h += '<button type="button" class="wd-btn" data-act="rename"><i class="fa-solid fa-pen"></i>改名</button>'
               + '<button type="button" class="wd-btn" data-act="discard"><i class="fa-solid fa-trash-can"></i>丟掉</button>';
        }
        return h + '</div>';
    }

    function _bindBar() {
        if (!_host) return;
        _host.querySelectorAll('.wd-bar [data-act]').forEach(btn => btn.addEventListener('click', () => _act(btn.dataset.act)));
        const inp = _host.querySelector('.wd-input');
        if (inp) inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); _act('rename-ok'); }
            if (e.key === 'Escape') { e.preventDefault(); _act('cancel'); }
        });
    }

    async function _act(what) {
        if (_busy || !_sel) return;
        if (what === 'cancel') { _mode = ''; if (_sel.kind === 'current') _sel = null; _render(); return; }
        if (what === 'rename' || what === 'discard') { _mode = what; _render(); return; }
        const b = _bridge();
        if (!b) return;
        let req = null;
        if (what === 'wear') req = _sel.kind === 'preset' ? { act: 'wear', preset: _sel.key } : { act: 'wear', id: _sel.id };
        if (what === 'discard-ok') req = { act: 'discard', id: _sel.id };
        if (what === 'rename-ok') {
            const inp = _host && _host.querySelector('.wd-input');
            const name = inp ? inp.value.trim() : '';
            if (!name) { if (inp) inp.focus(); return; }
            req = { act: 'rename', name: name, id: _sel.kind === 'outfit' ? _sel.id : null };
        }
        if (!req) return;
        _busy = true;
        const host = _host;
        host.querySelectorAll('.wd-bar button').forEach(x => { x.disabled = true; });
        let res = null;
        try { res = await _call(b, _who0, req); } catch (e) { res = { ok: false, msg: '連不上橋，沒做成' }; }
        _busy = false;
        if (host !== _host) return;
        if (res && res.wardrobe) _data = res.wardrobe;
        _mode = '';
        if (res && res.ok) {
            _note = what === 'wear' ? '換好了，他下次跟你說話時會知道' : what === 'discard-ok' ? '丟掉了' : '取好名字了';
            if (what === 'wear' || what === 'discard-ok' || _sel.kind === 'current') _sel = null;
            if (what === 'wear' && window.ChatWindow && typeof window.ChatWindow.refreshDecor === 'function') window.ChatWindow.refreshDecor();
        } else {
            _note = (res && res.msg) || '沒做成';
        }
        _render();
    }

})(window.RoomWardrobe = window.RoomWardrobe || {});
