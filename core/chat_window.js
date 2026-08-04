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
    let _menuEl = null;              // Claude/Codex 啟動選單
    let _provider = 'claude';        // 'claude' | 'codex'
    let _isOpen = false;
    let _subPanel = null;            // 當前開啟的子面板名（null = 沒開）

    const IDENTITY = {
        claude:   '🦀 Claude’s Room',
        codex:    '🔷 Codex’s Room',
        deepseek: '🟢 蘇景明 的房間',
        group:    '👥 群聊區',
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
                <span class="cw-identity" id="cw-identity">${IDENTITY.claude}</span>
                <div class="cw-toolbar">
                    <button class="cw-tool-btn" data-panel="settings"  type="button" title="設置">⚙️</button>
                    <button class="cw-tool-btn" data-panel="workbench" type="button" title="工作檯">🛠️</button>
                    <button class="cw-tool-btn" data-panel="spend"     type="button" title="額度">💰</button>
                    <button class="cw-tool-btn" data-panel="board"     type="button" title="留言板">📝</button>
                    <button class="cw-tool-btn" data-panel="recents"   type="button" title="Recents">🕘</button>
                    <button class="cw-tool-btn cw-tool-compact" data-action="compact" type="button" title="摘要 & 重啟群聊(壓縮上下文,清三人 session,留前情提要)" style="display:none;">🧹</button>
                </div>
                <button class="cw-close" id="cw-close" type="button" title="關閉">✕</button>
            </div>
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
                    <img id="claude-portrait-img" class="claude-portrait-img" alt="Clawd">
                    <div id="codex-portrait-sprite" class="codex-portrait-sprite"></div>
                    <div class="claude-conv-chip" id="claude-conv-chip" title="點開 Recents 多會話列表">
                        <span class="ccc-tab" id="ccc-tab">☕</span>
                        <span class="ccc-title" id="ccc-title">—</span>
                        <span class="ccc-arrow">▾</span>
                    </div>
                </div>
                <div class="claude-chat-stream" id="claude-chat-stream"></div>
                <div class="claude-picker-bar" id="claude-picker-bar">
                    <button class="claude-picker-btn" id="claude-picker-btn" type="button">
                        <span id="claude-pick-model">Opus 4.7</span>
                        <span class="claude-pick-sep" id="claude-pick-sep1">·</span>
                        <span id="claude-pick-effort">🧠 medium</span>
                        <span class="claude-pick-sep" id="claude-pick-sep2">·</span>
                        <span id="claude-pick-endpoint">☁️ VPS</span>
                        <span class="claude-pick-arrow">▼</span>
                    </button>
                </div>
                <div class="claude-picker-popup" id="claude-picker-popup" style="display:none;"></div>
                <div class="claude-attach-chips" id="claude-attach-chips"></div>
                <input type="file" id="claude-file-input" multiple style="display:none;"
                       accept="image/*,application/pdf,.txt,.md,.json,.csv,.js,.ts,.py,.html,.css,.yml,.yaml,.toml,.log">
                <div class="cw-input-row">
                    <textarea id="cw-input" class="cw-input" placeholder="對 Claude 說點什麼..." rows="1" autocomplete="off"></textarea>
                    <button class="cw-attach-btn" id="claude-attach-btn" type="button" title="附加檔案">📎</button>
                    <button class="cw-send-btn" id="cw-send-btn" type="button"><i class="fa-solid fa-paper-plane"></i></button>
                </div>
            </div>
            <div class="cw-subpanel" id="cw-subpanel" style="display:none;">
                <div class="cw-subpanel-head">
                    <span class="cw-subpanel-title" id="cw-subpanel-title"></span>
                    <button class="cw-subpanel-close" id="cw-subpanel-close" type="button">✕</button>
                </div>
                <div class="cw-subpanel-body" id="cw-subpanel-body"></div>
            </div>`;
        document.body.appendChild(el);

        el.querySelector('#cw-close').addEventListener('click', () => ChatWindow.close());
        el.querySelector('#cw-subpanel-close').addEventListener('click', () => ChatWindow.closeSubPanel());
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

    function _bindChatInput(el) {
        const input = el.querySelector('#cw-input');
        const sendBtn = el.querySelector('#cw-send-btn');
        const attachBtn = el.querySelector('#claude-attach-btn');
        const fileInput = el.querySelector('#claude-file-input');
        const pickerBtn = el.querySelector('#claude-picker-btn');

        if (sendBtn) sendBtn.onclick = ChatWindow.submitInput;
        if (input) {
            // ── @-mention 自動完成（只在群聊 provider 啟用）──
            const MENTIONS = [
                { key: 'claude',   label: 'Claude',   emoji: '🦀', alias: ['claude', '丹'] },
                { key: 'codex',    label: 'Codex',    emoji: '🔷', alias: ['codex', '阿洛'] },
                { key: 'deepseek', label: '蘇景明',   emoji: '🟢', alias: ['蘇景明', '景明', 'deepseek', 'deepseek'] },
            ];
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
                    <div class="cw-mention-item${i === mState.idx ? ' active' : ''}" data-key="${it.key}">
                        <span class="cw-mention-emoji">${it.emoji}</span>
                        <span class="cw-mention-label">${it.label}</span>
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
                const item = MENTIONS.find((m) => m.key === key);
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
                const items = MENTIONS.filter((m) =>
                    m.alias.some((a) => a.toLowerCase().startsWith(q))
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
                // 一般送出
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
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
        if (attachBtn && fileInput) {
            attachBtn.onclick = () => fileInput.click();
            fileInput.onchange = async (e) => {
                const files = e.target.files;
                if (files && files.length) {
                    if (_provider === 'group' && window.ChatGroup
                        && typeof window.ChatGroup.handleFilePick === 'function') {
                        await window.ChatGroup.handleFilePick(files);
                    } else if (window.VoidClaudeRoom) {
                        await window.VoidClaudeRoom.handleFilePick(files);
                    }
                }
                fileInput.value = '';
            };
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

    // 載入當前 provider 的 conv 歷史並渲染進浮窗
    async function _loadRoom(provider) {
        const cwBody = _winEl && _winEl.querySelector('#cw-body');
        // 🧹 摘要按鈕只在群聊房顯示
        const compactBtn = _winEl && _winEl.querySelector('.cw-tool-compact');
        if (compactBtn) compactBtn.style.display = (provider === 'group') ? '' : 'none';
        // 群聊區：交給 ChatGroup，跳過單房間流程
        if (provider === 'group') {
            if (cwBody) cwBody.classList.add('cw-body-group');
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
        const OS = window.OS_SETTINGS;
        if (!OS || typeof OS.getClaudeRoomConfig !== 'function') {
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

        if (!isCodex) {
            const tabBar = document.createElement('div');
            tabBar.className = 'cw-rec-tabs';
            [['max', '🏠 訂閱 Max'], ['api', '🌐 API']].forEach(pair => {
                const tb = document.createElement('button');
                tb.type = 'button';
                tb.className = 'cw-rec-tab' + (pair[0] === curTab ? ' active' : '');
                tb.textContent = pair[1];
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
        newBtn.textContent = '＋ 新會話';
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
                    ren.type = 'button'; ren.className = 'cw-rec-act'; ren.textContent = '✏️'; ren.title = '改名';
                    ren.addEventListener('click', renderRename);
                    const del = document.createElement('button');
                    del.type = 'button'; del.className = 'cw-rec-act'; del.textContent = '🗑️'; del.title = '刪除';
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
            clearBtn.textContent = '🗑️ 清空全部';
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
    function _renderGroupPanel(body) {
        body.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'cw-rec';
        const note = document.createElement('div');
        note.className = 'cw-rec-empty';
        note.textContent = '群聊區目前是單一條對話。清空會把你、Claude、Codex 的對話全部清掉，並重置兩邊的 session。';
        wrap.appendChild(note);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'cw-rec-clear';
        clearBtn.textContent = '🗑️ 清空群聊';
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
        provider = (provider === 'codex' || provider === 'deepseek' || provider === 'group') ? provider : 'claude';
        _provider = provider;
        const idEl = _winEl.querySelector('#cw-identity');
        if (idEl) idEl.textContent = IDENTITY[provider];
        _winEl.classList.toggle('cw-codex',    provider === 'codex');
        _winEl.classList.toggle('cw-deepseek', provider === 'deepseek');
        _winEl.classList.toggle('cw-group',    provider === 'group');
        _winEl.style.display = 'flex';
        _isOpen = true;
        if (_menuEl) _menuEl.style.display = 'none';
        ChatWindow.closeSubPanel();
        // 進房間靜音大廳 BGM（窗本身不放 BGM）
        if (window.VoidAmbient && typeof window.VoidAmbient.pauseBgm === 'function') {
            window.VoidAmbient.pauseBgm();
        }
        _syncTabBar();
        await _loadRoom(provider);
    }

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

    // 啟動選單：點酒館輸入列那顆鈕 → 跳小選單選 Claude / Codex
    ChatWindow.toggleLauncherMenu = function (anchorEl) {
        if (_menuEl && _menuEl.style.display !== 'none') {
            _menuEl.style.display = 'none';
            return;
        }
        if (!_menuEl) {
            _menuEl = document.createElement('div');
            _menuEl.id = 'cw-launcher-menu';
            _menuEl.innerHTML =
                '<button class="cw-lm-item" data-p="claude" type="button">🦀 Claude 的房間</button>' +
                '<button class="cw-lm-item" data-p="codex" type="button">🔷 Codex 的房間</button>' +
                '<button class="cw-lm-item" data-p="deepseek" type="button">🟢 蘇景明 的房間</button>' +
                '<button class="cw-lm-item" data-p="group" type="button">👥 群聊區</button>';
            document.body.appendChild(_menuEl);
            _menuEl.querySelectorAll('.cw-lm-item').forEach(b => {
                b.addEventListener('click', () => {
                    _menuEl.style.display = 'none';
                    ChatWindow.open(b.dataset.p);
                });
            });
            document.addEventListener('click', (e) => {
                if (!_menuEl || _menuEl.style.display === 'none') return;
                if (_menuEl.contains(e.target)) return;
                if (e.target && e.target.closest && e.target.closest('#aurelia-chat-launcher')) return;
                _menuEl.style.display = 'none';
            });
        }
        _menuEl.style.display = 'flex';
        const r = anchorEl.getBoundingClientRect();
        const mw = _menuEl.offsetWidth || 170;
        const mh = _menuEl.offsetHeight || 84;
        let left = r.left;
        if (left + mw > window.innerWidth) left = window.innerWidth - mw - 8;
        _menuEl.style.left = Math.max(8, left) + 'px';
        _menuEl.style.top = Math.max(8, r.top - mh - 6) + 'px';
    };

    const _SUBPANEL_TITLES = {
        settings: '⚙️ 設置', workbench: '🛠️ 工作檯',
        spend: '💰 額度', board: '📝 留言板', recents: '🕘 Recents',
    };

    // 工作檯 / 額度模組自帶關閉鈕（原本呼叫 PhoneSystem.goHome）→ 改接 closeSubPanel
    function _hijackModuleClose(body, selector) {
        const btn = body.querySelector(selector);
        if (btn) {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                ChatWindow.closeSubPanel();
            };
        }
    }

    ChatWindow.openSubPanel = function (name) {
        if (!_winEl) return;
        _subPanel = name;
        const sp = _winEl.querySelector('#cw-subpanel');
        const head = _winEl.querySelector('.cw-subpanel-head');
        const title = _winEl.querySelector('#cw-subpanel-title');
        const body = _winEl.querySelector('#cw-subpanel-body');
        if (!sp || !body) return;
        // 工作檯 / 額度 / 留言板自帶 header + 關閉鈕 → 藏浮窗自己的 header，避免雙標題雙 ✕
        const moduleOwnsHeader = (name === 'workbench' || name === 'spend' || name === 'board');
        if (head) head.style.display = moduleOwnsHeader ? 'none' : 'flex';
        if (title) title.textContent = _SUBPANEL_TITLES[name] || name;
        body.innerHTML = '';
        if (name === 'workbench') {
            if (window.OS_WORKBENCH && typeof window.OS_WORKBENCH.launch === 'function') {
                window.OS_WORKBENCH.launch(body);
                _hijackModuleClose(body, '#wb-close');
            } else {
                body.innerHTML = '<div class="cw-sub-missing">工作檯模組未載入</div>';
            }
        } else if (name === 'spend') {
            if (window.OS_SPEND_PANEL && typeof window.OS_SPEND_PANEL.launch === 'function') {
                window.OS_SPEND_PANEL.launch(body);
                _hijackModuleClose(body, '#sp-close-btn');
            } else {
                body.innerHTML = '<div class="cw-sub-missing">額度模組未載入</div>';
            }
        } else if (name === 'board') {
            if (window.OS_BOARD && typeof window.OS_BOARD.launch === 'function') {
                window.OS_BOARD.launch(body);
                _hijackModuleClose(body, '#ob-close-btn');
            } else {
                body.innerHTML = '<div class="cw-sub-missing">留言板模組未載入</div>';
            }
        } else if (name === 'settings') {
            _renderSettingsPanel(body);
        } else if (name === 'recents') {
            if (_provider === 'group') {
                if (title) title.textContent = '🕘 群聊';
                _renderGroupPanel(body);
            } else {
                _renderRecentsPanel(body);
            }
        }
        sp.style.display = 'flex';
    };

    ChatWindow.closeSubPanel = function () {
        _subPanel = null;
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
            '把整段群聊壓成一頁「前情提要」,並清掉三人的 session?\n\n' +
            '會用 Claude Sonnet 生成摘要(走 Max 訂閱,免費)。\n' +
            '之後三人從零開始記新對話,但會看到前情提要。'
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
        if (_provider === 'group') {
            if (window.ChatGroup && typeof window.ChatGroup.sendUserMessage === 'function') {
                window.ChatGroup.sendUserMessage(txt);
            }
        } else if (window.VoidClaudeRoom && typeof window.VoidClaudeRoom.sendMessage === 'function') {
            window.VoidClaudeRoom.sendMessage(txt);
        }
    };

    ChatWindow.isOpen      = function () { return _isOpen; };
    ChatWindow.getProvider = function () { return _provider; };
    ChatWindow.getBody     = function () { return _winEl && _winEl.querySelector('#cw-body'); };
    ChatWindow.getSubPanelBody = function () { return _winEl && _winEl.querySelector('#cw-subpanel-body'); };

    console.log('✅ ChatWindow（Claude/Codex 浮窗外殼）模組就緒');
})(window.ChatWindow = window.ChatWindow || {});
