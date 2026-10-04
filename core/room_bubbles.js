/**
 * core/room_bubbles.js — 房間的泡泡（window.RoomBubbles）
 * ------------------------------------------------------------------
 * 10-05 她：「那是不是宿舍可以應用 保存好的泡泡庫🤔」「好啊，可以自己換泡泡」。
 * 聊天 app 的泡泡庫（奧瑞亞 WX_BUBBLE_AI.galLoad()：[{id, name, css}]）每一套都只寫 .pbub-* 那組共用零件，
 * 聊天 app 跟故事裡的手機就是這樣共用一份；房間是第三個用它的地方。
 *
 * 一間房間（一位住戶）一套：存在房間設定 cfg.roomBubbles[rid] = { name, css, at }。css 照抄一份，
 *   泡泡庫之後改了刪了，房間這套照舊。沒存＝原本的樣子。
 * 套法：底稿＋提權（WX_BUBBLE_AI.BASE_CSS／boost，跟聊天 app 同一份）→ .pbub- 全換成 .ccrb-
 *   🚨 不能直接掛 .pbub-*：聊天 app 那份泡泡樣式是整頁全域的一個 <style>，掛了就會吃到聊天室正在用的那套。
 *   → 每條選擇器前面掛 #aurelia-chat-window（房間原本的泡泡有 #aurelia-chat-window.cw-codex 那種寫法，不提權蓋不過）；
 *     :root 換成 #aurelia-chat-window（變數只在房間裡）；不是泡泡零件的規則丟掉。
 *   另外先墊一層歸零：房間原本泡泡的金邊、陰影、襯線字收掉，不然便利貼上面還框著一圈金線。
 * 房間那邊：一則的外框掛 ccrb-row＋ccrb-me／ccrb-other，文字那幾顆掛 ccrb-bubble（表情包、語音、小面板不掛），
 *   見 chat_room.js 的 _renderClaudeBubble。群聊不換（各人各一套擠在同一串裡看不出誰是誰），進群聊就收掉。
 * 小機學會泡泡課的，回覆裡寫 <bubble_use name="…"/>／<bubble_reset/> 自己換（說明「你的泡泡」那段在 brief）。
 * ------------------------------------------------------------------
 */
(function (RoomBubbles) {
    'use strict';

    const STYLE_ID = 'ccr-room-bubbles';
    const WIN = '#aurelia-chat-window';
    const LIST_MAX = 20;   // 說明裡最多列幾套
    function _g(k) { const w = window.parent || window; return w[k] || window[k] || null; }
    function _AI() { return _g('WX_BUBBLE_AI'); }
    function _one(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
    function _fold(s) { return _one(s).toLowerCase(); }

    function _cfg() {
        const OS = window.OS_SETTINGS;
        return (OS && typeof OS.getClaudeRoomConfig === 'function') ? OS.getClaudeRoomConfig() : null;
    }
    function _saveCfg(cfg) {
        const OS = window.OS_SETTINGS;
        if (OS && typeof OS.saveClaudeRoomConfig === 'function') OS.saveClaudeRoomConfig(cfg);
    }

    /** 泡泡庫（聊天 app 那份，存在這台裝置）。沒載奧瑞亞＝空的 */
    RoomBubbles.library = function () {
        const AI = _AI();
        try { return ((AI && AI.galLoad) ? AI.galLoad() : []).filter(t => t && t.css && _one(t.name)); } catch (_) { return []; }
    };
    /** 這間現在用的那套 { name, css }；原本的樣子回 null */
    RoomBubbles.get = function (rid) {
        const cfg = _cfg(), m = cfg && cfg.roomBubbles;
        const x = m && rid ? m[rid] : null;
        return (x && x.css) ? x : null;
    };
    /** 換：t＝泡泡庫那一套（{name, css}）或 null（原本的樣子）。正開著的就是這間就當場套上 */
    RoomBubbles.set = function (rid, t) {
        if (!rid) return false;
        const cfg = _cfg();
        if (!cfg) return false;
        cfg.roomBubbles = cfg.roomBubbles || {};
        if (t && t.css) cfg.roomBubbles[rid] = { name: _one(t.name), css: String(t.css), at: Date.now() };
        else delete cfg.roomBubbles[rid];
        _saveCfg(cfg);
        if (_shown === rid) RoomBubbles.apply(rid);
        return true;
    };

    // ── 把泡泡庫那份 CSS 換成房間用的 ─────────────────────────────
    function _splitTop(sel) {
        const out = []; let depth = 0, cur = '';
        for (const ch of String(sel)) {
            if (ch === '(' || ch === '[') depth++;
            else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
            if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
        }
        out.push(cur);
        return out;
    }
    function _scopeSel(sel) {
        const parts = _splitTop(sel).map(p => p.trim()).filter(Boolean).map(p => {
            if (/:root\b/.test(p)) return p.replace(/:root\b/g, WIN);
            if (/\.ccrb-/.test(p)) return WIN + ' ' + p;
            return '';   // html、body、* 這種不是泡泡的：房間不收
        }).filter(Boolean);
        return parts.join(', ');
    }
    function _walk(rules) {
        const out = [];
        for (let i = 0; i < rules.length; i++) {
            const r = rules[i];
            if (r.selectorText != null) {
                const s = _scopeSel(r.selectorText);
                if (s) out.push(s + '{' + r.style.cssText + '}');
            } else if (r.media && r.cssRules) out.push('@media ' + r.media.mediaText + '{' + _walk(r.cssRules) + '}');
            else if (r.conditionText != null && r.cssRules) out.push('@supports ' + r.conditionText + '{' + _walk(r.cssRules) + '}');
            else out.push(r.cssText);   // @keyframes、@font-face 照搬
        }
        return out.join('\n');
    }
    /** 泡泡庫那份 → 房間能直接貼的一整段（含底稿）。讀不懂回 '' */
    RoomBubbles.compile = function (css) {
        const AI = _AI();
        if (!AI || !css) return '';
        let text = String(AI.BASE_CSS || '') + '\n' + (AI.boost ? AI.boost(String(css)) : String(css));
        // 只收 Google 字型的 @import（同聊天 app 那條規矩）；replaceSync 不吃 @import，先拿出來
        const imports = [];
        text = text.replace(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)['"]?\s*\)?[^;]*;/gi, (m, u) => {
            if (/^https:\/\/fonts\.googleapis\.com\//i.test(u)) imports.push('@import url("' + u + '");');
            return '';
        });
        text = text.replace(/pbub-/g, 'ccrb-');
        let body = '';
        try {
            const Sheet = window.CSSStyleSheet;
            const sheet = new Sheet();
            sheet.replaceSync(text);
            body = _walk(sheet.cssRules);
        } catch (e) {
            console.warn('[RoomBubbles] 這套泡泡讀不懂：', e);
            return '';
        }
        return imports.join('\n') + '\n' + body;
    };
    // 房間原本泡泡的邊、陰影、襯線字先收掉（主題那份提權過，蓋得過這一層）；
    //   一則左右各留一點：主題常把裝飾（尖角、草莓、膠帶）畫在泡泡外面，聊天 app 那邊有頭像那一欄墊著，房間沒有，貼邊會被切掉
    const RESET = WIN + '.ccrb-on .claude-bubble.ccrb-bubble{border:0;box-shadow:none;font-family:inherit;border-radius:6px}'
        + WIN + '.ccrb-on .claude-bubble-wrap.ccrb-row{padding-left:12px;padding-right:12px}';

    let _shown = null;   // 現在套著哪一間的（rid）；null＝沒有
    /** 開房間時叫：rid＝這間；null＝不套（群聊、沒有房間） */
    RoomBubbles.apply = function (rid) {
        _shown = rid || null;
        const t = rid ? RoomBubbles.get(rid) : null;
        const css = t ? RoomBubbles.compile(t.css) : '';
        let el = document.getElementById(STYLE_ID);
        const win = document.getElementById('aurelia-chat-window');
        if (!css) {
            if (el) el.remove();
            if (win) win.classList.remove('ccrb-on');
            return false;
        }
        if (!el) { el = document.createElement('style'); el.id = STYLE_ID; }
        el.textContent = RESET + '\n' + css;
        document.head.appendChild(el);   // 每次都搬到最後：同分時贏房間自己的樣式
        if (win) win.classList.add('ccrb-on');
        return true;
    };

    // ── 衣櫃最底下「聊天泡泡」那一區（wardrobe.js 每次重畫完叫 section）──────
    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    // 原本的樣子：房間自己的那兩顆（白底金邊、深藍），照 room_content.css 畫個小的
    const PLAIN_THUMB = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'
        + 'html,body{margin:0;height:100%}body{padding:9px 6px;background:#f4f6fb;font-family:system-ui,"Noto Sans TC",sans-serif;overflow:hidden}'
        + '.r{display:flex;margin:0 2px 8px}.r.me{justify-content:flex-end}'
        + '.b{max-width:78%;padding:6px 9px;border-radius:11px;font-size:10.5px;line-height:1.45}'
        + '.o .b{background:#fff;color:#1f3a68;border:1px solid #b9924f;border-top-left-radius:3px;font-family:Georgia,"Songti TC",serif}'
        + '.me .b{background:#2a4a80;color:#fff;border-top-right-radius:3px}'
        + '</style></head><body><div class="r o"><div class="b">今晚要不要出來？</div></div><div class="r me"><div class="b">好啊，老地方。</div></div></body></html>';
    /** host＝衣櫃裡那個空的格子；rid＝這間。🚨 卡片不掛 wd-card：衣櫃自己每次重畫會把 .wd-card 全部當成衣服那幾格去拆 data-k */
    RoomBubbles.section = function (host, rid) {
        if (!host || !rid) return;
        const AI = _AI(), lib = RoomBubbles.library(), now = RoomBubbles.get(rid);
        const nowKey = now ? _fold(now.name) : '';
        const card = (key, name, on) => '<button type="button" class="wd-bcard' + (on ? ' is-now' : '') + '" data-b="' + _esc(key) + '">'
            + '<span class="wd-bpic"><iframe sandbox="allow-same-origin" scrolling="no" tabindex="-1"></iframe></span>'
            + '<span class="wd-name">' + _esc(name) + '</span>' + (on ? '<span class="wd-badge">用著</span>' : '') + '</button>';
        // 泡泡庫裡已經沒有、但房間還用著的那套（刪了或改了名）：照存的那份留一格
        const orphan = now && !lib.some(t => _fold(t.name) === nowKey);
        let h = '<div class="wd-h">聊天泡泡<span class="wd-n">' + (lib.length ? '泡泡庫 ' + lib.length + ' 套' : '') + '</span></div>'
            + '<div class="wd-bgrid">' + card('', '原本的', !now)
            + (orphan ? card('\u0000now', now.name, true) : '')
            + lib.map(t => card(t.name, t.name, !!now && _fold(t.name) === nowKey)).join('') + '</div>';
        if (!lib.length) h += '<div class="wd-bnote">聊天 app 的泡泡庫還是空的。在聊天室的泡泡設定收藏一套，這裡就挑得到。</div>';
        host.innerHTML = h;
        const items = [null].concat(orphan ? [now] : [], lib);
        host.querySelectorAll('.wd-bcard').forEach((el, i) => {
            const t = items[i], fr = el.querySelector('iframe');
            try { fr.srcdoc = t ? ((AI && AI.buildThumb) ? AI.buildThumb(t.css) : '') : PLAIN_THUMB; } catch (_) {}
            el.addEventListener('click', () => {
                if (el.classList.contains('is-now')) return;
                RoomBubbles.set(rid, t);
                RoomBubbles.section(host, rid);
            });
        });
    };

    // ── 小機自己換（學會泡泡課才給說明、才照標籤做）──────────────
    const TAG_RE = /[<＜]\s*(bubble_use|bubble_reset)\b([^>＞]*?)\/?\s*[>＞]/gi;
    const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g;
    function _inCode(pos, text) {
        let hit = false;
        String(text).replace(CODE_RE, (m, off) => { if (pos >= off && pos < off + m.length) hit = true; return m; });
        return hit;
    }
    function _attr(attrs, name) {
        const m = String(attrs || '').match(new RegExp(name + '\\s*=\\s*["“”「『＂]?([^"“”」』＂]*)["“”」』＂]?', 'i'));
        return m ? _one(m[1]) : '';
    }
    /** 回覆裡的標籤（只做第一個）：{ verb: 'use'|'reset', name } 或 null。程式碼裡的不算 */
    RoomBubbles.parseTag = function (text) {
        const s = String(text || '');
        TAG_RE.lastIndex = 0;
        let m;
        while ((m = TAG_RE.exec(s))) {
            if (_inCode(m.index, s)) continue;
            return m[1].toLowerCase() === 'bubble_reset' ? { verb: 'reset', name: '' } : { verb: 'use', name: _attr(m[2], 'name') };
        }
        return null;
    };
    /** 照回覆換。回一句人話（做了什麼／為什麼沒做），沒有標籤回 '' */
    RoomBubbles.applyTags = function (rid, text) {
        const a = RoomBubbles.parseTag(text);
        if (!a || !rid) return '';
        if (a.verb === 'reset') {
            if (!RoomBubbles.get(rid)) return '泡泡本來就是原本的樣子';
            RoomBubbles.set(rid, null);
            return '泡泡換回原本的樣子';
        }
        if (!a.name) return '';
        const t = RoomBubbles.library().find(x => _fold(x.name) === _fold(a.name));
        if (!t) return '泡泡庫裡沒有「' + a.name + '」，沒換';
        RoomBubbles.set(rid, t);
        return '泡泡換成「' + t.name + '」';
    };
    /** 接在小機說明最後的「你的泡泡」一段（寫給陌生模型看；不給範例） */
    RoomBubbles.brief = function (rid, user) {
        user = user || '對方';
        const now = RoomBubbles.get(rid), lib = RoomBubbles.library();
        const out = ['', '【你的泡泡】',
            '你跟' + user + '私聊時，兩邊的對話泡泡用哪一套樣子，你可以自己換；' + user + '也能在衣櫃幫你換。換不換你自己決定，不用每次回覆都換：你自己想換了、或' + user + '要你換的時候再寫。',
            '現在用的：' + (now ? '「' + now.name + '」' : '原本的樣子') + '。'];
        if (lib.length) {
            out.push('泡泡庫裡有 ' + lib.length + ' 套' + (lib.length > LIST_MAX ? '，列最近的 ' + LIST_MAX + ' 套' : '') + '：'
                + lib.slice(0, LIST_MAX).map(t => '「' + _one(t.name) + '」').join('、'));
        } else out.push('泡泡庫裡還是空的。');
        out.push('想換就在回覆裡另外寫一個標籤。這不是工具，不用 tool_call，寫在你回' + user + '的話旁邊就好，' + user + '看不到標籤本身。'
            + '一次回覆只做第一個。標籤名與屬性名照抄英文，name 寫泡泡庫裡的名字，不要翻譯、不要改寫：',
            '<bubble_use name="名字"/>',
            '換回原本的樣子寫：',
            '<bubble_reset/>',
            '泡泡庫裡沒有想要的，可以用做泡泡的工具做一套新的；' + user + '按同意、收進泡泡庫之後，下一次回覆再換上。');
        return out.join('\n');
    };

})(window.RoomBubbles = window.RoomBubbles || {});
