// ----------------------------------------------------------------
// [檔案] xiaoji_train.js — API 小機的開箱與培養室畫面（2026-10-01；10-06 改成視覺小說）
// 引擎在奧瑞亞（OS_XIAOJI）；這支只畫畫面，掛在主窗的子頁：ChatWindow.openSubPanel('xiaoji_box'／'xiaoji_train')。
//   ・box：404 寄來的箱子（第一隻免費、附碎片）；mode 'adopt'＝在 404 黑市買第二隻以後（付碎片、柴郡另一句）
//   ・launch：培養室——四張店門卡（老師＋那間店），點一門課走進那間店：老師講課 → 報名（寫學費與要叫幾次模型）→ 考試 → 結業頁
//   考試中看得到它講的話與做到哪一步；結業頁攤開它交的作業（做東西那四門能收下）、它現在會什麼、小劇場、叫它試試。
//   學會的那門再點一次回到結業頁；小劇場第一次看才叫模型，存起來之後重看不用（10-05 她：學技能沒有獎勵或獲得感）。
// 10-06 她：「做成視覺小說的展示對話樣子? 不然看起來好毛胚」→ 上課整段是一場戲（_scene）：背景是那間店、老師站著、
//   底下對話框一句一句打出來、點畫面換下一句；要選的時候對話框上面長出選項。素材跟大廳地點頁同一套。
// 房間單獨載、沒有奧瑞亞：說要在奧瑞亞裡才養得了。
// ----------------------------------------------------------------
(function () {
    'use strict';
    const XT = window.XiaojiTrain = window.XiaojiTrain || {};
    XT.target = XT.target || null;
    XT.mode = XT.mode || 'box';
    function _g(k) { const w = window.parent || window; return w[k] || window[k] || null; }
    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    const _X = () => _g('OS_XIAOJI'), _L = () => _g('OS_XIAOJI_LESSONS');
    function _isAbort(e) { return !!(e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')))); }

    const A0 = _g('AUI');
    if (A0 && A0.registerHelp) A0.registerHelp({ xiaoji_train: { title: '培養室',
        body: '小機學會一門課，才看得到那一組工具。\n上課要繳學費：瀅瀅、帽匠收 PT，柴郡、丹收碎片。\n考試是小機在練習用的資料上做一題，不會動到你真的東西。考試會叫模型，報名時會寫要叫幾次。\n做東西那幾門（VN 組件、主題、泡泡、特效）考試做出來的那一件，你可以收下，收下才會存進你的東西。\n小劇場第一次看會叫一次模型，之後重看不用。學會的課再點一次，看得到作業和小劇場。\n沒考過可以再考，不用再繳學費。\n你自己用創作室、設定，一樣都不受影響。' } });

    // ── 老師與店 ──────────────────────────────────────────
    //   立繪是大廳那套（LobbyNpcs）；店的背景是大廳地點頁那套（core/void/lobby_places.js 的 bg，同一個 CDN）。
    //   丹沒有店的場景圖：資安部用 CSS 畫（xiaoji.css 的 [data-t="dan"]）
    const CDN = 'https://cdn.jsdelivr.net/gh/nancywang3641/sound-files@main/';
    const SHOP_BG = { ying: 'lobby_pv_bg_cafe_v1.jpg', hatter: 'lobby_pv_bg_workshop_v1.jpg', cheshire: 'lobby_pv_bg_room404_v1.jpg' };
    function _teacher(key) {
        const N = _g('LobbyNpcs');
        try { return !N ? null : (key === 'dan' ? (N.snResident && N.snResident('dan')) : (N.staff && N.staff(key))); } catch (e) { return null; }
    }
    function _portrait(key) { const t = _teacher(key); return (t && t.portrait) || ''; }
    function _face(key) {
        const p = _portrait(key);
        return p ? '<img class="xj-face" src="' + _esc(p) + '" alt="">' : '<span class="xj-face xj-face-none"><i class="fa-solid fa-user"></i></span>';
    }
    // 全身立繪（細長）跟丹那張半身大小不一樣：載完看比例掛 is-half（同大廳地點頁 sizePortrait）
    function _sizeWho(img) {
        const fit = () => { const r = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0; if (r) img.classList.toggle('is-half', r < 1.7); };
        if (img.complete) fit();
        img.addEventListener('load', fit);
    }
    function _missing(body) { body.innerHTML = '<div class="cw-sub-missing">要在酒館或手機的奧瑞亞裡才養得了小機</div>'; }
    async function _money() {
        const P = _g('OS_PT'), S = _g('OS_404_STORE');
        let pt = 0;
        try { pt = (P && P.getPT) ? await P.getPT() : 0; } catch (e) {}
        return { pt: pt, shards: (S && S.getShards) ? S.getShards() : 0 };
    }
    function _myName(rid) {
        const CT = window.ClaudeTerminal, r = (CT && CT.getResident) ? CT.getResident(rid) : null;
        return (r && r.name) || '小機';
    }
    // 小機的臉（領養時挑的那隻）：畫一次記著，名字牌上用
    const _faceUrls = {};
    function _xjFaceUrl(rid) {
        if (!_faceUrls[rid]) _faceUrls[rid] = (async () => {
            try { const X = _X(), CP = window.ClawdPortrait; return (CP && CP.faceOf) ? (await CP.faceOf(X.bodyOf(await X.get(rid)))) || '' : ''; } catch (_) { return ''; }
        })();
        return _faceUrls[rid];
    }
    function _xjFaceHtml(url) {
        return url ? '<img src="' + _esc(url) + '" alt="">' : '<span class="xj-dlg-face"><i class="fa-solid fa-microchip"></i></span>';
    }

    // ── 場景：店的背景＋老師＋底下選項與對話框 ─────────────
    //   say(句子們, 誰, 講完)：一句一句打出來，點畫面換下一句（打字中先整句出來），最後一句點完才叫講完。誰＝null 是旁白。
    //   show(字, 誰)：直接換字、不用點（考試中它講的話）。choose([...])：對話框上面的選項。card(html)：老師退場、內容一張卡。
    //   點選項、卡片裡的東西不算點畫面。
    function _scene(body, key, opt) {
        opt = opt || {};
        const T = ((_L() || {}).TEACHERS || {})[key] || {};
        const bg = SHOP_BG[key], who = _portrait(key);
        body.innerHTML = '<div class="xj-scene" data-t="' + _esc(key) + '" tabindex="0">'
            + (bg ? '<img class="xj-scene-bg" alt="" src="' + _esc(CDN + bg) + '">' : '')
            + '<div class="xj-scene-wash"></div>'
            + (who ? '<img class="xj-scene-who" alt="" src="' + _esc(who) + '">' : '')
            + '<div class="xj-scene-top">'
            + (opt.onBack ? '<button type="button" class="xj-scene-back"><i class="fa-solid fa-chevron-left"></i> 回培養室</button>' : '')
            + (T.place ? '<span class="xj-scene-tag"><b>' + _esc(T.place) + '</b></span>' : '') + '</div>'
            + '<div class="xj-scene-steps"></div>'
            + '<div class="xj-panel"></div>'
            + '<div class="xj-scene-ui"><div class="xj-choices"></div>'
            + '<div class="xj-dlg-wrap"><div class="xj-dlg-name"></div>'
            + '<div class="xj-dlg"><div class="xj-dlg-text"></div><i class="fa-solid fa-caret-down xj-dlg-next"></i></div></div></div>'
            + '</div>';
        const el = body.querySelector('.xj-scene');
        const whoEl = el.querySelector('.xj-scene-who');
        if (whoEl) _sizeWho(whoEl);
        const back = el.querySelector('.xj-scene-back');
        if (back) back.addEventListener('click', e => { e.stopPropagation(); opt.onBack(); });
        const steps = el.querySelector('.xj-scene-steps'), panel = el.querySelector('.xj-panel'), choices = el.querySelector('.xj-choices');
        const wrap = el.querySelector('.xj-dlg-wrap'), nameEl = el.querySelector('.xj-dlg-name'), dlg = el.querySelector('.xj-dlg'), text = el.querySelector('.xj-dlg-text');
        const calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        let lines = [], idx = 0, typing = null, full = '', onDone = null;
        const stopType = () => { if (typing) { clearInterval(typing); typing = null; } };
        const paintMore = () => dlg.classList.toggle('is-more', !typing && (idx < lines.length - 1 || !!onDone));
        function speaker(sp) {
            nameEl.classList.toggle('is-off', !sp);
            dlg.classList.toggle('is-nar', !sp);
            nameEl.innerHTML = sp ? ((sp.face || '') + '<span>' + _esc(sp.name) + '</span>') : '';
        }
        function type(s) {
            stopType();
            full = String(s == null ? '' : s);
            dlg.scrollTop = 0;
            if (calm || !full) { text.textContent = full; paintMore(); return; }
            let n = 0;
            text.textContent = '';
            typing = setInterval(() => {
                n++;
                text.textContent = full.slice(0, n);
                if (n >= full.length) { stopType(); paintMore(); }
            }, 28);
            paintMore();
        }
        function toDialog() {
            el.classList.remove('is-card');
            panel.innerHTML = '';
            choices.innerHTML = '';
            wrap.classList.remove('is-off');
            dlg.classList.remove('is-wait');
        }
        function say(ls, sp, done) {
            toDialog();
            speaker(sp);
            lines = (ls || []).filter(x => String(x || '').trim());
            idx = 0;
            onDone = done || null;
            if (!lines.length) {   // 沒有台詞：不讓她對著空白的框點，直接往下走
                if (onDone) { const d = onDone; onDone = null; d(); return; }
                lines = [''];
            }
            type(lines[0]);
        }
        function advance() {
            if (typing) { stopType(); text.textContent = full; paintMore(); return; }
            if (idx < lines.length - 1) { idx++; type(lines[idx]); return; }
            if (onDone) { const d = onDone; onDone = null; paintMore(); d(); }
        }
        el.addEventListener('click', e => {
            if (el.classList.contains('is-card')) return;
            if (e.target.closest('button, a, input, select, textarea, .xj-panel')) return;
            advance();
        });
        el.addEventListener('keydown', e => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); advance(); } });
        function show(s, sp, wait) {
            stopType();
            lines = []; onDone = null;
            el.classList.remove('is-card');
            panel.innerHTML = '';   // 從結業卡按「再考一次」回來：卡片收掉
            wrap.classList.remove('is-off');
            speaker(sp);
            dlg.classList.toggle('is-wait', !!wait);
            text.textContent = String(s == null ? '' : s);
            dlg.scrollTop = dlg.scrollHeight;
            paintMore();
        }
        function choose(list) {
            choices.innerHTML = '';
            (list || []).forEach(c => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'xj-choice' + (c.main ? ' is-main' : '');
                b.textContent = c.label;
                b.addEventListener('click', e => { e.stopPropagation(); if (!b.disabled && c.on) c.on(b); });
                choices.appendChild(b);
            });
        }
        function card(html) {
            stopType();
            lines = []; onDone = null;
            choices.innerHTML = '';
            steps.innerHTML = '';
            wrap.classList.add('is-off');
            el.classList.add('is-card');
            panel.innerHTML = html || '';
            panel.scrollTop = 0;
            return panel;
        }
        function setSteps(html) { steps.innerHTML = html || ''; return steps; }
        return { el: el, key: key, teacher: T, say: say, show: show, choose: choose, card: card, setSteps: setSteps };
    }

    // ── 開箱 ──────────────────────────────────────────────
    XT.box = function (body) {
        const X = _X(), L = _L();
        if (!X || !L) { _missing(body); return; }
        const adopt = XT.mode === 'adopt';
        const sc = _scene(body, 'cheshire');
        sc.say(X.lines('', adopt ? 'adopt' : 'box'), { name: '柴郡' }, () => _boxForm(sc, adopt));
    };
    function _boxForm(sc, adopt) {
        const X = _X(), L = _L();
        const opts = (X.connList() || []).map(c => '<option value="' + _esc(c.id) + '">' + _esc(c.label) + '</option>').join('');
        const DP = window.DormPanel;
        const picker = (DP && DP.xjBodyPicker && X.BODIES) ? DP.xjBodyPicker(X.BODIES[0].id) : '';
        const stage = sc.card('<div class="xj-form">'
            + '<label class="xj-lab">名字</label><input type="text" class="xj-in xj-in-name" maxlength="20">'
            + (picker ? '<label class="xj-lab">樣子（之後在門卡上能換）</label>' + picker : '')
            + '<label class="xj-lab">它說話走哪個接口</label><select class="xj-in xj-in-conn">' + opts + '</select>'
            + '<label class="xj-lab">它是什麼樣的（可以不寫）</label><textarea class="xj-in xj-in-about" rows="2" maxlength="300"></textarea>'
            + '<div class="xj-cost">' + (adopt ? '要付 ' + L.ADOPT_PRICE + ' 碎片' : '箱子裡附了 ' + L.BOX_GIFT + ' 碎片') + '</div>'
            + '<div class="xj-hint"></div>'
            + '<button type="button" class="xj-btn xj-take">' + (adopt ? '付碎片帶走' : '收下') + '</button></div>');
        const hint = stage.querySelector('.xj-hint'), take = stage.querySelector('.xj-take');
        if (picker) DP.xjBindPicker(stage);
        take.addEventListener('click', async () => {
            if (take.disabled) return;
            const name = stage.querySelector('.xj-in-name').value.trim();
            if (!name) { hint.textContent = '先給它一個名字'; return; }
            take.disabled = true;
            const S = _g('OS_404_STORE');
            if (adopt && !(S && S.spendShards && S.spendShards(L.ADOPT_PRICE))) { hint.textContent = '碎片不夠（要 ' + L.ADOPT_PRICE + '）'; take.disabled = false; return; }
            const bodyBtn = stage.querySelector('.dorm-xj-body.active');
            const r = await X.adopt({ name: name, conn: stage.querySelector('.xj-in-conn').value, about: stage.querySelector('.xj-in-about').value, gift: !adopt,
                body: bodyBtn ? bodyBtn.dataset.body : undefined });
            if (!r.ok) {
                if (adopt && S && S.addShards) S.addShards(L.ADOPT_PRICE);   // 沒住進去：碎片退回
                hint.textContent = r.why || '沒成功'; take.disabled = false; return;
            }
            try { localStorage.setItem('xiaoji_box_opened', '1'); } catch (e) {}
            XT.mode = 'box';
            const CW = window.ChatWindow;
            if (CW && CW.closeSubPanel) CW.closeSubPanel();
            if (window.DormPanel && DormPanel.refreshXiaoji) DormPanel.refreshXiaoji();
        });
    }

    // 正在考的那一場：關子頁、換子頁、整個窗關掉、按「回培養室」都叫 stop（以前關了考試照跑、照叫模型）
    XT._ac = null;
    XT.stop = function () { const ac = XT._ac; XT._ac = null; if (ac) { try { ac.abort(); } catch (_) {} } };

    // ── 培養室：四張店門卡 ──────────────────────────────────
    XT.launch = async function (body) {
        XT.stop();
        const X = _X(), L = _L();
        if (!X || !L) { _missing(body); return; }
        const rid = XT.target;
        const CT = window.ClaudeTerminal;
        const r = (CT && CT.getResident) ? CT.getResident(rid) : null;
        if (!r || r.provider !== 'xiaoji') { body.innerHTML = '<div class="cw-sub-missing">找不到這隻小機</div>'; return; }
        const rec = await X.get(rid), money = await _money();
        const A = _g('AUI');
        const lesson = s => {
            const done = !!rec.skills[s.id];
            const unit = ((L.TEACHERS[s.teacher] || {}).money === 'pt') ? ' PT' : ' 碎片';
            const sub = done ? '學會了' : (rec.paid[s.id] ? '學費繳過了' : s.price + unit);
            return '<button type="button" class="xj-lesson' + (done ? ' is-done' : '') + '" data-sk="' + _esc(s.id) + '">'
                + '<span>' + (done ? '<i class="fa-solid fa-check"></i>' : '') + _esc(s.label) + '</span><small>' + _esc(sub) + '</small></button>';
        };
        const shop = key => {
            const T = L.TEACHERS[key] || {}, bg = SHOP_BG[key], p = _portrait(key);
            const list = L.SKILLS.filter(s => s.teacher === key);
            if (!list.length) return '';
            return '<section class="xj-shop" data-t="' + _esc(key) + '">'
                + (bg ? '<img class="xj-shop-bg" alt="" src="' + _esc(CDN + bg) + '">' : '')
                + (p ? '<img class="xj-shop-who" alt="" src="' + _esc(p) + '">' : '')
                + '<div class="xj-shop-hd"><span class="xj-shop-name">' + _esc(T.name || key) + '</span><span class="xj-shop-place">' + _esc(T.place || '') + '</span></div>'
                + '<div class="xj-lessons">' + list.map(lesson).join('') + '</div></section>';
        };
        body.innerHTML = '<div class="xj-home">'
            + '<div class="xj-top"><span class="xj-home-face"><i class="fa-solid fa-microchip"></i></span><span class="xj-me">' + _esc(r.name) + '</span>'
            + '<span class="xj-money"><i class="fa-solid fa-coins"></i> ' + money.pt + ' PT　<i class="fa-solid fa-gem"></i> ' + money.shards + ' 碎片</span>'
            + ((A && A.helpBtn) ? A.helpBtn('xiaoji_train') : '') + '</div>'
            + '<div class="xj-born"><i class="fa-solid fa-microchip"></i> 生下來就會：說話、翻資料</div>'
            + '<div class="xj-shops">' + Object.keys(L.TEACHERS).map(shop).join('') + '</div></div>';
        body.querySelectorAll('.xj-shop-who').forEach(_sizeWho);
        _xjFaceUrl(rid).then(url => {
            const f = body.querySelector('.xj-home-face');
            if (url && f && f.isConnected) f.outerHTML = '<img class="xj-home-face" src="' + _esc(url) + '" alt="">';
        });
        body.querySelectorAll('.xj-lesson').forEach(b => b.addEventListener('click', () => {
            if (b.classList.contains('is-done')) _certPage(body, rid, b.dataset.sk);
            else _lesson(body, rid, b.dataset.sk);
        }));
    };

    // ── 上課：老師講課 → 報名 ──────────────────────────────
    async function _lesson(body, rid, sid) {
        const X = _X(), L = _L();
        const sk = L.SKILLS.find(s => s.id === sid), T = L.TEACHERS[sk.teacher] || {};
        const c = await X.canEnroll(rid, sid);
        const sc = _scene(body, sk.teacher, { onBack: () => XT.launch(body) });
        if (!c.ok) { sc.say([c.why], null); return; }
        sc.say(X.lines(rid, sid, 'intro'), { name: T.name }, () => _enroll(sc, body, rid, sid, c));
    }
    async function _enroll(sc, body, rid, sid, c) {
        const sk = _L().SKILLS.find(s => s.id === sid);
        const unit = c.money === 'pt' ? ' PT' : ' 碎片';
        const m = await _money();
        const note = (c.paid ? '學費繳過了。' : '學費 ' + c.price + unit + '（你現在有 ' + (c.money === 'pt' ? m.pt + ' PT' : m.shards + ' 碎片') + '）。')
            + '考試最多叫 ' + sk.examCalls + ' 次模型' + (sk.make ? '（含專門做東西那一次）' : '')
            + (c.calls > sk.examCalls ? '；考過看小劇場再 1 次（之後重看不用）' : '') + '。';
        const offer = () => sc.choose([
            { label: c.paid ? '開始考試' : '繳學費 ' + c.price + unit + '，開始考試', main: true, on: async b => {
                b.disabled = true;
                const p = await _X().pay(rid, sid);
                if (!p.ok) { sc.say([p.why || '沒繳成'], null); offer(); return; }
                _exam(sc, body, rid, sid);
            } },
            { label: '先不要', on: () => XT.launch(body) }
        ]);
        sc.say([note], null);
        offer();
    }

    // 考試中：老師照樣站著，對話框換成小機在講（它講的話本來就生出來了，不多叫模型），右上一步一步打勾
    async function _exam(sc, body, rid, sid) {
        const X = _X(), L = _L(), sk = L.SKILLS.find(s => s.id === sid), T = L.TEACHERS[sk.teacher] || {};
        XT.stop();
        const ac = new AbortController();
        XT._ac = ac;
        const me = { name: _myName(rid), face: _xjFaceHtml(await _xjFaceUrl(rid)) };
        sc.show('在想怎麼做…', me, true);
        const steps = sc.setSteps('<ol class="xj-steps"></ol>').querySelector('.xj-steps');
        sc.choose([{ label: '停', on: () => ac.abort() }]);
        let cur = null;   // 正在做的那一步
        const done = ok => {
            if (!cur) return;
            cur.classList.remove('is-doing');
            cur.classList.add(ok === false ? 'is-bad' : 'is-ok');
            cur.querySelector('i').className = ok === false ? 'fa-solid fa-xmark' : 'fa-solid fa-check';
            cur = null;
        };
        const step = txt => {
            done();
            const li = document.createElement('li');
            li.className = 'xj-step is-doing';
            li.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span></span>';
            li.querySelector('span').textContent = txt;
            steps.appendChild(li);
            cur = li;
        };
        let res;
        try {
            res = await X.exam(rid, sid, { signal: ac.signal, onProgress: ev => {
                if (ev.type === 'call') step(ev.n === 1 ? '看題目' : '看結果，想下一步');
                else if (ev.type === 'text') { sc.show(ev.accumulated || '', me); done(); }
                else if (ev.type === 'tool-start') step(ev.label || '做事');
                else if (ev.type === 'tool') { if (cur && ev.ok === false) cur.querySelector('span').textContent += '：沒成功'; done(ev.ok); }
            } });
        } catch (e) {
            if (XT._ac === ac) XT._ac = null;
            sc.setSteps('');
            sc.say([_isAbort(e) ? '停下來了。學費繳過了，下次直接考。' : ('考場出了問題：' + ((e && e.message) || e))], null);
            sc.choose([{ label: '再考一次', main: true, on: () => _exam(sc, body, rid, sid) }, { label: '回培養室', on: () => XT.launch(body) }]);
            return;
        }
        if (XT._ac === ac) XT._ac = null;
        done();
        sc.setSteps('');
        if (res.pass) {
            if (window.DormPanel && DormPanel.refreshXiaoji) DormPanel.refreshXiaoji();
            sc.say(X.lines(rid, sid, 'pass'), { name: T.name }, () => _cert(sc, body, rid, sid, { calls: res.calls }));
        } else {
            sc.say(X.lines(rid, sid, 'fail').concat(res.why ? ['（' + res.why + '）'] : []), { name: T.name }, () => _failPage(sc, body, rid, sid, res));
        }
    }
    function _head(sk, T, chip, bad) {
        return '<div class="xj-cert-hd">' + _face(sk.teacher)
            + '<div class="xj-cert-ttl"><span class="xj-what">' + _esc((T.name || '') + '的課：' + sk.label) + '</span>'
            + '<span class="xj-chip' + (bad ? ' is-no' : ' is-ok') + '">' + _esc(chip) + '</span></div></div>';
    }
    // 沒考過：它說了什麼、交了什麼（做東西那幾門做出來的照樣能收下）、再考一次
    function _failPage(sc, body, rid, sid, res) {
        const L = _L(), sk = L.SKILLS.find(s => s.id === sid), T = L.TEACHERS[sk.teacher] || {};
        const stage = sc.card('<div class="xj-cert">' + _head(sk, T, '沒考過', true)
            + (res.why ? '<div class="xj-sec-txt">' + _esc(res.why) + '</div>' : '')
            + (res.said ? '<div class="xj-sec"><div class="xj-sec-lab">' + _esc(_myName(rid)) + '說</div><div class="xj-sec-txt xj-quote"></div></div>' : '')
            + '<div class="xj-sec"><div class="xj-sec-lab">' + _esc(_myName(rid)) + '交的作業</div><div class="xj-hw-slot"></div></div>'
            + '<div class="xj-calls">這次叫了 ' + res.calls + ' 次模型。再考不用再繳學費。</div>'
            + '<button type="button" class="xj-btn xj-again">再考一次</button></div>');
        const q = stage.querySelector('.xj-quote');
        if (q) q.textContent = res.said;
        _hwCard(stage.querySelector('.xj-hw-slot'), res.hw, { rid: rid, sid: sid, persist: false, none: '沒有交出作業' });
        stage.querySelector('.xj-again').addEventListener('click', () => _exam(sc, body, rid, sid));
    }
    // 學會的那門：從培養室點進來，直接是那間店的結業頁
    async function _certPage(body, rid, sid) {
        const sk = _L().SKILLS.find(s => s.id === sid);
        const sc = _scene(body, sk.teacher, { onBack: () => XT.launch(body) });
        await _cert(sc, body, rid, sid, {});
    }
    // 結業頁：它交的作業、它現在會什麼、小劇場、叫它試試
    async function _cert(sc, body, rid, sid, opt) {
        opt = opt || {};
        const X = _X(), L = _L(), sk = L.SKILLS.find(s => s.id === sid), T = L.TEACHERS[sk.teacher] || {};
        const CT = window.ClaudeTerminal;
        const rec = await X.get(rid), ent = rec.skills[sid] || {};
        const saved = !!(ent.theater && ent.theater.content);
        const canTh = saved || !!rec.theater;   // 門卡關了小劇場、也沒存過：不放這顆
        const thLabel = '<i class="fa-solid fa-masks-theater"></i> 看小劇場';
        const stage = sc.card('<div class="xj-cert">' + _head(sk, T, '考過了')
            + '<div class="xj-sec"><div class="xj-sec-lab">' + _esc(_myName(rid)) + '交的作業</div><div class="xj-hw-slot"></div></div>'
            + '<div class="xj-sec"><div class="xj-sec-lab">它現在會</div><div class="xj-sec-txt">' + _esc(sk.what || sk.label) + '</div></div>'
            + '<div class="xj-acts">'
            + (canTh ? '<button type="button" class="xj-btn2 xj-th">' + thLabel + '</button>' : '')
            + '<button type="button" class="xj-btn2 xj-try"><i class="fa-solid fa-comment-dots"></i> 叫它試試</button></div>'
            + (canTh && !saved ? '<div class="xj-sec-soft">小劇場第一次看會叫 1 次模型，之後重看不用</div>' : '')
            + '<div class="xj-hint xj-th-hint"></div>'
            + (opt.calls ? '<div class="xj-calls">這次考試叫了 ' + opt.calls + ' 次模型</div>' : '')
            + '</div>');
        _hwCard(stage.querySelector('.xj-hw-slot'), ent.hw, { rid: rid, sid: sid, persist: true, none: '那時候交的作業沒有留下來' });
        const thb = stage.querySelector('.xj-th'), hint = stage.querySelector('.xj-th-hint');
        if (thb) thb.addEventListener('click', async () => {
            if (thb.disabled) return;
            thb.disabled = true;
            hint.textContent = '';
            let ok = false;
            if (saved) ok = await X.replay(rid, sid);
            else {
                thb.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 正在演…';
                // 小劇場帶它跟使用者最近 20 則：照它們平常相處的樣子演，不自己編（10-05 她：小機把她當成跑團的 MC、亂編愛恨情仇）
                let recent = [];
                try { if (CT && CT.xiaojiRecent) recent = await CT.xiaojiRecent(rid, 20); } catch (_) {}
                ok = await X.theater(rid, sid, null, { recent });
            }
            // 小劇場在 VN 播放器播：把窗收起來，不然擋在播放器前面
            if (ok) { if (window.ChatWindow && ChatWindow.close) ChatWindow.close(); return; }
            thb.disabled = false;
            thb.innerHTML = thLabel;
            hint.textContent = saved ? '播不出來，等一下再試' : '沒演成，可以再按一次';
        });
        stage.querySelector('.xj-try').addEventListener('click', () => {
            const CW = window.ChatWindow;
            if (CT && CT.setActiveResident) CT.setActiveResident(rid);
            if (CW && CW.showRoom) Promise.resolve(CW.showRoom('xiaoji')).catch(e => console.warn('[XiaojiTrain] 回房間失敗', e));
        });
    }
    // 作業那一張：一句話＋樣子（跟單子小窗同一個預覽）＋收下／看大一點；改練習資料那幾門只給看改了什麼
    function _hwCard(slot, hw, ctx) {
        const E = _g('OS_AURELIA_EDIT'), W = _g('WX_TOOLS');
        if (!hw) { slot.innerHTML = '<div class="xj-sec-soft">' + _esc(ctx.none) + '</div>'; return; }
        if (!E || !E.text) { slot.innerHTML = '<div class="xj-sec-soft">要在奧瑞亞裡才看得到作業</div>'; return; }
        let line = '';
        try { line = E.text(hw, false); } catch (_) {}
        slot.innerHTML = '<div class="xj-hw"><div class="xj-hw-line"></div><div class="xj-hw-pv wxtl-pp-pv"></div><div class="xj-hw-acts"></div><div class="xj-hint"></div></div>';
        slot.querySelector('.xj-hw-line').textContent = line || hw.title || '';
        // 樣子：照模組給單子的那幾格，拿新的那一格（掛 wxtl-pp-pv＝借單子小窗那套預覽樣式）。
        //   聊天 app 主題：奧瑞亞畫得出假群聊（WX_THEME_PACK.sampleDoc，10-06）就畫它（'sample'＝不帶「先套上看看」，這裡沒有單子可以收尾）；舊版奧瑞亞照舊一句話
        const pv = slot.querySelector('.xj-hw-pv');
        let cards = [];
        if (hw.state !== 'practice' && E.sheet && E.mountPreview) { try { cards = E.sheet(hw).cards || []; } catch (_) {} }
        const TP = _g('WX_THEME_PACK');
        if (cards.some(c => c.preview === 'after')) { try { E.mountPreview(hw, 'after', pv); } catch (e) { pv.textContent = '畫不出樣子：' + ((e && e.message) || e); } }
        else if (cards.some(c => c.preview === 'try') && TP && TP.sampleDoc) { try { E.mountPreview(hw, 'sample', pv); } catch (e) { pv.textContent = '畫不出樣子：' + ((e && e.message) || e); } }
        else if (cards.some(c => c.preview === 'try')) pv.innerHTML = '<div class="xj-sec-soft">聊天 app 的主題要在聊天 app 裡才看得到樣子：收下之後，到聊天 app 的主題那裡換上。</div>';
        else pv.remove();
        const acts = slot.querySelector('.xj-hw-acts'), hint = slot.querySelector('.xj-hint');
        const persist = async () => { if (ctx.persist) { try { await _X().hwSave(ctx.rid, ctx.sid, hw); } catch (_) {} } };
        const paint = () => {
            const s = hw.state;
            let h = '';
            if (s === 'wait' || s === 'no') h += '<button type="button" class="xj-btn xj-keep">收下</button>';
            else if (s === 'done') h += '<span class="xj-chip is-ok">收進去了</span>';
            else if (s === 'undone') h += '<span class="xj-chip">改回去了</span>';
            else if (s === 'stale') h += '<span class="xj-chip is-no">收不進去</span>';
            h += '<button type="button" class="xj-btn2 xj-look">' + (s === 'practice' ? '看改了什麼' : '看大一點') + '</button>';
            acts.innerHTML = h;
            hint.textContent = s === 'stale' ? (hw.why || '') : hint.textContent;
        };
        acts.addEventListener('click', async e => {
            const b = e.target.closest('button');
            if (!b || b.disabled) return;
            if (b.classList.contains('xj-keep')) {
                b.disabled = true;
                b.textContent = '收進去中…';
                let r;
                try { r = await E.apply(hw); } catch (err) { r = { ok: false, text: (err && err.message) || '沒收成' }; }
                hint.textContent = r && r.ok ? '' : ((r && r.text) || '沒收成');
                await persist();
                paint();
                return;
            }
            if (b.classList.contains('xj-look')) {
                if (!W || !W.openPropSheet) { hint.textContent = '要在奧瑞亞裡才看得到'; return; }
                const host = slot.closest('#cw-subpanel') || slot.closest('.xj-scene') || document.body;
                W.openPropSheet(hw, host, async () => { await persist(); paint(); });
            }
        });
        paint();
    }
})();
