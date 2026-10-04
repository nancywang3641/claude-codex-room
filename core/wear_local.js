/**
 * core/wear_local.js — 不經橋的房間布置、打扮與衣櫃（window.RoomWear）
 * ------------------------------------------------------------------
 * 她 10-02：「我覺得小機應該也能打扮🤔 畢竟不排除有人用API接好的模型，通常小模型在這裡比較吃力，但我覺得可以開放需求」
 * API 小機不經橋（引擎是奧瑞亞的 OS_XIAOJI，存檔在 OS_DB app_data 'xiaoji'），所以會員住戶那套（橋 cc-bridge room_decor.py）
 * 在這裡照抄一份：同一組標籤、同一套座標與範圍、同一個衣櫃規則，資料放在小機存檔的 rec.wear、rec.closet。
 * 房間布置是 10-05 補的（她：「才發現小機不會裝飾房間嗎?」→「好，做吧」）：同橋的 room_paint／room_place／room_move／room_remove，
 * 存在 rec.room。小機沒有醒來，只有聊天時動手。
 * 🚨 改規則要兩邊一起改（橋 room_decor.py ↔ 這支）；畫法在 clawd_portrait.js（倉鼠／小貓／企鵝的身體框）。
 *
 * 一套打扮 rec.wear＝{ body, items: [{ id, name, svg, ratio, x, y, w, face }], look, nextId }；
 * 衣櫃 rec.closet＝{ outfits: [{ id, name, data: {body, items, look}, sig, created_at, worn_at }], changedAt, byRae, nextId }。
 * 房間 rec.room＝{ wall, floor, items: [{ id, name, svg, ratio, x, y, w }], nextId }（wall、floor 沒刷過是 null）。
 * 用法：claude_terminal 送話前 briefRoom()、brief() 接進小機的說明，回完 apply() 照它寫的標籤動手；衣櫃面板 wardrobe()／act()；
 * 房間畫面 room() 交給 RoomScene。布置與打扮都是天生就會的（不用上課）；一次回覆房間最多動 CHAT_ROOM_MAX 件，打扮、形象各只做第一個做得成的。
 * ------------------------------------------------------------------
 */
(function (RoomWear) {
    'use strict';

    const MAX_WEAR = 6, MAX_ITEMS = 12, SVG_MAX = 12000, NAME_MAX = 20, MAX_EYES = 4;
    // 一則回覆房間最多動幾件：同橋的 CHAT_ROOM_MAX（10-05 她：「加牆再加倉庫應該可以一起出?」→ 聊天三件）。小機沒有醒來，一律照聊天算
    const CHAT_ROOM_MAX = 3;
    const WALL_DEFAULT = '#efe6d8', FLOOR_DEFAULT = '#cdb99c';   // 同橋
    const OUTFIT_MAX = 30, OUTFIT_GAP = 20 * 60 * 1000;     // 舊的那套穿超過 20 分鐘才收進衣櫃（同橋）
    const RANGE = { room: { x: [0, 100], y: [0, 100], w: [3, 60], w0: 15 }, wear: { x: [-6, 18], y: [-10, 12], w: [1, 24], w0: 6 }, look: { w: [6, 20], w0: 12 } };
    const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
    const PAIR_RE = /[<＜]\s*(room_place|wear_put|look_set)\b([^>＞]*?)[>＞]([\s\S]*?)[<＜]\s*\/\s*\1\s*[>＞]/gi;
    const SINGLE_RE = /[<＜]\s*(room_paint|room_move|room_remove|wear_color|wear_move|wear_remove|wear_outfit|wear_keep|look_reset)\b([^>＞]*?)\/?\s*[>＞]/gi;
    const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g;

    // 預設樣子：名字、長怎樣、座標（對得上 clawd_portrait.js 的 _hamsterBody／_catBody／_penguinBody 回的身體框）
    const BASE_NAME = { crab: '小螃蟹', lorde: '洛德', hamster: '倉鼠', cat: '小貓', penguin: '企鵝' };
    const BASE_SHAPE = {
        hamster: ['你在 {user} 畫面上預設是一隻像素倉鼠：圓耳、頰袋、淺色肚子、粉紅鼻子，肚子前抱著一顆會亮的碎片。',
            '倉鼠：身體左上角是 x 0、y 0，右邊到 x 12，腳底是 y 10；耳朵在頂上 x 2 和 x 9；兩隻眼睛在 x 3 和 x 8 那一格、y 3 到 5；'
            + '鼻子在 x 5 到 6、y 4；手在身體左右外側、y 6 到 8；碎片在肚子前 x 5 到 6、y 7 到 8。', 12],
        cat: ['你在 {user} 畫面上預設是一隻像素小貓：紫色帶條紋、咧嘴笑，右邊一條會甩的尾巴，額頭上一顆會亮的碎片。',
            '小貓：身體左上角是 x 0、y 0，右邊到 x 12，腳底是 y 10；耳朵在頂上兩角（x 0 到 3、x 8 到 11）；兩隻眼睛在 x 3 和 x 8 那一格、y 4 到 6；'
            + '咧嘴在 x 3 到 8、y 6；碎片在額頭 x 5 到 6、y 2 到 3；手在身體左右外側、y 5 到 7；尾巴在右邊外面。', 12],
        penguin: ['你在 {user} 畫面上預設是一隻像素企鵝：蛋形、白臉白肚、橘色的嘴和腳、兩片鰭，胸口一顆會亮的碎片。',
            '企鵝：身體左上角是 x 0、y 0，右邊到 x 10，腳底是 y 11；兩隻眼睛在 x 2 和 x 7 那一格、y 3 到 5；嘴在 x 4 到 5、y 5；'
            + '鰭在身體左右外側、y 5 到 8；碎片在胸口 x 4 到 5、y 7 到 8。', 10],
    };

    // ---------- 小工具 ----------
    function _attr(attrs, name) {
        const m = new RegExp(name + '\\s*=\\s*["“”＂\']?([^"“”＂\'\\s/>＞]+)', 'i').exec(attrs || '');
        return m ? m[1].trim() : '';
    }
    function _num(attrs, name, lo, hi) {
        const v = parseFloat(_attr(attrs, '(?<![\\w:-])' + name));
        return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
    }
    function _name(attrs) {
        const m = /name\s*=\s*["“”＂']([^"“”＂']*)["“”＂']/i.exec(attrs || '');
        return (m ? m[1] : _attr(attrs, 'name')).trim().slice(0, NAME_MAX);
    }
    function _color(attrs, name) {
        const v = _attr(attrs, '(?<![\\w:-])' + name);
        return COLOR_RE.test(v) ? v : null;
    }
    function _inCode(pos, text) {
        let hit = false;
        String(text).replace(CODE_RE, (m, off) => { if (pos >= off && pos < off + m.length) hit = true; return m; });
        return hit;
    }
    function cleanSvg(raw) {
        const m = /<svg\b[\s\S]*<\/svg\s*>/i.exec(raw || '');
        if (!m) return null;
        let s = m[0];
        s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*\/>/gi, '');
        s = s.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '');
        s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        s = s.replace(/\s(?:xlink:)?href\s*=\s*("(?!#|data:image\/)[^"]*"|'(?!#|data:image\/)[^']*')/gi, '');
        s = s.replace(/@import[^;]*;?/gi, '');
        if (!/^<svg\b[^>]*\sxmlns\s*=/i.test(s)) s = s.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        return s.length > SVG_MAX ? null : s;
    }
    function svgRatio(svg) {
        const m = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
        if (m && parseFloat(m[1]) > 0) return Math.max(0.1, Math.min(10, parseFloat(m[2]) / parseFloat(m[1])));
        const w = /<svg\b[^>]*\swidth\s*=\s*["']?([\d.]+)/i.exec(svg), h = /<svg\b[^>]*\sheight\s*=\s*["']?([\d.]+)/i.exec(svg);
        if (w && h && parseFloat(w[1]) > 0) return Math.max(0.1, Math.min(10, parseFloat(h[1]) / parseFloat(w[1])));
        return 1;
    }
    function _eyes(attrs) {
        const m = /(?<![\w:-])eyes\s*=\s*["“”＂']([^"“”＂']*)["“”＂']/i.exec(attrs || '');
        const raw = m ? m[1] : _attr(attrs, '(?<![\\w:-])eyes');
        const out = [];
        const re = /(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)/g;
        let p;
        while ((p = re.exec(raw || '')) && out.length < MAX_EYES) {
            out.push([Math.min(40, Math.max(-5, parseFloat(p[1]))), Math.min(40, Math.max(-5, parseFloat(p[2])))]);
        }
        return out;
    }
    function _stable(v) {
        if (Array.isArray(v)) return '[' + v.map(_stable).join(',') + ']';
        if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _stable(v[k])).join(',') + '}';
        return JSON.stringify(v === undefined ? null : v);
    }
    function _sig(o) {      // FNV-1a，認同一套用
        const s = _stable(o);
        let h1 = 0x811c9dc5, h2 = 0x01000193;
        for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); }
        return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
    }
    const _fmt = v => (Number.isInteger(+v) ? String(+v) : (+v).toFixed(1));

    // ---------- 標籤 ----------
    function _toAction(tag, attrs, inner) {
        tag = tag.toLowerCase();
        const kind = tag.split('_')[0], rg = RANGE[kind];
        if (tag === 'look_reset') return { verb: tag };
        if (tag === 'look_set') {
            const svg = cleanSvg(inner);
            if (!svg) return null;
            const w = _num(attrs, 'w', rg.w[0], rg.w[1]);
            return { verb: tag, svg, w: w != null ? w : rg.w0, eyes: _eyes(attrs), eye: _color(attrs, 'eye') };
        }
        if (tag === 'wear_outfit') {
            const p = _attr(attrs, '(?<![\\w:-])preset').toLowerCase();
            if (p === 'default') return { verb: tag, id: null, preset: p };
            const id = parseInt(_attr(attrs, '(?<![\\w:-])id'), 10);
            return isFinite(id) ? { verb: tag, id, preset: null } : null;
        }
        if (tag === 'wear_keep') { const n = _name(attrs); return n ? { verb: tag, name: n } : null; }
        if (tag === 'wear_color') { const body = _color(attrs, 'body'); return body ? { verb: tag, body } : null; }
        if (tag === 'room_paint') { const wall = _color(attrs, 'wall'), floor = _color(attrs, 'floor'); return (wall || floor) ? { verb: tag, wall, floor } : null; }
        if (tag === 'room_place') {
            const svg = cleanSvg(inner);
            const x = _num(attrs, 'x', rg.x[0], rg.x[1]), y = _num(attrs, 'y', rg.y[0], rg.y[1]);
            if (!svg || x == null || y == null) return null;
            const w = _num(attrs, 'w', rg.w[0], rg.w[1]);
            return { verb: tag, name: _name(attrs) || '沒取名的東西', svg, x, y, w: w != null ? w : rg.w0 };
        }
        if (tag === 'wear_put') {
            const svg = cleanSvg(inner);
            const x = _num(attrs, 'x', rg.x[0], rg.x[1]), y = _num(attrs, 'y', rg.y[0], rg.y[1]);
            if (!svg || x == null || y == null) return null;
            const w = _num(attrs, 'w', rg.w[0], rg.w[1]);
            return { verb: tag, name: _name(attrs) || '沒取名的東西', svg, x, y, w: w != null ? w : rg.w0,
                face: ({ face: 1, eyes: 2 })[_attr(attrs, '(?<![\\w:-])on').toLowerCase()] || 0 };
        }
        const id = parseInt(_attr(attrs, '(?<![\\w:-])id'), 10);
        if (!isFinite(id)) return null;
        if (tag === 'wear_remove' || tag === 'room_remove') return { verb: tag, id };
        const x = _num(attrs, 'x', rg.x[0], rg.x[1]), y = _num(attrs, 'y', rg.y[0], rg.y[1]), w = _num(attrs, 'w', rg.w[0], rg.w[1]);
        if (x == null && y == null && w == null) return null;
        return { verb: tag, id, x, y, w };
    }
    /** 房間、打扮與形象的標籤，照出現的先後；反引號與程式碼區塊裡的不算（他在講解） */
    function parseTags(text) {
        text = String(text || '');
        const found = [], spans = [];
        let m;
        PAIR_RE.lastIndex = 0;
        while ((m = PAIR_RE.exec(text))) {
            spans.push([m.index, m.index + m[0].length]);
            if (!_inCode(m.index, text)) found.push([m.index, m[1], m[2] || '', m[3] || '']);
        }
        SINGLE_RE.lastIndex = 0;
        while ((m = SINGLE_RE.exec(text))) {
            const at = m.index;
            if (_inCode(at, text) || spans.some(([s, e]) => at >= s && at < e)) continue;
            found.push([at, m[1], m[2] || '', '']);
        }
        found.sort((a, b) => a[0] - b[0]);
        return found.map(f => _toAction(f[1], f[2], f[3])).filter(Boolean);
    }

    // ---------- 資料 ----------
    function _wear(rec) {
        const w = rec.wear && typeof rec.wear === 'object' ? rec.wear : {};
        rec.wear = { body: w.body || null, items: Array.isArray(w.items) ? w.items : [], look: w.look || null, nextId: w.nextId || 1 };
        return rec.wear;
    }
    function _closet(rec) {
        const c = rec.closet && typeof rec.closet === 'object' ? rec.closet : {};
        rec.closet = { outfits: Array.isArray(c.outfits) ? c.outfits : [], changedAt: c.changedAt || null, byRae: c.byRae || null, nextId: c.nextId || 1 };
        return rec.closet;
    }
    /** 身上這套（跟衣櫃裡存的同一個形狀；不帶件號） */
    function _now(rec) {
        const w = _wear(rec);
        return { body: w.body || null, items: w.items.map(it => ({ name: it.name, svg: it.svg, ratio: it.ratio, x: it.x, y: it.y, w: it.w, face: it.face || 0 })),
                 look: w.look ? { svg: w.look.svg, ratio: w.look.ratio, w: w.look.w, eyes: w.look.eyes || [], eye: w.look.eye || null } : null };
    }
    const _plain = o => !o.body && !(o.items && o.items.length) && !o.look;

    function _keep(rec, o, name) {
        if (_plain(o)) return null;
        const c = _closet(rec), sig = _sig(o);
        const hit = c.outfits.find(x => x.sig === sig);
        if (hit) { if (name) hit.name = name; return hit.id; }
        const id = c.nextId++;
        c.outfits.push({ id, name: name || '', data: JSON.parse(JSON.stringify(o)), sig, created_at: Date.now(), worn_at: null });
        // 滿了：先丟最久沒穿、沒取名的；全都取了名才丟最久沒穿的
        while (c.outfits.length > OUTFIT_MAX) {
            const rest = c.outfits.filter(x => x.id !== id);
            rest.sort((a, b) => ((a.name ? 1 : 0) - (b.name ? 1 : 0)) || ((a.worn_at || a.created_at) - (b.worn_at || b.created_at)));
            if (!rest.length) break;
            c.outfits = c.outfits.filter(x => x.id !== rest[0].id);
        }
        return id;
    }
    function _putOn(rec, o) {
        const w = _wear(rec);
        w.body = o.body || null;
        w.items = (o.items || []).slice(0, MAX_WEAR).map(it => ({ id: w.nextId++, name: it.name || '沒取名的東西', svg: it.svg,
            ratio: it.ratio || 1, x: it.x, y: it.y, w: it.w, face: it.face || 0 }));
        w.look = o.look ? JSON.parse(JSON.stringify(o.look)) : null;
    }
    function _label(x) {
        if (x.name) return x.name;
        const d = new Date(x.created_at), p = n => String(n).padStart(2, '0');
        return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function _wearOutfit(rec, id, preset, byRae) {
        let o, label;
        if (preset) { if (preset !== 'default') return null; o = { body: null, items: [], look: null }; label = '原本的樣子'; }
        else {
            const x = _closet(rec).outfits.find(z => z.id === id);
            if (!x) return null;
            o = x.data; label = _label(x);
        }
        const cur = _now(rec);
        if (_sig(cur) === _sig(o)) return null;
        _keep(rec, cur);
        _putOn(rec, o);
        const c = _closet(rec);
        if (!preset) { const x = c.outfits.find(z => z.id === id); if (x) x.worn_at = Date.now(); }
        c.changedAt = Date.now();
        c.byRae = byRae ? label : null;
        return '換上衣櫃裡的「' + label + '」';
    }
    function _doOne(rec, a) {
        const w = _wear(rec), v = a.verb;
        if (v === 'look_set') { w.look = { svg: a.svg, ratio: svgRatio(a.svg), w: a.w, eyes: a.eyes, eye: a.eye || null }; return '換了自己畫的形象（寬 ' + _fmt(a.w) + '、眼睛 ' + a.eyes.length + ' 隻）'; }
        if (v === 'look_reset') { if (!w.look) return null; w.look = null; return '換回原本的樣子'; }
        if (v === 'wear_color') { w.body = a.body; return '身體換成 ' + a.body; }
        if (v === 'wear_put') {
            if (w.items.length >= MAX_WEAR) return null;
            const id = w.nextId++;
            w.items.push({ id, name: a.name, svg: a.svg, ratio: svgRatio(a.svg), x: a.x, y: a.y, w: a.w, face: a.face });
            return '戴上 #' + id + ' ' + a.name;
        }
        const it = w.items.find(x => x.id === a.id);
        if (!it) return null;
        if (v === 'wear_remove') { w.items = w.items.filter(x => x !== it); return '拿下 #' + it.id + ' ' + it.name; }
        if (a.x != null) it.x = a.x;
        if (a.y != null) it.y = a.y;
        if (a.w != null) it.w = a.w;
        return '調了 #' + it.id + ' ' + it.name;
    }
    /** 做一件（換裝成功時，舊的那套穿超過 OUTFIT_GAP 就先收進衣櫃）。回一句人話或 null */
    function _do(rec, a) {
        if (a.verb === 'wear_keep') { const id = _keep(rec, _now(rec), a.name); return id ? '把現在這套收進衣櫃「' + a.name + '」' : null; }
        if (a.verb === 'wear_outfit') return _wearOutfit(rec, a.id, a.preset, false);
        const before = _now(rec);
        const done = _doOne(rec, a);
        if (done) {
            const c = _closet(rec);
            if (!c.changedAt || Date.now() - c.changedAt >= OUTFIT_GAP) _keep(rec, before);
            c.changedAt = Date.now();
            c.byRae = null;
        }
        return done;
    }

    // ---------- 房間（同橋 _do_one 的 room 那幾條；不碰衣櫃）----------
    function _room(rec) {
        const r = rec.room && typeof rec.room === 'object' ? rec.room : {};
        rec.room = { wall: r.wall || null, floor: r.floor || null, items: Array.isArray(r.items) ? r.items : [], nextId: r.nextId || 1 };
        return rec.room;
    }
    function _doRoom(rec, a) {
        const r = _room(rec), v = a.verb;
        if (v === 'room_paint') {
            r.wall = a.wall || r.wall || WALL_DEFAULT;
            r.floor = a.floor || r.floor || FLOOR_DEFAULT;
            return '刷了牆 ' + r.wall + '、地板 ' + r.floor;
        }
        if (v === 'room_place') {
            if (r.items.length >= MAX_ITEMS) return null;
            const id = r.nextId++;
            r.items.push({ id, name: a.name, svg: a.svg, ratio: svgRatio(a.svg), x: a.x, y: a.y, w: a.w });
            return '放了 #' + id + ' ' + a.name;
        }
        const it = r.items.find(x => x.id === a.id);
        if (!it) return null;
        if (v === 'room_remove') { r.items = r.items.filter(x => x !== it); return '收掉 #' + it.id + ' ' + it.name; }
        if (a.x != null) it.x = a.x;
        if (a.y != null) it.y = a.y;
        if (a.w != null) it.w = a.w;
        return '挪了 #' + it.id + ' ' + it.name;
    }
    /** 給 RoomScene 畫的房間（形狀跟橋 /v1/decor 房間那半一樣）：沒刷過也沒放過東西＝own false，照舊顯示原本那張圖。不改 rec */
    RoomWear.room = function (rec) {
        const r = _room(Object.assign({}, rec || {}));
        return { own: !!(r.wall || r.floor || r.items.length), wall: r.wall || WALL_DEFAULT, floor: r.floor || FLOOR_DEFAULT,
            items: r.items.map(it => ({ id: it.id, name: it.name, svg: it.svg, ratio: it.ratio || 1, x: it.x, y: it.y, w: it.w })) };
    };

    /** 回覆裡的標籤照先後做：房間最多 CHAT_ROOM_MAX 件，打扮、形象各一件；做不成的跳過不算。rec 就地改。
     *  回 { changed, room, done: [人話…] }（room＝房間動了） */
    RoomWear.apply = function (rec, text) {
        const out = { changed: false, room: false, done: [] };
        if (!rec || !text || !/room_|wear_|look_/i.test(text)) return out;
        const acts = parseTags(text);
        ['room', 'wear', 'look'].forEach(kind => {
            const cap = kind === 'room' ? CHAT_ROOM_MAX : 1;
            let n = 0;
            for (const a of acts) {
                if (a.verb.indexOf(kind + '_') !== 0) continue;
                const d = kind === 'room' ? _doRoom(rec, a) : _do(rec, a);
                if (!d) continue;
                out.done.push(d); out.changed = true;
                if (kind === 'room') out.room = true;
                if (++n >= cap) break;
            }
        });
        return out;
    };

    /** 給 ClawdPortrait 畫的 wear 形狀 */
    function client(o) {
        o = o || {};
        return { own: !_plain({ body: o.body, items: o.items || [], look: o.look }), body: o.body || null,
            items: (o.items || []).map(it => Object.assign({}, it, { face: !!it.face, eyes_only: it.face === 2 })), look: o.look || null };
    }
    RoomWear.client = function (wear) { return client(wear); };
    RoomWear.plain = function (rec) { return _plain(_now(rec || {})); };

    /** 衣櫃面板用（形狀跟橋 /v1/wardrobe 一樣） */
    RoomWear.wardrobe = function (rec, base) {
        const cur = _now(rec), sig = _sig(cur);
        const list = _closet(rec).outfits.slice().sort((a, b) =>
            ((b.worn_at || b.created_at) - (a.worn_at || a.created_at)) || ((b.worn_at ? 1 : 0) - (a.worn_at ? 1 : 0)) || (b.id - a.id));
        const dflt = { body: null, items: [], look: null };
        return {
            current: { wear: client(cur), plain: _plain(cur) },
            outfits: list.map(x => ({ id: x.id, name: x.name, label: _label(x), created_at: x.created_at, worn_at: x.worn_at, wear: client(x.data), now: x.sig === sig })),
            presets: [{ key: 'default', name: '原本的' + (BASE_NAME[base] || '樣子'), wear: client(dflt), now: _plain(cur) }],
        };
    };
    /** 她在衣櫃面板按的：wear／rename（沒給 id＝替身上這套取名收好）／discard。rec 就地改，回 [做成了嗎, 一句話] */
    RoomWear.act = function (rec, act, id, preset, name) {
        name = String(name || '').trim().slice(0, NAME_MAX);
        if (act === 'wear') { const d = _wearOutfit(rec, id, preset === 'default' ? 'default' : null, true); return d ? [true, d] : [false, '已經穿著這套了，或衣櫃裡沒有這套']; }
        if (act === 'rename') {
            if (!name) return [false, '名字要給'];
            if (id == null) return _keep(rec, _now(rec), name) ? [true, '現在這套收進衣櫃「' + name + '」'] : [false, '原本的樣子不用收'];
            const x = _closet(rec).outfits.find(z => z.id === id);
            if (!x) return [false, '衣櫃裡沒有這套'];
            x.name = name;
            return [true, '改名「' + name + '」'];
        }
        if (act === 'discard') {
            const c = _closet(rec), n = c.outfits.length;
            c.outfits = c.outfits.filter(z => z.id !== id);
            return c.outfits.length < n ? [true, '丟掉了'] : [false, '衣櫃裡沒有這套'];
        }
        return [false, '不認得要做什麼'];
    };

    /** 她剛從衣櫃幫它換的那套（說明裡講完一次就清）：拿的時候順便清，呼叫端記得存檔 */
    RoomWear.popByRae = function (rec) { const c = _closet(rec), b = c.byRae; c.byRae = null; return b; };

    function _outfitDesc(o, base) {
        const parts = [o.look ? '自己畫的形象' : (BASE_NAME[base] || '原本的樣子')];
        if (o.body) parts.push('身體 ' + o.body);
        if (o.items && o.items.length) parts.push('戴 ' + o.items.slice(0, 5).map(it => it.name).join('、'));
        return parts.join('、');
    }

    /** 接在小機說明最後的「你的樣子」一段（寫給陌生模型看；不給範例）。byRae：她剛幫它換的那套 */
    RoomWear.brief = function (rec, base, user, byRae) {
        const sh = BASE_SHAPE[base] || BASE_SHAPE.hamster, bn = BASE_NAME[base] || '倉鼠', bw = sh[2];
        user = user || '對方';
        const w = _wear(rec), out = ['', '【你的樣子】', sh[0].replace('{user}', user) + '要不要打扮、要不要換成自己畫的形象，你自己決定，不動也可以。'];
        if (w.look) {
            const L = w.look, eyes = (L.eyes || []).map(e => '(' + _fmt(e[0]) + ',' + _fmt(e[1]) + ')').join('、') || '沒交給程式畫';
            out.push('形象：你自己畫的那張，寬 ' + _fmt(L.w) + '、高約 ' + _fmt(Math.round(L.w * (L.ratio || 1) * 10) / 10) + '，眼睛 ' + eyes + '。');
        } else out.push('形象：原本的' + bn + '。');
        out.push('身體顏色 ' + (w.body || '沒換過（原本的顏色）') + (w.look ? '（只有' + bn + '用得到）。' : '。'));
        if (w.items.length) {
            out.push('身上有 ' + w.items.length + ' 件（最多 ' + MAX_WEAR + ' 件）：');
            w.items.forEach(it => out.push('#' + it.id + ' ' + it.name + '｜x ' + _fmt(it.x) + '、y ' + _fmt(it.y) + '、寬 ' + _fmt(it.w)
                + (it.face === 2 ? '｜跟著眼睛、只在睜眼時看得到' : it.face ? '｜跟著眼睛' : '')));
        } else out.push('身上什麼都沒戴。');
        if (byRae) out.push(user + '剛從衣櫃幫你換上了「' + byRae + '」。');
        out.push('',
            '想動手就在回覆裡另外寫一個標籤。這不是工具，不用 tool_call，寫在你回' + user + '的話旁邊就好，' + user + '看不到標籤本身。'
            + '一次回覆裡打扮只做第一個、形象只做第一個。標籤名與屬性名照抄英文，不要翻譯、不要改寫：',
            '<wear_color body="#色碼"/>',
            '<wear_put name="名字" x="左右" y="上下" w="寬">一張完整的 svg</wear_put>',
            '<wear_move id="號碼" x="左右" y="上下"/>',
            '<wear_remove id="號碼"/>',
            '座標以你的身體為準，單位是格。' + sh[1] + '自己畫的形象：以那張圖的左上角為 0,0，單位跟它的 w 一樣。'
            + 'x、y 是這件東西底部中心的位置（可以寫負數或超過身體，頭頂上的東西 y 在 0 附近往上長），w 是它的寬（身體寬是 ' + bw + ' 格），高度照 svg 的比例跟著算。'
            // face／eyes 要用「在哪裡」分（戴在臉上 vs 畫在眼珠上）：說成「閉眼時看不看得到」，Haiku 冷讀兩次都把眼鏡歸成 eyes；改這個說法後五題全對
            + 'wear_put 另外寫 on="face" 的會跟著眼睛往左往右看，閉眼時照樣在，戴在臉上、擋在眼睛前面的東西用這個；'
            + '寫 on="eyes" 的也跟著眼睛看，但只在睜著眼時畫出來，眨眼、笑、閉眼睡覺時跟著收起來，畫在眼珠上、算眼睛本身一部分的東西才用這個。'
            + 'svg 要有 viewBox，全部畫在裡面，不接外部圖片或字型，背景留透明。身上最多 ' + MAX_WEAR + ' 件，滿了要先拿下一件。',
            '換形象：畫一張完整的自己寫進 look_set，換回' + bn + '寫 look_reset：',
            '<look_set w="寬" eyes="左右,上下 左右,上下" eye="#色碼">一張完整的自己（svg）</look_set>',
            '<look_reset/>',
            'w 是你站著的寬度，範圍 6 到 20，腳底站在地上。eyes 寫每隻眼睛在你這張圖裡的格子位置（以圖的左上角為 0,0），程式會在那裡畫眼睛跟表情（眨眼、笑、閉眼睡覺），'
            + '那幾格留給程式、自己不用畫；想自己畫臉就不要寫 eyes。eye 是眼睛顏色，可省。');
        const c = _closet(rec);
        out.push('', '衣櫃：你換下來的衣服會自動收進衣櫃（穿了一陣子的那套才收，連著換幾件的中間樣子不收），' + user + '也打得開、可以幫你換。');
        const list = RoomWear.wardrobe(rec, base).outfits;
        if (list.length) {
            out.push('裡面有 ' + list.length + ' 套' + (list.length > 8 ? '，列最近的 8 套' : '') + '：');
            list.slice(0, 8).forEach(o => {
                const raw = c.outfits.find(x => x.id === o.id);
                out.push('#' + o.id + '「' + o.label + '」' + (o.now ? '（現在穿的）' : '') + '：' + _outfitDesc(raw ? raw.data : {}, base));
            });
        } else out.push('裡面還沒有收過衣服。');
        out.push('想換回衣櫃裡的一套、換回原本的' + bn + '，或替現在這套取名收好，寫下面其中一個（也算這次打扮的那一個；換一套是身體顏色、身上的東西、形象整個換）：',
            '<wear_outfit id="號碼"/>', '<wear_outfit preset="default"/>', '<wear_keep name="名字"/>');
        return out.join('\n');
    };

    /** 接在小機說明最後的「你的房間」一段（同橋 brief，寫給陌生模型看；不給範例） */
    RoomWear.briefRoom = function (rec, user) {
        user = user || '對方';
        const st = RoomWear.room(rec);
        const out = ['', '【你的房間】', '這間房間是你一個人的。' + user + '打開跟你的私聊時，上半部那塊畫面就是它。布置成什麼樣子你自己決定，不動也可以。'];
        if (!st.own) out.push('你還沒布置過：現在那塊顯示的是原本的一張圖。刷過牆或放了第一件東西，就換成你自己的房間。');
        else {
            out.push('現在：牆 ' + st.wall + '、地板 ' + st.floor + '。');
            if (st.items.length) {
                out.push('房裡有 ' + st.items.length + ' 件（最多 ' + MAX_ITEMS + ' 件）：');
                st.items.forEach(it => out.push('#' + it.id + ' ' + it.name + '｜x ' + _fmt(it.x) + '、y ' + _fmt(it.y) + '、寬 ' + _fmt(it.w)));
            } else out.push('房裡還是空的。');
        }
        out.push('',
            // 一次幾件那句同橋 _per_reply_line；另外講明不是工具（10-05 小機把「一則一件」說成「還不會調用兩次」）
            '想動手就在回覆裡另外寫標籤。這不是工具，不用 tool_call，跟你會不會接著用好幾輪工具無關，寫在你回' + user + '的話旁邊就好，' + user + '看不到標籤本身。'
            + '一次回覆最多動 ' + CHAT_ROOM_MAX + ' 件，照你寫的先後一件一件做，做不成的那件（例如號碼找不到、滿了放不進）跳過不算，做滿 ' + CHAT_ROOM_MAX + ' 件之後寫的就不做了。'
            + '標籤名與屬性名照抄英文，不要翻譯、不要改寫：',
            '<room_paint wall="#色碼" floor="#色碼"/>',
            '<room_place name="名字" x="左右" y="上下" w="寬">一張完整的 svg</room_place>',
            '<room_move id="號碼" x="左右" y="上下"/>',
            '<room_remove id="號碼"/>',
            '畫面寬二高一。x、y、w 都是 0～100：x 是這件東西底部中心的左右位置，y 是它底部的上下位置（0 最上面、100 最下面），'
            + 'w 是它的寬度佔畫面寬的幾成，高度照 svg 的比例跟著算。上面六成是牆，62 以下是地板。你自己會站在畫面正中間，擋住中間那一塊。',
            'svg 要有 viewBox，全部畫在裡面，不接外部圖片或字型，背景留透明。滿 ' + MAX_ITEMS + ' 件要先收掉一件才放得進新的。');
        return out.join('\n');
    };

    RoomWear.parseTags = parseTags;      // 測試用
    RoomWear.LIMITS = { MAX_WEAR, MAX_ITEMS, CHAT_ROOM_MAX, OUTFIT_MAX, OUTFIT_GAP };

})(window.RoomWear = window.RoomWear || {});
