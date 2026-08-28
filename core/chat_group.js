/**
 * core/chat_group.js — Claude × Codex 群聊區協調器
 * 你 / Claude / Codex 三方同一聊天室。骰子決定誰拿發言權、可 [PASS]。
 * 傳話人模型：Claude / Codex 各自獨立 session，協調器互相轉述。
 */
(function (ChatGroup) {
    'use strict';

    const STORE_KEY = 'group_chat_main';     // OS_DB transcript

    // 席位以「住戶」為單位（宿舍化之後同一顆 Claude 的分身各佔各的席）。
    // 舊資料裡 speaker / session 都是 provider 字串，一律先過 _normSpeaker 換成住戶 id。
    const LEGACY_SPEAKER = { claude: 'dan', codex: 'aluo', deepseek: 'sujingming' };
    // 內建三位沿用原本的 localStorage key，她的既有 session 不用重開
    const LEGACY_SID = {
        dan:        'group_claude_sid',
        aluo:       'group_codex_sid',
        sujingming: 'group_deepseek_sid',
    };

    let _transcript = [];   // [{ speaker:'rae'|'recap'|<residentId>, content, ts, usage? }]
    let _seen = {};         // residentId → 已被送到第幾則 transcript index（沒有的當 -1）
    let _loaded = false;    // load() 跑過沒 —— 沒跑過就往 _transcript 推東西會蓋掉 OS_DB 那份
    let _busy = false;
    let _streamEl = null;   // 渲染目標（窗內 chat-stream）
    let _game = null;             // 遊戲模式：{ players:[p1,p2], turnIdx, moveCount, raeResolver, endSignal }
    let _pendingAttachments = []; // 待送附件：{path,filename,mime,size,thumb} 或 {_uploading:true,filename,mime,size}
    const GAME_TURN_LIMIT = 60;   // 安全閥：總手數上限，防無限迴圈 + 訂閱額度爆

    function _CT() { return window.ClaudeTerminal || null; }

    /** 目前入席的住戶 [{id,name,provider,seatModelId}]；資料層還沒好就回空陣列 */
    function _seats() {
        const CT = _CT();
        if (!CT || typeof CT.listGroupSeats !== 'function') return [];
        try { return CT.listGroupSeats() || []; } catch (_) { return []; }
    }
    function _seatIds() { return _seats().map(s => s.id); }
    function _seatOf(rid) { return _seats().find(s => s.id === rid) || null; }

    /** 住戶 id → provider。查不到（退席了但 transcript 還留著他的話）也要有答案。 */
    function _provOf(rid) {
        const s = _seatOf(rid);
        if (s) return s.provider;
        const CT = _CT();
        if (CT && typeof CT.getResident === 'function') {
            const r = CT.getResident(rid);
            if (r) return r.provider;
        }
        return 'claude';
    }

    /** 顯示名。退席／被刪的住戶仍要有名字，不然舊訊息會變成一串 id。 */
    function _labelOf(sp) {
        if (sp === 'rae')   return 'Rae';
        if (sp === 'recap') return '前情提要';
        if (sp === 'sys')   return '系統';
        const s = _seatOf(sp);
        if (s) return s.name;
        const CT = _CT();
        if (CT && typeof CT.getResident === 'function') {
            const r = CT.getResident(sp);
            if (r) return r.name;
        }
        return String(sp || 'AI');
    }

    /** 氣泡配色跟著 provider 走 —— 同一顆 Claude 的分身共用一套顏色，CSS 不用改 */
    function _cssOf(sp) {
        if (sp === 'rae' || sp === 'recap') return sp;
        return _provOf(sp);
    }

    const _FACE = { claude: '🦀', codex: '🔷', deepseek: '🟢' };
    function _hdrTextOf(sp) { return (_FACE[_provOf(sp)] || '🦀') + ' ' + _labelOf(sp); }

    /**
     * 把表頭填成「🦀 名字 · 模型」。分小機之後同一顆 Claude 會有好幾位坐在桌上，
     * 光看名字認不出是哪顆腦在講話 —— 模型那截用淡色小字掛在後面，不搶名字。
     * Codex / DeepSeek 各只有一位，不標。
     */
    function _fillHdr(el, sp) {
        if (!el) return;
        el.textContent = '';
        const nameEl = document.createElement('span');
        nameEl.className = 'cg-hdr-name';
        nameEl.textContent = _hdrTextOf(sp);
        el.appendChild(nameEl);
        const CT = _CT();
        const model = (CT && typeof CT.residentModelLabel === 'function') ? CT.residentModelLabel(sp) : '';
        if (model) {
            const mEl = document.createElement('span');
            mEl.className = 'cg-hdr-model';
            mEl.textContent = '· ' + model;
            el.appendChild(mEl);
        }
    }

    /** 舊 transcript / 舊參數裡的 provider 字串 → 住戶 id */
    function _normSpeaker(sp) { return LEGACY_SPEAKER[sp] || sp; }

    function _seenOf(rid) { return _seen[rid] == null ? -1 : _seen[rid]; }

    function _lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
    function _lsSet(k, v) {
        try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {}
    }
    function _sidKey(rid) {
        return LEGACY_SID[rid] || ('group_sid__' + rid);
    }

    /** 清掉某位在群聊裡的 session（下次從零 boot） */
    function _clearSid(rid) { _lsSet(_sidKey(rid), null); }

    /** 清掉所有可能有 session 的人：現在入席的 + 內建三位（退席的也要清乾淨） */
    function _clearAllSids() {
        const ids = new Set(_seatIds());
        Object.keys(LEGACY_SID).forEach(id => ids.add(id));
        ids.forEach(_clearSid);
    }

    function _save() {
        if (window.OS_DB && typeof window.OS_DB.saveStudioChat === 'function') {
            window.OS_DB.saveStudioChat(STORE_KEY, _transcript).catch(() => {});
        }
    }

    // ── 載入 ──
    ChatGroup.load = async function () {
        _transcript = [];
        if (window.OS_DB && typeof window.OS_DB.getStudioChat === 'function') {
            try {
                const m = await window.OS_DB.getStudioChat(STORE_KEY);
                if (Array.isArray(m)) _transcript = m;
            } catch (_) {}
        }
        // 宿舍化之前的 transcript speaker 是 provider 字串 → 一次性換成住戶 id
        let migrated = false;
        _transcript.forEach(function (m) {
            if (m && LEGACY_SPEAKER[m.speaker]) { m.speaker = LEGACY_SPEAKER[m.speaker]; migrated = true; }
        });
        if (migrated) _save();

        // 各人的 session 都已續到上次存檔點 → seen 設為 transcript 末端
        _seen = {};
        const end = _transcript.length - 1;
        _seatIds().forEach(function (id) { _seen[id] = end; });
        // 退席後又回來的人也不能重看整段（他的 session 裡本來就有）
        _transcript.forEach(function (m) {
            if (m && m.speaker !== 'rae' && m.speaker !== 'recap' && m.speaker !== 'sys'
                && _seen[m.speaker] == null) {
                _seen[m.speaker] = end;
            }
        });
        _loaded = true;
    };

    // ── 系統告示 ──
    // 入席 / 離席 / 改名這種事發生在宿舍面板，群聊當下可能根本沒開。
    // 所以它進 transcript（而不是只畫一行字）：一來下次打開看得到，
    // 二來——真正的重點——其他人會透過傳話增量知道桌上多了誰、誰改了名。
    async function _announce(text) {
        if (!text) return;
        if (!_loaded) await ChatGroup.load();   // 沒 load 過就 push 會把 OS_DB 那份蓋成空的
        _transcript.push({ speaker: 'sys', content: text, ts: Date.now() });
        _save();
        if (_streamEl) _renderSystemLine(text);
    }

    /** 誰上桌 / 下桌。dorm 面板點椅子時呼叫（fire-and-forget）。 */
    ChatGroup.announceSeat = function (rid, seated) {
        const who = _labelOf(rid);
        return _announce(who + (seated ? ' 入席了' : ' 離席了')).catch(function (e) {
            console.warn('[ChatGroup] 入席告示失敗：', e);
        });
    };

    /** 有人改名。改的是誰、從什麼變成什麼，桌上的人要知道。 */
    ChatGroup.announceRename = function (oldName, newName) {
        if (!oldName || !newName || oldName === newName) return Promise.resolve();
        return _announce(oldName + ' 改名叫 ' + newName + ' 了').catch(function (e) {
            console.warn('[ChatGroup] 改名告示失敗：', e);
        });
    };

    /**
     * AI 自己改名（回覆裡吐 [RENAME|新名字]）。
     * 回 { ok, reason } —— 改成了就順手告示，沒改成也告示一行，
     * 不然他會以為改好了、之後都自稱新名字，桌上其他人卻還叫他舊的。
     */
    function _aiRename(rid, raw) {
        const CT = _CT();
        if (!CT || typeof CT.saveResident !== 'function') return { ok: false, reason: '資料層沒載入' };
        const cur = _seatOf(rid) || (typeof CT.getResident === 'function' ? CT.getResident(rid) : null);
        if (!cur) return { ok: false, reason: '查無此住戶' };
        const name = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
        if (!name) return { ok: false, reason: '名字是空的' };
        if (name.length > 20) return { ok: false, reason: '名字太長（最多 20 字）' };
        if (name === cur.name) return { ok: false, reason: '本來就叫這個' };
        // 這三個是講者前綴會用到的字，被拿去當名字會讓逐字稿分不清誰在講話
        if (['Rae', 'rae', '系統', '前情提要'].indexOf(name) >= 0) return { ok: false, reason: '這個名字被系統用掉了' };
        const clash = (typeof CT.listResidents === 'function' ? CT.listResidents() : [])
            .some(function (x) { return x.id !== rid && x.name === name; });
        if (clash) return { ok: false, reason: '已經有人叫這個名字' };
        const saved = CT.saveResident({ id: rid, name: name });
        if (!saved) return { ok: false, reason: '存檔失敗' };
        return { ok: true, oldName: cur.name, newName: name };
    }

    // ── 渲染 ──
    function _scrollBottom() { if (_streamEl) _streamEl.scrollTop = _streamEl.scrollHeight; }

    // 把內容塞進氣泡：AI → markdown 渲染；Rae → 純文字。一律先剝遊戲標記。
    function _setBubbleContent(bubbleEl, speaker, content) {
        const clean = _stripForDisplay(content);
        if (speaker !== 'rae' && window.VoidClaudeRoom
            && typeof window.VoidClaudeRoom.markdownToSafeHtml === 'function') {
            const html = window.VoidClaudeRoom.markdownToSafeHtml(clean);
            if (html !== null && html !== undefined) {
                bubbleEl.innerHTML = html;
                bubbleEl.classList.add('claude-bubble-md');
                return;
            }
        }
        bubbleEl.textContent = clean;
    }

    // 把附件陣列建成氣泡內的附件區塊（圖片 → 縮圖點放大；非圖 → 📎 chip）。空 → null。
    function _buildAttachmentsBox(attachments) {
        if (!Array.isArray(attachments) || !attachments.length) return null;
        const box = document.createElement('div');
        box.className = 'cg-bubble-attachments';
        attachments.forEach(function (a) {
            if (a && a.thumb && a.mime && a.mime.indexOf('image/') === 0) {
                const im = document.createElement('img');
                im.className = 'cg-attach-img';
                im.src = a.thumb;
                im.addEventListener('click', function () { _openImageOverlay(a.thumb); });
                box.appendChild(im);
            } else {
                const chip = document.createElement('span');
                chip.className = 'cg-attach-chip';
                chip.textContent = '📎 ' + ((a && a.filename) || 'file');
                box.appendChild(chip);
            }
        });
        return box;
    }

    function _renderBubble(speaker, content, attachments) {
        if (!_streamEl) return null;
        // 'recap' = 「🧹 摘要重啟」按鈕生成的前情提要,render 成置中分隔卡(非氣泡)
        if (speaker === 'recap') {
            const card = document.createElement('div');
            card.className = 'cg-recap-card';
            const hdr = document.createElement('div');
            hdr.className = 'cg-recap-hdr';
            hdr.textContent = '📋 前情提要(已壓縮)';
            const body = document.createElement('div');
            body.className = 'cg-recap-body';
            _setBubbleContent(body, speaker, content);
            card.appendChild(hdr);
            card.appendChild(body);
            _streamEl.appendChild(card);
            _scrollBottom();
            return body;
        }
        const css = _cssOf(speaker);
        const wrap = document.createElement('div');
        wrap.className = 'cg-bubble-wrap cg-from-' + css;
        if (speaker !== 'rae') {
            const hdr = document.createElement('div');
            hdr.className = 'cg-bubble-hdr cg-hdr-' + css;
            _fillHdr(hdr, speaker);
            wrap.appendChild(hdr);
        }
        const b = document.createElement('div');
        b.className = 'cg-bubble cg-from-' + css;
        _setBubbleContent(b, speaker, content);

        // 附件：圖片 → 內嵌縮圖（點放大）；非圖 → 📎 chip
        const attBox = _buildAttachmentsBox(attachments);
        if (attBox) b.appendChild(attBox);

        wrap.appendChild(b);
        _streamEl.appendChild(wrap);
        _scrollBottom();
        return b;
    }

    function _renderTyping(speaker) {
        if (!_streamEl) return null;
        const css = _cssOf(speaker);
        const wrap = document.createElement('div');
        wrap.className = 'cg-bubble-wrap cg-from-' + css;
        const hdr = document.createElement('div');
        hdr.className = 'cg-bubble-hdr cg-hdr-' + css;
        _fillHdr(hdr, speaker);
        const b = document.createElement('div');
        b.className = 'cg-bubble cg-from-' + css + ' cg-typing';
        b.textContent = '正在輸入…';
        wrap.appendChild(hdr);
        wrap.appendChild(b);
        _streamEl.appendChild(wrap);
        _scrollBottom();
        return wrap;
    }

    // 系統通知行（置中、淡色，例如收場 / 中止）
    function _renderSystemLine(text) {
        if (!_streamEl) return;
        const d = document.createElement('div');
        d.className = 'cg-system-line';
        d.textContent = text;
        _streamEl.appendChild(d);
        _scrollBottom();
    }

    // 點縮圖 → 全螢幕放大 overlay（點任意處關閉）
    function _openImageOverlay(src) {
        const ov = document.createElement('div');
        ov.className = 'cg-img-overlay';
        const im = document.createElement('img');
        im.src = src;
        ov.appendChild(im);
        ov.addEventListener('click', function () {
            if (ov.parentNode) ov.parentNode.removeChild(ov);
        });
        document.body.appendChild(ov);
    }

    // 把圖檔縮到長邊 ≤ maxEdge、轉 JPEG base64 data URL。失敗回 null。
    function _makeThumb(file, maxEdge) {
        return new Promise(function (resolve) {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = function () {
                URL.revokeObjectURL(url);
                let w = img.naturalWidth || 1, h = img.naturalHeight || 1;
                const scale = Math.min(1, maxEdge / Math.max(w, h));
                w = Math.max(1, Math.round(w * scale));
                h = Math.max(1, Math.round(h * scale));
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.82));
                } catch (e) { resolve(null); }
            };
            img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        });
    }

    // 待送附件 chip 列（重用浮窗既有的 #claude-attach-chips 容器）
    function _attachChipsEl() {
        const body = (window.ChatWindow && typeof window.ChatWindow.getBody === 'function')
            ? window.ChatWindow.getBody() : null;
        return body ? body.querySelector('#claude-attach-chips') : null;
    }

    function _renderPendingAttachments() {
        const row = _attachChipsEl();
        if (!row) return;
        row.innerHTML = '';
        _pendingAttachments.forEach(function (a, idx) {
            const chip = document.createElement('div');
            chip.className = 'cg-pending-chip' + (a._uploading ? ' cg-pending-uploading' : '');
            if (a.thumb) {
                const im = document.createElement('img');
                im.className = 'cg-pending-thumb';
                im.src = a.thumb;
                chip.appendChild(im);
            } else {
                const ic = document.createElement('span');
                ic.textContent = a._uploading ? '⏳' : '📎';
                chip.appendChild(ic);
            }
            const nm = document.createElement('span');
            nm.className = 'cg-pending-name';
            nm.textContent = a.filename || 'file';
            chip.appendChild(nm);
            const x = document.createElement('span');
            x.className = 'cg-pending-x';
            x.textContent = '×';
            x.addEventListener('click', function (e) {
                e.stopPropagation();
                _pendingAttachments.splice(idx, 1);
                _renderPendingAttachments();
            });
            chip.appendChild(x);
            row.appendChild(chip);
        });
    }

    /** 把整條 transcript 渲染進 streamEl（進群聊時用） */
    ChatGroup.hydrate = function (streamEl) {
        _streamEl = streamEl;
        _pendingAttachments = [];
        _renderPendingAttachments();
        if (!_streamEl) return;
        _streamEl.innerHTML = '';
        if (!_transcript.length) {
            const seats = _seats();
            const who = seats.length
                ? '你、' + seats.map(s => s.name).join('、') + ' 共 ' + (seats.length + 1) + ' 個人。'
                : '還沒有人入席 —— 去宿舍面板把要參加的住戶勾進來。';
            _renderBubble(seats.length ? seats[0].id : 'dan',
                '群聊區開張了 —— ' + who + (seats.length ? '@誰就只叫誰,不 @ 就大家一起回。' : ''));
            return;
        }
        _transcript.forEach(function (m) {
            // 系統告示（入席 / 離席 / 改名）→ 置中一行，不是氣泡
            if (m.speaker === 'sys') { _renderSystemLine(m.content); return; }
            // 系統注入提示、純標記行（如落子）剝完是空的 —— 不渲染
            if (m.speaker === 'rae' && m.content && m.content.indexOf('（系統）') === 0) return;
            const hasAtt = Array.isArray(m.attachments) && m.attachments.length;
            if (!_stripForDisplay(m.content) && !hasAtt) return;
            _renderBubble(m.speaker, m.content, m.attachments);
        });
    };

    // ── 遊戲標記解析 ──
    const RE_PANEL    = /<lobbyPanel>[\s\S]*?<\/lobbyPanel>/i;
    const RE_GAME     = /\[GAME\|\s*([^\],]+?)\s*,\s*([^\],]+?)\s*\]/i;
    const RE_MOVE     = /\[MOVE\|([^\]]*)\]/i;
    const RE_GAMEOVER = /\[GAMEOVER\|([^\]]*)\]/i;
    const RE_RENAME   = /\[RENAME\|([^\]]*)\]/i;

    // 先手/後手欄位認：住戶名字、住戶 id、'rae'，外加舊的 provider 代號（claude/codex/deepseek）。
    // 回住戶 id（或 'rae'）；認不出來回 null。
    function _normPlayer(v) {
        const raw = String(v == null ? '' : v).trim();
        if (!raw) return null;
        const low = raw.toLowerCase();
        if (low === 'rae' || raw === '我' || raw === '你') return 'rae';
        const seats = _seats();
        const byName = seats.find(x => (x.name || '').toLowerCase() === low);
        if (byName) return byName.id;
        const byId = seats.find(x => x.id.toLowerCase() === low);
        if (byId) return byId.id;
        if (LEGACY_SPEAKER[low]) {   // 舊代號 → 該 provider 第一位入席者
            const p = seats.find(x => x.provider === low);
            if (p) return p.id;
        }
        return null;
    }

    // 解析回覆裡的遊戲標記。回 { game:{p1,p2}|null, move:string|null, gameover:string|null }
    function _parseGameMarkers(text) {
        const t = text || '';
        const g = t.match(RE_GAME);
        const m = t.match(RE_MOVE);
        const o = t.match(RE_GAMEOVER);
        let game = null;
        if (g) {
            const p1 = _normPlayer(g[1]), p2 = _normPlayer(g[2]);
            if (p1 && p2) game = { p1: p1, p2: p2 };
        }
        const rn = t.match(RE_RENAME);
        return {
            game: game,
            move: m ? m[1].trim() : null,
            gameover: o ? o[1].trim() : null,
            rename: rn ? rn[1].trim() : null,
        };
    }

    // 給對手看：剝掉 <lobbyPanel> 大 HTML（畫布已渲染、不重送），保留遊戲標記
    function _stripForTranscript(text) {
        // RENAME 也剝掉：系統告示已經講過這件事，留著只會讓別人跟著學那個標記
        return (text || '').replace(RE_PANEL, '').replace(RE_RENAME, '').trim();
    }

    // 給氣泡顯示：剝掉 panel + 所有遊戲標記
    function _stripForDisplay(text) {
        return (text || '')
            .replace(RE_PANEL, '')
            .replace(RE_GAME, '')
            .replace(RE_MOVE, '')
            .replace(RE_GAMEOVER, '')
            .replace(RE_RENAME, '')
            .replace(/[ \t]+\n/g, '\n')      // 標記剝掉後行尾留的空白
            .replace(/\n{3,}/g, '\n\n')      // 標記剝掉後留下的空行 → 收斂成單一段落間距
            .trim();
    }

    // 兩則之間隔多久才值得標一行。低於這個當同一段對話，不吵。
    const GAP_MARK_MS = 30 * 60 * 1000;

    /** 把毫秒差說成人話。給 AI 看的，不用精確到秒。 */
    function _fmtGap(ms) {
        const min = Math.round(ms / 60000);
        if (min < 60) return min + ' 分鐘';
        const hr = Math.round(min / 60);
        if (hr < 24) return hr + ' 小時';
        const day = Math.round(hr / 24);
        if (day < 30) return day + ' 天';
        const mon = Math.round(day / 30);
        if (mon < 12) return mon + ' 個月';
        return Math.round(mon / 12) + ' 年';
    }

    function _fmtClock(ts) {
        const d = new Date(ts);
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
             + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    // ── 傳話增量：transcript 自 _seen[rid] 之後、非他自己的話 ──
    // 開頭永遠標現在幾點，中間隔久了插一行 —— 他的 session 裡沒有任何時間資訊，
    // 不講的話她隔一週回來，那一輪對他而言跟「剛剛」沒有分別。
    function _buildDelta(rid) {
        const seenIdx = _seenOf(rid);
        const lines = [];
        // 從「他上次看到的那則」起算，第一段間隔才算得出來
        let prevTs = (seenIdx >= 0 && _transcript[seenIdx]) ? _transcript[seenIdx].ts : null;
        for (let i = seenIdx + 1; i < _transcript.length; i++) {
            const m = _transcript[i];
            if (m.speaker === rid) {          // 他自己的話已在他 session 裡，但時間要當基準
                if (m.ts) prevTs = m.ts;
                continue;
            }
            if (prevTs && m.ts && (m.ts - prevTs) >= GAP_MARK_MS) {
                lines.push('（隔了 ' + _fmtGap(m.ts - prevTs) + '）');
            }
            lines.push('[' + _labelOf(m.speaker) + ']: ' + m.content);
            if (m.ts) prevTs = m.ts;
        }
        if (!lines.length) return '';         // 沒有新東西 —— 別讓時間行自己撐成一則增量
        return '（現在 ' + _fmtClock(Date.now()) + '）\n\n' + lines.join('\n\n');
    }

    // 跟 _buildDelta 同範圍：收集增量涵蓋的 rae 附件（去掉 thumb，cc-bridge 只要 path）
    function _collectDeltaAttachments(rid) {
        const out = [];
        for (let i = _seenOf(rid) + 1; i < _transcript.length; i++) {
            const m = _transcript[i];
            if (m.speaker === rid) continue;
            if (Array.isArray(m.attachments)) {
                m.attachments.forEach(function (a) {
                    if (a && a.path) out.push({ path: a.path, filename: a.filename, mime: a.mime, size: a.size });
                });
            }
        }
        return out;
    }

    /** 回合收尾時把改名結果告示出去（成功與否都說，AI 才知道自己現在叫什麼） */
    async function _flushRename(rid, markers, renamed) {
        if (!renamed) return;
        if (renamed.ok) await ChatGroup.announceRename(renamed.oldName, renamed.newName);
        else await _announce(_labelOf(rid) + ' 想改名叫「' + markers.rename + '」，沒改成：' + renamed.reason);
    }

    // ── 一個 AI 的回合 ──
    // opts.gameTurn=true：遊戲回合，即使沒有新增量也要催它落子
    // 回傳 { spoke:bool, failed:bool, markers:{game,move,gameover} }
    async function _runTurn(rid, opts) {
        opts = opts || {};
        let delta = _buildDelta(rid);
        const deltaAttachments = _collectDeltaAttachments(rid);
        // 他這一輪實際看到哪裡為止。回合結束一律用這個數字，別再取當下的
        // _transcript.length-1 —— 這中間可能插進了他沒看過的東西（有人入席、
        // 有人改名的系統告示），拿當下末端會把那些一起標成已讀、之後永遠不補送。
        const seenAt = _transcript.length - 1;
        if (!delta.trim()) {
            if (!opts.gameTurn) {
                _seen[rid] = seenAt;
                return { spoke: false, failed: false, markers: {} };
            }
            // 遊戲回合沒新增量（例：開局先手的第一手）→ 催落子
            delta = '（系統）輪到你下棋了，請依先前約定的格式落子。';
        }

        const seat = _seatOf(rid);
        const typingWrap = _renderTyping(rid);
        const bubbleEl = typingWrap && typingWrap.querySelector('.cg-bubble');
        let acc = '';

        function _send(sid) {
            acc = '';
            return window.ClaudeTerminal.sendGroup({
                residentId: rid,
                selfName:   _labelOf(rid),
                otherNames: _seats().filter(x => x.id !== rid).map(x => x.name),
                model:      seat ? seat.seatModelId : '',
                sessionId: sid,
                userText: delta,
                attachments: deltaAttachments,
                onProgress: function (ev) {
                    if (ev && ev.type === 'text') {
                        acc = ev.accumulated || (acc + (ev.delta || ''));
                        if (bubbleEl) {
                            bubbleEl.classList.remove('cg-typing');
                            bubbleEl.textContent = _stripForDisplay(acc);
                            _scrollBottom();
                        }
                    }
                },
            });
        }

        function _fail(err) {
            if (bubbleEl) {
                bubbleEl.classList.remove('cg-typing');
                bubbleEl.classList.add('cg-error');
                bubbleEl.textContent = '⚠️ ' + ((err && err.message) || '送出失敗');
            }
            // 送出失敗：不推進 _seen —— 下一輪再補送
            return { spoke: false, failed: true, markers: {} };
        }

        const sid0 = _lsGet(_sidKey(rid));
        let result;
        try {
            result = await _send(sid0);
        } catch (e) {
            // EMPTY 而且當時帶著 session：多半是那條 session 已經不在了。
            // CLI 的 session 按工作目錄分家，cc-bridge 的 cli_cwd 換過之後，
            // 舊 sid 在新目錄下找不到——CLI 不報錯、回空、cost 算 0，橋照實回傳，
            // 到這裡就成了 EMPTY。清掉 sid 從零開一條再試一次，只試這一次。
            if (/^EMPTY:/.test((e && e.message) || '') && sid0) {
                _clearSid(rid);
                try {
                    result = await _send(null);
                } catch (e2) { return _fail(e2); }
            } else {
                return _fail(e);
            }
        }
        if (result.sessionId) _lsSet(_sidKey(rid), result.sessionId);

        const reply = (result.reply || '').trim();
        if (/^\[PASS\]$/i.test(reply)) {
            if (typingWrap && typingWrap.parentNode) typingWrap.parentNode.removeChild(typingWrap);
            _seen[rid] = seenAt;
            return { spoke: false, failed: false, markers: {} };
        }

        const markers = _parseGameMarkers(result.reply);

        // 他自己要改名：先改掉，這則氣泡的表頭就用新名字（他講這句話時已經叫新的了）
        let renamed = null;
        if (markers.rename) {
            renamed = _aiRename(rid, markers.rename);
            if (renamed.ok && typingWrap) {
                _fillHdr(typingWrap.querySelector('.cg-bubble-hdr'), rid);
            }
        }

        // <lobbyPanel> 畫布：永遠渲染（開局棋盤經此上來）
        if (window.VoidCanvas && typeof window.VoidCanvas.parseLobbyPanel === 'function') {
            const panel = window.VoidCanvas.parseLobbyPanel(result.reply);
            if (panel && window.ChatCanvas && typeof window.ChatCanvas.render === 'function') {
                window.ChatCanvas.render(panel);
            }
        }

        // 落子 → 餵畫布（只在遊戲模式中；開局首手由 _maybeStartGame 另外處理）
        if (markers.move != null && _game &&
            window.ChatCanvas && typeof window.ChatCanvas.applyMove === 'function') {
            window.ChatCanvas.applyMove(markers.move, _labelOf(rid));
        }

        if (result.usage && window.OS_SPEND_PANEL && typeof window.OS_SPEND_PANEL.record === 'function') {
            try { window.OS_SPEND_PANEL.record(result.usage); } catch (_) {}
        }

        const displayText = _stripForDisplay(result.reply);
        const transcriptText = _stripForTranscript(result.reply);
        const imgAtts = (Array.isArray(result.images) && result.images.length) ? result.images : null;

        if (!transcriptText && !imgAtts) {
            // 整則只有 <lobbyPanel>、沒文字沒標記沒圖：移掉空氣泡，不進 transcript
            if (typingWrap && typingWrap.parentNode) typingWrap.parentNode.removeChild(typingWrap);
            _seen[rid] = seenAt;
            await _flushRename(rid, markers, renamed);
            return { spoke: true, failed: false, markers: markers };
        }
        if (!displayText && !imgAtts) {
            // 只有標記、沒閒聊文字也沒圖：移掉氣泡，但 transcript 仍要記（對手要看到 [MOVE]）
            if (typingWrap && typingWrap.parentNode) typingWrap.parentNode.removeChild(typingWrap);
        } else if (bubbleEl) {
            bubbleEl.classList.remove('cg-typing');
            _setBubbleContent(bubbleEl, rid, result.reply);
            if (imgAtts) {
                const box = _buildAttachmentsBox(imgAtts);
                if (box) bubbleEl.appendChild(box);
            }
        }
        const turnEntry = { speaker: rid, content: transcriptText, ts: Date.now(), usage: result.usage || null };
        if (imgAtts) turnEntry.attachments = imgAtts;
        _transcript.push(turnEntry);
        _seen[rid] = seenAt;
        _save();
        await _flushRename(rid, markers, renamed);
        return { spoke: true, failed: false, markers: markers };
    }

    // ── 自動多輪遊戲迴圈 ──
    // _game 為 truthy 時運轉；用 _game.endSignal 統一收場。整個生命週期由本迴圈獨佔。
    async function _runGameLoop() {
        while (_game && !_game.endSignal) {
            if (_game.moveCount >= GAME_TURN_LIMIT) {
                _game.endSignal = { text: '已達回合上限 ' + GAME_TURN_LIMIT + ' 手，自動對弈停止。' };
                break;
            }
            const mover = _game.players[_game.turnIdx % 2];

            if (mover === 'rae') {
                // 輪到 Rae：暫停迴圈，等畫布捕捉點擊 → LP.submitMove → resolve
                const payload = await new Promise(function (resolve) { _game.raeResolver = resolve; });
                if (!_game) return;                       // 等待期間遊戲被清掉
                _game.raeResolver = null;
                if (_game.endSignal) break;               // 等待期間被收場
                if (payload == null) break;               // 中止信號
                if (window.ChatCanvas && typeof window.ChatCanvas.applyMove === 'function') {
                    window.ChatCanvas.applyMove(payload, 'rae');
                }
                _transcript.push({ speaker: 'rae', content: '[MOVE|' + payload + ']', ts: Date.now() });
                _save();
                _game.moveCount++;
                _game.turnIdx++;
                continue;
            }

            // 輪到 AI
            const res = await _runTurn(mover, { gameTurn: true });
            if (!_game) return;
            if (_game.endSignal) break;
            if (res.failed) {
                _game.endSignal = { text: _labelOf(mover) + ' 連線失敗，對局中止。' };
                break;
            }
            if (res.markers && res.markers.gameover != null) {
                _game.endSignal = { text: res.markers.gameover };
                break;
            }
            if (res.markers && res.markers.move != null) {
                _game.moveCount++;
                _game.turnIdx++;
                continue;
            }
            // 該下棋卻沒落子也沒收場 → 中止（不重試，YAGNI）
            _game.endSignal = { text: _labelOf(mover) + ' 這手沒有落子，對局中止。' };
            break;
        }
        const sig = _game && _game.endSignal;
        await _endGameInternal(sig ? sig.text : null);
    }

    // ── 收場：退出遊戲模式 + 收場講評一輪 ──
    async function _endGameInternal(resultText) {
        // players 在清掉 _game 之前先抓下來 —— 講評要問的是這局的雙方
        const players = ((_game && _game.players) || []).filter(p => p && p !== 'rae');
        _game = null;
        if (resultText) _renderSystemLine('🏁 ' + resultText);

        // 收場講評一輪：注入系統提示進 transcript（不渲染這條），兩個 AI 各講評一句
        _transcript.push({
            speaker: 'rae',
            content: '（系統）這盤對局結束了。請用一句話講評，不要再落子、不要再輸出任何遊戲標記。',
            ts: Date.now(),
        });
        _save();
        const order = _shuffle(players);
        for (let i = 0; i < order.length; i++) await _runTurn(order[i]);

        _busy = false;
    }

    // 偵測某回合的回覆是否開了一局遊戲。是 → 進遊戲模式、啟動迴圈、回 true
    function _maybeStartGame(mover, res) {
        if (_game || !res || !res.markers || !res.markers.game) return false;
        const g = res.markers.game;
        _game = { players: [g.p1, g.p2], turnIdx: 0, moveCount: 0, raeResolver: null, endSignal: null };
        // 開局回覆若已落第一手（且開局者就是先手）→ 算進去、補畫
        if (res.markers.move != null && mover === g.p1) {
            _game.turnIdx = 1;
            _game.moveCount = 1;
            if (window.ChatCanvas && typeof window.ChatCanvas.applyMove === 'function') {
                window.ChatCanvas.applyMove(res.markers.move, mover);
            }
        }
        _busy = true;   // 遊戲模式期間維持 busy，由 _endGameInternal 釋放
        _runGameLoop().catch(function (e) {
            console.error('[ChatGroup] 遊戲迴圈錯誤：', e);
            _game = null;
            _busy = false;
        });
        return true;
    }

    // ── @-mention 解析（給 sendUserMessage 用）──
    // 認入席住戶的名字（她自己取的名字都算）、住戶 id，以及舊的 @Claude / @Codex /
    // @deepseek 這種 provider 代號 —— 代號對到「該 provider 第一位入席者」。
    // 名字先長後短比對，免得叫「丹」的那位把 @丹二 也接走。
    // 回傳入席住戶 id 的子集合（依她 @ 的先後順序）。
    function _parseMentions(text) {
        if (!text) return [];
        const seats = _seats();
        if (!seats.length) return [];
        const byLen = seats.slice().sort((a, b) => (b.name || '').length - (a.name || '').length);
        const out = [];
        const push = id => { if (id && out.indexOf(id) < 0) out.push(id); };
        // @ 後面連續的非分隔字元；名字最長 20（住戶名上限）
        const re = /@([^\s@,，。、;；:：!！?？]{1,20})/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const low = m[1].toLowerCase();
            const byName = byLen.find(x => x.name && low.indexOf(x.name.toLowerCase()) === 0);
            if (byName) { push(byName.id); continue; }
            const byId = seats.find(x => low.indexOf(x.id.toLowerCase()) === 0);
            if (byId) { push(byId.id); continue; }
            const prov = ['claude', 'codex', 'deepseek'].find(p => low.indexOf(p) === 0);
            if (prov) { const p = seats.find(x => x.provider === prov); if (p) push(p.id); }
        }
        return out;
    }

    // Fisher-Yates shuffle:入席順序隨機,避免老是同一隻先講
    function _shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // ── 你發訊息 ──
    ChatGroup.sendUserMessage = async function (text) {
        text = text || '';
        const hasAtt = _pendingAttachments.some(function (a) { return a && a.path; });
        if (!text.trim() && !hasAtt) return;
        // 一般忙碌中（非遊戲）→ 擋，不動 pending，使用者可稍後重送
        if (!_game && _busy) return;

        // 快照待送附件（只取上傳完成、有 path 的），清空 pending
        const atts = _pendingAttachments
            .filter(function (a) { return a && a.path; })
            .map(function (a) {
                return { path: a.path, filename: a.filename, mime: a.mime, size: a.size, thumb: a.thumb || null };
            });
        _pendingAttachments = [];
        _renderPendingAttachments();

        const entry = { speaker: 'rae', content: text, ts: Date.now() };
        if (atts.length) entry.attachments = atts;

        // 遊戲進行中：只進 transcript + 渲染，不另起一輪（迴圈下個回合自然帶到）
        if (_game) {
            _transcript.push(entry);
            _renderBubble('rae', text, atts);
            _save();
            return;
        }

        _busy = true;
        try {
            _transcript.push(entry);
            _renderBubble('rae', text, atts);
            _save();

            // @-mention 路由:
            //  - 明確 @ 某幾隻 → 只叫那些(省 token、其他人完全跳過)
            //  - 無 @ → 全部入席者都叫、Fisher-Yates 洗順序、各自 [PASS] 自決
            // 這裡是「序列」不是併發:後講的人看得到前面的人剛說什麼,互相接話靠的就是這個。
            // 入席的人越多一輪越久,那是語意成本 —— 沒話講的會直接 [PASS],很快。
            const mentions = _parseMentions(text);
            const seated = _seatIds();
            if (!seated.length) {
                // 全員下桌了：她發的話還是進 transcript（回頭有人上桌就看得到），
                // 但得當場說一聲，不然按了送出什麼都沒發生，看起來像壞了。
                _renderSystemLine('桌上沒有人 —— 去宿舍面板的門卡上勾「入席」，把要參加的住戶請上桌。');
                return;
            }
            const order = mentions.length > 0 ? mentions : _shuffle(seated);
            for (let i = 0; i < order.length; i++) {
                const r = await _runTurn(order[i]);
                if (_maybeStartGame(order[i], r)) return;   // 開局了 → 交給遊戲迴圈
            }
        } finally {
            // 進了遊戲模式則 _busy 維持 true（由 _endGameInternal 釋放）；否則放掉
            if (!_game) _busy = false;
        }
    };

    // ── 摘要 & 重啟:對話太長時用一次 Sonnet 把整段壓成「前情提要」,
    //    清三人 session(各自的 CLI session 也 reset → 從零開始 stateful 對話),
    //    把摘要塞回 transcript 第 0 條,下次 Rae 一發訊息就會把摘要當前情送給三人。
    //    走 Claude Sonnet:Rae 的 Max 訂閱配額用不完,後台雜活 0 元最划算。
    ChatGroup.compact = async function () {
        if (_busy) return { ok: false, reason: 'busy' };
        if (_game)  return { ok: false, reason: 'in_game' };
        // 整段對話太短就沒必要(避免誤觸):至少 6 則訊息才做
        const compactable = _transcript.filter(m => m.speaker !== 'recap' || m.content);
        if (compactable.length < 6) return { ok: false, reason: 'too_short' };

        _busy = true;
        const restore = () => { _busy = false; };
        try {
            // 把所有舊訊息(含舊 recap)組成可讀的對話腳本給 Sonnet
            const scriptLines = compactable.map(m => {
                const tag = _labelOf(m.speaker);
                const body = (m.content || '').replace(/\s+$/g, '');
                return `[${tag}]\n${body}`;
            }).join('\n\n');

            const _who = _seats().map(x => x.name).join('、') || '幾個 AI';
            const sysPrompt =
                '你是個對話摘要助手。下方是 Rae 跟 ' + _who + ' 的群聊紀錄,' +
                '幫我壓縮成一頁「前情提要」,供他們之後接續聊天用。\n\n' +
                '規則:\n' +
                '1. 用第三人稱、自然中文敘述(像「Rae 跟大家聊到 X,某某說 Y,某某吐槽 Z」)\n' +
                '2. 保留:主題、結論、未完的事、人物之間的梗或語感\n' +
                '3. 跳過:重複的問候、寒暄、純表情、已解決的小問題\n' +
                '4. 控制在 300-600 字之間(對話越長可以越長,但別超過)\n' +
                '5. 直接輸出摘要本文,不要加標題、不要加「以下是摘要:」這種開場白';

            const r = await window.ClaudeTerminal.sendRaw({
                provider: 'claude',
                model: 'sonnet',  // 強制 Sonnet,不被使用者當前選的 opus 干擾
                messages: [
                    { role: 'system', content: sysPrompt },
                    { role: 'user',   content: scriptLines },
                ],
            });
            const recap = (r && r.reply || '').trim();
            if (!recap) {
                restore();
                return { ok: false, reason: 'empty_reply' };
            }

            // 清掉每個人的 session(各自 CLI session 重新 boot,從零累積 context)。
            // 連退席的內建三位也一起清 —— 不然他們回席時會帶著跟摘要打架的舊記憶。
            _clearAllSids();
            // transcript reset + 塞入摘要;_seen 清空(全部當 -1),下次 sendUserMessage 會把摘要 + 新訊息一起送
            _transcript = [{ speaker: 'recap', content: recap, ts: Date.now() }];
            _seen = {};
            _save();
            if (_streamEl) ChatGroup.hydrate(_streamEl);
            restore();
            return { ok: true, recap: recap };
        } catch (e) {
            restore();
            return { ok: false, reason: 'error', error: (e && e.message) || String(e) };
        }
    };

    // ── 清空群聊（transcript + 每個人的 session + 進行中的對局）──
    ChatGroup.clear = function () {
        if (_game) {
            // 中止進行中的對局：先解開可能卡住的 Rae await，再清狀態
            const g = _game;
            _game = null;
            if (typeof g.raeResolver === 'function') g.raeResolver(null);
        }
        _busy = false;
        _transcript = [];
        _seen = {};
        _clearAllSids();
        _save();
        if (_streamEl) ChatGroup.hydrate(_streamEl);
    };

    // 畫布(LP.submitMove)呼叫：把 Rae 的一手推進迴圈
    ChatGroup.submitPlayerMove = function (payload) {
        if (_game && typeof _game.raeResolver === 'function') {
            const r = _game.raeResolver;
            _game.raeResolver = null;
            r(String(payload == null ? '' : payload));
        }
    };

    // 畫布(LP.gameEnd / LP.close)呼叫：請求收場。設 endSignal，迴圈會自行收尾。
    ChatGroup.endGame = function (text) {
        if (!_game) return;
        _game.endSignal = { text: String(text == null ? '' : text) || '對局結束。' };
        // 若迴圈正等 Rae 落子 → 喚醒它，好讓它看到 endSignal 後退出
        if (typeof _game.raeResolver === 'function') {
            const r = _game.raeResolver;
            _game.raeResolver = null;
            r(null);
        }
    };

    // 選檔 → 上傳 cc-bridge + 圖檔做縮圖 → 進 _pendingAttachments
    ChatGroup.handleFilePick = async function (fileList) {
        if (!fileList || !fileList.length) return;
        if (!window.ClaudeTerminal || typeof window.ClaudeTerminal.uploadFiles !== 'function') {
            _renderSystemLine('⚠️ ClaudeTerminal 未載入，無法上傳。');
            return;
        }
        const baseIdx = _pendingAttachments.length;
        const files = Array.from(fileList);
        files.forEach(function (f) {
            _pendingAttachments.push({ _uploading: true, filename: f.name, mime: f.type || '', size: f.size });
        });
        _renderPendingAttachments();

        // 圖檔做縮圖（跟上傳並行）
        const thumbs = await Promise.all(files.map(function (f) {
            return (f.type && f.type.indexOf('image/') === 0) ? _makeThumb(f, 720) : Promise.resolve(null);
        }));

        try {
            const result = await window.ClaudeTerminal.uploadFiles(fileList);
            (result.files || []).forEach(function (meta, i) {
                _pendingAttachments[baseIdx + i] = {
                    path: meta.path, filename: meta.filename, mime: meta.mime, size: meta.size,
                    thumb: thumbs[i] || null,
                };
            });
        } catch (e) {
            _pendingAttachments.splice(baseIdx, files.length);
            _renderSystemLine('⚠️ 上傳失敗：' + ((e && e.message) || '未知錯誤'));
        }
        _renderPendingAttachments();
    };

    // 有沒有上傳完成、可送的附件（給 chat_window 的 submitInput 判斷純附件送出用）
    ChatGroup.hasPending = function () {
        return _pendingAttachments.some(function (a) { return a && a.path; });
    };

    ChatGroup.isBusy = function () { return _busy; };

    console.log('✅ ChatGroup（群聊區協調器）模組就緒');
})(window.ChatGroup = window.ChatGroup || {});
