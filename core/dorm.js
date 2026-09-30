/**
 * core/dorm.js — 宿舍面板
 * ------------------------------------------------------------------
 * 點 💬 開的不再是四行下拉選單，而是一排門卡：每位住戶一張，點門進房。
 * 住戶名冊與會話隔離都在 claude_terminal.js（listResidents / saveResident /
 * deleteResident / setActiveResident），本檔只負責畫面與點按。
 * ------------------------------------------------------------------
 */
(function (DormPanel) {
    'use strict';
    const NAME_MAX = 20;

    let _el = null;
    let _editing = null;      // 展開編輯列的住戶 id；'__new__' = 底下那張新住戶卡
    let _delArmed = null;     // 兩段確認：已經按過第一下的住戶 id
    let _delTimer = null;
    let _opening = false;     // 擋連點兩張門卡

    // 心跳（會不會自己醒來）不存在住戶資料裡，狀態在橋的 board_kv。
    // 為什麼做在橋而不是 Windows 排程器：瀏覽器叫不動 schtasks，那樣她就得去雙擊 .bat；
    // 橋本來就常駐、本來就在收 HTTP，開關做在這裡才點得動。
    let _hb = {};             // rid → { enabled, hours_since, ... }
    // 奧瑞亞工具（09-30）：每位住戶勾哪幾組，存在橋上（/v1/aurelia/perm）。沒設過的＝三組全開（原本的樣子）。
    //   三組跟聊天 app 勾工具的名字一樣；住戶的工具服務只列他勾了的，三組都不勾就整個不掛。
    let _perm = {};           // rid → { look, wb, preset }
    const PERM_GROUPS = [
        { g: 'look', label: '翻資料', tip: '看她的故事、世界書、手機裡的東西' },
        { g: 'wb', label: '改世界書', tip: '提改世界書的單子，你按同意才寫進去' },
        { g: 'preset', label: '改預設', tip: '提改預設的單子，你按同意才寫進去' },
        { g: 'vn', label: '改組件', tip: '提改 VN 組件的單子（附預覽），你按同意才寫進去' },
    ];

    function _CT() { return window.ClaudeTerminal || null; }

    /** 橋的位址與金鑰（跟房間聊天共用同一組設定） */
    function _bridge() {
        const OS = window.OS_SETTINGS;
        const p = (OS && typeof OS.getActiveClaudePreset === 'function') ? OS.getActiveClaudePreset() : null;
        if (!p || !p.url || !p.key) return null;
        // 設定裡存的是 /v1/chat/completions，剝到根再接心跳那條
        const base = String(p.url).replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, '');
        return { base: base, key: p.key };
    }

    async function _hbLoad() {
        const b = _bridge();
        if (!b) { _hb = {}; return; }
        try {
            const r = await fetch(b.base + '/v1/heartbeat', { headers: { 'Authorization': 'Bearer ' + b.key } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            _hb = (j && j.residents) || {};
        } catch (e) {
            // 舊版橋沒有這條端點 → 當作沒人開著。不在這裡猜也不報錯：
            // 宿舍的主要功能跟心跳無關，不能因為它掛掉就打不開。
            _hb = {};
        }
    }

    async function _permLoad() {
        const b = _bridge();
        if (!b) { _perm = {}; return; }
        try {
            const r = await fetch(b.base + '/v1/aurelia/perm', { headers: { 'Authorization': 'Bearer ' + b.key } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            _perm = (j && j.perm) || {};
        } catch (e) {
            _perm = {};   // 舊的橋沒有這條：照全開畫，按了會跳「橋還沒重啟」
        }
    }
    function _permOf(id) {
        const p = _perm[id] || {};
        const out = {};
        PERM_GROUPS.forEach(x => { out[x.g] = p[x.g] !== false; });
        return out;
    }
    async function _permSet(id, perm) {
        const b = _bridge();
        if (!b) return { ok: false, msg: '還沒設好連線（⚙️ 裡的網址與密鑰）' };
        try {
            const res = await fetch(b.base + '/v1/aurelia/perm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + b.key },
                body: JSON.stringify(Object.assign({ rid: id }, perm)),
            });
            if (!res.ok) return { ok: false, msg: res.status === 404 ? '橋還沒重啟，重啟之後才改得了' : '橋回了 HTTP ' + res.status };
            const j = await res.json();
            _perm[id] = (j && j.perm) || perm;
            return { ok: true };
        } catch (e) {
            return { ok: false, msg: '連不上橋' };
        }
    }

    /** 開關某位住戶的心跳。住戶身分一起送，橋不必知道名冊（那在瀏覽器裡）。 */
    async function _hbSet(r, enabled) {
        const b = _bridge();
        if (!b) return { ok: false, msg: '還沒設好連線（⚙️ 裡的網址與密鑰）' };
        const CT = _CT();
        const home = (CT && typeof CT.residentHome === 'function') ? CT.residentHome(r.id) : '';
        try {
            const res = await fetch(b.base + '/v1/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + b.key },
                body: JSON.stringify({
                    resident_id: r.id,
                    enabled: !!enabled,
                    name: r.name,
                    backend: r.provider,
                    cwd: home || null,
                }),
            });
            if (!res.ok) return { ok: false, msg: '橋回了 HTTP ' + res.status + '（可能還沒重啟）' };
            return { ok: true };
        } catch (e) {
            return { ok: false, msg: '連不到橋：' + ((e && e.message) || e) };
        }
    }

    /** 「上次醒來」說成人話 */
    function _hbWhen(info) {
        if (!info || info.hours_since == null) return '還沒醒過';
        const h = info.hours_since;
        if (h < 1) return Math.max(1, Math.round(h * 60)) + ' 分鐘前醒過';
        if (h < 24) return Math.round(h) + ' 小時前醒過';
        return Math.round(h / 24) + ' 天前醒過';
    }

    function _cfg() {
        const OS = window.OS_SETTINGS;
        if (!OS || typeof OS.getClaudeRoomConfig !== 'function') return {};
        try { return OS.getClaudeRoomConfig() || {}; } catch (_) { return {}; }
    }

    function _models() {
        const room = window.VoidClaudeRoom;
        return (room && Array.isArray(room.claudeModels)) ? room.claudeModels : [];
    }

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** 模型的顯示名（共用資料層那支，別在這裡再養一份） */
    function _modelLabel(id) {
        const CT = _CT();
        if (CT && typeof CT.modelLabel === 'function') return CT.modelLabel(id);
        if (!id) return '';
        const m = _models().find(x => x.id === id);
        return m ? m.label : id;
    }

    /** 頭像角標用的短碼：Opus 4.6(舊) → 4.6 */
    function _modelBadge(id) {
        const cfg = _cfg();
        const nick = cfg.modelNames && cfg.modelNames[id];
        if (nick) return nick.slice(0, 4);
        const m = _models().find(x => x.id === id);
        const core = String((m ? m.label : id) || '').replace(/[(（].*$/, '').trim();
        const seg = core.split(/\s+/);
        return seg[seg.length - 1] || core;
    }

    /** 門卡上名字底下那行小字 */
    function _subtitle(r, all) {
        if (r.provider === 'codex')    return 'Codex';
        if (r.provider === 'deepseek') return 'DeepSeek';
        if (r.provider === 'group') {
            const CT = _CT();
            const seats = (CT && typeof CT.listGroupSeats === 'function') ? CT.listGroupSeats() : [];
            return seats.length ? seats.map(x => x.name).join('、') : '還沒有人上桌';
        }
        if (r.modelId) return _modelLabel(r.modelId) + (r.chatOnly ? ' · 只聊天' : '');
        const cfg = _cfg();
        // 沒鎖模型的住戶自己在房裡挑過就顯示那顆（丹、克語各記各的）
        const own = cfg.residentModels && cfg.residentModels[r.id];
        if (own) return _modelLabel(own);
        const cur = (cfg.providerModels && cfg.providerModels.claude) || cfg.inlineModel || cfg.model || '';
        return cur ? _modelLabel(cur) : '想用哪顆都行';
    }

    // ---- 頭像跟著打扮走（09-30）----
    //   她：「你們都換了裝飾，但所有頭像都沒變化的說，留言板也是這樣」。以前門卡、留言板、群成員格一律是預設那張小螃蟹
    //   （阿洛是 Codex 機器人）。現在跟房間裡那隻同一份打扮：橋 /v1/decor 的 wear，ClawdPortrait.renderStill 畫一格定格，
    //   裁掉四周的空白（影子不算）存成小圖。拿到之前先放原本那張，拿到了把畫面上同一位的頭像（[data-look]）都換掉。
    //   五分鐘內不重拿；房間裡他換了打扮（ChatWindow.refreshDecor）就重拿。Claude 那幾位沒打扮過照舊預設那張；
    //   阿洛一律畫他自己的洛德（沒打扮過也是）。拿不到（舊的橋、沒連線、畫布讀不出來）就照舊，不報錯。
    const LOOK_TTL = 5 * 60 * 1000;
    const _looks = {};          // rid → 小圖（data URL）；'' ＝沒打扮，用預設那張
    let _looksAt = 0, _looksJob = null;
    function _cropLook(cv) {
        const w = cv.width, h = cv.height;
        const data = cv.getContext('2d').getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (data[(y * w + x) * 4 + 3] <= 60) continue;   // 腳下的影子很淡，不算
                if (x < x0) x0 = x; if (x > x1) x1 = x;
                if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
        }
        if (x1 < 0) return '';
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1, side = Math.max(bw, bh) + 12;
        const out = document.createElement('canvas');
        out.width = out.height = side;
        const o = out.getContext('2d');
        o.imageSmoothingEnabled = false;
        o.drawImage(cv, x0, y0, bw, bh, Math.round((side - bw) / 2), Math.round((side - bh) / 2), bw, bh);
        return out.toDataURL('image/png');
    }
    async function _lookFor(r) {
        const CP = window.ClawdPortrait;
        const b = _bridge();
        if (!CP || typeof CP.renderStill !== 'function' || !b) return '';
        const res = await fetch(b.base + '/v1/decor?rid=' + encodeURIComponent(r.id), { headers: { 'Authorization': 'Bearer ' + b.key } });
        if (!res.ok) return '';
        const st = await res.json();
        const wear = st && st.wear;
        const base = r.provider === 'codex' ? 'lorde' : 'crab';
        if (base === 'crab' && !(wear && wear.own)) return '';
        const cv = document.createElement('canvas');
        await CP.renderStill(cv, wear, 'idle', 0, base);
        return _cropLook(cv);
    }
    function _paintLook(rid, url) {
        document.querySelectorAll('[data-look="' + (window.CSS && CSS.escape ? CSS.escape(rid) : rid) + '"]').forEach(el => {
            const badge = el.querySelector('.dorm-badge');
            el.classList.remove('dorm-face-codex', 'cw-mem-face-codex', 'cw-mem-icon');
            if (el.classList.contains('dorm-face')) el.classList.add('dorm-face-img');
            el.innerHTML = '<img class="ccr-look" src="' + url + '" alt="">' + (badge ? badge.outerHTML : '');
        });
    }
    function _loadLooks(force) {
        if (_looksJob) return _looksJob;
        if (!force && _looksAt && Date.now() - _looksAt < LOOK_TTL) return Promise.resolve();
        const CT = _CT();
        const list = ((CT && typeof CT.listResidents === 'function') ? CT.listResidents() : [])
            .filter(r => r && r.id && (r.provider === 'claude' || r.provider === 'codex'));
        _looksAt = Date.now();
        _looksJob = (async () => {
            for (const r of list) {
                let url = '';
                try { url = await _lookFor(r); } catch (_) { url = ''; }
                const had = _looks[r.id];
                _looks[r.id] = url;
                if (url && url !== had) _paintLook(r.id, url);
            }
        })().finally(() => { _looksJob = null; });
        return _looksJob;
    }
    // 門卡、留言板、群成員格要畫頭像時問這裡：有打扮過的小圖就回它（沒拿過或過期了順便去拿）
    function _lookSrc(r) {
        if (!_looksAt || Date.now() - _looksAt > LOOK_TTL) setTimeout(() => { _loadLooks(); }, 0);
        return (r && _looks[r.id]) || '';
    }

    function _faceHtml(r) {
        const look = (r.provider === 'claude' || r.provider === 'codex') ? _lookSrc(r) : '';
        const badge = r.modelId
            ? '<span class="dorm-badge">' + _esc(_modelBadge(r.modelId)) + '</span>'
            : '';
        if (look) return '<span class="dorm-face dorm-face-img" data-look="' + _esc(r.id) + '"><img class="ccr-look" src="' + look + '" alt="">' + badge + '</span>';
        if (r.provider === 'codex') {
            return '<span class="dorm-face dorm-face-codex" data-look="' + _esc(r.id) + '"></span>';
        }
        if (r.provider === 'deepseek') {
            return '<span class="dorm-face dorm-face-icon"><i class="fa-solid fa-user-tie"></i></span>';
        }
        if (r.provider === 'group') {
            return '<span class="dorm-face dorm-face-icon"><i class="fa-solid fa-users"></i></span>';
        }
        const CT = _CT() || {};
        const src = (CT.ASSETS && (CT.ASSETS.idle || CT.ASSETS.mini)) || '';
        const onerr = CT.imgOnError || '';
        return '<span class="dorm-face dorm-face-img" data-look="' + _esc(r.id) + '">'
            + '<img src="' + _esc(src) + '" alt="" onerror="' + _esc(onerr) + '">'
            + badge + '</span>';
    }

    /** 就地編輯列：r 為 null 代表底下那張「新住戶」 */
    function _formHtml(r) {
        const isNew = !r;
        const withModel = isNew || (!r.builtin && r.provider === 'claude');
        let h = '<div class="dorm-form">';
        h += '<input type="text" class="dorm-input dorm-in-name" maxlength="' + NAME_MAX
           + '" placeholder="名字" value="' + (r ? _esc(r.name) : '') + '">';
        if (withModel) {
            h += '<select class="dorm-input dorm-in-model">';
            _models().forEach(m => {
                const sel = (r && r.modelId === m.id) ? ' selected' : '';
                h += '<option value="' + _esc(m.id) + '"' + sel + '>' + _esc(_modelLabel(m.id)) + '</option>';
            });
            h += '</select>';
            // 只聊天 = 不帶 Claude Code 那套工具與系統指令進來（省三萬多 token 的 context）。
            // 預設「也能動手」—— 那是既有行為，不改變任何人的預期。
            const chatOn = !!(r && r.chatOnly);
            h += '<div class="dorm-mode">'
               + '<button type="button" class="dorm-mode-btn' + (chatOn ? '' : ' active') + '" data-mode="work">也能動手</button>'
               + '<button type="button" class="dorm-mode-btn' + (chatOn ? ' active' : '') + '" data-mode="chat">只聊天</button>'
               + '</div>';
        }
        // 奧瑞亞工具：只有會掛工具的（Claude、Codex 住戶）才有這排；按了當場存到橋上，不用等「改好了」
        if (r && (r.provider === 'claude' || r.provider === 'codex')) {
            const pm = _permOf(r.id);
            h += '<div class="dorm-perm"><span class="dorm-perm-lab">奧瑞亞工具</span><div class="dorm-mode dorm-perm-set">';
            PERM_GROUPS.forEach(x => {
                h += '<button type="button" class="dorm-perm-btn' + (pm[x.g] ? ' active' : '') + '" data-g="' + x.g + '" title="' + _esc(x.tip) + '">'
                   + _esc(x.label) + '</button>';
            });
            h += '</div></div>';
        }
        // 心跳的開關不放這裡 —— 這一列要按鉛筆才展得開，等於把狀態摺起來。
        // 它跟入席一樣是「一眼要看得到」的狀態，所以做成門卡上的常駐鈕（見 _wakeBtnHtml）。
        h += '<div class="dorm-form-act">';
        h += '<button type="button" class="dorm-btn dorm-save">' + (isNew ? '住進來' : '改好了') + '</button>';
        if (r && !r.builtin) {
            h += '<button type="button" class="dorm-btn dorm-del"><i class="fa-solid fa-box-archive"></i> 請他搬走</button>';
        }
        h += '</div><div class="dorm-hint"></div></div>';
        return h;
    }

    /** 門卡上的「自己醒來」鈕。跟入席鈕一樣是狀態，開著的常駐顯示、不必 hover 也不必展開。
     *  群聊區沒有 —— 那是桌子不是人。 */
    function _wakeBtnHtml(r) {
        if (r.provider === 'group') return '';
        const info = _hb[r.id];
        const on = !!(info && info.enabled);
        const when = on ? ('，' + _hbWhen(info)) : '';
        return '<button type="button" class="dorm-wake' + (on ? ' waking' : '') + '" title="'
            + (on ? '他會自己醒來' + when + '，點一下改成等妳開口' : '只有妳開口他才在，點一下讓他自己醒來')
            + '"><i class="fa-solid fa-heart-pulse"></i></button>';
    }

    function _cardHtml(r, all) {
        const open = _editing === r.id ? ' dorm-editing' : '';
        return '<div class="dorm-card' + open + '" data-id="' + _esc(r.id) + '">'
            + '<button type="button" class="dorm-door">'
            + _faceHtml(r)
            + '<span class="dorm-who">'
            + '<span class="dorm-name">' + _esc(r.name) + '</span>'
            + '<span class="dorm-sub">' + _esc(_subtitle(r, all)) + '</span>'
            + '</span>'
            + '<i class="fa-solid fa-chevron-right dorm-go"></i>'
            + '</button>'
            + _wakeBtnHtml(r)
            + '<button type="button" class="dorm-pen" title="改這位住戶"><i class="fa-solid fa-pen"></i></button>'
            + (_editing === r.id ? _formHtml(r) : '')
            + '</div>';
    }

    function _render() {
        if (!_el) return;
        const CT = _CT();
        const all = (CT && typeof CT.listResidents === 'function') ? CT.listResidents() : [];
        const newOpen = _editing === '__new__' ? ' dorm-editing' : '';
        let h = '<div class="dorm-list">';
        all.forEach(r => { h += _cardHtml(r, all); });
        h += '<div class="dorm-card dorm-new' + newOpen + '" data-id="__new__">'
            + '<button type="button" class="dorm-door dorm-door-new">'
            + '<span class="dorm-face dorm-face-icon"><i class="fa-solid fa-plus"></i></span>'
            + '<span class="dorm-who"><span class="dorm-name">新住戶</span>'
            + '<span class="dorm-sub">再請一位進來住</span></span>'
            + '</button>'
            + (_editing === '__new__' ? _formHtml(null) : '')
            + '</div>';
        h += '</div>';
        h += '<div class="dorm-hall">'
            + '<button type="button" class="dorm-hall-btn" data-panel="board"><i class="fa-solid fa-note-sticky"></i><span>留言板</span></button>'
            + '<button type="button" class="dorm-hall-btn" data-panel="spend"><i class="fa-solid fa-coins"></i><span>額度</span></button>'
            + '</div>';
        _el.innerHTML = h;
        _bind();
    }

    function _disarmDelete() {
        if (_delTimer) { clearTimeout(_delTimer); _delTimer = null; }
        _delArmed = null;
    }

    function _bind() {
        const x = _el.querySelector('.dorm-x');   // 嵌進主窗之後就沒有這顆了
        if (x) x.addEventListener('click', DormPanel.close);

        _el.querySelectorAll('.dorm-card').forEach(card => {
            const id = card.dataset.id;
            const door = card.querySelector('.dorm-door');
            const pen = card.querySelector('.dorm-pen');
            const wake = card.querySelector('.dorm-wake');

            if (wake) {
                wake.addEventListener('click', async (e) => {
                    e.stopPropagation();   // 別讓點擊冒到門上把房間開起來
                    const CT = _CT();
                    const r = CT && typeof CT.getResident === 'function' ? CT.getResident(id) : null;
                    if (!r || wake.dataset.busy) return;
                    const want = !wake.classList.contains('waking');
                    // 先反應再送：她點下去要當場看到變化，不然會以為沒吃到。
                    // 失敗再撥回來 —— 撥回去比一直轉圈更誠實。
                    wake.dataset.busy = '1';
                    wake.classList.toggle('waking', want);
                    const res = await _hbSet(r, want);
                    delete wake.dataset.busy;
                    if (!res.ok) {
                        wake.classList.toggle('waking', !want);
                        wake.title = res.msg || '沒設定成';
                        return;
                    }
                    await _hbLoad();
                    _render();   // 重畫拿到「上次醒來多久前」
                });
            }

            if (id === '__new__') {
                door.addEventListener('click', () => { _toggleEdit('__new__'); });
            } else {
                door.addEventListener('click', () => { _enter(id); });
                if (pen) pen.addEventListener('click', (e) => { e.stopPropagation(); _toggleEdit(id); });
            }

            const form = card.querySelector('.dorm-form');
            if (!form) return;
            const nameIn = form.querySelector('.dorm-in-name');
            const modelIn = form.querySelector('.dorm-in-model');
            const hint = form.querySelector('.dorm-hint');
            const save = form.querySelector('.dorm-save');
            const del = form.querySelector('.dorm-del');

            form.addEventListener('click', (e) => e.stopPropagation());
            form.querySelectorAll('.dorm-mode-btn').forEach(b => {
                b.addEventListener('click', () => {
                    form.querySelectorAll('.dorm-mode-btn').forEach(x => x.classList.remove('active'));
                    b.classList.add('active');
                });
            });
            form.querySelectorAll('.dorm-perm-btn').forEach(b => {
                b.addEventListener('click', async () => {
                    if (b.dataset.busy) return;
                    // 先反應再送，失敗撥回來（跟心跳鈕同一招）
                    const want = !b.classList.contains('active');
                    b.dataset.busy = '1';
                    b.classList.toggle('active', want);
                    const perm = {};
                    form.querySelectorAll('.dorm-perm-btn').forEach(x => { perm[x.dataset.g] = x.classList.contains('active'); });
                    const res = await _permSet(id, perm);
                    delete b.dataset.busy;
                    if (!res.ok) {
                        b.classList.toggle('active', !want);
                        hint.textContent = res.msg || '沒改成';
                        return;
                    }
                    hint.textContent = Object.values(perm).some(Boolean) ? '' : '三個都沒勾：他用不到奧瑞亞的工具';
                });
            });
            nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
            nameIn.addEventListener('input', () => {
                nameIn.classList.remove('dorm-warn');
                hint.textContent = '';
            });

            save.addEventListener('click', () => {
                const CT = _CT();
                if (!CT) return;
                const name = nameIn.value.trim();
                if (!name) {
                    nameIn.classList.add('dorm-warn');
                    hint.textContent = '先給他一個名字';
                    nameIn.focus();
                    return;
                }
                const modeBtn = form.querySelector('.dorm-mode-btn.active');
                const chatOnly = !!(modeBtn && modeBtn.dataset.mode === 'chat');
                if (id === '__new__') {
                    CT.saveResident({ name: name, provider: 'claude',
                                      modelId: modelIn ? modelIn.value : '', chatOnly: chatOnly });
                } else {
                    const before = CT.getResident(id);
                    const oldName = before ? before.name : '';
                    CT.saveResident({ id: id, name: name,
                                      modelId: modelIn ? modelIn.value : undefined,
                                      chatOnly: modeBtn ? chatOnly : undefined });
                    // 在席的人改了名，桌上其他人要知道 —— 不然逐字稿的講者前綴會無聲換人
                    if (oldName && oldName !== name && CT.isGroupSeated(id)
                        && window.ChatGroup && typeof window.ChatGroup.announceRename === 'function') {
                        window.ChatGroup.announceRename(oldName, name, true);   // 她改的
                    }
                    _syncOpenRoom(id);
                }
                _editing = null;
                _disarmDelete();
                _render();
            });

            if (del) {
                del.addEventListener('click', () => {
                    const CT = _CT();
                    if (!CT) return;
                    // 原生確認框會被瀏覽器擋掉，改成按兩下：三秒沒動作就當她反悔
                    if (_delArmed !== id) {
                        _disarmDelete();
                        _delArmed = id;
                        del.classList.add('dorm-armed');
                        del.innerHTML = '<i class="fa-solid fa-box-archive"></i> 真的？再按一次';
                        _delTimer = setTimeout(() => {
                            _disarmDelete();
                            del.classList.remove('dorm-armed');
                            del.innerHTML = '<i class="fa-solid fa-box-archive"></i> 請他搬走';
                        }, 3000);
                        return;
                    }
                    _disarmDelete();
                    // 名字跟在席狀態要在刪之前抓 —— 刪完就查不到了
                    const gone = CT.getResident(id);
                    const wasSeated = typeof CT.isGroupSeated === 'function' && CT.isGroupSeated(id);
                    if (CT.deleteResident(id) && window.ChatGroup
                        && typeof window.ChatGroup.noteResidentRemoved === 'function') {
                        window.ChatGroup.noteResidentRemoved(id, gone ? gone.name : '', wasSeated);
                    }
                    _editing = null;
                    _render();
                });
            }
            setTimeout(() => { try { nameIn.focus(); } catch (_) {} }, 0);
        });

        _el.querySelectorAll('.dorm-hall-btn').forEach(b => {
            b.addEventListener('click', () => _enterHall(b.dataset.panel));
        });
    }

    function _toggleEdit(id) {
        _editing = (_editing === id) ? null : id;
        _disarmDelete();
        _render();
    }

    /** 改名字的時候房間正開著，順手把標題列換掉 */
    function _syncOpenRoom(id) {
        const CT = _CT();
        const CW = window.ChatWindow;
        if (!CT || !CW || typeof CW.refreshIdentity !== 'function') return;
        const r = CT.getResident(id);
        if (r && typeof CT.getActiveResidentId === 'function' && CT.getActiveResidentId(r.provider) === id) {
            CW.refreshIdentity();
        }
    }

    /** 防連點只鎖一下下，不跟房間載得快不快綁在一起——
     *  群聊房載入要等網路，鎖在那邊等於整個面板從此點不動。 */
    function _armOpening() {
        _opening = true;
        setTimeout(() => { _opening = false; }, 600);
    }

    function _enter(id) {
        const CT = _CT();
        const CW = window.ChatWindow;
        if (!CT || !CW || _opening) return;
        const r = CT.getResident(id);
        if (!r) return;
        _armOpening();
        CT.setActiveResident(r.id);
        // 就地換頁 —— 以前這裡是關掉宿舍浮層、再開一個房間浮窗，
        // 兩個窗各自定位，畫面上就成了兩塊各飄各的東西。
        Promise.resolve(CW.showRoom(r.provider)).catch(e => console.warn('[DormPanel] 進房失敗', e));
    }

    function _enterHall(panel) {
        const CW = window.ChatWindow;
        if (!CW || _opening) return;
        _armOpening();
        // 走廊那兩個（留言板／額度）是主窗的子面板，窗已經開著，直接疊上去就好。
        // 不必先把房間讀起來 —— 那會多等好幾秒（進過群聊之後特別慢），而且看完子面板
        // 按「‹ 返回」本來就該回到宿舍，不是掉進某個房間。
        if (typeof CW.openSubPanel === 'function') CW.openSubPanel(panel);
    }

    /**
     * 把門卡畫進主窗的宿舍頁。以前 DormPanel 自己造一個 #ccr-dorm 浮層、自己算座標、
     * 自己處理「點外面關掉」—— 那套整組拿掉了，現在它只負責內容。
     */
    // 留言板（朋友圈樣）的頭像跟門卡同一套，不另外養一份
    DormPanel.faceHtml = _faceHtml;
    // 群成員格也用同一份打扮小圖；房間裡他換了打扮就叫 forgetLooks 重拿
    DormPanel.lookSrc = _lookSrc;
    DormPanel.forgetLooks = function () { _looksAt = 0; return _loadLooks(true); };

    DormPanel.renderInto = function (container) {
        if (!container) return;
        _el = container;
        _editing = null;
        _disarmDelete();
        _render();
        // 心跳狀態在橋那邊，拉回來之後再畫一次。先畫是刻意的：宿舍不能等網路，
        // 拉不到就維持「全部關著」的樣子，而不是卡在空白。
        Promise.all([_hbLoad(), _permLoad()]).then(function () { if (_el === container) _render(); });
    };

    // 以下三支保留原本的名字（輸入列那顆鈕、手機浮球、斜線命令都在叫它們），
    // 但實作全部轉給主窗 —— 宿舍已經是主窗的一頁，不是獨立的東西。
    DormPanel.open = function () {
        const CW = window.ChatWindow;
        if (CW && typeof CW.openDorm === 'function') CW.openDorm();
    };

    DormPanel.toggle = function () {
        const CW = window.ChatWindow;
        if (!CW) return;
        // 已經開著而且正停在宿舍頁 → 收起來；其他情況一律帶她回宿舍
        if (typeof CW.isOpen === 'function' && CW.isOpen()
            && typeof CW.getView === 'function' && CW.getView() === 'dorm') {
            CW.close();
        } else if (typeof CW.openDorm === 'function') {
            CW.openDorm();
        }
    };

    DormPanel.close = function () {
        const CW = window.ChatWindow;
        if (CW && typeof CW.close === 'function') CW.close();
    };

    DormPanel.isOpen = function () {
        const CW = window.ChatWindow;
        return !!(CW && typeof CW.isOpen === 'function' && CW.isOpen()
                  && typeof CW.getView === 'function' && CW.getView() === 'dorm');
    };

    /** 住戶名字改了、正停在宿舍頁就重畫 */
    DormPanel.refresh = function () {
        if (DormPanel.isOpen() && _el) _render();
    };

    console.log('[DormPanel] 宿舍面板已載入');

})(window.DormPanel = window.DormPanel || {});
