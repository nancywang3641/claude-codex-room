/**
 * core/clawd_portrait.js — 會打扮的小方塊立繪（window.ClawdPortrait）
 * ------------------------------------------------------------------
 * Claude 那幾位（丹、天天、克語）在房間裡是那隻橘色像素小方塊。原本立繪是一組現成動圖，
 * 帽子疊上去他一換動作就懸在半空；打扮過的住戶改用這支一格一格畫他，戴的東西每一格都跟著身體算位置。
 * 沒打扮過的照舊是原本那組動圖——這支只在 show() 之後才接手。
 *
 * 打扮資料是橋 /v1/decor 帶回來的 wear：{ own, body: 身體顏色, items: [{ svg, ratio, x, y, w, face }] }。
 * 座標以身體為準（寬 12、高 8，左上角 0,0），x、y 是那件東西底部中心，w 是寬；face 的跟著眼睛左看右看。
 * 橋念給住戶聽的是同一套（cc-bridge room_decor.brief_wear），改一邊要改另一邊。
 *
 * 動作沿用房間原本的立繪狀態（chat_room.js 的 _swapPortraitImg 每次換狀態都會叫 setState）。
 * 造型與動作源自 參考資料/clawd_dan_LAB.html（丹的小動圖），這裡只留立繪用得到的幾個。
 * ------------------------------------------------------------------
 */
(function (ClawdPortrait) {
    'use strict';

    const S = 8, W = 32, H = 24;          // 一格 8px，畫布 32×24 格
    const FPS_MS = 125;
    const BODY_DEFAULT = '#d97757';
    const PAL = {
        eye: '#1c1714', shadow: 'rgba(58,36,24,.16)', gray: '#b8b1aa', dark: '#2a2623',
        white: '#fffaf2', line: '#d6ccc0', blue: '#7cc4f2', gold: '#f3c969', green: '#8fcf7a',
        sky: '#7fb2e5', brown: '#8a5a3b', spine: '#d8cdbf',
    };

    // 房間的立繪狀態 → 這裡的動作
    const STATE_ACTION = {
        living: 'idle', idle: 'idle', mini: 'idle',
        reading: 'memory',
        doze: 'night', yawn: 'night', sleeping: 'night',
        thinking: 'think', ultrathink: 'think',
        typing: 'code', happy: 'happy', wake: 'happy', error: 'oops',
    };

    let _canvas = null, _ctx = null, _area = null;
    let _timer = null, _frame = 0;
    let _action = 'idle';
    let _body = BODY_DEFAULT;
    let _worn = [];                        // [{ img, ratio, x, y, w, face }]

    function px(x, y, c) { _ctx.fillStyle = PAL[c] || c; _ctx.fillRect(x * S, y * S, S, S); }
    function rect(x, y, w, h, c) {
        if (w <= 0 || h <= 0) return;
        _ctx.fillStyle = PAL[c] || c; _ctx.fillRect(x * S, y * S, w * S, h * S);
    }
    function text(t, x, y, size, c, font) {
        _ctx.fillStyle = PAL[c] || c; _ctx.font = size + 'px ' + font;
        _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle'; _ctx.fillText(t, x * S, y * S);
    }
    const shadow = (X, small) => rect(X + 3 + (small ? 2 : 0), 22, 12 - (small ? 4 : 0), 1, 'shadow');
    const sparkle = (x, y) => { px(x, y, 'gold'); px(x - 1, y, 'gold'); px(x + 1, y, 'gold'); px(x, y - 1, 'gold'); px(x, y + 1, 'gold'); };

    /** 本體＋身上的東西。o：x,y 位置；eyes open/blink/happy/x/closed；armL/armR down/up/tap；sq 壓扁；look 左右看；eyeDy 眼睛上下 */
    function clawd(o) {
        const X = o.x, Y = o.y, sq = o.sq || 0, B = _body;
        const legs = o.legs || [2, 2, 2, 2];
        [4, 6, 11, 13].forEach((lx, i) => rect(X + lx, Y + 8, 1, legs[i], B));
        const wide = sq >= 2 ? 1 : 0;
        rect(X + 3 - wide, Y + sq, 12 + wide * 2, 8 - sq, B);
        const ay = Y + 4 + Math.floor(sq / 2);
        const arm = (mode, ax) => {
            const dy = mode === 'up' ? -2 : mode === 'tap' ? 1 : 0;
            rect(ax, ay + dy, 2, 2, B);
        };
        arm(o.armL || 'down', X + 1 - wide);
        arm(o.armR || 'down', X + 15 + wide);
        const ey = Y + 2 + sq + (o.eyeDy || 0), look = o.look || 0;
        for (const [ex, side] of [[X + 5 + look, -1], [X + 12 + look, 1]]) {
            switch (o.eyes || 'open') {
                case 'open':   rect(ex, ey, 1, 2, 'eye'); break;
                case 'blink':  px(ex, ey + 1, 'eye'); break;
                case 'happy':  px(ex - 1, ey + 1, 'eye'); px(ex, ey, 'eye'); px(ex + 1, ey + 1, 'eye'); break;
                case 'x': { const a = ex + side; px(a, ey, 'eye'); px(ex, ey + 1, 'eye'); px(a, ey + 2, 'eye'); break; }
                case 'closed': rect(ex - 1, ey + 1, 3, 1, 'eye'); break;
            }
        }
        // 戴的東西：以身體左上角為原點，壓扁時跟著身體頂一起往下；跟著眼睛的再加上眼睛的偏移
        const bx = X + 3, by = Y + sq;
        for (const it of _worn) {
            if (!it.img.complete || !it.img.naturalWidth) continue;
            const fx = it.face ? look : 0, fy = it.face ? (o.eyeDy || 0) : 0;
            const w = it.w, h = w * (it.ratio || 1);
            _ctx.drawImage(it.img, (bx + it.x + fx - w / 2) * S, (by + it.y + fy - h) * S, w * S, h * S);
        }
    }

    const ACTIONS = {
        idle(f) {
            const X = 7, Y = 12; shadow(X);
            clawd({ x: X, y: Y, eyes: f === 5 ? 'blink' : 'open', look: f >= 9 && f < 12 ? -1 : f >= 12 && f < 15 ? 1 : 0 });
        },
        code(f) {
            const X = 2, Y = 12; shadow(X);
            rect(21, 11, 10, 9, 'dark'); rect(20, 20, 12, 2, 'gray');
            let p = f;
            [[5, '#d97757'], [3, 'green'], [5, 'sky'], [3, 'gold']].forEach(([len, c], i) => {
                rect(22, 12 + i * 2, Math.max(0, Math.min(len, p)), 1, c); p -= len;
            });
            clawd({ x: X, y: Y, look: 1, armL: f % 2 ? 'down' : 'tap', armR: f % 2 ? 'tap' : 'down', eyes: f === 9 ? 'blink' : 'open' });
        },
        memory(f) {
            const X = 7, Y = 12; shadow(X);
            clawd({ x: X, y: Y, eyeDy: 1, armL: 'tap', armR: 'tap', eyes: f === 4 ? 'blink' : 'open' });
            rect(10, 17, 12, 6, 'brown');
            rect(10, 17, 5, 5, 'white'); rect(17, 17, 5, 5, 'white'); rect(15, 17, 2, 5, 'spine');
            rect(11, 18, 3, 1, 'line'); rect(11, 20, 3, 1, 'line'); rect(18, 18, 3, 1, 'line'); rect(18, 20, 2, 1, 'line');
            if (f >= 8 && f <= 13) {
                const t = f - 8;
                if (t < 3) rect(17, 16, 5 - t * 2, 6, 'white');
                else { const w = (t - 2) * 2 - 1; rect(15 - w, 16, w, 6, 'white'); }
            }
        },
        oops(f) {
            const shake = [0, -1, 1, -1, 1, -1, 1, 0][f] || 0, sq = f >= 8 ? 2 : 0, X = 7 + shake, Y = 12;
            shadow(7);
            clawd({ x: X, y: Y, sq, eyes: 'x', armL: f >= 8 ? 'tap' : 'up', armR: f >= 8 ? 'tap' : 'up' });
            if (f >= 3) rect(X + 15, Y + sq - 2 + (f % 4 < 2 ? 0 : 1), 1, 2, 'blue');
            if (f >= 9) { const n = Math.min(3, f - 8); rect(X + 4, Y + sq + 5, 1, n, 'blue'); rect(X + 13, Y + sq + 5, 1, n, 'blue'); }
        },
        think(f) {
            const X = 7, Y = 12; shadow(X);
            clawd({ x: X, y: Y, look: f < 8 ? -1 : 1, eyeDy: -1, eyes: f === 12 ? 'blink' : 'open', armR: f >= 4 && f < 12 ? 'up' : 'down' });
            text(['✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳'][f % 8], 16, 5, S * 4.5, _body, '"Segoe UI Symbol","Noto Sans Symbols 2",sans-serif');
            for (let i = 0; i < Math.floor(f / 4) % 4; i++) px(20 + i * 2, 6, 'gray');
        },
        happy(f) {
            const dy = [0, -1, -3, -4, -4, -3, -1, 0][f % 8], air = dy < 0, X = 7, Y = 12 + dy;
            shadow(X, air);
            clawd({ x: X, y: Y, eyes: 'happy', armL: air ? 'up' : 'down', armR: air ? 'up' : 'down', legs: air ? [1, 1, 1, 1] : [2, 2, 2, 2] });
            if (f % 8 >= 2 && f % 8 <= 5) (f < 8 ? [[4, 5], [27, 8], [25, 3]] : [[6, 9], [28, 4], [3, 2]]).forEach(([x, y]) => sparkle(x, y));
        },
        night(f) {
            const X = 7, Y = 12; shadow(X);
            clawd({ x: X, y: Y, sq: f < 8 ? 0 : 1, eyes: 'closed' });
            for (let i = 0; i < 3; i++) {
                const t = ((f + i * 5) % 16) / 16;
                _ctx.globalAlpha = 1 - t;
                text('z', 23 + i * 1.5 + t * 3, 10 - t * 8, S * (1.6 + t * 1.6), 'sky', 'bold system-ui,sans-serif');
                _ctx.globalAlpha = 1;
            }
        },
    };

    function _tick() {
        // 房間收起來、切去別人房間時畫布不在畫面上，不畫
        if (!_canvas || !_canvas.offsetParent) return;
        _ctx.clearRect(0, 0, W * S, H * S);
        (ACTIONS[_action] || ACTIONS.idle)(_frame);
        _frame = (_frame + 1) % 16;
    }

    function _ensureCanvas(area) {
        if (_canvas && _canvas.parentElement === area) return;
        _canvas = area.querySelector('.cw-clawd-canvas');
        if (!_canvas) {
            _canvas = document.createElement('canvas');
            _canvas.className = 'cw-clawd-canvas';
            _canvas.width = W * S;
            _canvas.height = H * S;
            // 排在原本立繪後面：同一層，後來的畫在上面
            area.appendChild(_canvas);
        }
        _ctx = _canvas.getContext('2d');
        _area = area;
    }

    function _b64(s) { return btoa(unescape(encodeURIComponent(s))); }

    function _bodyOf(wear) {
        return /^#[0-9a-f]{3,6}$/i.test((wear && wear.body) || '') ? wear.body : BODY_DEFAULT;
    }

    function _wornOf(wear) {
        return ((wear && wear.items) || []).map(it => {
            const img = new Image();
            img.src = 'data:image/svg+xml;base64,' + _b64(it.svg || '');
            return { img, ratio: +it.ratio || 1, x: +it.x || 0, y: +it.y || 0, w: +it.w || 6, face: !!it.face };
        });
    }

    /** 照這身打扮接手立繪。wear 是橋回的那包；沒打扮過（own=false）就交回原本的動圖。 */
    ClawdPortrait.show = function (area, wear) {
        if (!area || !wear || !wear.own) { ClawdPortrait.hide(area); return; }
        _ensureCanvas(area);
        _body = _bodyOf(wear);
        _worn = _wornOf(wear);
        area.classList.add('cw-clawd-on');
        if (!_timer) _timer = setInterval(_tick, FPS_MS);
        _tick();
    };

    /** 交回原本的動圖 */
    ClawdPortrait.hide = function (area) {
        const a = area || _area;
        if (a) a.classList.remove('cw-clawd-on');
        if (_timer) { clearInterval(_timer); _timer = null; }
    };

    ClawdPortrait.isOn = function () { return !!(_area && _area.classList.contains('cw-clawd-on')); };

    /** 在指定的畫布上畫一格定格（鏡子用）。等戴的東西都載好才畫，畫完不影響房間裡正在動的那隻。 */
    ClawdPortrait.renderStill = async function (canvas, wear, state, frame) {
        const worn = _wornOf(wear);
        await Promise.all(worn.map(it => (it.img.decode ? it.img.decode() : Promise.resolve()).catch(() => {})));
        canvas.width = W * S;
        canvas.height = H * S;
        const saved = [_ctx, _body, _worn];
        _ctx = canvas.getContext('2d');
        _body = _bodyOf(wear);
        _worn = worn;
        try {
            _ctx.clearRect(0, 0, W * S, H * S);
            (ACTIONS[STATE_ACTION[state] || state] || ACTIONS.idle)(frame || 0);
        } finally {
            [_ctx, _body, _worn] = saved;
        }
    };

    /** 房間換立繪狀態時叫（沒接手時也記著，接手那一刻就用對的動作） */
    ClawdPortrait.setState = function (state) {
        const next = STATE_ACTION[state] || 'idle';
        if (next === _action) return;
        _action = next;
        _frame = 0;
    };

})(window.ClawdPortrait = window.ClawdPortrait || {});
