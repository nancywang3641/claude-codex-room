/**
 * core/chat_room.js — Claude / Codex 聊天室 UI 層
 * 渲染進 ChatWindow（core/chat_window.js）的浮窗。
 * 歷史由本檔的 _roomHistory 持有，持久化走 ClaudeTerminal.saveHistory。
 * 注意：與 core/claude_terminal.js 不同 —— 那個是後端（API/持久化），本檔是 UI。
 */
(function (VoidClaudeRoom) {
    'use strict';

    /** 當前房間 provider：'claude' | 'codex'（由 ChatWindow 決定） */
    function _provider() {
        return (window.ChatWindow && typeof window.ChatWindow.getProvider === 'function'
            && window.ChatWindow.getProvider()) || 'claude';
    }

    /** 取浮窗內元素（避免抓到大廳 createTab 模板殘留的同 id 元素） */
    function _el(id) {
        const body = (window.ChatWindow && typeof window.ChatWindow.getBody === 'function')
            ? window.ChatWindow.getBody() : null;
        return body ? body.querySelector('#' + id) : document.getElementById(id);
    }

    // 當前浮窗對話歷史。ChatWindow.open 時由 setHistory() 灌入，送訊息時 push。
    let _roomHistory = [];
    function _activeHistory() { return _roomHistory; }

    // 持久化（debounced）：寫回 ClaudeTerminal 當前 conv 的 IndexedDB
    let _saveTimer = null;
    function _scheduleSave() {
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            _saveTimer = null;
            if (window.ClaudeTerminal && typeof window.ClaudeTerminal.saveHistory === 'function') {
                window.ClaudeTerminal.saveHistory(_roomHistory);
            }
        }, 600);
    }

    let _pendingClaudeAttachments = []; // 當前訊息要附的檔（每筆 {path, filename, mime, size}），送出後清空
    let _claudeAbortCtrl = null;        // 當前 send 的 AbortController（client-side fetch 中止）
    let _claudeTaskId    = null;        // 當前 send 的 task_id（給 /v1/cancel/{taskId} 用）

    // 套用浮窗聊天室 UI（picker 文字 / 立繪 / 輸入框 placeholder）
    function _applyClaudeRoomUi() {
        const isCodex = _provider() === 'codex';
        _setClaudePortraitState('living');
        _updateClaudePickerLabel();
        const inputField = _el('cw-input');
        if (inputField) inputField.placeholder = isCodex ? '對 Codex 說點什麼...' : '對 Claude 說點什麼...';
    }

    // 浮窗化後大廳傳送門按鈕為固定文字（🦀 Claude / 🔷 Codex），不再反映房間狀態
    function _updateClaudePortalBtn() {}

    // Claude 回覆切多頁（套奧瑞亞 VN 翻頁體驗，避免長文字爆出對話框）
    // 優先度：段落空行 > 單換行 > 句末標點 > 逗號 > 字數硬切
    // ===== Claude inline picker（聊天室上方橫條：model / effort / endpoint） =====

    const CLAUDE_MODELS = [
        { id: 'claude-opus-4-7',           label: 'Opus 4.7 ⭐'   },
        { id: 'claude-opus-4-6',           label: 'Opus 4.6'      },
        { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6'    },
        { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5'     },
    ];
    // Codex CLI 走 ~/.codex/config.toml 決定預設主模型,也接受 --model 字串 hint。
    // 清單按 ChatGPT App / Codex 訂閱帳號當前能 access 的 model 命名(小寫破折號)。
    // 如果跑時報 "model not found" → 回 picker 選「預設」交給 config.toml。
    const CODEX_MODELS = [
        { id: '',               label: '預設(走 ~/.codex/config.toml)⭐' },
        { id: 'gpt-5.5',        label: 'GPT-5.5(旗艦)' },
        { id: 'gpt-5.4',        label: 'GPT-5.4' },
        { id: 'gpt-5.4-mini',   label: 'GPT-5.4-Mini(快版,便宜)' },
        { id: 'gpt-5.3-codex',  label: 'GPT-5.3-Codex(寫程式專用)' },
        { id: 'gpt-5.2',        label: 'GPT-5.2(舊版)' },
    ];
    // DeepSeek V4 系列(2026 起,V3 chat/coder/reasoner 已下架)
    // `deepseek models` 列出來只有兩個:pro 是預設旗艦、flash 是便宜快版
    // 空 id = 不傳 --model,讓 CodeWhale 用預設(目前 = v4-pro)
    const DEEPSEEK_MODELS = [
        { id: '',                  label: 'CodeWhale 預設(v4-pro)⭐' },
        { id: 'deepseek-v4-pro',   label: 'deepseek-v4-pro(強版,推理/規劃)' },
        { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash(快版,便宜)' },
    ];
    // helper:依當前 provider 取對應的 model 清單
    function _modelsForProvider(prov) {
        if (prov === 'codex')    return CODEX_MODELS;
        if (prov === 'deepseek') return DEEPSEEK_MODELS;
        return CLAUDE_MODELS;
    }
    // helper:從 cfg 取「該 provider 目前選的 model id」
    //   cfg.providerModels = { claude: '...', codex: '...', deepseek: '...' }
    //   claude 兼容舊欄位 cfg.inlineModel(歷史遺產,純 Claude 時代用的)
    function _getProviderModel(cfg, prov) {
        const pm = (cfg && cfg.providerModels) || {};
        if (prov === 'claude') return pm.claude || cfg.inlineModel || cfg.model || 'claude-opus-4-7';
        return pm[prov] || '';  // codex/deepseek 預設空 = 不指定、讓 CLI 自己用預設
    }
    // helper:設定「該 provider 的 model id」回寫進 cfg
    function _setProviderModel(cfg, prov, modelId) {
        cfg.providerModels = cfg.providerModels || {};
        cfg.providerModels[prov] = modelId;
        if (prov === 'claude') cfg.inlineModel = modelId;  // 同步舊欄位,避免別處取值落差
    }
    // helper:把 model id 轉成顯示用 label(找不到就回 id)
    function _modelLabel(modelId, prov) {
        const list = _modelsForProvider(prov);
        const found = list.find(x => x.id === modelId);
        return found ? found.label.replace(' ⭐', '') : (modelId || list[0].label.replace(' ⭐', ''));
    }
    const CLAUDE_EFFORTS = [
        { id: 'off',    label: 'Off · 不思考' },
        { id: 'low',    label: 'Low · 簡單問題跳過' },
        { id: 'medium', label: 'Medium · 自動判斷（建議）' },
        { id: 'high',   label: 'High · 多數題都思考' },
        { id: 'xhigh',  label: 'xHigh · 深度思考' },
        { id: 'max',    label: 'Max · 不留餘地' },
    ];

    function _getClaudeRoomCfg() {
        return (window.OS_SETTINGS && window.OS_SETTINGS.getClaudeRoomConfig)
            ? window.OS_SETTINGS.getClaudeRoomConfig() : null;
    }
    function _saveClaudeRoomCfg(cfg) {
        if (window.OS_SETTINGS && window.OS_SETTINGS.saveClaudeRoomConfig) {
            window.OS_SETTINGS.saveClaudeRoomConfig(cfg);
        }
    }
    function _shortModelLabel(modelId) {
        const m = CLAUDE_MODELS.find(x => x.id === modelId);
        return m ? m.label.replace(' ⭐', '') : (modelId || 'Opus 4.7');
    }
    function _shortEffortLabel(eff) {
        if (!eff) return '🧠 預設';
        if (eff === 'off') return '🧠 off';
        return '🧠 ' + eff;
    }
    function _shortEndpointLabel(cfg) {
        const presets = cfg?.presets || [];
        const active = presets.find(p => p.id === cfg.activePresetId) || presets[0];
        if (!active) return '⚠️ 沒設定';
        // 偵測 URL 類型自動配 emoji
        const url = active.url || '';
        let emoji = '🌐';
        if (/api\.anthropic\.com/i.test(url)) emoji = '🌐';
        else if (/dancc\.|localhost|127\.0\.0\.1/i.test(url)) emoji = '🏠';
        else if (/cc\.|vps/i.test(url)) emoji = '☁️';
        return `${emoji} ${active.name || active.id}`;
    }

    /** 聊天室上方那條橫條的文字更新 */
    function _updateClaudePickerLabel() {
        const cfg = _getClaudeRoomCfg();
        if (!cfg) return;
        const prov = _provider();
        const isCodex    = prov === 'codex';
        const isDeepseek = prov === 'deepseek';
        // thinking effort 只 Claude 有(Codex/DeepSeek model 不吃 effort 參數)
        const hasEffort = !isCodex && !isDeepseek;
        const m = _el('claude-pick-model');
        const e = _el('claude-pick-effort');
        const ep = _el('claude-pick-endpoint');
        const bk = _el('claude-pick-backend');
        const sep1 = _el('claude-pick-sep1');
        if (e)    e.style.display    = hasEffort ? '' : 'none';
        if (sep1) sep1.style.display = hasEffort ? '' : 'none';
        if (m) {
            const emoji = isCodex ? '🔷 ' : isDeepseek ? '🟢 ' : '';
            m.textContent = emoji + _modelLabel(_getProviderModel(cfg, prov), prov);
        }
        if (e && hasEffort) e.textContent = _shortEffortLabel(cfg.inlineEffort);
        if (ep) ep.textContent = _shortEndpointLabel(cfg);
        // backend 選單一律顯示（Anthropic 直連分支已於 2026-05-24 移除）
        if (bk) bk.style.display = '';
    }

    /** popup 內容生成 + 展開 */
    function _openClaudePickerPopup() {
        const cfg = _getClaudeRoomCfg();
        if (!cfg) return;
        const popup = _el('claude-picker-popup');
        if (!popup) return;
        const prov        = _provider();
        const models      = _modelsForProvider(prov);
        const curModel    = _getProviderModel(cfg, prov);
        const curEffort   = cfg.inlineEffort  || '';
        const curPresetId = cfg.activePresetId || '';
        const modelSectionTitle = prov === 'codex'    ? 'Codex Model'
                                : prov === 'deepseek' ? '蘇景明 Model'
                                :                       'Claude Model';

        const sectionHtml = (title, list, curId, dataKey) => `
            <div class="claude-picker-section-title">${title}</div>
            ${list.map(it => `
                <div class="claude-picker-item${curId === it.id ? ' active' : ''}" data-${dataKey}="${it.id}">
                    <span class="claude-picker-check">${curId === it.id ? '✓' : ''}</span>
                    <span>${it.label}</span>
                </div>
            `).join('')}
        `;

        // 連線預設 section（從 cfg.presets）
        const presets = cfg.presets || [];
        const presetList = presets.map(p => ({
            id: p.id,
            label: (p.name || p.id) + (p.url ? '' : ' (未設定)'),
        }));

        // 三段:連線預設 / Model(provider-aware) / Thinking(只 Claude)
        const showEffort = (prov === 'claude');
        popup.innerHTML = `
            ${sectionHtml('連線預設',  presetList, curPresetId, 'preset')}
            ${sectionHtml(modelSectionTitle, models, curModel, 'model')}
            ${showEffort ? sectionHtml('Thinking 思考', CLAUDE_EFFORTS, curEffort || 'medium', 'effort') : ''}
        `;
        popup.style.display = 'block';

        // 綁項目點擊
        popup.querySelectorAll('[data-preset]').forEach(el => el.onclick = () => {
            const c = _getClaudeRoomCfg();
            c.activePresetId = el.dataset.preset;
            _saveClaudeRoomCfg(c);
            // sid 已經 per-preset 存了，切過去自動取對應 sid（不用清也不會混）
            _updateClaudePickerLabel(); _openClaudePickerPopup();
        });
        popup.querySelectorAll('[data-model]').forEach(el => el.onclick = () => {
            const c = _getClaudeRoomCfg();
            _setProviderModel(c, prov, el.dataset.model);
            _saveClaudeRoomCfg(c);
            _updateClaudePickerLabel(); _openClaudePickerPopup();
        });
        popup.querySelectorAll('[data-effort]').forEach(el => el.onclick = () => {
            const c = _getClaudeRoomCfg(); c.inlineEffort = el.dataset.effort; _saveClaudeRoomCfg(c);
            _updateClaudePickerLabel(); _openClaudePickerPopup();
        });
    }

    function _closeClaudePickerPopup() {
        const p = _el('claude-picker-popup');
        if (p) p.style.display = 'none';
    }

    // 點 popup 外面關閉
    document.addEventListener('click', (e) => {
        const popup = _el('claude-picker-popup');
        if (!popup || popup.style.display === 'none') return;
        const btn = _el('claude-picker-btn');
        if (popup.contains(e.target) || (btn && btn.contains(e.target))) return;
        _closeClaudePickerPopup();
    });

    // ===== Claude 聊天室渲染（取代 VN 翻頁） =====

    // 立繪狀態機（idle / living / thinking / ultrathink / typing / happy / error
    //          / doze / yawn / reading / sleeping / wake）
    // living 進場後會依下表逐段切到 idle 變化、最後沉睡；任何 setState 都重置
    let _idleTimer = null;
    let _idleStage = 0;
    let _currentPortraitState = 'living';
    const IDLE_STAGES = [
        { state: 'doze',     delay: 120000 }, // 2 分鐘：打盹
        { state: 'reading',  delay: 180000 }, // +3 分（5 分總）：翻書
        { state: 'yawn',     delay: 180000 }, // +3 分（8 分總）：哈欠
        { state: 'sleeping', delay: 420000 }, // +7 分（15 分總）：沉睡
    ];

    // 🔷 Codex 寵物 spritesheet 動畫：8 欄 × 9 列，每列一種動作。
    // 來源 = OpenAI ChatGPT 擴展的 codex 寵物，逐幀切 background-position 播放。
    const CODEX_SHEET_COLS = 8, CODEX_SHEET_ROWS = 9;
    const CODEX_ANIMS = {
        idle:    { row: 0, count: 6, dur: 600 },
        waiting: { row: 6, count: 6, dur: 240 },
        running: { row: 7, count: 6, dur: 130 },
        waving:  { row: 3, count: 4, dur: 200 },
        failed:  { row: 5, count: 8, dur: 160 },
        jumping: { row: 4, count: 5, dur: 180 },
    };
    // 房間立繪狀態 → Codex 寵物動作
    const CODEX_STATE_ANIM = {
        living: 'idle', idle: 'idle', mini: 'idle', reading: 'idle',
        doze: 'idle', yawn: 'idle', sleeping: 'idle',
        thinking: 'waiting', ultrathink: 'waiting',
        typing: 'running', happy: 'waving', error: 'failed', wake: 'jumping',
    };
    let _codexFrameTimer = null;

    /** 在 #codex-portrait-sprite 上逐幀循環播放對應動作 */
    function _codexSpritePlay(state) {
        const sprite = _el('codex-portrait-sprite');
        if (!sprite) return;
        const anim = CODEX_ANIMS[CODEX_STATE_ANIM[state]] || CODEX_ANIMS.idle;
        let frame = 0;
        const step = () => {
            if (_provider() !== 'codex') { _codexFrameTimer = null; return; }  // 已離開 Codex 房間，停
            const col = frame % anim.count;
            const x = (col / (CODEX_SHEET_COLS - 1)) * 100;
            const y = (anim.row / (CODEX_SHEET_ROWS - 1)) * 100;
            sprite.style.backgroundPosition = x + '% ' + y + '%';
            frame++;
            _codexFrameTimer = setTimeout(step, anim.dur);
        };
        step();
    }

    function _swapPortraitImg(state) {
        // 切換立繪前先停掉 Codex spritesheet 的逐幀計時器
        if (_codexFrameTimer) { clearTimeout(_codexFrameTimer); _codexFrameTimer = null; }
        if (_provider() === 'codex') {
            _codexSpritePlay(state);
            _currentPortraitState = state;
            return;
        }
        const img = _el('claude-portrait-img');
        if (!img) return;
        const CT = window.ClaudeTerminal || {};
        const ASSETS = CT.ASSETS || {};
        const FB = CT.FALLBACK_URL || '';
        img.onerror = function(){ this.onerror = null; this.src = FB; };
        img.src = ASSETS[state] || ASSETS.living || ASSETS.idle || FB;
        _currentPortraitState = state;
    }

    function _clearIdleTimer() {
        if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    }

    function _scheduleNextIdle() {
        _clearIdleTimer();
        if (_idleStage >= IDLE_STAGES.length) return; // 已 sleeping、停
        const next = IDLE_STAGES[_idleStage];
        _idleTimer = setTimeout(() => {
            _swapPortraitImg(next.state);
            _idleStage++;
            _scheduleNextIdle();
        }, next.delay);
    }

    function _setClaudePortraitState(state) {
        _clearIdleTimer();
        _idleStage = 0;
        const wasSleeping = _currentPortraitState === 'sleeping';
        if (wasSleeping && state !== 'sleeping') {
            // 從沉睡醒來：先 wake 一下、~350ms 後切目標狀態
            _swapPortraitImg('wake');
            setTimeout(() => {
                _swapPortraitImg(state);
                if (state === 'living') _scheduleNextIdle();
            }, 350);
            return;
        }
        _swapPortraitImg(state);
        if (state === 'living') _scheduleNextIdle();
    }

    function _scrollClaudeChatToBottom() {
        const stream = _el('claude-chat-stream');
        if (stream) stream.scrollTop = stream.scrollHeight;
    }

    /** 加一條氣泡到 chat-stream。
     *  role: 'user' | 'assistant'
     *  opts.thinking: 字串 → 在氣泡上方塞折疊 thinking 區塊（之後 cc-bridge 真的吐 thinking 再用）
     */
    /** 從 mime / filename 推一個合適 emoji icon 給附件 chip 用 */
    function _attachIcon(mime, filename) {
        const ext = ((filename || '').split('.').pop() || '').toLowerCase();
        if (['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext)) return '🖼️';
        if (ext === 'pdf') return '📄';
        if (['md','txt','log','csv','yaml','yml','toml'].includes(ext)) return '📝';
        if (['js','ts','tsx','jsx','py','html','css','json','sh','bat','rb','go','rs','c','cpp','java'].includes(ext)) return '⚡';
        if (typeof mime === 'string') {
            if (mime.startsWith('image/')) return '🖼️';
            if (mime === 'application/pdf') return '📄';
            if (mime.startsWith('text/')) return '📝';
        }
        return '📎';
    }

    /** 把 tools_used list 摘成「改了 X 個檔、跑了 Y 個命令...」一行字 */
    function _summarizeToolsUsed(toolsUsed) {
        if (!Array.isArray(toolsUsed) || !toolsUsed.length) return '';
        const counts = {};
        for (const t of toolsUsed) {
            const name = (t && t.name) || 'unknown';
            counts[name] = (counts[name] || 0) + 1;
        }
        const cnt = k => counts[k] || 0;
        const e = cnt('Edit') + cnt('Write') + cnt('MultiEdit') + cnt('NotebookEdit');
        const b = cnt('Bash');
        const r = cnt('Read');
        const s = cnt('Grep') + cnt('Glob');
        const w = cnt('WebFetch') + cnt('WebSearch');
        const known = e + b + r + s + w;
        const other = toolsUsed.length - known;
        const parts = [];
        if (e) parts.push(`改了 ${e} 個檔`);
        if (b) parts.push(`跑了 ${b} 個命令`);
        if (r) parts.push(`讀了 ${r} 個檔`);
        if (s) parts.push(`搜了 ${s} 次`);
        if (w) parts.push(`抓了 ${w} 個網頁`);
        if (other) parts.push(`其他 ${other} 個工具`);
        return parts.length ? parts.join('、') : `用了 ${toolsUsed.length} 個工具`;
    }

    /** 拿 tool 的主要輸入欄位作為 detail（檔名 / 命令前 80 字 / pattern 前 60 字 等） */
    function _toolDetailLine(tool) {
        const inp = (tool && tool.input) || {};
        const name = tool && tool.name;
        if (!name) return '';
        if (name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit' || name === 'Read') {
            const p = (inp.file_path || inp.notebook_path || '');
            return p ? p.replace(/^.*[\\/]/, '') : '';  // basename only
        }
        if (name === 'Bash')      return (inp.command || '').slice(0, 80);
        if (name === 'Grep')      return (inp.pattern || '').slice(0, 60) + (inp.path ? ` in ${inp.path.replace(/^.*[\\/]/, '')}` : '');
        if (name === 'Glob')      return (inp.pattern || '').slice(0, 60);
        if (name === 'WebFetch')  return (inp.url || '').slice(0, 80);
        if (name === 'WebSearch') return (inp.query || '').slice(0, 60);
        return '';
    }

    let _claudeMdConverter = null;
    function _claudeMarkdownToSafeHtml(text) {
        if (!window.showdown || !window.DOMPurify) return null;
        if (!_claudeMdConverter) {
            _claudeMdConverter = new window.showdown.Converter({
                tables: true,
                strikethrough: true,
                simpleLineBreaks: true,
                openLinksInNewWindow: true,
                disableForced4SpacesIndentedSublists: true,
                ghCodeBlocks: true,
                tasklists: true,
            });
        }
        const html = _claudeMdConverter.makeHtml(String(text == null ? '' : text));

        // sanitize：放行 input 給 task list checkbox，下面後處理會把非 checkbox 的 input 砍掉
        const safe = window.DOMPurify.sanitize(html, {
            ADD_TAGS: ['input'],
            ADD_ATTR: ['type', 'disabled', 'checked'],
        });

        // 後處理：(1) 過濾 input 只留 disabled checkbox  (2) hljs 套語法高亮
        const tmp = document.createElement('div');
        tmp.innerHTML = safe;

        tmp.querySelectorAll('input').forEach(el => {
            if (el.getAttribute('type') !== 'checkbox') {
                el.remove();
            } else {
                el.setAttribute('disabled', '');  // 強制 disabled，使用者點不到
            }
        });

        if (window.hljs) {
            tmp.querySelectorAll('pre code').forEach(el => {
                try {
                    window.hljs.highlightElement(el);
                } catch (_) { /* 忽略：可能已 highlighted 或語言未支援 */ }
            });
        }

        return tmp.innerHTML;
    }

    // ===== ASK marker：Clawd 在回覆嵌 [ASK|題目|選項...]、前端 render 成按鈕 + 其他自輸入 =====
    function _parseAskMarkers(content) {
        if (!content || typeof content !== 'string') return { asks: [], stripped: content };
        const asks = [];
        const re = /\[ASK\|([^\]]+)\]/g;
        let m;
        while ((m = re.exec(content)) !== null) {
            const parts = m[1].split('|').map(s => s.trim()).filter(s => s.length);
            if (parts.length >= 2) {
                asks.push({ question: parts[0], options: parts.slice(1) });
            }
        }
        const stripped = asks.length ? content.replace(re, '').trim() : content;
        return { asks, stripped };
    }

    function _pickClaudeAskAnswer(wrapEl, answer) {
        if (!wrapEl || wrapEl.classList.contains('picked')) return;
        wrapEl.classList.add('picked');
        wrapEl.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
        const picked = document.createElement('div');
        picked.className = 'claude-ask-picked';
        picked.textContent = `✓ 已選：${answer}`;
        wrapEl.appendChild(picked);
        if (window.VoidClaudeRoom && typeof window.VoidClaudeRoom.sendMessage === 'function') {
            window.VoidClaudeRoom.sendMessage(answer);
        }
    }

    function _buildClaudeAskUI(ask) {
        const wrap = document.createElement('div');
        wrap.className = 'claude-ask';

        const qEl = document.createElement('div');
        qEl.className = 'claude-ask-q';
        qEl.textContent = ask.question;
        wrap.appendChild(qEl);

        const optsEl = document.createElement('div');
        optsEl.className = 'claude-ask-opts';
        ask.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'claude-ask-opt';
            btn.type = 'button';
            btn.textContent = opt;
            btn.addEventListener('click', () => _pickClaudeAskAnswer(wrap, opt));
            optsEl.appendChild(btn);
        });
        wrap.appendChild(optsEl);

        const otherRow = document.createElement('div');
        otherRow.className = 'claude-ask-other-row';
        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'claude-ask-other-input';
        inputEl.placeholder = '或自己填...';
        const submitBtn = document.createElement('button');
        submitBtn.className = 'claude-ask-other-submit';
        submitBtn.type = 'button';
        submitBtn.textContent = '送出';
        const submitOther = () => {
            const txt = inputEl.value.trim();
            if (!txt) return;
            _pickClaudeAskAnswer(wrap, txt);
        };
        submitBtn.addEventListener('click', submitOther);
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                submitOther();
            }
        });
        otherRow.appendChild(inputEl);
        otherRow.appendChild(submitBtn);
        wrap.appendChild(otherRow);

        return wrap;
    }

    // 點生成圖縮圖 → 全螢幕放大（點任意處關閉）。重用群聊的 .cg-img-overlay 樣式。
    function _openClaudeImageOverlay(src) {
        const ov = document.createElement('div');
        ov.className = 'cg-img-overlay';
        const im = document.createElement('img');
        im.src = src;
        ov.appendChild(im);
        ov.addEventListener('click', () => { if (ov.parentNode) ov.parentNode.removeChild(ov); });
        document.body.appendChild(ov);
    }

    function _renderClaudeBubble(role, content, opts = {}) {
        const stream = _el('claude-chat-stream');
        if (!stream) return;
        const isUser = role === 'user';
        const wrap = document.createElement('div');
        wrap.className = 'claude-bubble-wrap ' + (isUser ? 'from-user' : 'from-claude');

        // ASK marker：只在 Clawd 最終回覆 render（不在 streaming 中、不在 user 訊息）
        let askMatches = [];
        if (!isUser && !opts.suppressMarkdown) {
            const r = _parseAskMarkers(content);
            askMatches = r.asks;
            content = r.stripped;
        }

        if (!isUser && opts.thinking) {
            const t = document.createElement('div');
            t.className = 'claude-thinking';
            const header = document.createElement('div');
            header.className = 'claude-thinking-header';
            header.innerHTML = '<span class="claude-thinking-toggle">▶</span><span>💭 thinking...</span>';
            const body = document.createElement('div');
            body.className = 'claude-thinking-content';
            body.textContent = opts.thinking;
            t.appendChild(header); t.appendChild(body);
            t.addEventListener('click', () => t.classList.toggle('open'));
            wrap.appendChild(t);
        }

        // tool summary 摺疊塊（仿 Claude.ai 桌面端「Edited 2 files, ran a command」）
        if (!isUser && Array.isArray(opts.toolsUsed) && opts.toolsUsed.length) {
            const ts = document.createElement('div');
            ts.className = 'claude-tool-summary';

            const tsHeader = document.createElement('div');
            tsHeader.className = 'claude-tool-summary-header';
            const summary = _summarizeToolsUsed(opts.toolsUsed);
            tsHeader.innerHTML = `<span class="claude-tool-summary-toggle">▶</span><span>🔧 ${summary}</span>`;

            const tsBody = document.createElement('div');
            tsBody.className = 'claude-tool-summary-body';
            opts.toolsUsed.forEach(tool => {
                const item = document.createElement('div');
                item.className = 'claude-tool-summary-item';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'claude-tool-summary-name';
                nameSpan.textContent = (tool && tool.name) || 'unknown';
                item.appendChild(nameSpan);
                const detail = _toolDetailLine(tool);
                if (detail) {
                    const detailSpan = document.createElement('span');
                    detailSpan.className = 'claude-tool-summary-detail';
                    detailSpan.textContent = detail;
                    item.appendChild(document.createTextNode(' '));
                    item.appendChild(detailSpan);
                }
                tsBody.appendChild(item);
            });

            ts.appendChild(tsHeader);
            ts.appendChild(tsBody);
            ts.addEventListener('click', () => ts.classList.toggle('open'));
            wrap.appendChild(ts);
        }

        const bubble = document.createElement('div');
        bubble.className = 'claude-bubble ' + (isUser ? 'from-user' : 'from-claude');
        if (isUser || opts.suppressMarkdown) {
            // User 訊息 / streaming 中：raw text 顯示（streaming 期間每 chunk re-render
            // 一次 markdown 太貴，stream 結束最後一次 render 才開 markdown）
            bubble.textContent = content;
        } else {
            // Claude 回覆：解析 markdown 後 sanitize 再插入
            const safeHtml = _claudeMarkdownToSafeHtml(content);
            if (safeHtml !== null) {
                bubble.innerHTML = safeHtml;
                bubble.classList.add('claude-bubble-md');
            } else {
                bubble.textContent = content;
            }
        }

        // 附件：圖片 → 內嵌縮圖（點放大）；非圖 → chip
        if (Array.isArray(opts.attachments) && opts.attachments.length) {
            const attachBox = document.createElement('div');
            attachBox.className = 'claude-bubble-attachments';
            opts.attachments.forEach(a => {
                if (a && a.thumb && a.mime && a.mime.indexOf('image/') === 0) {
                    const im = document.createElement('img');
                    im.className = 'cg-attach-img';
                    im.src = a.thumb;
                    im.addEventListener('click', () => _openClaudeImageOverlay(a.thumb));
                    attachBox.appendChild(im);
                } else {
                    const item = document.createElement('span');
                    item.className = 'claude-bubble-attach-item';
                    item.textContent = `${_attachIcon(a.mime, a.filename)} ${a.filename || 'file'}`;
                    attachBox.appendChild(item);
                }
            });
            bubble.appendChild(attachBox);
        }

        wrap.appendChild(bubble);

        // ASK marker UI：附在氣泡下方、用量 footer 上方
        askMatches.forEach(ask => {
            wrap.appendChild(_buildClaudeAskUI(ask));
        });

        // 用量 footer：只在 Claude 氣泡 + 有 usage 時顯示
        if (!isUser && opts.usage && (opts.usage.input_tokens || opts.usage.output_tokens)) {
            const u = opts.usage;
            const cost = (typeof u.total_cost_usd === 'number' && u.total_cost_usd > 0)
                ? `$${u.total_cost_usd.toFixed(4)}` : '$0.0000';
            const cacheNote = (u.cache_read_input_tokens > 0)
                ? ` · cache ${u.cache_read_input_tokens}r` : '';
            // 顯示「實際 model」:讓 Rae 確認跑的是誰(picker 選的跟實際可能不一致,
            // 例如 deepseek 空字串會 fallback CodeWhale 預設、Claude 訂閱可能 route 到不同版本)
            const modelStr = u.model ? ` · ${u.model}` : '';
            const footer = document.createElement('div');
            footer.className = 'claude-bubble-usage';
            footer.title = `model: ${u.model || '?'}\ninput: ${u.input_tokens || 0}\noutput: ${u.output_tokens || 0}\ncache write: ${u.cache_creation_input_tokens || 0}\ncache read: ${u.cache_read_input_tokens || 0}\ncost: ${cost}`;
            footer.textContent = `💰 ${cost} · ${u.input_tokens || 0}↑ ${u.output_tokens || 0}↓${cacheNote}${modelStr}`;
            wrap.appendChild(footer);
        }

        stream.appendChild(wrap);
        _scrollClaudeChatToBottom();
    }

    /** 進入浮窗時用：把 _roomHistory 全部 render 成氣泡（含附件 + thinking + usage） */
    function _hydrateClaudeStream() {
        const stream = _el('claude-chat-stream');
        if (!stream) return;
        stream.innerHTML = '';
        (_activeHistory() || []).forEach(m => {
            _renderClaudeBubble(
                m.role === 'user' ? 'user' : 'assistant',
                m.content,
                {
                    attachments: m.attachments || [],
                    thinking: m.thinking || null,
                    usage: m.usage || null,
                    toolsUsed: (Array.isArray(m.tools_used) && m.tools_used.length) ? m.tools_used : null,
                }
            );
        });
        _scrollClaudeChatToBottom();
    }

    // ===== 附件 chip 預覽列（輸入框上方）=====
    function _renderClaudeAttachChips() {
        const row = _el('claude-attach-chips');
        if (!row) return;
        row.innerHTML = '';
        _pendingClaudeAttachments.forEach((a, idx) => {
            const chip = document.createElement('div');
            chip.className = 'claude-attach-chip';
            chip.title = a.path || a.filename;
            const icon = document.createElement('span');
            icon.textContent = _attachIcon(a.mime, a.filename);
            const name = document.createElement('span');
            name.className = 'claude-attach-chip-name';
            name.textContent = a.filename || 'file';
            const x = document.createElement('span');
            x.className = 'claude-attach-chip-x';
            x.textContent = '×';
            x.title = '移除';
            x.addEventListener('click', (e) => {
                e.stopPropagation();
                _pendingClaudeAttachments.splice(idx, 1);
                _renderClaudeAttachChips();
            });
            chip.appendChild(icon); chip.appendChild(name); chip.appendChild(x);
            row.appendChild(chip);
        });
    }

    /** 觸發隱藏的 file input、上傳到 cc-bridge、push 進 _pendingClaudeAttachments */
    async function _handleClaudeFilePick(fileList) {
        if (!fileList || !fileList.length) return;
        if (!window.ClaudeTerminal || typeof window.ClaudeTerminal.uploadFiles !== 'function') {
            _renderClaudeBubble('assistant', '⚠️ ClaudeTerminal 未載入，無法上傳。');
            return;
        }
        // 顯示「上傳中」chip
        const placeholderIdx = _pendingClaudeAttachments.length;
        Array.from(fileList).forEach(f => {
            _pendingClaudeAttachments.push({
                _uploading: true,
                filename: f.name,
                mime: f.type || '',
                size: f.size,
            });
        });
        _renderClaudeAttachChips();

        try {
            const result = await window.ClaudeTerminal.uploadFiles(fileList);
            // 用 server 回傳的真實路徑替換 placeholder
            (result.files || []).forEach((meta, i) => {
                _pendingClaudeAttachments[placeholderIdx + i] = {
                    path: meta.path,
                    filename: meta.filename,
                    mime: meta.mime,
                    size: meta.size,
                };
            });
        } catch (e) {
            // 上傳失敗：拔掉 placeholder
            _pendingClaudeAttachments.splice(placeholderIdx, fileList.length);
            const raw = (e && e.message) || '未知錯誤';
            _renderClaudeBubble('assistant', '⚠️ 上傳失敗：' + raw);
        }
        _renderClaudeAttachChips();
    }

    // 把 Claude 回覆 append 成一條氣泡 + 立繪 happy → living
    function _renderClaudeReply(text) {
        _renderClaudeBubble('assistant', text);
        _setClaudePortraitState('happy');
        setTimeout(() => _setClaudePortraitState('living'), 600);
    }

    // 發送 Claude 房間訊息（走 cc-bridge / OpenAI 兼容；持久化由 ClaudeTerminal 處理）
    async function _sendClaudeMessage(text) {
        if (!window.ClaudeTerminal) {
            _renderClaudeReply('⚠️ ClaudeTerminal 模組未載入。');
            return;
        }
        if (!window.ClaudeTerminal.isConfigured()) {
            _renderClaudeReply('⚠️ 還沒設定 cc-bridge URL / Key。\n\n去「寫作 → API 設置 → 🦀 Claude 的房間」填好。');
            return;
        }

        // 快照當前附件（only paths from server，不送 _uploading placeholder），送出後清空
        const attachmentsSnapshot = _pendingClaudeAttachments
            .filter(a => a && a.path)
            .map(a => ({ path: a.path, filename: a.filename, mime: a.mime, size: a.size }));
        _pendingClaudeAttachments = [];
        _renderClaudeAttachChips();

        // 即時把 user message（含附件）push 進 history + 立刻 render 成右側橘氣泡
        _activeHistory().push({
            role: 'user', content: text, ts: Date.now(),
            attachments: attachmentsSnapshot.length ? attachmentsSnapshot : undefined,
        });
        _renderClaudeBubble('user', text, { attachments: attachmentsSnapshot });

        // 立繪切 thinking（effort=high/xhigh/max 用 ultrathink）
        const _cfgForState = window.ClaudeTerminal.getConfig();
        const _eff = ((_cfgForState && _cfgForState.inlineEffort) || '').toLowerCase();
        const _thinkState = (_eff === 'high' || _eff === 'xhigh' || _eff === 'max') ? 'ultrathink' : 'thinking';
        _setClaudePortraitState(_thinkState);

        // 送出鈕換 ⏹ 停止：click 觸發 abort + 呼叫 cc-bridge /v1/cancel/{taskId}
        // 訂閱版（CLI）→ /v1/cancel kill 子進程；API 直連版 → abort fetch（server 端目前沒 cancel 機制）
        _claudeAbortCtrl = new AbortController();
        _claudeTaskId    = (window.crypto?.randomUUID && window.crypto.randomUUID()) || ('t-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
        const sendBtn = _el('cw-send-btn');
        if (sendBtn) {
            sendBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
            sendBtn.onclick = async () => {
                // 先 server-side kill（cc-bridge 訂閱版才生效），再 client-side abort fetch
                if (_claudeTaskId) {
                    try { await window.ClaudeTerminal.cancelTask?.(_claudeTaskId); } catch (_) {}
                }
                if (_claudeAbortCtrl) _claudeAbortCtrl.abort();
            };
        }

        // 提到 try 外:finally / catch 也要碰這兩個變數(清 throttle timer + 殘留 stream bubble)
        let streamWrap = null;
        let _rerenderTimer = null;

        try {
            // streaming 漸進式 render：stream 期間每收到 text/tool 事件就 destroy 舊 wrapper
            // 重 render 一個（用 suppressMarkdown 跳過 markdown，避免每 chunk 重 render markdown 閃爍）
            // stream 結束後最終 render 才開 markdown
            const acc = { text: '', tools: [] };
            let _typingSwitched = false;
            const stream = _el('claude-chat-stream');

            // streaming 期間用 incremental update:bubble 只建一次,後續只更新 textContent。
            // 為何不每次 _renderClaudeBubble:那樣是 createElement+appendChild 全新 DOM node,
            //   CSS 進場動畫重播 + layout/paint → 視覺上「一直閃爍」,throttle 多慢都治不了
            //   (因為閃的是動畫重播,不是頻率)。
            // 寫法:
            //   _ensureStreamShell()  → 第一次建 wrap + bubble + (optional) tool placeholder
            //   後續呼叫 → 直接 textContent = acc.text,零重排
            //   stream 結束 → finally 移除 streamWrap,再走 _renderClaudeBubble final(帶 markdown)
            let _streamBubbleEl = null;
            let _streamToolEl = null;
            const _ensureStreamShell = () => {
                if (streamWrap) return;
                streamWrap = document.createElement('div');
                streamWrap.className = 'claude-bubble-wrap from-claude';
                _streamBubbleEl = document.createElement('div');
                _streamBubbleEl.className = 'claude-bubble from-claude';
                streamWrap.appendChild(_streamBubbleEl);
                stream.appendChild(streamWrap);
            };
            const _flushStreamingRender = () => {
                _rerenderTimer = null;
                _ensureStreamShell();
                _streamBubbleEl.textContent = acc.text || '⏳ ...';
                if (acc.tools.length) {
                    if (!_streamToolEl) {
                        _streamToolEl = document.createElement('div');
                        _streamToolEl.className = 'claude-tool-summary streaming-placeholder';
                        streamWrap.insertBefore(_streamToolEl, _streamBubbleEl);
                    }
                    _streamToolEl.textContent = `🔧 使用工具中...(${acc.tools.length})`;
                }
                // 自動黏底:streaming 中持續滾到最新
                if (stream) stream.scrollTop = stream.scrollHeight;
            };
            const rerenderStreaming = () => {
                if (_rerenderTimer) return;  // 已排程,等它 fire 就好
                _rerenderTimer = setTimeout(_flushStreamingRender, 60);
            };

            const onProgress = (ev) => {
                if (!ev) return;
                if (ev.type === 'text') {
                    // 第一個文字 delta 抵達：thinking/ultrathink → typing
                    if (!_typingSwitched) {
                        _typingSwitched = true;
                        _setClaudePortraitState('typing');
                    }
                    acc.text = ev.accumulated || (acc.text + (ev.delta || ''));
                    rerenderStreaming();
                } else if (ev.type === 'tool_use' && ev.tool) {
                    acc.tools.push(ev.tool);
                    rerenderStreaming();
                }
            };

            const result = await window.ClaudeTerminal.send(text, attachmentsSnapshot, onProgress, {
                taskId: _claudeTaskId,
                signal: _claudeAbortCtrl?.signal,
            });
            const reply = result.reply;
            const thinking = result.thinking || null;
            const usage = result.usage || null;
            const toolsUsed = (Array.isArray(result.toolsUsed) && result.toolsUsed.length) ? result.toolsUsed : null;
            const images = (Array.isArray(result.images) && result.images.length) ? result.images : null;

            // 累計到額度面板（💰 app）
            if (usage && window.OS_SPEND_PANEL && typeof window.OS_SPEND_PANEL.record === 'function') {
                try { window.OS_SPEND_PANEL.record(usage); } catch (_) {}
            }

            // 先取消還在排程中的 throttled rerender,避免 final render 後又冒一個多餘 stream bubble
            if (_rerenderTimer) {
                clearTimeout(_rerenderTimer);
                _rerenderTimer = null;
            }

            // 移除 stream 期間最後一個 placeholder wrap，下面做最終 render（含 markdown）
            if (streamWrap && streamWrap.parentNode) {
                streamWrap.parentNode.removeChild(streamWrap);
                streamWrap = null;
            }

            // assistant reply 寫進 history（含 thinking / usage / tools_used 一起存）
            const assistantRecord = { role: 'assistant', content: reply, ts: Date.now() };
            if (thinking) assistantRecord.thinking = thinking;
            if (usage) assistantRecord.usage = usage;
            if (toolsUsed) assistantRecord.tools_used = toolsUsed;
            if (images) assistantRecord.attachments = images;
            _activeHistory().push(assistantRecord);

            // session_id resume 失敗：cc-bridge 退回新 session、Claude 不記得前文
            if (result.sessionFallback) {
                _renderClaudeBubble('assistant',
                    '⚠️ 之前的 session 失效了（cc-bridge 重啟過 / log 被清 / 太久沒聊）。\n\n' +
                    '我從零開始記新對話了。如果想讓我知道之前聊過什麼，把重點再講一次給我聽吧。\n\n' +
                    '---\n\n' + reply,
                    { thinking, usage, toolsUsed, attachments: images }
                );
                _setClaudePortraitState('happy');
                setTimeout(() => _setClaudePortraitState('living'), 600);
            } else {
                _renderClaudeBubble('assistant', reply, { thinking, usage, toolsUsed, attachments: images });
                _setClaudePortraitState('happy');
                setTimeout(() => _setClaudePortraitState('living'), 600);
            }
            _scheduleSave();
            // 新 conv 的標題會在 saveHistory 自動從第一條 user msg 抓 → 更新左上角小卡
            if (typeof window._VoidClaudeUpdateChip === 'function') {
                try { window._VoidClaudeUpdateChip(); } catch (_) {}
            }
        } catch (e) {
            const isAbort = e?.name === 'AbortError' || /abort/i.test(e?.message || '');
            // 失敗：回滾剛 push 的 user message（無論主動停止 / 真錯誤都不該留半條對話）
            if (_activeHistory().length > 0 && _activeHistory()[_activeHistory().length - 1].role === 'user') {
                _activeHistory().pop();
            }

            if (isAbort) {
                // 主動停止：靜默顯示已停止氣泡，不噴錯誤
                _setClaudePortraitState('living');
                _renderClaudeBubble('assistant', '⏹ 已停止');
            } else {
                _setClaudePortraitState('error');
                const raw = (e && e.message) || '未知錯誤';
                const [code, ...rest] = raw.split(':');
                const detail = rest.join(':') || raw;
                let userMsg;
                switch (code) {
                    case 'NOT_CONFIGURED': userMsg = '⚠️ 還沒設定 cc-bridge URL / Key。\n\n去「寫作 → API 設置 → 🦀 Claude 的房間」填好。'; break;
                    case 'AUTH':           userMsg = '🔒 ' + detail; break;
                    case 'NETWORK':        userMsg = '🌐 ' + detail; break;
                    case 'SERVER':         userMsg = '💥 ' + detail; break;
                    case 'EMPTY':          userMsg = '🤔 ' + detail; break;
                    case 'API':            userMsg = '⚠️ API 錯誤：' + detail; break;
                    case 'BAD_JSON':       userMsg = '⚠️ ' + detail; break;
                    case 'SETTINGS_MISSING': userMsg = '⚠️ ' + detail; break;
                    default:               userMsg = '⚠️ ' + raw;
                }
                _renderClaudeBubble('assistant', userMsg);
                setTimeout(() => _setClaudePortraitState('living'), 1500);
            }
        } finally {
            // 兜底:無論 success/error/abort 都清掉 throttle timer 跟殘留 stream bubble
            if (_rerenderTimer) {
                clearTimeout(_rerenderTimer);
                _rerenderTimer = null;
            }
            if (streamWrap && streamWrap.parentNode) {
                streamWrap.parentNode.removeChild(streamWrap);
                streamWrap = null;
            }

            // 還原送出鈕：icon 回紙飛機、onclick 回浮窗的 submitInput
            _claudeAbortCtrl = null;
            _claudeTaskId    = null;
            const sb = _el('cw-send-btn');
            if (sb) {
                sb.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
                const fn = window.ChatWindow && window.ChatWindow.submitInput;
                if (typeof fn === 'function') sb.onclick = fn;
            }
        }
    }

    VoidClaudeRoom.setHistory        = function (arr) { _roomHistory = Array.isArray(arr) ? arr : []; };
    VoidClaudeRoom.getHistory        = _activeHistory;
    VoidClaudeRoom.applyRoomUi       = _applyClaudeRoomUi;
    VoidClaudeRoom.updatePortalBtn   = _updateClaudePortalBtn;
    VoidClaudeRoom.updatePickerLabel = _updateClaudePickerLabel;
    VoidClaudeRoom.openPicker        = _openClaudePickerPopup;
    VoidClaudeRoom.closePicker       = _closeClaudePickerPopup;
    VoidClaudeRoom.setPortraitState  = _setClaudePortraitState;
    VoidClaudeRoom.renderBubble      = _renderClaudeBubble;
    VoidClaudeRoom.renderReply       = _renderClaudeReply;
    VoidClaudeRoom.hydrateStream     = _hydrateClaudeStream;
    VoidClaudeRoom.handleFilePick    = _handleClaudeFilePick;
    VoidClaudeRoom.sendMessage       = _sendClaudeMessage;
    VoidClaudeRoom.markdownToSafeHtml = _claudeMarkdownToSafeHtml;

    console.log('✅ VoidClaudeRoom（Claude 房間 UI）模組就緒');
})(window.VoidClaudeRoom = window.VoidClaudeRoom || {});
