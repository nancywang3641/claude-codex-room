/**
 * core/chat_window.js — Claude / Codex 獨立浮窗外殼
 * 職責：浮動框、標題列拖動、開關、子面板路由、啟動選單。
 * 純浮層 —— 浮在最上層，不隱藏 / 不影響奧瑞亞大廳。
 * 聊天室 UI 由 chat_room.js（window.VoidClaudeRoom）渲染進 #cw-body。
 */
(function (ChatWindow) {
    'use strict';

    const WIN_ID = 'aurelia-chat-window';

    let _winEl = null;
    let _provider = 'claude';        // 'claude' | 'codex'
    let _isOpen = false;
    let _subPanel = null;            // 當前開啟的子面板名（null = 沒開）
    let _subBack = null;             // 子面板裡又點開一層時，標題列「返回」改做這件事（setSubPanelHead 設）

    const IDENTITY_ICON = {
        claude: '🦀', codex: '🔷', deepseek: '🟢', group: '👥', xiaoji: '',
    };

    /** 標題列文字：進的是誰的房就寫誰的名字（住戶可以改名） */
    function _identityText(provider) {
        const icon = Object.prototype.hasOwnProperty.call(IDENTITY_ICON, provider) ? IDENTITY_ICON[provider] : IDENTITY_ICON.claude;
        const CT = window.ClaudeTerminal;
        let name = '';
        if (CT && typeof CT.getActiveResident === 'function') {
            const r = CT.getActiveResident(provider);
            if (r && r.name) name = r.name;
        }
        if (provider === 'group') return (icon ? icon + ' ' : '') + (name || '群聊區');
        return (icon ? icon + ' ' : '') + (name || 'Claude') + ' 的房間';
    }

    /** 住戶改了名字，房間開著就順手換掉標題 */
    ChatWindow.refreshIdentity = function () {
        if (!_winEl) return;
        const el = _winEl.querySelector('#cw-identity');
        if (el) el.textContent = _identityText(_provider);
        if (window.VoidClaudeRoom && typeof window.VoidClaudeRoom.updatePickerLabel === 'function') {
            window.VoidClaudeRoom.updatePickerLabel();
        }
    };

    function _sizeForViewport() {
        const mobile = window.matchMedia('(max-width: 560px)').matches;
        if (mobile) {
            return {
                w: Math.min(window.innerWidth - 20, 440),
                h: Math.min(window.innerHeight - 60, 660),
            };
        }
        return {
            w: 480,
            h: Math.min(700, window.innerHeight - 40),
        };
    }

    function _centerPos(size) {
        return {
            left: Math.max(8, (window.innerWidth  - size.w) / 2),
            top:  Math.max(8, (window.innerHeight - size.h) / 2),
        };
    }

    function _buildWindow() {
        const el = document.createElement('div');
        el.id = WIN_ID;
        el.className = 'cw-window';
        el.innerHTML = `
            <div class="cw-titlebar" id="cw-titlebar">
                <button class="cw-back" id="cw-back" type="button" title="回宿舍"><i class="fa-solid fa-chevron-left"></i></button>
                <span class="cw-identity" id="cw-identity">${_identityText('claude')}</span>
                <div class="cw-toolbar">
                    <button class="cw-tool-btn" data-panel="settings"  type="button" title="設置"><i class="fa-solid fa-gear"></i></button>
                    <button class="cw-tool-btn" data-panel="spend"     type="button" title="額度"><i class="fa-solid fa-coins"></i></button>
                    <button class="cw-tool-btn" data-panel="board"     type="button" title="留言板"><i class="fa-solid fa-note-sticky"></i></button>
                    <button class="cw-tool-btn" data-panel="notebook"  type="button" title="紀錄"><i class="fa-solid fa-book-bookmark"></i></button>
                    <button class="cw-tool-btn" data-panel="recents"   type="button" title="會話"><i class="fa-solid fa-clock-rotate-left"></i></button>
                    <button class="cw-tool-btn cw-tool-compact" data-action="compact" type="button" title="摘要 & 重啟群聊(壓縮上下文,清三人 session,留前情提要)" style="display:none;"><i class="fa-solid fa-broom"></i></button>
                </div>
                <button class="cw-close" id="cw-close" type="button" title="關閉">✕</button>
            </div>
            <div class="cw-dorm" id="cw-dorm"></div>
            <div class="cw-body" id="cw-body">
                <div class="cw-canvas" id="cw-canvas" style="display:none;">
                    <div class="cw-canvas-bar">
                        <span class="cw-canvas-title">🎮 畫布</span>
                        <button class="cw-canvas-collapse" type="button" title="收合">▲</button>
                        <button class="cw-canvas-close" type="button" title="關閉">✕</button>
                    </div>
                    <div class="cw-canvas-content"></div>
                </div>
                <div class="cw-canvas-tab" id="cw-canvas-tab" style="display:none;">▾ 展開畫布</div>
                <div class="claude-portrait-area">
                    <div class="cw-room-bar" id="cw-room-bar" title="展開房間"><i class="fa-solid fa-chevron-down"></i></div>
                    <img id="cw-decor-img" class="cw-decor-img" alt="">
                    <img id="claude-portrait-img" class="claude-portrait-img" alt="Clawd">
                    <div id="codex-portrait-sprite" class="codex-portrait-sprite"></div>
                    <button type="button" class="cw-room-closet" id="cw-room-closet" title="衣櫃" hidden><i class="fa-solid fa-shirt"></i></button>
                    <button type="button" class="cw-room-memo" id="cw-room-memo" title="它記得的事" hidden><i class="fa-solid fa-feather-pointed"></i></button>
                    <div class="claude-conv-chip" id="claude-conv-chip" title="點開 Recents 多會話列表">
                        <span class="ccc-tab" id="ccc-tab">☕</span>
                        <span class="ccc-title" id="ccc-title">—</span>
                        <span class="ccc-arrow">▾</span>
                    </div>
                </div>
                <div class="claude-chat-stream" id="claude-chat-stream"></div>
                <div class="claude-picker-bar" id="claude-picker-bar">
                    <button class="claude-picker-btn" id="claude-picker-btn" type="button">
                        <span id="claude-pick-model">Fable 5.1</span>
                        <span class="claude-pick-sep" id="claude-pick-sep1">·</span>
                        <span id="claude-pick-effort">🧠 medium</span>
                        <span class="claude-pick-sep" id="claude-pick-sep2">·</span>
                        <span id="claude-pick-endpoint">☁️ VPS</span>
                        <span class="claude-pick-arrow">▼</span>
                    </button>
                </div>
                <div class="claude-picker-popup" id="claude-picker-popup" style="display:none;"></div>
                <div class="claude-attach-chips" id="claude-attach-chips"></div>
                <div class="claude-stk-panel" id="claude-stk-panel" hidden></div>
                <div class="cw-hold-card" id="cw-hold-card" hidden>
                    <div class="cw-hold-top">
                        <span class="cw-hold-level" id="cw-hold-level"><i></i><i></i><i></i><i></i></span>
                        <span class="cw-hold-timer" id="cw-hold-timer">0:00</span>
                    </div>
                    <div class="cw-hold-text" id="cw-hold-text"></div>
                    <div class="cw-hold-hint" id="cw-hold-hint"></div>
                </div>
                <input type="file" id="claude-file-input" multiple style="display:none;"
                       accept="image/*,application/pdf,.txt,.md,.json,.csv,.js,.ts,.py,.html,.css,.yml,.yaml,.toml,.log">
                <div class="cw-input-row cw-empty">
                    <div class="cw-input-wrap">
                        <textarea id="cw-input" class="cw-input" placeholder="對 Claude 說點什麼..." rows="1" autocomplete="off"></textarea>
                        <button class="cw-mic-btn" id="cw-mic-btn" type="button" title="按住說話"><i class="fa-solid fa-microphone"></i></button>
                    </div>
                    <button class="cw-attach-btn claude-stk-btn" id="claude-stk-btn" type="button" title="表情包"><i class="fa-regular fa-face-smile"></i></button>
                    <button class="cw-attach-btn" id="claude-attach-btn" type="button" title="附加檔案"><i class="fa-solid fa-paperclip"></i></button>
                    <button class="cw-attach-btn cw-reply-btn" id="cw-reply-btn" type="button" title="讓他回"><i class="fa-solid fa-wand-magic-sparkles"></i><span class="cw-held-n" id="cw-held-n" hidden>0</span></button>
                    <button class="cw-send-btn" id="cw-send-btn" type="button"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            </div>
            <div class="cw-subpanel" id="cw-subpanel" style="display:none;">
                <div class="cw-subpanel-head">
                    <button class="cw-subpanel-close" id="cw-subpanel-close" type="button"><i class="fa-solid fa-chevron-left"></i> 返回</button>
                    <span class="cw-subpanel-title" id="cw-subpanel-title"></span>
                </div>
                <div class="cw-subpanel-body" id="cw-subpanel-body"></div>
            </div>`;
        document.body.appendChild(el);

        el.querySelector('#cw-close').addEventListener('click', () => ChatWindow.close());
        el.querySelector('#cw-back').addEventListener('click', () => ChatWindow.showDorm());
        el.querySelector('#cw-subpanel-close').addEventListener('click', () => {
            // 子面板自己開了一層（紀錄點開的單頁）：返回先退那一層，不整個關掉
            if (_subBack) { const f = _subBack; f(); return; }
            ChatWindow.closeSubPanel();
        });
        el.querySelectorAll('.cw-tool-btn').forEach(b => {
            b.addEventListener('click', () => {
                if (b.dataset.action === 'compact') {
                    ChatWindow.compactGroup(b);
                } else if (b.dataset.panel) {
                    ChatWindow.openSubPanel(b.dataset.panel);
                }
            });
        });
        _bindDrag(el.querySelector('#cw-titlebar'), el);
        _bindChatInput(el);
        _bindRoomFold(el);
        if (window.RoomNotebook && typeof window.RoomNotebook.bind === 'function') window.RoomNotebook.bind(el);   // 長按一則 → 收進記事本
        const closet = el.querySelector('#cw-room-closet');
        if (closet) closet.addEventListener('click', (e) => { e.stopPropagation(); ChatWindow.openSubPanel('wardrobe'); });
        const memo = el.querySelector('#cw-room-memo');
        if (memo) memo.addEventListener('click', (e) => { e.stopPropagation(); ChatWindow.openSubPanel('xiaoji_memory'); });

        const chip = el.querySelector('#claude-conv-chip');
        if (chip) chip.addEventListener('click', () => ChatWindow.openSubPanel('recents'));

        if (window.ChatCanvas && typeof window.ChatCanvas.mount === 'function') {
            window.ChatCanvas.mount(el.querySelector('#cw-canvas'), el.querySelector('#cw-canvas-tab'));
        }

        const size = _sizeForViewport();
        const pos = _centerPos(size);
        el.style.width  = size.w + 'px';
        el.style.height = size.h + 'px';
        el.style.left   = pos.left + 'px';
        el.style.top    = pos.top + 'px';
        return el;
    }

    function _bindDrag(handle, win) {
        let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
        handle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;  // 點按鈕不觸發拖動
            dragging = true;
            sx = e.clientX; sy = e.clientY;
            const r = win.getBoundingClientRect();
            ox = r.left; oy = r.top;
            handle.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        handle.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const w = win.offsetWidth, h = win.offsetHeight;
            let nx = ox + (e.clientX - sx);
            let ny = oy + (e.clientY - sy);
            nx = Math.max(0, Math.min(nx, window.innerWidth  - w));
            ny = Math.max(0, Math.min(ny, window.innerHeight - h));
            win.style.left = nx + 'px';
            win.style.top  = ny + 'px';
        });
        const end = (e) => {
            if (!dragging) return;
            dragging = false;
            try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    }

    // 輸入列最右邊那一格：框裡有字是送出（先放著），框空著換成魔杖（叫他回）；他在回的時候是停止
    //   （chat_room 的 _paintSendBtn 在列上掛 .cw-busy）。群聊也一樣先放著（10-03 起），只是沒有停止。切換全在 chat_window.css
    function _syncInputEmpty() {
        const input = _winEl && _winEl.querySelector('#cw-input');
        const row = _winEl && _winEl.querySelector('.cw-input-row');
        if (input && row) row.classList.toggle('cw-empty', !input.value.trim());
    }

    function _bindChatInput(el) {
        const input = el.querySelector('#cw-input');
        const sendBtn = el.querySelector('#cw-send-btn');
        const attachBtn = el.querySelector('#claude-attach-btn');
        const fileInput = el.querySelector('#claude-file-input');
        const pickerBtn = el.querySelector('#claude-picker-btn');

        if (sendBtn) sendBtn.onclick = ChatWindow.submitInput;
        // 🤚 魔杖：把放著的那幾條一起送、叫他回。🎙 麥克風：按住說話（放開放上去）
        const replyBtn = el.querySelector('#cw-reply-btn');
        if (replyBtn) replyBtn.onclick = () => {
            if (_provider === 'group') {
                if (window.ChatGroup && typeof window.ChatGroup.replyNow === 'function') window.ChatGroup.replyNow();
            } else if (window.VoidClaudeRoom && typeof window.VoidClaudeRoom.replyNow === 'function') window.VoidClaudeRoom.replyNow();
        };
        const micBtn = el.querySelector('#cw-mic-btn');
        if (micBtn) {
            micBtn.addEventListener('pointerdown', (e) => {
                if (window.VoidClaudeRoom && typeof window.VoidClaudeRoom.micStart === 'function') window.VoidClaudeRoom.micStart(e);
            });
            micBtn.addEventListener('contextmenu', (e) => e.preventDefault());   // 手機長按不要跳選單
        }
        if (input) {
            // ── @-mention 自動完成（只在群聊 provider 啟用）──
            // 每次都現讀入席名單：她可能剛在宿舍面板加了人 / 改了名字，這裡不能拿快照。
            const _MENTION_FACE = { claude: '🦀', codex: '🔷', deepseek: '🟢' };
            const _mentionList = () => {
                const CT = window.ClaudeTerminal;
                if (!CT || typeof CT.listGroupSeats !== 'function') return [];
                let seats = [];
                try { seats = CT.listGroupSeats() || []; } catch (_) { return []; }
                return seats.map((r) => ({
                    key: r.id,
                    label: r.name,
                    emoji: _MENTION_FACE[r.provider] || '🦀',
                    alias: [r.name, r.id, r.provider],
                }));
            };
            const inputRow = el.querySelector('.cw-input-row');
            let popup = el.querySelector('#cw-mention-popup');
            if (!popup) {
                popup = document.createElement('div');
                popup.id = 'cw-mention-popup';
                popup.className = 'cw-mention-popup cw-mention-popup-hidden';
                (inputRow || el).appendChild(popup);
            }
            const mState = { active: false, items: [], idx: 0, atPos: -1 };

            const _getMentionRange = () => {
                if (_provider !== 'group') return null;
                const text = input.value;
                const caret = input.selectionStart;
                for (let i = caret - 1; i >= 0; i--) {
                    const ch = text[i];
                    if (ch === '@') {
                        const query = text.slice(i + 1, caret);
                        if (/\s/.test(query)) return null;
                        return { atPos: i, query };
                    }
                    if (/\s/.test(ch)) return null;
                }
                return null;
            };

            const _renderMention = () => {
                if (!mState.active || !mState.items.length) {
                    popup.classList.add('cw-mention-popup-hidden');
                    return;
                }
                popup.innerHTML = mState.items.map((it, i) => `
                    <div class="cw-mention-item${i === mState.idx ? ' active' : ''}" data-key="${_esc(it.key)}">
                        <span class="cw-mention-emoji">${it.emoji}</span>
                        <span class="cw-mention-label">${_esc(it.label)}</span>
                    </div>
                `).join('');
                popup.classList.remove('cw-mention-popup-hidden');
                popup.querySelectorAll('.cw-mention-item').forEach((node) => {
                    node.addEventListener('mousedown', (ev) => {
                        ev.preventDefault(); // 別讓 input blur
                        _commitMention(node.dataset.key);
                    });
                });
            };

            const _commitMention = (key) => {
                const item = _mentionList().find((m) => m.key === key);
                if (!item || mState.atPos < 0) return;
                const text = input.value;
                const before = text.slice(0, mState.atPos);
                const afterCaret = text.slice(input.selectionStart);
                const insert = `@${item.label} `;
                input.value = before + insert + afterCaret;
                const newCaret = before.length + insert.length;
                input.setSelectionRange(newCaret, newCaret);
                mState.active = false;
                _renderMention();
                input.focus();
                input.dispatchEvent(new Event('input'));
            };

            const _refreshMention = () => {
                const range = _getMentionRange();
                if (!range) {
                    mState.active = false;
                    _renderMention();
                    return;
                }
                const q = range.query.toLowerCase();
                const items = _mentionList().filter((m) =>
                    m.alias.some((a) => String(a || '').toLowerCase().startsWith(q))
                );
                mState.active = true;
                mState.items = items;
                mState.idx = 0;
                mState.atPos = range.atPos;
                _renderMention();
            };

            input.onkeydown = (e) => {
                // @-mention popup 鍵盤導航(優先)
                if (mState.active && mState.items.length) {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        mState.idx = (mState.idx + 1) % mState.items.length;
                        _renderMention();
                        return;
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        mState.idx = (mState.idx - 1 + mState.items.length) % mState.items.length;
                        _renderMention();
                        return;
                    }
                    if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) {
                        e.preventDefault();
                        _commitMention(mState.items[mState.idx].key);
                        return;
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        mState.active = false;
                        _renderMention();
                        return;
                    }
                }
                // 一般送出：電腦 Enter 送出、Shift+Enter 換行。
                //   手機螢幕鍵盤那顆是「換行」，她在 iPhone 上按它是要換行，以前一按就送出去；手機上送出一律按送出鍵。
                const touchKb = (() => { try { return !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches); } catch (_) { return false; } })();
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !touchKb) {
                    e.preventDefault();
                    ChatWindow.submitInput();
                }
            };
            const autoGrow = () => {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 160) + 'px';
            };
            input.addEventListener('input', () => {
                autoGrow();
                _refreshMention();
                _syncInputEmpty();
            });
            input.addEventListener('blur', () => {
                // 延遲關，讓 mousedown 來得及 fire
                setTimeout(() => {
                    mState.active = false;
                    _renderMention();
                }, 150);
            });
            autoGrow();
        }
        // 附檔：選的跟 Ctrl+V 貼上的走同一條（群聊交給 ChatGroup，其他交給房間）
        const _pickFiles = async (files) => {
            if (!files || !files.length) return;
            if (_provider === 'group' && window.ChatGroup
                && typeof window.ChatGroup.handleFilePick === 'function') {
                await window.ChatGroup.handleFilePick(files);
            } else if (window.VoidClaudeRoom) {
                await window.VoidClaudeRoom.handleFilePick(files);
            }
        };
        if (attachBtn && fileInput) {
            attachBtn.onclick = () => fileInput.click();
            fileInput.onchange = async (e) => {
                await _pickFiles(e.target.files);
                fileInput.value = '';
            };
        }
        // 📋 截完圖直接在輸入框 Ctrl+V 就附進去（跟創作室同一招）：只有剪貼簿裡真的是圖才攔，貼文字照舊。
        //   截圖從剪貼簿來都叫 image.png，換成「截圖 月-日 時分秒.png」，不然好幾張都同一個名字
        if (input) {
            input.addEventListener('paste', (e) => {
                const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
                const files = items.filter(it => it.kind === 'file' && /^image\//.test(it.type)).map(it => it.getAsFile()).filter(Boolean);
                if (!files.length) return;
                e.preventDefault();
                const d = new Date(), p2 = n => String(n).padStart(2, '0');
                const stamp = p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
                const named = files.map((f, i) => {
                    if (f.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(f.name)) return f;
                    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
                    return new File([f], '截圖 ' + stamp + (files.length > 1 ? '-' + (i + 1) : '') + '.' + ext, { type: f.type });
                });
                _pickFiles(named);
            });
        }
        // 😺 表情包框：按一下開、再按一下收；按到框以外的地方也收（她：「點擊其他地方自動縮起」）
        const stkBtn = el.querySelector('#claude-stk-btn');
        const stkPanel = el.querySelector('#claude-stk-panel');
        if (stkBtn && stkPanel) {
            stkBtn.onclick = (e) => {
                e.stopPropagation();
                if (stkPanel.hidden) { _renderStickerPanel(el); stkPanel.hidden = false; }
                else stkPanel.hidden = true;
            };
            document.addEventListener('pointerdown', (e) => {
                if (stkPanel.hidden) return;
                if (stkPanel.contains(e.target) || stkBtn.contains(e.target)) return;
                stkPanel.hidden = true;
            }, true);
        }
        if (pickerBtn) {
            pickerBtn.onclick = (e) => {
                e.stopPropagation();
                const popup = el.querySelector('#claude-picker-popup');
                if (popup && popup.style.display !== 'none') {
                    if (window.VoidClaudeRoom) window.VoidClaudeRoom.closePicker();
                } else {
                    if (window.VoidClaudeRoom) window.VoidClaudeRoom.openPicker();
                }
            };
        }
    }

    // ── 😺 表情包框 ──
    // 直接讀奧瑞亞微信那份庫（os_sticker_libs：{id, name, baseUrl, stickers:[{name, file}]}）。
    // 一份就是一份：這裡不另存，匯入也交給微信那支 WX_STICKER.importFromFile，寫進同一份。
    // 點一張就送出 ![名字](網址)：小機看得到名字，房間把它畫成圖。
    const STK_RECENT_KEY = 'ccr_sticker_recent';
    const STK_RECENT_MAX = 16;
    let _stkTab = '';
    function _stkLibs() {
        try {
            const l = JSON.parse(localStorage.getItem('os_sticker_libs') || '[]');
            return Array.isArray(l) ? l.filter(x => x && Array.isArray(x.stickers) && x.stickers.length) : [];
        } catch (_) { return []; }
    }
    function _stkUrl(lib, file) {
        if (!file) return '';
        const u = /^https?:\/\//i.test(file) ? file : String(lib.baseUrl || '').replace(/\/?$/, '/') + file;
        return u.replace(/[^\x00-\x7F]/g, c => encodeURIComponent(c)).replace(/ /g, '%20');
    }
    function _stkRecent() {
        try {
            const r = JSON.parse(localStorage.getItem(STK_RECENT_KEY) || '[]');
            return Array.isArray(r) ? r.filter(x => x && x.url) : [];
        } catch (_) { return []; }
    }
    function _stkRemember(item) {
        try {
            const r = _stkRecent().filter(x => x.url !== item.url);
            r.unshift({ name: item.name, url: item.url });
            localStorage.setItem(STK_RECENT_KEY, JSON.stringify(r.slice(0, STK_RECENT_MAX)));
        } catch (_) {}
    }
    function _sendSticker(el, item) {
        const name = String(item.name || '').replace(/[\[\]()\n]/g, ' ').trim();
        const md = '![' + name + '](' + item.url + ')';
        _stkRemember(item);
        const panel = el.querySelector('#claude-stk-panel');
        if (panel) panel.hidden = true;
        if (_provider === 'group') {
            if (window.ChatGroup && typeof window.ChatGroup.holdMessage === 'function') window.ChatGroup.holdMessage(md);   // 🤚 群聊也只放上桌
        } else if (window.VoidClaudeRoom && typeof window.VoidClaudeRoom.holdMessage === 'function') {
            window.VoidClaudeRoom.holdMessage(md);      // 🤚 私聊只放上去，按魔杖才回
        }
    }
    function _renderStickerPanel(el) {
        const panel = el.querySelector('#claude-stk-panel');
        if (!panel) return;
        const libs = _stkLibs();
        const recent = _stkRecent();
        const tabDefs = [];
        if (recent.length) tabDefs.push({ id: '__recent', name: '最近' });
        libs.forEach(l => tabDefs.push({ id: l.id, name: l.name || '表情包' }));
        if (!tabDefs.some(t => t.id === _stkTab)) _stkTab = tabDefs.length ? tabDefs[0].id : '';

        panel.innerHTML = '';
        const tabs = document.createElement('div');
        tabs.className = 'claude-stk-tabs';
        tabDefs.forEach(t => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'claude-stk-tab' + (t.id === _stkTab ? ' is-on' : '');
            b.textContent = t.name;
            b.onclick = (e) => { e.stopPropagation(); _stkTab = t.id; _renderStickerPanel(el); };
            tabs.appendChild(b);
        });
        // 匯入：交給奧瑞亞微信那支，寫進同一份庫；房間單獨裝、沒有奧瑞亞時不顯示
        const W = window.WX_STICKER;
        const canImport = !!(W && typeof W.importFromFile === 'function');
        if (canImport) {
            const file = document.createElement('input');
            file.type = 'file';
            file.accept = '.txt,text/plain';
            file.hidden = true;
            file.onchange = () => {
                if (!file.files || !file.files.length) return;
                W.importFromFile(file);
                setTimeout(() => { _stkTab = ''; _renderStickerPanel(el); }, 400);
            };
            const imp = document.createElement('button');
            imp.type = 'button';
            imp.className = 'claude-stk-import';
            imp.innerHTML = '<i class="fa-solid fa-file-import"></i><span>匯入</span>';
            imp.onclick = (e) => { e.stopPropagation(); file.click(); };
            tabs.appendChild(imp);
            tabs.appendChild(file);
        }
        panel.appendChild(tabs);

        const grid = document.createElement('div');
        grid.className = 'claude-stk-grid';
        let items = [];
        if (_stkTab === '__recent') {
            items = recent;
        } else {
            const lib = libs.find(l => l.id === _stkTab);
            if (lib) items = lib.stickers.map(s => ({ name: s.name, url: _stkUrl(lib, s.file) })).filter(x => x.url);
        }
        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'claude-stk-empty';
            empty.textContent = canImport ? '還沒有表情包，按「匯入」選一份表情包清單' : '還沒有表情包，到奧瑞亞微信的表情包設定匯入';
            grid.appendChild(empty);
        }
        items.forEach(it => {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'claude-stk-item';
            cell.title = it.name || '';
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.alt = it.name || '';
            img.src = it.url;
            img.onerror = () => {
                const fb = document.createElement('span');
                fb.className = 'claude-stk-fallback';
                fb.textContent = it.name || '';
                img.replaceWith(fb);
            };
            cell.appendChild(img);
            cell.onclick = (e) => { e.stopPropagation(); _sendSticker(el, it); };
            grid.appendChild(cell);
        });
        panel.appendChild(grid);
    }

    // 載入當前 provider 的 conv 歷史並渲染進浮窗
    // ── 住戶自己布置的房間（橋的 /v1/decor，住戶醒來時寫標籤動手）──
    // 還沒布置過的照舊顯示原本那張圖；刷過牆或放過東西，立繪區底下就鋪一張他自己的房間。
    // 整間組成一張 svg、用 <img> 顯示：家具是小機寫的 svg，當圖片看不會跑任何程式、也連不到外面。
    // 組圖在 room_scene.js（鏡子也用同一支，兩邊畫出來要一模一樣）。
    let _decorSeq = 0;

    function _decorBridge() {
        const OS = window.OS_SETTINGS;
        const p = (OS && typeof OS.getActiveClaudePreset === 'function') ? OS.getActiveClaudePreset() : null;
        if (!p || !p.url || !p.key) return null;
        return { base: String(p.url).replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, ''), key: p.key };
    }
    async function _renderDecor(provider) {
        const area = _winEl && _winEl.querySelector('.claude-portrait-area');
        const img = _winEl && _winEl.querySelector('#cw-decor-img');
        if (!area || !img) return;
        const seq = ++_decorSeq;
        // 先收起來：從布置過（打扮過）的房間切到沒有的，不能留著上一位的房間跟樣子
        area.classList.remove('cw-own-room');
        const CP = window.ClawdPortrait;
        if (CP) CP.hide(area);
        // 小機：樣子是領養時挑的那隻，房間布置與打扮都在它自己的存檔（rec.room、rec.wear，wear_local.js 管，不經橋）
        if (provider === 'xiaoji') {
            const X = window.OS_XIAOJI, CT = window.ClaudeTerminal, RW = window.RoomWear;
            const r = (CT && typeof CT.getActiveResident === 'function') ? CT.getActiveResident('xiaoji') : null;
            if (!X || !r || !r.id) return;
            try {
                const rec = await X.get(r.id);
                if (seq !== _decorSeq) return;
                // 它自己打扮過的照著畫
                const wear = (RW && rec && rec.wear) ? RW.client(rec.wear) : null;
                if (CP) CP.show(area, wear, X.bodyOf(rec));
                // 它布置過的房間（同住戶那張，RoomScene 組圖）；沒布置過照舊顯示原本那張
                const st = (RW && typeof RW.room === 'function') ? RW.room(rec) : null;
                if (st && st.own && window.RoomScene) {
                    img.src = window.RoomScene.dataUrl(st);
                    area.classList.add('cw-own-room');
                }
            } catch (_) {}
            return;
        }
        // 阿洛的預設樣子是洛德（他自己的幽靈管家），沒有現成動圖——先畫出來，免得閃一下 Codex 機器人
        if (CP && provider === 'codex') CP.show(area, null, 'lorde');
        const CT = window.ClaudeTerminal;
        const r = (CT && typeof CT.getActiveResident === 'function') ? CT.getActiveResident(provider) : null;
        const b = _decorBridge();
        if (!r || !r.id || !b) return;
        try {
            const res = await fetch(b.base + '/v1/decor?rid=' + encodeURIComponent(r.id),
                { headers: { 'Authorization': 'Bearer ' + b.key } });
            if (!res.ok) return;          // 舊版橋沒有這條 → 照舊顯示原本那張圖
            const st = await res.json();
            if (seq !== _decorSeq || !st) return;
            // 打扮給 Claude 那幾位（預設小螃蟹，打扮過才接手立繪）跟阿洛（預設洛德）
            if (CP && provider === 'claude' && st.wear && st.wear.own) CP.show(area, st.wear, 'crab');
            if (CP && provider === 'codex') CP.show(area, st.wear, 'lorde');
            if (!st.own) return;
            if (!window.RoomScene) return;
            img.src = window.RoomScene.dataUrl(st);
            area.classList.add('cw-own-room');
        } catch (_) { /* 連不到橋：房間聊天本來就會自己報，這裡不多話 */ }
    }

    /** 他在聊天裡動了房間：重畫目前開著的那間（群聊沒有上半部那塊，不畫） */
    ChatWindow.refreshDecor = function () {
        // 他換了打扮：門卡、留言板、群成員格的頭像也重拿
        if (window.DormPanel && typeof window.DormPanel.forgetLooks === 'function') { try { window.DormPanel.forgetLooks(); } catch (_) {} }
        if (_winEl && _isOpen && _view === 'room' && _provider !== 'group') _renderDecor(_provider);
    };

    // ── 📱 手機上房間收成小橫幅（三小樣裡她挑的 A 捲簾，tmp/collapse_samples.html）──
    //   點輸入框、往上翻舊對話 → 收；點橫幅 → 展開；每次進房先展開。只在手機寬有作用（樣式在 chat_window.css 的 @media）。
    //   房間是蓋在聊天上面的一層：收放只動房間的裁切、立繪與小卡的位移縮放；聊天區只在切換那一下換上方留白（排一次版），
    //   捲動位置補同樣的距離，畫面上的字不跳。逐格改聊天區高度＝每格重排整串，在酒館會卡。
    const _FOLD_MQ = window.matchMedia ? window.matchMedia('(max-width: 600px)') : null;

    function _foldable() {
        return !!(_winEl && _view === 'room' && _provider !== 'group' && _FOLD_MQ && _FOLD_MQ.matches);
    }

    function _barH(body) {
        return parseFloat(getComputedStyle(body).getPropertyValue('--cw-bar-h')) || 56;
    }

    /** 立繪縮進橫幅左邊要挪多少、縮多少：量現在看得到的那一個（動圖／打扮過與洛德的畫布／Codex 角色表） */
    function _measureMini(area, barH) {
        const el = ['.cw-clawd-canvas', '.codex-portrait-sprite', '.claude-portrait-img']
            .map(s => area.querySelector(s)).find(n => n && n.offsetWidth > 0);
        if (!el) return;
        // 動圖那組（assets/claude/*.svg）四周空白多、螃蟹畫在框中心往下 30% 的地方：框放大一點、往上補回來。
        // 程式畫的（打扮過的螃蟹、洛德、小機的身體）人站在畫布偏下一點
        const isImg = el.tagName === 'IMG';
        const box = isImg ? 84 : 64;
        const h = el.offsetHeight || box;
        const s = Math.min(1, box / h);
        const dy = (isImg ? 0.30 : 0.13) * h * s;
        // 例外：JS 量出來的位移只能經 CSS 變數傳（永不 inline style 那條允許的那種）
        area.style.setProperty('--cw-mini-x', (34 - (el.offsetLeft + el.offsetWidth / 2)) + 'px');
        area.style.setProperty('--cw-mini-y', (barH / 2 + 2 - dy - (el.offsetTop + h / 2)) + 'px');
        area.style.setProperty('--cw-mini-s', String(s));
    }

    function _setRoomCollapsed(on) {
        const body = _winEl && _winEl.querySelector('#cw-body');
        if (!body) return;
        on = !!on;
        if (body.classList.contains('cw-room-collapsed') === on) return;
        if (on && !_foldable()) return;
        if (!_foldable()) { body.classList.remove('cw-room-collapsed'); return; }   // 視窗拉寬了：沒有留白可補
        const area = body.querySelector('.claude-portrait-area');
        const stream = body.querySelector('#claude-chat-stream');
        const barH = _barH(body);
        const shift = area ? area.offsetHeight - barH : 0;   // 聊天區上方留白差這麼多
        const st = stream ? stream.scrollTop : 0;
        if (on && area) _measureMini(area, barH);
        body.classList.toggle('cw-room-collapsed', on);
        if (stream) stream.scrollTop = on ? Math.max(0, st - shift) : st + shift;
    }
    ChatWindow.setRoomCollapsed = _setRoomCollapsed;

    function _bindRoomFold(el) {
        const body = el.querySelector('#cw-body');
        const area = el.querySelector('.claude-portrait-area');
        const stream = el.querySelector('#claude-chat-stream');
        const input = el.querySelector('#cw-input');
        if (input) {
            input.addEventListener('focus', () => _setRoomCollapsed(true));
            input.addEventListener('pointerdown', () => _setRoomCollapsed(true));   // 焦點本來就在框裡時，再點不會有 focus
        }
        if (area) area.addEventListener('click', (e) => {
            if (!body || !body.classList.contains('cw-room-collapsed')) return;
            if (e.target.closest('.claude-conv-chip')) return;   // 小卡照舊開會話清單
            _setRoomCollapsed(false);
        });
        if (!stream) return;
        // 只認她自己的手勢（滾輪往上、手指往下拖＝看舊的）；程式捲到底、重畫歷史那種不算
        let wheelUp = 0, touchY = null;
        stream.addEventListener('wheel', (e) => {
            if (e.deltaY >= 0) { wheelUp = 0; return; }
            wheelUp -= e.deltaY;
            if (wheelUp > 60) { wheelUp = 0; _setRoomCollapsed(true); }
        }, { passive: true });
        stream.addEventListener('touchstart', (e) => {
            touchY = (e.touches && e.touches[0]) ? e.touches[0].clientY : null;
        }, { passive: true });
        stream.addEventListener('touchmove', (e) => {
            if (touchY == null || !e.touches || !e.touches[0]) return;
            if (e.touches[0].clientY - touchY > 40 && stream.scrollTop > 0) { touchY = null; _setRoomCollapsed(true); }
        }, { passive: true });
    }

    async function _loadRoom(provider) {
        const cwBody = _winEl && _winEl.querySelector('#cw-body');
        if (cwBody) cwBody.classList.remove('cw-room-collapsed');   // 進房一律先展開
        _syncInputEmpty();
        // 衣櫃鈕：只有會打扮的住戶（Claude 住戶、阿洛）
        const closet = _winEl && _winEl.querySelector('#cw-room-closet');
        if (closet) closet.hidden = !(window.RoomWardrobe && window.RoomWardrobe.canDress(provider));
        // 它記得的事：只有小機（會員住戶的記憶在他們自己的資料夾）
        const memo = _winEl && _winEl.querySelector('#cw-room-memo');
        if (memo) memo.hidden = !(window.XiaojiMemory && window.XiaojiMemory.can(provider));
        // 紀錄那顆：這位有沒看過的「想跟妳說的」就點一顆（群聊沒有）
        if (window.RoomNotebook && typeof window.RoomNotebook.peekRoom === 'function') window.RoomNotebook.peekRoom();
        // 🧹 摘要按鈕只在群聊房顯示
        const compactBtn = _winEl && _winEl.querySelector('.cw-tool-compact');
        if (compactBtn) compactBtn.style.display = (provider === 'group') ? '' : 'none';
        // 🫧 房間的泡泡（room_bubbles.js）：一間一套；群聊不換
        const RB = window.RoomBubbles;
        if (RB && typeof RB.apply === 'function') {
            const CT0 = window.ClaudeTerminal;
            try { RB.apply(provider === 'group' ? null : ((CT0 && CT0.getActiveResidentId) ? CT0.getActiveResidentId(provider) : null)); } catch (e) { console.warn('[ChatWindow] 房間泡泡沒套上', e); }
        }
        // 群聊區：交給 ChatGroup，跳過單房間流程
        if (provider === 'group') {
            if (cwBody) cwBody.classList.add('cw-body-group');
            // 群聊區不走單房間那條路，placeholder 得自己設 ——
            // 不設的話會留著上一個房間的名字（從阿洛房切進來就寫「對 Codex 說點什麼」）
            const inEl = _winEl && _winEl.querySelector('#cw-input');
            if (inEl) inEl.placeholder = '對大家說點什麼...';
            const stream = _winEl && _winEl.querySelector('#claude-chat-stream');
            if (window.ChatGroup) {
                await window.ChatGroup.load();
                if (stream) window.ChatGroup.hydrate(stream);
            }
            return;
        }
        if (cwBody) cwBody.classList.remove('cw-body-group');
        // 離開群聊 → 收掉畫布，不殘留到單人房間
        if (window.ChatCanvas && typeof window.ChatCanvas.close === 'function') {
            window.ChatCanvas.close();
        }
        if (window.ClaudeTerminal && typeof window.ClaudeTerminal.setProvider === 'function') {
            window.ClaudeTerminal.setProvider(provider);
        }
        _renderDecor(provider);
        // 每次開房間都重新跟橋要一次最新狀態。拉取本身在 loadHistory 裡，但它有個
        // 「這組 provider|住戶|tab 拉過就不再拉」的旗標 —— 不在這裡清掉的話，關掉房間
        // 再打開會直接用記憶體裡的舊資料，得整頁重新整理才看得到另一台剛講的話。
        //
        // 🚨 只在開房間清，不要改成「每次 loadHistory 都拉」：loadHistory 在每次送出前
        // 也會被呼叫，而拉取會連 active 是哪一串一起覆蓋掉 —— 那會讓她在電腦打到一半的
        // 訊息，被手機那邊最後開著的會話搶走。
        if (window.ClaudeTerminal && typeof window.ClaudeTerminal._invalidateSync === 'function') {
            window.ClaudeTerminal._invalidateSync();
        }
        let hist = [];
        if (window.ClaudeTerminal && typeof window.ClaudeTerminal.loadHistory === 'function') {
            try { hist = await window.ClaudeTerminal.loadHistory(); } catch (_) { hist = []; }
        }
        const room = window.VoidClaudeRoom;
        if (!room) return;
        if (typeof room.setHistory === 'function') room.setHistory(hist || []);
        if (typeof room.applyRoomUi === 'function') room.applyRoomUi();
        if (typeof room.hydrateStream === 'function') room.hydrateStream();
        if ((!hist || !hist.length) && typeof room.renderBubble === 'function') {
            room.renderBubble('assistant', provider === 'codex'
                ? '這裡是 Codex 的房間，跟外面是分開的線。說吧。'
                : provider === 'xiaoji'
                ? '要做什麼直接說。還沒學會的事，它會說要去找誰上課。'
                : '在這裡，我跟妳的對話跟外面是兩條線。妳說什麼吧。');
        }
        _updateChip();
    }

    // 更新左上角會話小卡（tab emoji + 當前 conv 標題）
    function _updateChip() {
        if (!_winEl || !window.ClaudeTerminal) return;
        const CT = window.ClaudeTerminal;
        const tab = CT.getActiveTab ? CT.getActiveTab() : 'max';
        const convId = CT.getActiveConvId ? CT.getActiveConvId(tab) : null;
        const tabEl = _winEl.querySelector('#ccc-tab');
        const titleEl = _winEl.querySelector('#ccc-title');
        if (tabEl) tabEl.textContent = tab === 'codex' ? '🔷' : tab === 'api' ? '🌐' : '☕';
        if (titleEl) {
            let title = '新會話';
            if (convId && CT.findConv) {
                const f = CT.findConv(convId);
                if (f && f.meta && f.meta.title) title = f.meta.title;
            }
            titleEl.textContent = title;
        }
    }
    window._VoidClaudeUpdateChip = _updateChip;

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ⚙️ 設置子面板 —— Claude 連線預設管理 + 預設值（讀寫 os_claude_room_config）
    function _renderSettingsPanel(body) {
        let OS = window.OS_SETTINGS;
        // 被別人整份蓋掉的話這裡先補回來，不必重載酒館
        if (!OS || typeof OS.getClaudeRoomConfig !== 'function') {
            try {
                if (typeof window.__CCR_ENSURE_SETTINGS__ === 'function') window.__CCR_ENSURE_SETTINGS__();
            } catch (_) {}
            OS = window.OS_SETTINGS;
        }
        if (!OS || typeof OS.getClaudeRoomConfig !== 'function') {
            // 補不回來就把現場記下來（她的殼沒有 console，這筆之後直接從她電腦上讀）
            try {
                let framed = 'unknown';
                try { framed = String(window.top !== window.self); } catch (_) { framed = 'cross'; }
                localStorage.setItem('ccr_settings_diag', JSON.stringify({
                    t: new Date().toISOString(),
                    keys: window.OS_SETTINGS ? Object.keys(window.OS_SETTINGS).slice(0, 30) : null,
                    hasEnsure: typeof window.__CCR_ENSURE_SETTINGS__,
                    loaded: !!window.__CCR_LOADED__,
                    base: String(window.__CCR_BASE__ || '').slice(0, 120),
                    booted: String(window.__CCR_BOOTSTRAPPED__ || '').slice(0, 120),
                    framed: framed,
                    here: String(location.href).slice(0, 120),
                }));
            } catch (_) {}
            body.innerHTML = '<div class="cw-sub-missing">設定模組未載入</div>';
            return;
        }
        const cfg = OS.getClaudeRoomConfig();
        const save = () => {
            try { OS.saveClaudeRoomConfig(cfg); } catch (_) {}
            if (window.VoidClaudeRoom && typeof window.VoidClaudeRoom.updatePickerLabel === 'function') {
                window.VoidClaudeRoom.updatePickerLabel();
            }
        };

        body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'cw-set';

        const presetSec = document.createElement('div');
        presetSec.className = 'cw-set-sec';
        presetSec.innerHTML = '<div class="cw-set-h">連線預設（填 URL + 密鑰即可用）</div>';
        const listEl = document.createElement('div');
        presetSec.appendChild(listEl);
        const addBtn = document.createElement('button');
        addBtn.className = 'cw-set-add';
        addBtn.type = 'button';
        addBtn.textContent = '➕ 新增預設';
        presetSec.appendChild(addBtn);
        wrap.appendChild(presetSec);

        function renderPresets() {
            listEl.innerHTML = '';
            (cfg.presets || []).forEach((p, idx) => {
                const card = document.createElement('div');
                card.className = 'cw-set-preset';
                card.innerHTML =
                    '<div class="cw-set-prow">' +
                    '<input type="radio" name="cw-active-preset" ' + (p.id === cfg.activePresetId ? 'checked' : '') + '>' +
                    '<input type="text" class="cw-set-in cw-set-name" placeholder="名稱" value="' + _esc(p.name) + '">' +
                    '<button class="cw-set-del" type="button" title="刪除">✕</button>' +
                    '</div>' +
                    '<input type="text" class="cw-set-in cw-set-url" placeholder="URL" value="' + _esc(p.url) + '">' +
                    '<input type="password" class="cw-set-in cw-set-key" placeholder="密鑰 / Bearer token" value="' + _esc(p.key) + '">';
                card.querySelector('input[type=radio]').addEventListener('change', () => { cfg.activePresetId = p.id; save(); });
                card.querySelector('.cw-set-name').addEventListener('input', e => { p.name = e.target.value; save(); });
                card.querySelector('.cw-set-url').addEventListener('input', e => { p.url = e.target.value; save(); });
                card.querySelector('.cw-set-key').addEventListener('input', e => { p.key = e.target.value; save(); });
                card.querySelector('.cw-set-del').addEventListener('click', () => {
                    cfg.presets.splice(idx, 1);
                    if (cfg.activePresetId === p.id) cfg.activePresetId = (cfg.presets[0] && cfg.presets[0].id) || '';
                    save(); renderPresets();
                });
                listEl.appendChild(card);
            });
        }
        addBtn.addEventListener('click', () => {
            cfg.presets = cfg.presets || [];
            const id = 'p_' + Date.now().toString(36);
            cfg.presets.push({ id, name: '新預設', url: '', key: '' });
            if (!cfg.activePresetId) cfg.activePresetId = id;
            save(); renderPresets();
        });
        renderPresets();

        // 模型取名:幫每個 Claude 模型取自己的名字(存 cfg.modelNames,picker 清單跟底部欄都會顯示)
        const nameSec = document.createElement('div');
        nameSec.className = 'cw-set-sec';
        nameSec.innerHTML = '<div class="cw-set-h">模型取名（留空就用原名）</div>';
        const modelList = (window.VoidClaudeRoom && window.VoidClaudeRoom.claudeModels) || [];
        modelList.forEach(m => {
            const row = document.createElement('label');
            row.className = 'cw-set-field';
            const span = document.createElement('span');
            span.textContent = m.label;
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'cw-set-in cw-set-nick';
            inp.placeholder = '取個名字…';
            inp.value = (cfg.modelNames && cfg.modelNames[m.id]) || '';
            inp.addEventListener('input', () => {
                cfg.modelNames = cfg.modelNames || {};
                const v = inp.value.trim();
                if (v) cfg.modelNames[m.id] = v;
                else delete cfg.modelNames[m.id];
                save();
            });
            row.appendChild(span);
            row.appendChild(inp);
            nameSec.appendChild(row);
        });
        wrap.appendChild(nameSec);

        const defSec = document.createElement('div');
        defSec.className = 'cw-set-sec';
        defSec.innerHTML =
            '<div class="cw-set-h">預設值</div>' +
            '<label class="cw-set-field"><span>Max Tokens</span>' +
            '<input type="number" class="cw-set-in" id="cw-set-maxtok" min="100" max="200000" step="100" value="' + (cfg.maxTokens || 4096) + '"></label>' +
            '<label class="cw-set-field"><span>Temperature</span>' +
            '<input type="number" class="cw-set-in" id="cw-set-temp" min="0" max="2" step="0.05" value="' + (cfg.temperature != null ? cfg.temperature : 1) + '"></label>' +
            '<label class="cw-set-field"><span>Top P</span>' +
            '<input type="number" class="cw-set-in" id="cw-set-topp" min="0" max="1" step="0.01" value="' + (cfg.top_p != null ? cfg.top_p : 1) + '"></label>';
        wrap.appendChild(defSec);
        defSec.querySelector('#cw-set-maxtok').addEventListener('input', e => { cfg.maxTokens = parseInt(e.target.value, 10) || 4096; save(); });
        defSec.querySelector('#cw-set-temp').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { cfg.temperature = v; save(); } });
        defSec.querySelector('#cw-set-topp').addEventListener('input', e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { cfg.top_p = v; save(); } });

        body.appendChild(wrap);
    }

    // 🕘 Recents 子面板 —— 多會話列表
    function _renderRecentsPanel(body) {
        const CT = window.ClaudeTerminal;
        if (!CT || typeof CT.listConversations !== 'function') {
            body.innerHTML = '<div class="cw-sub-missing">會話模組未載入</div>';
            return;
        }
        body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'cw-rec';

        const isCodex = _provider === 'codex';
        const curTab = CT.getActiveTab ? CT.getActiveTab() : (isCodex ? 'codex' : 'max');

        if (!isCodex && _provider !== 'xiaoji') {
            const tabBar = document.createElement('div');
            tabBar.className = 'cw-rec-tabs';
            [['max', '<i class="fa-solid fa-house"></i> 訂閱 Max'], ['api', '<i class="fa-solid fa-globe"></i> API']].forEach(pair => {
                const tb = document.createElement('button');
                tb.type = 'button';
                tb.className = 'cw-rec-tab' + (pair[0] === curTab ? ' active' : '');
                tb.innerHTML = pair[1];
                tb.addEventListener('click', () => {
                    if (CT.setActiveTab) CT.setActiveTab(pair[0]);
                    _renderRecentsPanel(body);
                });
                tabBar.appendChild(tb);
            });
            wrap.appendChild(tabBar);
        }

        const newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.className = 'cw-rec-new';
        newBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 新會話';
        newBtn.addEventListener('click', async () => {
            if (CT.startNewConversation) CT.startNewConversation(curTab);
            await _loadRoom(_provider);
            ChatWindow.closeSubPanel();
        });
        wrap.appendChild(newBtn);

        const listEl = document.createElement('div');
        listEl.className = 'cw-rec-list';
        const convs = CT.listConversations(curTab) || [];
        const activeId = CT.getActiveConvId ? CT.getActiveConvId(curTab) : null;
        if (!convs.length) {
            listEl.innerHTML = '<div class="cw-rec-empty">還沒有會話。發個訊息就會開始第一個。</div>';
        } else {
            convs.forEach(c => {
                const row = document.createElement('div');
                row.className = 'cw-rec-row' + (c.id === activeId ? ' active' : '');

                // 一般狀態：標題 + ✏️ + 🗑️
                function renderNormal() {
                    row.innerHTML = '';
                    row.classList.remove('confirming');
                    const info = document.createElement('div');
                    info.className = 'cw-rec-info';
                    const t = document.createElement('div');
                    t.className = 'cw-rec-title';
                    t.textContent = c.title || '新會話';
                    const m = document.createElement('div');
                    m.className = 'cw-rec-meta';
                    m.textContent = (c.msgCount || 0) + ' 則';
                    info.appendChild(t);
                    info.appendChild(m);
                    info.addEventListener('click', async () => {
                        if (CT.switchConversation) await CT.switchConversation(c.id);
                        await _loadRoom(_provider);
                        ChatWindow.closeSubPanel();
                    });
                    const ren = document.createElement('button');
                    ren.type = 'button'; ren.className = 'cw-rec-act'; ren.innerHTML = '<i class="fa-solid fa-pen"></i>'; ren.title = '改名';
                    ren.addEventListener('click', renderRename);
                    const del = document.createElement('button');
                    del.type = 'button'; del.className = 'cw-rec-act'; del.innerHTML = '<i class="fa-solid fa-trash-can"></i>'; del.title = '刪除';
                    del.addEventListener('click', renderConfirm);
                    row.appendChild(info);
                    row.appendChild(ren);
                    row.appendChild(del);
                }

                // 刪除確認：窗內自訂 UI（不用原生 confirm —— 會被瀏覽器「禁止對話框」擋掉）
                function renderConfirm() {
                    row.innerHTML = '';
                    row.classList.add('confirming');
                    const msg = document.createElement('div');
                    msg.className = 'cw-rec-info cw-rec-cmsg';
                    msg.textContent = '刪除這個會話？';
                    const yes = document.createElement('button');
                    yes.type = 'button'; yes.className = 'cw-rec-act cw-rec-yes'; yes.textContent = '刪除';
                    yes.addEventListener('click', async () => {
                        if (CT.deleteConversation) await CT.deleteConversation(c.id);
                        _renderRecentsPanel(body);
                    });
                    const no = document.createElement('button');
                    no.type = 'button'; no.className = 'cw-rec-act cw-rec-no'; no.textContent = '取消';
                    no.addEventListener('click', renderNormal);
                    row.appendChild(msg);
                    row.appendChild(yes);
                    row.appendChild(no);
                }

                // 改名：窗內 inline input（不用原生 prompt）
                function renderRename() {
                    row.innerHTML = '';
                    const inp = document.createElement('input');
                    inp.type = 'text';
                    inp.className = 'cw-rec-rename-in';
                    inp.value = c.title || '';
                    let done = false;
                    const commit = () => {
                        if (done) return;
                        done = true;
                        const nt = inp.value.trim();
                        if (nt && CT.renameConversation) { CT.renameConversation(c.id, nt); c.title = nt; }
                        renderNormal();
                    };
                    inp.addEventListener('keydown', e => {
                        if (e.key === 'Enter') { e.preventDefault(); commit(); }
                        else if (e.key === 'Escape') { done = true; renderNormal(); }
                    });
                    inp.addEventListener('blur', commit);
                    row.appendChild(inp);
                    inp.focus();
                    inp.select();
                }

                renderNormal();
                listEl.appendChild(row);
            });
        }
        wrap.appendChild(listEl);

        // 清空全部（窗內確認，不用原生 confirm）
        if (convs.length) {
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'cw-rec-clear';
            clearBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 清空全部';
            clearBtn.addEventListener('click', () => {
                if (clearBtn.dataset.armed === '1') {
                    clearBtn.disabled = true;
                    clearBtn.textContent = '清空中…';
                    (async () => {
                        for (const c of convs) {
                            if (CT.deleteConversation) { try { await CT.deleteConversation(c.id); } catch (_) {} }
                        }
                        _renderRecentsPanel(body);
                    })();
                } else {
                    clearBtn.dataset.armed = '1';
                    clearBtn.classList.add('armed');
                    clearBtn.textContent = '確定清空全部 ' + convs.length + ' 個？再按一次';
                }
            });
            wrap.appendChild(clearBtn);
        }

        body.appendChild(wrap);
    }

    // 群聊區的 🕘 子面板 —— 群聊是單一條對話，沒有多會話，只提供「清空」
    /** 目前入席的住戶名字，接成一句；沒人入席回「大家」 */
    function _seatNames(sep) {
        const CT = window.ClaudeTerminal;
        if (!CT || typeof CT.listGroupSeats !== 'function') return '大家';
        try {
            const names = (CT.listGroupSeats() || []).map(r => r.name).filter(Boolean);
            return names.length ? names.join(sep || '、') : '大家';
        } catch (_) { return '大家'; }
    }

    /** 群成員那格的頭像。跟門卡同一套判斷，只是這裡不掛模型角標。 */
    function _memFaceHtml(r) {
        const CT = window.ClaudeTerminal;
        // 打扮過的（阿洛是他的洛德）：跟門卡、留言板同一張小圖（dorm.js 的 lookSrc，拿到了會把 [data-look] 換掉）
        const D = window.DormPanel;
        const look = (D && typeof D.lookSrc === 'function' && r.provider !== 'deepseek') ? D.lookSrc(r) : '';
        const dl = ' data-look="' + String(r.id || '').replace(/[^\w-]/g, '') + '"';
        if (look) return '<span class="cw-mem-face"' + dl + '><img class="ccr-look" src="' + look + '" alt=""></span>';
        if (r.provider === 'codex')    return '<span class="cw-mem-face cw-mem-face-codex"' + dl + '></span>';
        if (r.provider === 'deepseek') return '<span class="cw-mem-face cw-mem-icon"><i class="fa-solid fa-user-tie"></i></span>';
        const src = (CT && CT.ASSETS && (CT.ASSETS.idle || CT.ASSETS.mini)) || '';
        const onerr = (CT && CT.imgOnError) || '';
        return src
            ? '<span class="cw-mem-face"' + dl + '><img src="' + src + '" alt="" onerror="' + onerr + '"></span>'
            : '<span class="cw-mem-face cw-mem-icon"><i class="fa-solid fa-user"></i></span>';
    }

    /** 群成員網格：誰在這張桌子上，點一下加減。
     *  這是這個群自己的名單，不該跑去通訊錄（宿舍門卡）上管 —— 那等於把「這個群有誰」
     *  做進聯絡人清單，沒有一個 IM 是那樣的。
     *  跟微信的差別只在人數級距：那邊聯絡人上百個所以要按 + 才展開挑，這裡就四五位，
     *  全部攤開、亮的在桌上暗的不在，一眼看得完也一下就切得動。 */
    function _renderSeatGrid(wrap) {
        const CT = window.ClaudeTerminal;
        if (!CT || typeof CT.listResidents !== 'function') return;
        const all = CT.listResidents().filter(r => r && r.provider !== 'group' && r.provider !== 'xiaoji');
        if (!all.length) return;
        const grid = document.createElement('div');
        grid.className = 'cw-mem-grid';
        all.forEach(r => {
            const on = typeof CT.isGroupSeated === 'function' && CT.isGroupSeated(r.id);
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'cw-mem' + (on ? ' seated' : '');
            cell.title = on ? '在桌上，點一下請他下桌' : '不在桌上，點一下請他上桌';
            cell.innerHTML = _memFaceHtml(r)
                + '<span class="cw-mem-name">' + _esc(r.name) + '</span>';
            cell.addEventListener('click', () => {
                if (typeof CT.setGroupSeat !== 'function') return;
                const next = !CT.isGroupSeated(r.id);
                if (!CT.setGroupSeat(r.id, next)) return;
                // 桌上留一行告示：不只給她看，桌上其他人也靠這條知道多了誰／少了誰
                if (window.ChatGroup && typeof window.ChatGroup.announceSeat === 'function') {
                    window.ChatGroup.announceSeat(r.id, next);
                }
                ChatWindow.openSubPanel('recents');   // 重畫這一頁
            });
            grid.appendChild(cell);
        });
        wrap.appendChild(grid);
    }

    function _renderGroupPanel(body) {
        body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'cw-rec';
        const memTitle = document.createElement('div');
        memTitle.className = 'cw-mem-title';
        memTitle.textContent = '桌上的人';
        wrap.appendChild(memTitle);
        _renderSeatGrid(wrap);
        const note = document.createElement('div');
        note.className = 'cw-rec-empty';
        note.textContent = '群聊區目前是單一條對話。清空會把你跟' + _seatNames('、') +
                           '的對話全部清掉，並重置每個人的 session。';
        wrap.appendChild(note);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'cw-rec-clear';
        clearBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 清空群聊';
        clearBtn.addEventListener('click', () => {
            if (clearBtn.dataset.armed === '1') {
                if (window.ChatGroup && typeof window.ChatGroup.clear === 'function') {
                    window.ChatGroup.clear();
                }
                ChatWindow.closeSubPanel();
            } else {
                clearBtn.dataset.armed = '1';
                clearBtn.classList.add('armed');
                clearBtn.textContent = '確定清空整個群聊？再按一次';
            }
        });
        wrap.appendChild(clearBtn);
        body.appendChild(wrap);
    }

    // 共用：套用 provider（identity/class/display/靜音/載房間）—— open(浮窗) 與 mountInside(嵌入) 都走這
    async function _applyProvider(provider) {
        provider = (provider === 'codex' || provider === 'deepseek' || provider === 'group' || provider === 'xiaoji') ? provider : 'claude';
        _provider = provider;
        const idEl = _winEl.querySelector('#cw-identity');
        if (idEl) idEl.textContent = _identityText(provider);
        _winEl.classList.toggle('cw-codex',    provider === 'codex');
        _winEl.classList.toggle('cw-deepseek', provider === 'deepseek');
        _winEl.classList.toggle('cw-group',    provider === 'group');
        _winEl.classList.toggle('cw-xiaoji',   provider === 'xiaoji');
        _winEl.style.display = 'flex';
        _isOpen = true;
        _winEl.classList.remove('cw-view-dorm');   // 進房間就離開宿舍頁
        _view = 'room';
        ChatWindow.closeSubPanel();
        // 進房間靜音大廳 BGM（窗本身不放 BGM）
        if (window.VoidAmbient && typeof window.VoidAmbient.pauseBgm === 'function') {
            window.VoidAmbient.pauseBgm();
        }
        _syncTabBar();
        await _loadRoom(provider);
    }

    // ── 主窗的兩頁：宿舍（門卡）跟房間（對話）──
    // 以前這兩個是各自獨立的浮層，同時開著會在畫面上疊成兩個窗。
    // 現在是同一個窗的兩頁，點門卡就地切過去，標題列的「‹」切回來。
    let _view = 'room';

    function _applyView(v) {
        _view = (v === 'dorm') ? 'dorm' : 'room';
        if (!_winEl) return;
        _winEl.classList.toggle('cw-view-dorm', _view === 'dorm');
        if (_view === 'dorm') {
            const idEl = _winEl.querySelector('#cw-identity');
            if (idEl) idEl.textContent = '宿舍';
            ChatWindow.closeSubPanel();
        }
    }

    ChatWindow.getView = function () { return _view; };

    /** 把窗擺好、顯示出來（open 跟 openDorm 共用這段） */
    function _ensureWindowOnScreen() {
        if (!_winEl) _winEl = _buildWindow();
        // 浮窗模式：若先前被嵌進手機殼，復原成浮窗（尺寸/位置/回 body）
        if (_winEl.classList.contains('cw-embedded')) {
            _winEl.classList.remove('cw-embedded');
            const size = _sizeForViewport(); const pos = _centerPos(size);
            _winEl.style.width = size.w + 'px'; _winEl.style.height = size.h + 'px';
            _winEl.style.left = pos.left + 'px'; _winEl.style.top = pos.top + 'px';
        }
        if (_winEl.parentElement !== document.body) document.body.appendChild(_winEl);
    }

    /** 開窗並停在宿舍頁 —— 三個入口（輸入列鈕、手機浮球、斜線命令）都走這支 */
    ChatWindow.openDorm = function () {
        _ensureWindowOnScreen();
        _winEl.style.display = 'flex';
        _isOpen = true;
        if (window.VoidAmbient && typeof window.VoidAmbient.pauseBgm === 'function') {
            window.VoidAmbient.pauseBgm();
        }
        ChatWindow.showDorm();
    };

    /** 切到宿舍頁（門卡由 DormPanel 畫進來，名冊每次現讀） */
    ChatWindow.showDorm = function () {
        if (!_winEl) return;
        _applyView('dorm');
        const host = _winEl.querySelector('#cw-dorm');
        if (host && window.DormPanel && typeof window.DormPanel.renderInto === 'function') {
            window.DormPanel.renderInto(host);
        }
    };

    /** 切到某位住戶的房間（門卡點下去走這支，不再開新窗） */
    ChatWindow.showRoom = async function (provider) {
        _ensureWindowOnScreen();
        _applyView('room');
        await _applyProvider(provider);
    };

    ChatWindow.open = async function (provider) {
        if (!_winEl) _winEl = _buildWindow();
        // 浮窗模式：若先前被嵌進手機殼，復原成浮窗（尺寸/位置/回 body）
        if (_winEl.classList.contains('cw-embedded')) {
            _winEl.classList.remove('cw-embedded');
            const size = _sizeForViewport(); const pos = _centerPos(size);
            _winEl.style.width = size.w + 'px'; _winEl.style.height = size.h + 'px';
            _winEl.style.left = pos.left + 'px'; _winEl.style.top = pos.top + 'px';
        }
        if (_winEl.parentElement !== document.body) document.body.appendChild(_winEl);
        await _applyProvider(provider);
    };

    // 🤖 嵌進手機殼容器（「AI 助手」app 用）：脫浮窗外框、加 Claude/Codex tab 列、填滿容器
    ChatWindow.mountInside = function (container) {
        if (!container) return;
        if (!_winEl) _winEl = _buildWindow();
        _ensureTabBar();
        _winEl.classList.add('cw-embedded');
        _winEl.style.width = ''; _winEl.style.height = ''; _winEl.style.left = ''; _winEl.style.top = '';
        container.appendChild(_winEl);
        _applyProvider(_provider || 'claude');
    };

    // Claude/Codex tab 列（只在嵌入模式顯示，CSS 控）
    function _ensureTabBar() {
        if (!_winEl || _winEl.querySelector('#cw-tab-bar')) return;
        const bar = document.createElement('div');
        bar.id = 'cw-tab-bar';
        bar.className = 'cw-tab-bar';
        bar.innerHTML =
            '<button class="cw-tab-btn" data-p="claude" type="button">🦀 Claude</button>' +
            '<button class="cw-tab-btn" data-p="codex" type="button">🔷 Codex</button>';
        bar.querySelectorAll('.cw-tab-btn').forEach(b => {
            b.addEventListener('click', () => { if (b.dataset.p !== _provider) _applyProvider(b.dataset.p); });
        });
        _winEl.insertBefore(bar, _winEl.firstChild);
    }

    function _syncTabBar() {
        if (!_winEl) return;
        _winEl.querySelectorAll('#cw-tab-bar .cw-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.p === _provider));
    }

    ChatWindow.close = function () {
        if (!_isOpen) return;
        if (_winEl) _winEl.style.display = 'none';
        ChatWindow.closeSubPanel();
        _isOpen = false;
        // 回大廳：恢復大廳 BGM（resumeLobbyActivity 內含 bgmEnabled 判斷）
        if (window.VoidTerminal && typeof window.VoidTerminal.resumeLobbyActivity === 'function') {
            window.VoidTerminal.resumeLobbyActivity();
        }
    };

    // 三個入口（輸入列那顆鈕、手機浮球、斜線命令）都走這支；開的是宿舍面板
    ChatWindow.toggleLauncherMenu = function (anchorEl) {
        if (window.DormPanel && typeof window.DormPanel.toggle === 'function') {
            window.DormPanel.toggle(anchorEl);
        } else {
            console.warn('[ChatWindow] 宿舍面板尚未載入');
        }
    };

    const _SUBPANEL_TITLES = {
        settings: '設置',
        spend: '額度', board: '留言板', recents: '會話',
        xiaoji_train: '培養室', xiaoji_box: '404 寄來的箱子',
        wardrobe: '衣櫃', notebook: '紀錄', xiaoji_memory: '它記得的事',
    };

    ChatWindow.openSubPanel = function (name) {
        if (!_winEl) return;
        _subPanel = name;
        _subBack = null;
        const sp = _winEl.querySelector('#cw-subpanel');
        const title = _winEl.querySelector('#cw-subpanel-title');
        const body = _winEl.querySelector('#cw-subpanel-body');
        if (!sp || !body) return;
        if (title) title.textContent = _SUBPANEL_TITLES[name] || name;
        body.innerHTML = '';
        if (name === 'spend') {
            if (window.OS_SPEND_PANEL && typeof window.OS_SPEND_PANEL.launch === 'function') {
                window.OS_SPEND_PANEL.launch(body);
            } else {
                body.innerHTML = '<div class="cw-sub-missing">額度模組未載入</div>';
            }
        } else if (name === 'board') {
            if (window.OS_BOARD && typeof window.OS_BOARD.launch === 'function') {
                window.OS_BOARD.launch(body);
            } else {
                body.innerHTML = '<div class="cw-sub-missing">留言板模組未載入</div>';
            }
        } else if (name === 'xiaoji_train' || name === 'xiaoji_box') {
            const XT = window.XiaojiTrain;
            const fn = name === 'xiaoji_box' ? 'box' : 'launch';
            if (XT && typeof XT[fn] === 'function') XT[fn](body);
            else body.innerHTML = '<div class="cw-sub-missing">培養室模組未載入</div>';
        } else if (name === 'wardrobe') {
            if (window.RoomWardrobe && typeof window.RoomWardrobe.launch === 'function') window.RoomWardrobe.launch(body);
            else body.innerHTML = '<div class="cw-sub-missing">衣櫃模組未載入</div>';
        } else if (name === 'xiaoji_memory') {
            if (window.XiaojiMemory && typeof window.XiaojiMemory.launch === 'function') window.XiaojiMemory.launch(body);
            else body.innerHTML = '<div class="cw-sub-missing">它記得的事模組未載入</div>';
        } else if (name === 'notebook') {
            if (window.RoomNotebook && typeof window.RoomNotebook.launch === 'function') window.RoomNotebook.launch(body);
            else body.innerHTML = '<div class="cw-sub-missing">紀錄模組未載入</div>';
        } else if (name === 'settings') {
            _renderSettingsPanel(body);
        } else if (name === 'recents') {
            if (_provider === 'group') {
                if (title) title.textContent = '群聊';
                _renderGroupPanel(body);
            } else {
                _renderRecentsPanel(body);
            }
        }
        sp.style.display = 'flex';
    };

    /** 子面板裡點開一層：標題換成那一層的，「返回」退回上一層（onBack）。不給 onBack＝回到子面板本身的標題 */
    ChatWindow.setSubPanelHead = function (title, onBack) {
        if (!_winEl) return;
        const t = _winEl.querySelector('#cw-subpanel-title');
        if (t) t.textContent = title || _SUBPANEL_TITLES[_subPanel] || _subPanel || '';
        _subBack = typeof onBack === 'function' ? onBack : null;
    };

    ChatWindow.closeSubPanel = function () {
        _subPanel = null;
        _subBack = null;
        if (!_winEl) return;
        const sp = _winEl.querySelector('#cw-subpanel');
        if (sp) sp.style.display = 'none';
    };

    // 🧹 按鈕觸發:對群聊做一次「摘要 & 重啟」
    //   呼叫 Sonnet 壓縮整段對話 → 清三人 session → 留下「前情提要」卡片在頂部
    //   Sonnet 走 Rae 的 Max 訂閱配額,後台雜活 0 元
    ChatWindow.compactGroup = async function (btnEl) {
        if (_provider !== 'group') return;
        if (!window.ChatGroup || typeof window.ChatGroup.compact !== 'function') return;
        const ok = window.confirm(
            '把整段群聊壓成一頁「前情提要」,並清掉每個人的 session?\n\n' +
            '會用 Claude Sonnet 生成摘要(走 Max 訂閱,免費)。\n' +
            '之後' + _seatNames('、') + '從零開始記新對話,但會看到前情提要。'
        );
        if (!ok) return;
        const _btn = btnEl || (_winEl && _winEl.querySelector('.cw-tool-compact'));
        const _origText = _btn ? _btn.textContent : null;
        if (_btn) { _btn.disabled = true; _btn.textContent = '⏳'; }
        try {
            const r = await window.ChatGroup.compact();
            if (r && r.ok) {
                // 成功:hydrate 已重畫過,不用再動 UI
                return;
            }
            const why = (r && r.reason) || 'unknown';
            const msg = why === 'busy'        ? '群聊還在忙(有 AI 在回應),稍後再試。'
                      : why === 'in_game'     ? '對局進行中不能摘要,先 endGame 或等對局結束。'
                      : why === 'too_short'   ? '對話太短(<6 則)沒必要壓縮。'
                      : why === 'empty_reply' ? '摘要結果是空的,Sonnet 可能罷工,過幾秒重試。'
                      : why === 'error'       ? '出錯了:' + ((r && r.error) || '未知')
                      :                         '未知狀況:' + why;
            window.alert(msg);
        } finally {
            if (_btn) { _btn.disabled = false; if (_origText !== null) _btn.textContent = _origText; }
        }
    };

    ChatWindow.submitInput = function () {
        if (!_winEl) return;
        const input = _winEl.querySelector('#cw-input');
        if (!input) return;
        const txt = input.value.trim();
        const groupHasAttach = _provider === 'group' && window.ChatGroup
            && typeof window.ChatGroup.hasPending === 'function' && window.ChatGroup.hasPending();
        if (!txt && !groupHasAttach) return;
        input.value = '';
        input.style.height = 'auto';
        _syncInputEmpty();
        if (_provider === 'group') {
            if (window.ChatGroup && typeof window.ChatGroup.holdMessage === 'function') {
                window.ChatGroup.holdMessage(txt);          // 🤚 群聊也只放上桌，按魔杖才叫大家回
            }
        } else if (window.VoidClaudeRoom && typeof window.VoidClaudeRoom.holdMessage === 'function') {
            window.VoidClaudeRoom.holdMessage(txt);     // 🤚 私聊只放上去，按魔杖才回
        }
    };

    /** 重開現在這間（紀錄頁跳回別的一串時用：先換好那串，再照開房間的路走一次） */
    ChatWindow.reloadRoom = function () { return _winEl ? _loadRoom(_provider) : Promise.resolve(); };

    ChatWindow.isOpen      = function () { return _isOpen; };
    ChatWindow.getProvider = function () { return _provider; };
    ChatWindow.getBody     = function () { return _winEl && _winEl.querySelector('#cw-body'); };
    ChatWindow.getSubPanelBody = function () { return _winEl && _winEl.querySelector('#cw-subpanel-body'); };

    console.log('✅ ChatWindow（Claude/Codex 浮窗外殼）模組就緒');
})(window.ChatWindow = window.ChatWindow || {});
