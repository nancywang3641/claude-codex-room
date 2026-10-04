// ----------------------------------------------------------------
// [檔案] xiaoji_train.js — API 小機的開箱與培養室畫面（2026-10-01）
// 引擎在奧瑞亞（OS_XIAOJI）；這支只畫畫面，掛在主窗的子頁：ChatWindow.openSubPanel('xiaoji_box'／'xiaoji_train')。
//   ・box：404 寄來的箱子（第一隻免費、附碎片）；mode 'adopt'＝在 404 黑市買第二隻以後（付碎片、柴郡另一句）
//   ・launch：培養室——技能樹，點一門上課：老師台詞 → 報名（寫學費與要叫幾次模型）→ 考試 → 過了演小劇場
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
        body: '小機學會一門課，才看得到那一組工具。\n上課要繳學費：瀅瀅、帽匠收 PT，柴郡、丹收碎片。\n考試是小機在練習用的資料上做一題，不會動到你真的東西。考試和考過的小劇場會叫模型，報名時會寫要叫幾次。\n沒考過可以再考，不用再繳學費。\n你自己用創作室、設定，一樣都不受影響。' } });

    function _face(key) {
        const N = _g('LobbyNpcs');
        const t = !N ? null : (key === 'dan' ? (N.snResident && N.snResident('dan')) : (N.staff && N.staff(key)));
        return (t && t.portrait) ? '<img class="xj-face" src="' + _esc(t.portrait) + '" alt="">'
            : '<span class="xj-face xj-face-none"><i class="fa-solid fa-user"></i></span>';
    }
    function _missing(body) { body.innerHTML = '<div class="cw-sub-missing">要在酒館或手機的奧瑞亞裡才養得了小機</div>'; }
    // 一句一句講，點「繼續」換下一句，講完叫 done
    function _talk(host, key, name, lines, done) {
        let i = 0;
        host.innerHTML = '<div class="xj-talk">' + _face(key) + '<div class="xj-talk-who">' + _esc(name) + '</div>'
            + '<div class="xj-talk-line"></div><button type="button" class="xj-btn xj-next"></button></div>';
        const line = host.querySelector('.xj-talk-line'), next = host.querySelector('.xj-next');
        const show = () => { line.textContent = lines[i] || ''; next.textContent = i >= lines.length - 1 ? '好' : '繼續'; };
        next.addEventListener('click', () => { if (i < lines.length - 1) { i++; show(); } else done(); });
        show();
    }
    async function _money() {
        const P = _g('OS_PT'), S = _g('OS_404_STORE');
        let pt = 0;
        try { pt = (P && P.getPT) ? await P.getPT() : 0; } catch (e) {}
        return { pt: pt, shards: (S && S.getShards) ? S.getShards() : 0 };
    }

    // ── 開箱 ──────────────────────────────────────────────
    XT.box = function (body) {
        const X = _X(), L = _L();
        if (!X || !L) { _missing(body); return; }
        const adopt = XT.mode === 'adopt';
        body.innerHTML = '<div class="xj-page"><div class="xj-stage"></div></div>';
        const stage = body.querySelector('.xj-stage');
        _talk(stage, 'cheshire', '柴郡', X.lines('', adopt ? 'adopt' : 'box'), () => _boxForm(stage, adopt));
    };
    function _boxForm(stage, adopt) {
        const X = _X(), L = _L();
        const opts = (X.connList() || []).map(c => '<option value="' + _esc(c.id) + '">' + _esc(c.label) + '</option>').join('');
        const DP = window.DormPanel;
        const picker = (DP && DP.xjBodyPicker && X.BODIES) ? DP.xjBodyPicker(X.BODIES[0].id) : '';
        stage.innerHTML = '<div class="xj-form">'
            + '<label class="xj-lab">名字</label><input type="text" class="xj-in xj-in-name" maxlength="20">'
            + (picker ? '<label class="xj-lab">樣子（之後在門卡上能換）</label>' + picker : '')
            + '<label class="xj-lab">它說話走哪個接口</label><select class="xj-in xj-in-conn">' + opts + '</select>'
            + '<label class="xj-lab">它是什麼樣的（可以不寫）</label><textarea class="xj-in xj-in-about" rows="2" maxlength="300"></textarea>'
            + '<div class="xj-cost">' + (adopt ? '要付 ' + L.ADOPT_PRICE + ' 碎片' : '箱子裡附了 ' + L.BOX_GIFT + ' 碎片') + '</div>'
            + '<div class="xj-hint"></div>'
            + '<button type="button" class="xj-btn xj-take">' + (adopt ? '付碎片帶走' : '收下') + '</button></div>';
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

    // ── 培養室 ────────────────────────────────────────────
    XT.launch = async function (body) {
        const X = _X(), L = _L();
        if (!X || !L) { _missing(body); return; }
        const rid = XT.target;
        const CT = window.ClaudeTerminal;
        const r = (CT && CT.getResident) ? CT.getResident(rid) : null;
        if (!r || r.provider !== 'xiaoji') { body.innerHTML = '<div class="cw-sub-missing">找不到這隻小機</div>'; return; }
        const rec = await X.get(rid), money = await _money();
        const A = _g('AUI');
        const node = s => {
            const done = !!rec.skills[s.id];
            const unit = ((L.TEACHERS[s.teacher] || {}).money === 'pt') ? ' PT' : ' 碎片';
            const sub = done ? '學會了' : (rec.paid[s.id] ? '學費繳過了' : '學費 ' + s.price + unit);
            return '<button type="button" class="xj-node' + (done ? ' xj-done' : '') + '" data-sk="' + s.id + '">'
                + '<span class="xj-node-name">' + _esc(s.label) + '</span><span class="xj-node-sub">' + _esc(sub) + '</span>'
                + (done ? '<i class="fa-solid fa-circle-check"></i>' : '') + '</button>';
        };
        const col = key => '<div class="xj-col"><div class="xj-col-hd">' + _face(key) + '<span>' + _esc((L.TEACHERS[key] || {}).name || key) + '</span></div>'
            + L.SKILLS.filter(s => s.teacher === key).map(node).join('') + '</div>';
        body.innerHTML = '<div class="xj-page">'
            + '<div class="xj-top"><span class="xj-me">' + _esc(r.name) + '</span>'
            + '<span class="xj-money"><i class="fa-solid fa-coins"></i> ' + money.pt + ' PT　<i class="fa-solid fa-gem"></i> ' + money.shards + ' 碎片</span>'
            + ((A && A.helpBtn) ? A.helpBtn('xiaoji_train') : '') + '</div>'
            + '<div class="xj-born"><i class="fa-solid fa-microchip"></i> 生下來就會：說話、翻資料</div>'
            + '<div class="xj-tree">' + col('ying') + col('hatter') + col('cheshire') + '</div>'
            + '<div class="xj-last">' + col('dan') + '</div></div>';
        body.querySelectorAll('.xj-node').forEach(b => b.addEventListener('click', () => {
            if (!b.classList.contains('xj-done')) _lesson(body, rid, b.dataset.sk);
        }));
    };
    async function _lesson(body, rid, sid) {
        const X = _X(), L = _L();
        const sk = L.SKILLS.find(s => s.id === sid), T = L.TEACHERS[sk.teacher] || {};
        const c = await X.canEnroll(rid, sid);
        body.innerHTML = '<div class="xj-page"><button type="button" class="xj-back"><i class="fa-solid fa-chevron-left"></i> 回培養室</button><div class="xj-stage"></div></div>';
        body.querySelector('.xj-back').addEventListener('click', () => XT.launch(body));
        const stage = body.querySelector('.xj-stage');
        if (!c.ok) { stage.innerHTML = '<div class="xj-note">' + _esc(c.why) + '</div>'; return; }
        _talk(stage, sk.teacher, T.name, X.lines(rid, sid, 'intro'), () => _enroll(stage, rid, sid, c));
    }
    function _enroll(stage, rid, sid, c) {
        const sk = _L().SKILLS.find(s => s.id === sid), T = _L().TEACHERS[sk.teacher] || {};
        const unit = c.money === 'pt' ? ' PT' : ' 碎片';
        stage.innerHTML = '<div class="xj-form">'
            + '<div class="xj-what">' + _esc(T.name || '') + '的課：' + _esc(sk.label) + '</div>'
            + '<div class="xj-cost">' + (c.paid ? '學費繳過了' : '學費 ' + c.price + unit) + '</div>'
            + '<div class="xj-cost">考試最多叫 ' + sk.examCalls + ' 次模型' + (sk.make ? '（含專門做東西那一次）' : '')
            + (c.calls > sk.examCalls ? '；考過演小劇場再 1 次' : '') + '</div>'
            + '<div class="xj-hint"></div>'
            + '<button type="button" class="xj-btn xj-go">' + (c.paid ? '開始考試' : '繳學費、開始考試') + '</button></div>';
        const go = stage.querySelector('.xj-go'), hint = stage.querySelector('.xj-hint');
        go.addEventListener('click', async () => {
            if (go.disabled) return;
            go.disabled = true;
            const p = await _X().pay(rid, sid);
            if (!p.ok) { hint.textContent = p.why || '沒繳成'; go.disabled = false; return; }
            _exam(stage, rid, sid);
        });
    }
    async function _exam(stage, rid, sid) {
        const X = _X(), L = _L(), sk = L.SKILLS.find(s => s.id === sid), T = L.TEACHERS[sk.teacher] || {};
        const ac = new AbortController();
        stage.innerHTML = '<div class="xj-form"><div class="xj-doing">考試中…</div><button type="button" class="xj-btn xj-stop">停</button></div>';
        const doing = stage.querySelector('.xj-doing');
        stage.querySelector('.xj-stop').addEventListener('click', () => ac.abort());
        const again = (msg) => {
            stage.innerHTML = '<div class="xj-note">' + _esc(msg) + '</div><button type="button" class="xj-btn xj-again">再考一次</button>';
            stage.querySelector('.xj-again').addEventListener('click', () => _exam(stage, rid, sid));
        };
        let res;
        try {
            res = await X.exam(rid, sid, { signal: ac.signal, onProgress: ev => {
                if (ev.type === 'call') doing.textContent = '考試中…第 ' + ev.n + ' 次';
                else if (ev.type === 'tool') doing.textContent = '正在' + ev.label + '…';
            } });
        } catch (e) {
            again(_isAbort(e) ? '停下來了。學費繳過了，下次直接考。' : ('考場出了問題：' + ((e && e.message) || e)));
            return;
        }
        if (res.pass) {
            _talk(stage, sk.teacher, T.name, X.lines(rid, sid, 'pass'), async () => {
                stage.innerHTML = '<div class="xj-note">學會了「' + _esc(sk.label) + '」。這次叫了 ' + res.calls + ' 次模型。</div>';
                if (window.DormPanel && DormPanel.refreshXiaoji) DormPanel.refreshXiaoji();
                // 小劇場帶它跟使用者最近 20 則：照它們平常相處的樣子演，不自己編（10-05 她：小機把她當成跑團的 MC、亂編愛恨情仇）
                let recent = [];
                try { if (window.ClaudeTerminal && ClaudeTerminal.xiaojiRecent) recent = await ClaudeTerminal.xiaojiRecent(rid, 20); } catch (_) {}
                const played = await X.theater(rid, sid, res.summary, { recent });
                // 小劇場在 VN 播放器播：把窗收起來，不然擋在播放器前面
                if (played && window.ChatWindow && ChatWindow.close) ChatWindow.close();
            });
        } else {
            const ln = X.lines(rid, sid, 'fail').concat(res.why ? ['（' + res.why + '）'] : []);
            _talk(stage, sk.teacher, T.name, ln, () => again('沒考過。這次叫了 ' + res.calls + ' 次模型。再考不用再繳學費。'));
        }
    }
})();
