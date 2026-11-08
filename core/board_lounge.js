// ----------------------------------------------------------------
// [檔案] board_lounge.js —— 留言板最上面的交誼廳（window.BoardLounge）
// 11-09 她看了阿洛畫的交誼廳說「接進去」：留言板封面換成這間客廳，開著「自己醒來」的住戶在裡面走來走去。
//   圖是阿洛的 SVG（core/assets/lounge/，浮起來的地方我修過，產圖程式在房間 tmp/lounge）：
//   背景 → 小人 → 前景茶几，三層同一個 940×450 座標。
//   小人是房間同一套像素小人（ClawdPortrait.renderStill，跟宿舍門窗、房間立繪同一份打扮），整張畫布不裁，
//   大家同一個比例、腳底都在畫布同一列，換了打扮也不會飄。
// 走動只是畫面：不叫模型、不碰心跳、不代表他醒著。好久沒醒的（stopped）坐在椅子上睡。
// 站位只有固定幾個：位置和前後層寫在 css/board_lounge.css 的 .ob-lg-at-<站位>／.ob-lg-z-<站位>（不寫 inline style），
//   這裡只記誰能走去哪、左右（決定臉朝哪邊）。兩邊的座標要一起改。
// 點小人、近況小卡在 os_board.js（它有醒來紀錄、日程那些資料），這支只管畫和走。
// 沒載入這支的地方（奧瑞亞 board.html 通知點進來那頁）留言板照舊畫一排頭像。
// ----------------------------------------------------------------
(function () {
    'use strict';

    // x、y＝腳底在 940×450 圖上的位置（只拿 x 算臉朝哪、拿距離算走多久；畫面上的位置看 CSS）
    // 前排、後排都在家具前面的地上；seat 是座位，只能從旁邊那個地上的位置跳上去／跳下來
    const SPOTS = [
        { k: 'tea', x: 125, y: 372 }, { k: 'fridge', x: 262, y: 382 }, { k: 'win', x: 715, y: 372 },
        { k: 'fl', x: 178, y: 412 }, { k: 'rugl', x: 318, y: 394 }, { k: 'fm', x: 470, y: 414 },
        { k: 'rugr', x: 610, y: 394 }, { k: 'fr', x: 800, y: 412 },
        { k: 'sofal', x: 385, y: 306, from: 'rugl' }, { k: 'sofar', x: 595, y: 306, from: 'rugr' },
        { k: 'chair', x: 815, y: 333, from: 'fr' },
    ];
    const SPOT = {};
    SPOTS.forEach(s => { SPOT[s.k] = s; });
    const FLOOR = SPOTS.filter(s => !s.from).map(s => s.k);
    const SEATS = SPOTS.filter(s => s.from).map(s => s.k);
    // 第一次進來站哪：睡著的先坐椅子、沙發，其他人照這個順序站
    const FIRST_FLOOR = ['rugl', 'win', 'tea', 'rugr', 'fridge', 'fm', 'fl', 'fr'];
    const FIRST_SEAT = ['chair', 'sofal', 'sofar'];
    const DUR = [1600, 2600, 3600, 4600];      // 走多久：跟 CSS 的 .ob-lg-d1～d4 一樣

    const _pos = {};       // rid → 上次站的地方（板子重畫時接著站，不會整群跳位置）

    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _assetBase() {
        const a = window.__CCR_ASSET_BASE__ || (function () { try { return window.parent && window.parent.__CCR_ASSET_BASE__; } catch (_) { return ''; } })();
        const base = a ? String(a).replace(/claude\/?$/, 'lounge/') : 'scripts/extensions/third-party/claude-codex-room/core/assets/lounge/';
        return base;
    }
    function _src(name) {
        const v = window.__CCR_VER__;
        return _assetBase() + name + (v ? '?v=' + v : '');
    }

    /** 這次每個人站哪：上次站的還空著就接著站；睡著的盡量坐著，醒著的站地上 */
    function _place(people) {
        const used = {}, out = {};
        const take = k => { used[k] = 1; return k; };
        people.forEach(p => {
            const k = _pos[p.rid];
            if (!k || !SPOT[k] || used[k]) return;
            const sleepy = p.tone === 'stopped';
            // 睡著的不站在地上（剛變成好久沒醒的，換去坐）
            if (sleepy && !SPOT[k].from) return;
            out[p.rid] = take(k);
        });
        people.forEach(p => {
            if (out[p.rid]) return;
            const order = p.tone === 'stopped' ? FIRST_SEAT.concat(FIRST_FLOOR) : FIRST_FLOOR.concat(FIRST_SEAT);
            const k = order.find(x => !used[x]);
            if (k) out[p.rid] = take(k);
        });
        Object.keys(out).forEach(rid => { _pos[rid] = out[rid]; });
        return out;
    }

    /** 整間客廳。people：[{ rid, name, tone, title, link }]（os_board 算好的：誰、狀況、滑過去的字、點不點得開紀錄）。
     *  比站位多的人這次先不畫（11 個位置，宿舍很少這麼多人開著自己醒來）。 */
    function sceneHtml(people) {
        const list = (people || []).slice(0, SPOTS.length);
        const at = _place(list);
        let h = '<div class="ob-lg">'
            + '<img class="ob-lg-bg" src="' + _esc(_src('lounge_bg.svg')) + '" alt="" draggable="false">'
            + '<div class="ob-lg-people">';
        list.forEach(p => {
            const k = at[p.rid];
            if (!k) return;
            h += '<button type="button" class="ob-wake ob-lg-p ob-wake-' + _esc(p.tone || 'quiet') + (p.link ? ' is-link' : '')
                + ' ob-lg-at-' + k + ' ob-lg-z-' + k + (SPOT[k].x > 600 ? ' is-left' : '') + '"'
                + ' data-rid="' + _esc(p.rid) + '" data-spot="' + k + '" title="' + _esc(p.title || p.name) + '">'
                + '<span class="ob-lg-fig"><img class="ob-lg-img" alt="" draggable="false"></span>'
                + '<span class="ob-lg-hit"></span>'
                + '<span class="ob-wake-name">' + _esc(p.name) + '</span>'
                + '</button>';
        });
        h += '</div>'
            + '<img class="ob-lg-fg" src="' + _esc(_src('lounge_fg.svg')) + '" alt="" draggable="false">'
            + (list.length ? '' : '<div class="ob-lg-empty">還沒有人開著自己醒來</div>')
            + '</div>';
        return h;
    }

    // ---- 小人的樣子：跟宿舍門窗同一份打扮 ----
    function _resident(rid) {
        try {
            const CT = window.ClaudeTerminal;
            const list = (CT && typeof CT.listResidents === 'function') ? CT.listResidents() : [];
            return list.find(r => r && r.id === rid) || null;
        } catch (_) { return null; }
    }
    function _XJ() { return window.OS_XIAOJI || (function () { try { return window.parent && window.parent.OS_XIAOJI; } catch (_) { return null; } })(); }

    // rid → Promise<{ key, open, blink, sleep: [三格] }>；五分鐘內不重畫（打扮換了 DormPanel.wearOf 會拿到新的）
    const _looks = {};
    const LOOK_TTL = 5 * 60 * 1000;
    async function _still(CP, wear, state, f, base) {
        const cv = document.createElement('canvas');
        await CP.renderStill(cv, wear, state, f, base);
        return cv.toDataURL('image/png');
    }
    async function _lookOf(rid) {
        const CP = window.ClawdPortrait;
        if (!CP || typeof CP.renderStill !== 'function') return null;
        const r = _resident(rid);
        const prov = r ? r.provider : '';
        let base = 'crab', wear = null;
        if (prov === 'codex') base = 'lorde';
        else if (prov === 'deepseek') base = 'whale';      // 鯨魚不去橋上問打扮（宿舍門窗也一樣）
        else if (prov === 'xiaoji') {
            const X = _XJ(), RW = window.RoomWear;
            const rec = X && typeof X.get === 'function' ? await X.get(rid).catch(() => null) : null;
            base = (X && rec && typeof X.bodyOf === 'function') ? X.bodyOf(rec) : 'hamster';
            wear = (rec && RW && typeof RW.client === 'function' && !(RW.plain && RW.plain(rec))) ? RW.client(rec.wear) : null;
        }
        if ((prov === 'claude' || prov === 'codex' || !prov) && window.DormPanel && typeof window.DormPanel.wearOf === 'function') {
            wear = await window.DormPanel.wearOf(rid);
        }
        const key = base + '|' + JSON.stringify(wear || null);
        const [open, blink, s0, s1, s2] = await Promise.all([
            _still(CP, wear, 'idle', 0, base), _still(CP, wear, 'idle', 5, base),
            _still(CP, wear, 'sleeping', 0, base), _still(CP, wear, 'sleeping', 5, base), _still(CP, wear, 'sleeping', 10, base),
        ]);
        return { key, open, blink, sleep: [s0, s1, s2] };
    }
    function _look(rid) {
        const c = _looks[rid];
        if (c && Date.now() - c.at < LOOK_TTL) return c.job;
        const job = _lookOf(rid).catch(() => null);
        _looks[rid] = { at: Date.now(), job };
        return job;
    }
    function _paint(el) {
        const img = el.querySelector('.ob-lg-img');
        if (!img) return;
        _look(el.dataset.rid).then(L => {
            if (!L || !el.isConnected) return;
            el._lgLook = L;
            el._lgSleep = 0;
            img.src = el.classList.contains('ob-wake-stopped') ? L.sleep[0] : L.open;
            el.classList.add('is-drawn');
        });
    }

    // ---- 走動 ----
    const _reduce = () => { try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };

    function _move(el, to) {
        const from = SPOT[el.dataset.spot], dest = SPOT[to];
        if (!from || !dest) return;
        const dx = dest.x - from.x, dy = dest.y - from.y;
        const dist = Math.hypot(dx, dy * 2);
        const seat = !!(from.from || dest.from);
        const d = seat ? 0 : (dist < 150 ? 0 : dist < 300 ? 1 : dist < 480 ? 2 : 3);
        // 走的時候前後層照前面那一端（從茶几前面走到茶几後面，走的途中還在茶几前面），到了才換成目的地的
        const front = dest.y >= from.y ? dest.k : from.k;
        if (dx < -4) el.classList.add('is-left');
        else if (dx > 4) el.classList.remove('is-left');
        el.classList.remove('ob-lg-at-' + from.k, 'ob-lg-z-' + from.k);
        el.classList.add('ob-lg-at-' + dest.k, 'ob-lg-z-' + front, 'ob-lg-d' + (d + 1), seat ? 'is-hop' : 'is-walk');
        el.dataset.spot = dest.k;
        _pos[el.dataset.rid] = dest.k;
        const ms = _reduce() ? 0 : DUR[d];
        setTimeout(() => {
            el.classList.remove('is-hop', 'is-walk', 'ob-lg-d' + (d + 1), 'ob-lg-z-' + front);
            el.classList.add('ob-lg-z-' + dest.k);
        }, ms + 80);
    }

    function _step(scene) {
        const all = [...scene.querySelectorAll('.ob-lg-p')];
        const used = {};
        all.forEach(el => { used[el.dataset.spot] = 1; });
        const free = k => !used[k];
        const idle = all.filter(el => !el.classList.contains('is-on') && !el.classList.contains('is-walk')
            && !el.classList.contains('is-hop') && !el.classList.contains('ob-wake-stopped'));
        if (!idle.length || Math.random() < 0.4) return;
        const el = idle[Math.floor(Math.random() * idle.length)];
        const cur = SPOT[el.dataset.spot];
        if (!cur) return;
        if (cur.from) {
            // 坐著的：坐一陣子才起來
            if (Math.random() < 0.55 && free(cur.from)) _move(el, cur.from);
            return;
        }
        const seats = SEATS.filter(k => SPOT[k].from === cur.k && free(k));
        if (seats.length && Math.random() < 0.35) { _move(el, seats[0]); return; }
        const floors = FLOOR.filter(k => k !== cur.k && free(k));
        if (floors.length) _move(el, floors[Math.floor(Math.random() * floors.length)]);
    }

    // 眨眼、睡著的 z 飄起來：整間一個計時器
    function _tick(scene) {
        const all = [...scene.querySelectorAll('.ob-lg-p.is-drawn')];
        all.forEach(el => {
            const L = el._lgLook, img = el.querySelector('.ob-lg-img');
            if (!L || !img) return;
            if (el.classList.contains('ob-wake-stopped')) {
                el._lgSleep = ((el._lgSleep || 0) + 1) % L.sleep.length;
                img.src = L.sleep[el._lgSleep];
            } else if (!el.classList.contains('is-walk') && Math.random() < 0.12) {
                img.src = L.blink;
                setTimeout(() => { if (img.isConnected) img.src = L.open; }, 170);
            }
        });
    }

    /** 開始畫小人、讓他們走。板子重畫（換掉這間）或關掉，兩個計時器自己停。 */
    function mount(scene) {
        if (!scene || scene._lgOn) return;
        scene._lgOn = true;
        scene.querySelectorAll('.ob-lg-p').forEach(_paint);
        if (!scene.querySelector('.ob-lg-p')) return;
        const loop = () => {
            if (!scene.isConnected) return;
            if (!document.hidden) _step(scene);
            setTimeout(loop, 1500 + Math.random() * 1700);
        };
        setTimeout(loop, 1800);
        const t = setInterval(() => {
            if (!scene.isConnected) { clearInterval(t); return; }
            if (!document.hidden) _tick(scene);
        }, 700);
    }

    /** 點到的那位：腳下一圈、站著不走；rid 空＝都不選 */
    function select(scene, rid) {
        if (!scene) return;
        scene.querySelectorAll('.ob-lg-p').forEach(el => el.classList.toggle('is-on', !!rid && el.dataset.rid === rid));
    }

    window.BoardLounge = { sceneHtml, mount, select, SPOTS };
})();
