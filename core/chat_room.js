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
    // 正在回的那幾輪：住戶 id → { ctrl（AbortController）, taskId（給 /v1/cancel/{taskId}）, provider }。
    //   以前全房間只有一份：阿洛還在跑時切去丹的房間，丹那顆送出鈕也是 ⏹、按下去停的是阿洛（待修 #288/#289）
    const _inflight = {};

    // 送出鈕：現在開著的這位正在回就是 ⏹（按了停他那一輪），不然是紙飛機。切房間（applyRoomUi）時照新那間重畫
    function _paintSendBtn() {
        const sb = _el('cw-send-btn');
        if (!sb) return;
        const CT = window.ClaudeTerminal;
        const cur = (CT && _provider() !== 'group' && typeof CT.getActiveResidentId === 'function') ? _inflight[CT.getActiveResidentId()] : null;
        // 輸入框空著時這一格平常讓給魔杖；他在回就換回這顆（停止）。CSS 看 .cw-busy
        const row = sb.closest('.cw-input-row');
        if (row) row.classList.toggle('cw-busy', !!cur);
        if (cur) {
            sb.innerHTML = '<i class="fa-solid fa-stop"></i>';
            sb.onclick = async () => {
                // 先 server-side kill（cc-bridge 訂閱版才生效），再 client-side abort fetch；小機不經橋：直接停，不先等橋
                if (cur.taskId && cur.provider !== 'xiaoji') {
                    try { await CT.cancelTask?.(cur.taskId); } catch (_) {}
                }
                cur.ctrl.abort();
            };
        } else {
            sb.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
            const fn = window.ChatWindow && window.ChatWindow.submitInput;
            if (typeof fn === 'function') sb.onclick = fn;
        }
    }

    // 套用浮窗聊天室 UI（picker 文字 / 立繪 / 輸入框 placeholder）
    function _applyClaudeRoomUi() {
        _setClaudePortraitState('living');
        _updateClaudePickerLabel();
        const inputField = _el('cw-input');
        if (!inputField) return;
        // 名字跟著住戶走（房間標題本來就是「🦀 老丹 的房間」，這裡不該還寫死 Claude）
        const prov = _provider();
        const CT = window.ClaudeTerminal;
        let who = '';
        if (CT && typeof CT.getActiveResident === 'function') {
            const r = CT.getActiveResident(prov);
            if (r && r.name) who = r.name;
        }
        if (!who) who = prov === 'codex' ? 'Codex' : (prov === 'deepseek' ? '蘇景明' : 'Claude');
        inputField.placeholder = '對 ' + who + ' 說點什麼...';
        _paintSendBtn();
    }

    // 浮窗化後大廳傳送門按鈕為固定文字（🦀 Claude / 🔷 Codex），不再反映房間狀態
    function _updateClaudePortalBtn() {}

    // Claude 回覆切多頁（套奧瑞亞 VN 翻頁體驗，避免長文字爆出對話框）
    // 優先度：段落空行 > 單換行 > 句末標點 > 逗號 > 字數硬切
    // ===== Claude inline picker（聊天室上方橫條：model / effort / endpoint） =====

    // 照 Claude 官方 app 的選單（2026-09-28 她貼的）：前四個是現行，後面是「More models」裡的舊版。
    // 舊的都留著——既有存檔或鎖了模型的住戶（天天鎖 4.6）選的是它們，拿掉的話 label 會退成裸 id。
    const CLAUDE_MODELS = [
        { id: 'claude-opus-5-5',           label: 'Opus 5.5'      },
        { id: 'claude-fable-5-1',          label: 'Fable 5.1 ⭐'  },
        { id: 'claude-sonnet-5',           label: 'Sonnet 5'      },
        { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5'     },
        { id: 'claude-opus-5',             label: 'Opus 5(舊)'    },
        { id: 'claude-fable-5',            label: 'Fable 5(舊)'   },
        { id: 'claude-opus-4-8',           label: 'Opus 4.8(舊)'  },
        { id: 'claude-opus-4-7',           label: 'Opus 4.7(舊)'  },
        { id: 'claude-opus-4-6',           label: 'Opus 4.6(舊)'  },
        { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6(舊)' },
    ];
    // Codex CLI 走 ~/.codex/config.toml 決定預設主模型,也接受 --model 字串 hint。
    // 清單照 ~/.codex/models_cache.json 列出來的（2026-09-28：6 系列、5.6 系列、5.5），跟 Codex App 的選單一樣。
    // 如果跑時報 "model not found" → 回 picker 選「預設」交給 config.toml；命令列 codex 太舊也會認不得新模型。
    const CODEX_MODELS = [
        { id: '',               label: '預設(走 ~/.codex/config.toml)⭐' },
        { id: 'gpt-6-astra',    label: 'GPT-6 Astra' },
        { id: 'gpt-6-sol',      label: 'GPT-6 Sol' },
        { id: 'gpt-6-luna',     label: 'GPT-6 Luna' },
        { id: 'gpt-5.6-sol',    label: 'GPT-5.6 Sol' },
        { id: 'gpt-5.6-terra',  label: 'GPT-5.6 Terra' },
        { id: 'gpt-5.6-luna',   label: 'GPT-5.6 Luna' },
        { id: 'gpt-5.5',        label: 'GPT-5.5(10/14 退役)', until: '2026-10-14' },   // 到那天起選單不列；橋那邊同一天起改吃 config.toml 那顆
    ];
    // 帶 until 的：那天（含）以後不列
    function _stillOn(m) {
        if (!m.until) return true;
        const d = new Date(), p = n => (n < 10 ? '0' : '') + n;
        return (d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())) < m.until;
    }
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
        if (prov === 'codex')    return CODEX_MODELS.filter(_stillOn);
        if (prov === 'deepseek') return DEEPSEEK_MODELS;
        return CLAUDE_MODELS;
    }
    // helper:從 cfg 取「該 provider 目前選的 model id」
    //   cfg.providerModels = { claude: '...', codex: '...', deepseek: '...' }
    //   claude 兼容舊欄位 cfg.inlineModel(歷史遺產,純 Claude 時代用的)
    function _getProviderModel(cfg, prov) {
        const pm = (cfg && cfg.providerModels) || {};
        if (prov === 'claude') return pm.claude || cfg.inlineModel || cfg.model || 'claude-fable-5-1';
        return pm[prov] || '';  // codex/deepseek 預設空 = 不指定、讓 CLI 自己用預設
    }
    // helper:設定「該 provider 的 model id」回寫進 cfg
    function _setProviderModel(cfg, prov, modelId) {
        cfg.providerModels = cfg.providerModels || {};
        cfg.providerModels[prov] = modelId;
        if (prov === 'claude') cfg.inlineModel = modelId;  // 同步舊欄位,避免別處取值落差
    }
    // helper:她在設置裡幫模型取的名字(cfg.modelNames = {modelId: 暱稱}),沒取就 null
    function _modelNick(modelId) {
        const cfg = _getClaudeRoomCfg();
        const n = cfg && cfg.modelNames && cfg.modelNames[modelId];
        return (n && String(n).trim()) || null;
    }
    // helper:把 model id 轉成顯示用 label(暱稱優先,找不到就回 id)
    function _modelLabel(modelId, prov) {
        const nick = _modelNick(modelId);
        if (nick) return nick;
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

    // helper:當前住戶鎖定的模型。分身進門就綁死一顆,丹沒鎖(回空字串)照舊自由選
    function _lockedModel() {
        const CT = window.ClaudeTerminal;
        if (!CT || typeof CT.getActiveResident !== 'function') return '';
        const r = CT.getActiveResident(_provider());
        return (r && r.modelId) ? r.modelId : '';
    }

    // helper:當前住戶自己在房裡挑的模型。沒鎖模型的 Claude 住戶（丹、克語）各記各的（cfg.residentModels），
    //   以前共用 providerModels.claude 那一格，她選一個另一個跟著換。沒挑過回空字串 → 吃共用預設。
    function _residentPick() {
        const CT = window.ClaudeTerminal;
        if (_provider() !== 'claude' || !CT || typeof CT.getActiveResident !== 'function') return '';
        const r = CT.getActiveResident('claude');
        const cfg = _getClaudeRoomCfg();
        return (r && !r.modelId && cfg && cfg.residentModels && cfg.residentModels[r.id]) || '';
    }

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
        const nick = _modelNick(modelId);
        if (nick) return nick;
        const m = CLAUDE_MODELS.find(x => x.id === modelId);
        return m ? m.label.replace(' ⭐', '') : (modelId || 'Fable 5.1');
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
            m.textContent = emoji + _modelLabel(_lockedModel() || _residentPick() || _getProviderModel(cfg, prov), prov);
        }
        if (e && hasEffort) e.textContent = _shortEffortLabel(cfg.inlineEffort);
        // 🌐 這位住戶講外語時，模型名字後面帶語言，一眼看得出這間現在不是講中文
        if (m) {
            const CT = window.ClaudeTerminal;
            const r = (CT && typeof CT.getActiveResident === 'function') ? CT.getActiveResident(prov) : null;
            const k = r && cfg.residentLang ? cfg.residentLang[r.id] : '';
            const F = window.OS_VN_FOREIGN;
            const ln = k ? ((F && F.langName && F.langName(k)) || k) : '';
            if (ln) m.textContent += ' · ' + ln;
        }
        if (ep) ep.textContent = _shortEndpointLabel(cfg);
        // backend 選單一律顯示（Anthropic 直連分支已於 2026-05-24 移除）
        if (bk) bk.style.display = '';
    }

    /** popup 內容生成 + 展開 */
    function _openClaudePickerPopup() {
        const cfg = _getClaudeRoomCfg();
        if (!cfg) { console.warn('[claude-room] picker 打不開:OS_SETTINGS.getClaudeRoomConfig 不在(shim 被整份覆蓋或尚未載入)'); return; }
        const popup = _el('claude-picker-popup');
        if (!popup) { console.warn('[claude-room] picker 打不開:浮窗裡找不到 #claude-picker-popup(chat_window 版本不合,清瀏覽器快取)'); return; }
        const prov        = _provider();
        // 取過名的模型在清單裡顯示暱稱(取名在 設置 → 模型取名)
        const models      = _modelsForProvider(prov).map(m => {
            const nick = _modelNick(m.id);
            return nick ? { id: m.id, label: nick } : m;
        });
        const curModel    = _residentPick() || _getProviderModel(cfg, prov);
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
        // 分身的模型在宿舍門卡上就決定了,房裡只顯示不給改(丹沒鎖,照舊整排任選)
        const showEffort = (prov === 'claude');
        const locked = _lockedModel();
        const modelBlock = locked
            ? `<div class="claude-picker-section-title">${modelSectionTitle}</div>
               <div class="claude-picker-fixed">${_modelLabel(locked, prov)}
                   <span class="claude-picker-fixed-note">這位住戶固定用這顆</span></div>`
            : sectionHtml(modelSectionTitle, models, curModel, 'model');
        // 🌐 這位住戶講什麼語言（一位一個；中文＝照常）。每一輪送話時附一句，見 claude_terminal.js _langNote
        const _CTL = window.ClaudeTerminal;
        const _lr = (_CTL && typeof _CTL.getActiveResident === 'function') ? _CTL.getActiveResident(prov) : null;
        const _F = window.OS_VN_FOREIGN;
        const langList = [{ id: 'zh', label: '中文' }].concat(((_F && _F.LANGS) || [['en', '英文'], ['ja', '日文'], ['ko', '韓文']]).map(([k, v]) => ({ id: k, label: v })));
        const curLang = (_lr && cfg.residentLang && cfg.residentLang[_lr.id]) || 'zh';
        popup.innerHTML = `
            ${sectionHtml('連線預設',  presetList, curPresetId, 'preset')}
            ${modelBlock}
            ${showEffort ? sectionHtml('Thinking 思考', CLAUDE_EFFORTS, curEffort || 'medium', 'effort') : ''}
            ${_lr ? sectionHtml('講什麼語言', langList, curLang, 'lang') : ''}
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
            // Claude 住戶各記各的：在誰的房間選就只換誰（沒鎖模型的才走到這裡，鎖了的整排不給選）
            const CT = window.ClaudeTerminal;
            const r = (prov === 'claude' && CT && typeof CT.getActiveResident === 'function') ? CT.getActiveResident('claude') : null;
            if (r && !r.modelId) {
                c.residentModels = Object.assign({}, c.residentModels || {});
                c.residentModels[r.id] = el.dataset.model;
            } else {
                _setProviderModel(c, prov, el.dataset.model);
            }
            _saveClaudeRoomCfg(c);
            _updateClaudePickerLabel(); _openClaudePickerPopup();
        });
        popup.querySelectorAll('[data-effort]').forEach(el => el.onclick = () => {
            const c = _getClaudeRoomCfg(); c.inlineEffort = el.dataset.effort; _saveClaudeRoomCfg(c);
            _updateClaudePickerLabel(); _openClaudePickerPopup();
        });
        popup.querySelectorAll('[data-lang]').forEach(el => el.onclick = () => {
            if (!_lr) return;
            const c = _getClaudeRoomCfg();
            c.residentLang = Object.assign({}, c.residentLang || {});
            if (el.dataset.lang === 'zh') delete c.residentLang[_lr.id]; else c.residentLang[_lr.id] = el.dataset.lang;
            _saveClaudeRoomCfg(c);
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
        // 程式畫的立繪（打扮過的小螃蟹、阿洛的洛德）也照這個狀態換動作；沒接手時只記著
        if (window.ClawdPortrait) window.ClawdPortrait.setState(state);
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
    /** 「🔧 跑了 N 個命令」那顆可折疊的塊。沒工具回 null。
     *  原本寫死在 _renderClaudeBubble 裡，抽出來是為了讓群聊也用得到同一顆
     *  —— 群聊的 sendGroup 一直有回 toolsUsed，只是從來沒畫出來，
     *  她的話是「群聊看不太到他們做了啥工具」。 */
    function _buildToolSummary(toolsUsed) {
        if (!Array.isArray(toolsUsed) || !toolsUsed.length) return null;
        const ts = document.createElement('div');
        ts.className = 'claude-tool-summary';

        const tsHeader = document.createElement('div');
        tsHeader.className = 'claude-tool-summary-header';
        const summary = _summarizeToolsUsed(toolsUsed);
        tsHeader.innerHTML = `<span class="claude-tool-summary-toggle">▶</span><span>🔧 ${summary}</span>`;

        const tsBody = document.createElement('div');
        tsBody.className = 'claude-tool-summary-body';
        toolsUsed.forEach(tool => {
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
        return ts;
    }

    /** 串流當下要顯示的那句人話。「使用工具中...(3)」是機器在講話，
     *  而她要的是知道「他現在在幹嘛」。先看工具名，Bash 有中文說明就照念，
     *  沒有才往指令內容猜。 */
    function _toolDoingLabel(tool) {
        if (tool && tool.xj) return '正在' + (tool.name || '動手') + '…';   // 小機：工具自己的中文名（看有哪些主題、做 VN 組件…）
        const name = String((tool && tool.name) || '');
        const cmd  = String((tool && tool.input && tool.input.command) || '').toLowerCase();
        if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) return '正在改檔案…';
        if (/^(Read|NotebookRead)$/.test(name))                 return '正在讀檔…';
        if (/^(Grep|Glob)$/.test(name))                         return '正在找東西…';
        if (/^(WebFetch|WebSearch)$/.test(name))                return '正在上網查…';
        // 他自己寫的中文說明比我們猜的準，Bash 有 description 就照著念。
        const desc = String((tool && tool.input && tool.input.description) || '').trim();
        if (name === 'Bash' && desc) return (desc.length > 24 ? desc.slice(0, 24) + '…' : desc + '…');
        if (/image[-_ ]?gen|imagegen|generate[-_ ]?image/.test(cmd)) return '正在畫圖…';
        if (/curl|wget|fetch|http/.test(cmd))                   return '正在上網查…';
        if (/\bgit\b/.test(cmd))                               return '正在翻程式碼…';
        if (/\b(cat|type|head|tail|less)\b/.test(cmd))          return '正在讀檔…';
        if (/\b(ls|dir|find|grep|rg)\b/.test(cmd))              return '正在找東西…';
        if (name === 'Bash')                                     return '正在跑指令…';
        return '正在動手…';
    }

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
        // Bash 的 description 是他自己寫的中文說明（「找工具標籤的函式」），
        // 指令原文她看不懂。有說明就給說明，沒有才退回指令。
        if (name === 'Bash')      return (String(inp.description || '').trim() || inp.command || '').slice(0, 80);
        if (name === 'Grep')      return (inp.pattern || '').slice(0, 60) + (inp.path ? ` in ${inp.path.replace(/^.*[\\/]/, '')}` : '');
        if (name === 'Glob')      return (inp.pattern || '').slice(0, 60);
        if (name === 'WebFetch')  return (inp.url || '').slice(0, 80);
        if (name === 'WebSearch') return (inp.query || '').slice(0, 60);
        return '';
    }

    // 圖片語法 ![說明](https://…)：住戶發表情包用。手機 PWA 沒載 showdown，也要認得它
    const _MD_IMG_ONE = /!\[([^\]\n]*)\]\((https:\/\/[^\s)]+)\)/;
    const _MD_IMG_ALL = new RegExp(_MD_IMG_ONE.source, 'g');

    // 串流中（還沒畫成圖）先藏起來，連同括號還沒收的尾巴，網址不露在泡泡裡
    function _hideMdImages(text) {
        return String(text == null ? '' : text)
            .replace(new RegExp('\\n?' + _MD_IMG_ONE.source, 'g'), '')
            .replace(/\n?!\[[^\]\n]*(\]\([^)\n]*)?$/, '');
    }

    // 沒有 showdown 時的退路：只把圖片語法畫成圖，其餘照純文字（換行轉 <br>）；沒有圖回 null
    function _plainWithImagesHtml(text) {
        const s = String(text == null ? '' : text);
        if (!_MD_IMG_ONE.test(s)) return null;
        const box = document.createElement('div');
        const addText = (t) => t.split('\n').forEach((line, i) => {
            if (i) box.appendChild(document.createElement('br'));
            if (line) box.appendChild(document.createTextNode(line));
        });
        let last = 0, m;
        _MD_IMG_ALL.lastIndex = 0;
        while ((m = _MD_IMG_ALL.exec(s)) !== null) {
            addText(s.slice(last, m.index));
            const im = document.createElement('img');
            im.className = 'claude-md-img';
            im.alt = m[1];
            im.src = m[2];
            box.appendChild(im);
            last = m.index + m[0].length;
        }
        addText(s.slice(last));
        return box.innerHTML;
    }

    // 🫧 一則回覆切成好幾顆泡泡。她：「你們輸出都一段一段的，中間還帶著表情包，好奇怪」
    //   空行分段；單獨一行的表情包圖自己一顆。程式碼區塊裡的空行不算分段；空行隔開的清單項目併回同一顆。
    //   私聊與群聊共用這一支（VoidClaudeRoom.splitReplySegments），規則只有一份。
    function _isStickerSeg(s) { return /^!\[[^\]\n]*\]\(https:\/\/[^\s)]+\)$/.test(String(s == null ? '' : s).trim()); }
    function _splitReplySegments(text) {
        const src = String(text == null ? '' : text).replace(/\r/g, '');
        const segs = [];
        let cur = [], fence = false;
        const isList = (s) => /^\s*([-*+]|\d+[.)])\s+/.test(s || '');
        const flush = () => {
            const s = cur.join('\n').trim();
            cur = [];
            if (!s) return;
            const prev = segs[segs.length - 1];
            if (prev && !_isStickerSeg(prev) && isList(s.split('\n')[0]) && isList(prev.split('\n').pop())) segs[segs.length - 1] = prev + '\n\n' + s;
            else segs.push(s);
        };
        src.split('\n').forEach(ln => {
            if (/^\s*```/.test(ln)) { fence = !fence; cur.push(ln); return; }
            if (fence) { cur.push(ln); return; }
            if (!ln.trim()) { flush(); return; }
            if (_isStickerSeg(ln)) { flush(); segs.push(ln.trim()); return; }
            cur.push(ln);
        });
        flush();
        return segs.length ? segs : [src];
    }

    // 🖼 住戶貼電腦上的圖：[看這張](D:/residents/aluo/mirror/aluo.png) 或 ![](file:///D:/…)。
    //   酒館頁與手機都打不開這種路徑，DOMPurify 也會把 D: 開頭的連結拔掉，所以轉 markdown 之前先換成記號，
    //   轉完再放回一張圖，圖本身經橋拿（ClaudeTerminal.fetchLocalImage）。程式碼裡的是他在講解，不動。
    const _LOCAL_IMG_RE = /(!?)\[([^\]\n]*)\]\(\s*<?((?:file:\/\/\/?)?[A-Za-z]:[\\/][^)\n]*?\.(?:png|jpe?g|webp|gif))>?\s*\)/gi;
    const _LOCAL_TOKEN_RE = /\uE000(\d+)\uE001/g;
    const _localImgJobs = new Map();   // 路徑 → Promise<blob 網址|null>；串流中每次重畫不重拿
    function _pullLocalImages(text) {
        const src = String(text == null ? '' : text);
        const found = [];
        if (!/[A-Za-z]:[\\/]/.test(src)) return { text: src, found };
        const codes = [];
        src.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m, off) => { codes.push([off, off + m.length]); return m; });
        const out = src.replace(_LOCAL_IMG_RE, (m, bang, label, path, off) => {
            if (codes.some(r => off >= r[0] && off < r[1])) return m;
            found.push({ isImg: !!bang, label: label, path: path.replace(/^file:\/\/\/?/i, '').replace(/\\/g, '/') });
            return '\uE000' + (found.length - 1) + '\uE001';
        });
        return { text: out, found };
    }
    function _putLocalImages(html, text, found) {
        const box = document.createElement('div');
        if (html === null || html === undefined) {
            String(text).split('\n').forEach((line, i) => {
                if (i) box.appendChild(document.createElement('br'));
                if (line) box.appendChild(document.createTextNode(line));
            });
        } else {
            box.innerHTML = html;
        }
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) if (/\uE000\d+\uE001/.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
        nodes.forEach(node => {
            const frag = document.createDocumentFragment();
            const after = [];
            let last = 0, m;
            const s = node.nodeValue;
            _LOCAL_TOKEN_RE.lastIndex = 0;
            while ((m = _LOCAL_TOKEN_RE.exec(s)) !== null) {
                frag.appendChild(document.createTextNode(s.slice(last, m.index)));
                const f = found[+m[1]];
                const img = document.createElement('img');
                img.className = 'cg-attach-img claude-local-img';
                img.alt = '';
                img.setAttribute('data-local-path', f.path);
                // ![]：他就是要貼一張圖，放在原處；[字](路徑)：字留在句子裡，圖放在這一段後面
                if (f.isImg) frag.appendChild(img);
                else { frag.appendChild(document.createTextNode(f.label)); after.push(img); }
                last = m.index + m[0].length;
            }
            frag.appendChild(document.createTextNode(s.slice(last)));
            let block = node.parentNode;
            while (block && block !== box && !/^(P|LI|BLOCKQUOTE|H[1-6]|TD)$/.test(block.nodeName)) block = block.parentNode;
            node.parentNode.replaceChild(frag, node);
            after.forEach(img => {
                // 清單項目、表格格子裡的放進那一格的最後（放到外面會變成 ul 底下直接一張圖）
                if (!block || block === box || /^(LI|TD)$/.test(block.nodeName)) (block || box).appendChild(img);
                else block.parentNode.insertBefore(img, block.nextSibling);
            });
        });
        setTimeout(_watchLocalImages, 0);
        return box.innerHTML;
    }
    // 呼叫端拿到的是 html 字串，圖什麼時候掛上畫面不一定（泡泡一顆一顆冒、串流中重畫），
    // 所以有這種圖的時候盯畫面一陣子，掛上去就拿；沒有就不盯。
    let _localObs = null, _localObsTimer = null;
    function _watchLocalImages() {
        _hydrateLocalImages();
        if (!_localObs && typeof MutationObserver === 'function') {
            _localObs = new MutationObserver(_hydrateLocalImages);
            _localObs.observe(document.body, { childList: true, subtree: true });
        }
        clearTimeout(_localObsTimer);
        _localObsTimer = setTimeout(() => { if (_localObs) { _localObs.disconnect(); _localObs = null; } }, 15000);
    }
    function _hydrateLocalImages() {
        const CT = window.ClaudeTerminal;
        if (!CT || typeof CT.fetchLocalImage !== 'function') return;
        document.querySelectorAll('img.claude-local-img[data-local-path]:not([data-local-state])').forEach(img => {
            const path = img.getAttribute('data-local-path');
            img.setAttribute('data-local-state', 'loading');
            let job = _localImgJobs.get(path);
            if (!job) {
                job = CT.fetchLocalImage(path);
                _localImgJobs.set(path, job);
            }
            job.then(url => {
                if (url) {
                    img.src = url;
                    img.setAttribute('data-local-state', 'ok');
                    img.addEventListener('click', () => _openClaudeImageOverlay(url));
                    return;
                }
                _localImgJobs.delete(path);   // 橋晚點開了，下次重畫再拿
                const miss = document.createElement('span');
                miss.className = 'claude-local-miss';
                miss.textContent = '（這張圖在電腦上，橋沒開時看不到）';
                if (img.parentNode) img.parentNode.replaceChild(miss, img);
            });
        });
    }

    let _claudeMdConverter = null;
    function _claudeMarkdownToSafeHtml(text) {
        const loc = _pullLocalImages(text);
        const html = _mdToSafeHtml(loc.text);
        return loc.found.length ? _putLocalImages(html, loc.text, loc.found) : html;
    }
    function _mdToSafeHtml(text) {
        // 手機 PWA 沒載 showdown：借留言板那支小的 markdown（標題、粗體、清單、程式碼、表情包圖都認得），
        // 以前這裡只剩「圖片語法畫成圖、其他全是純文字」，## 跟 ** 原樣印在泡泡裡。
        if (!window.showdown || !window.DOMPurify) {
            const B = window.OS_BOARD;
            if (B && typeof B.miniMd === 'function') return B.miniMd(text);
            return _plainWithImagesHtml(text);
        }
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

        tmp.querySelectorAll('img').forEach(el => el.classList.add('claude-md-img'));

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

    /** 模型那邊擋下或出錯（送出時丟的 REFUSED: / MODEL_ERROR:<種類>）→ 給她看的一句話；其他錯誤 → null */
    function _modelErrorText(err) {
        const m = /^(REFUSED|MODEL_ERROR):(.*)$/.exec(String((err && err.message) || err || ''));
        if (!m) return null;
        if (m[1] === 'REFUSED') return '這則被模型那邊的安全檢查擋下來了，他沒收到。再傳一次通常就會過。';
        switch (m[2]) {
            case 'rate_limit':            return '模型那邊的用量到上限了，這則沒送出，晚一點再傳。';
            case 'billing_error':         return '模型那邊的帳號額度有問題，這則沒送出。';
            case 'authentication_failed': return '模型那邊的登入失效了，這則沒送出。';
            default:                      return '模型那邊出錯了，這則沒送出，再傳一次試試。';
        }
    }

    /** 一行系統提示：置中小字，不是誰講的話，也不存進記錄 */
    function _renderClaudeNotice(text) {
        const stream = _el('claude-chat-stream');
        if (!stream) return;
        const d = document.createElement('div');
        d.className = 'claude-sys-line';
        d.textContent = text;
        stream.appendChild(d);
        _scrollClaudeChatToBottom();
    }

    // 🧩 小面板：回覆裡 <widget title="…">完整 HTML</widget>（開頭標籤在行首、</widget> 在行尾）
    //   畫成對話中間的隔離小框（sandbox 只給 allow-scripts，碰不到房間的網頁、設定與記錄）。
    //   切段前把整段換成單獨一行的記號，所以它自己成一顆；畫的時候認出記號就建框。
    //   串流中還沒寫到 </widget> 的，從 <widget 那行起先藏著，不會露出一堆程式碼。
    const WIDGET_TOKEN_RE = /^\[\[ccr-widget:([A-Za-z0-9+/=]*)\]\]$/;
    const _b64enc = (s) => { try { return btoa(unescape(encodeURIComponent(s))); } catch (_) { return ''; } };
    const _b64dec = (s) => { try { return decodeURIComponent(escape(atob(s))); } catch (_) { return ''; } };
    function _widgetize(text, streaming) {
        let s = String(text == null ? '' : text).replace(
            /^[ \t]*<widget\b([^>\n]*)>([\s\S]*?)<\/widget>[ \t]*$/gim,
            (_, attrs, html) => {
                const t = /title\s*=\s*"([^"]*)"/i.exec(attrs || '');
                return '\n\n[[ccr-widget:' + _b64enc(JSON.stringify({ title: t ? t[1] : '', html: html })) + ']]\n\n';
            });
        const open = s.search(/^[ \t]*<widget\b/im);
        if (open >= 0) s = s.slice(0, open) + (streaming ? '' : '\n\n（這個小面板沒寫完整，畫不出來）');
        return s;
    }
    function _isWidgetSeg(seg) { return WIDGET_TOKEN_RE.test(String(seg == null ? '' : seg).trim()); }

    let _widgetSeq = 0;
    const _widgetFrames = new Map();
    let _widgetListening = false;
    // 框裡回報內容多高，框就長多高（用 height 屬性，不寫 inline style）
    function _ensureWidgetListener() {
        if (_widgetListening) return;
        _widgetListening = true;
        window.addEventListener('message', (ev) => {
            const d = ev && ev.data;
            if (!d || typeof d.ccrWidget !== 'string') return;
            const f = _widgetFrames.get(d.ccrWidget);
            if (!f) return;
            if (!f.isConnected) { _widgetFrames.delete(d.ccrWidget); return; }
            if (ev.source !== f.contentWindow) return;
            f.setAttribute('height', String(Math.max(60, Math.min(640, Math.ceil(Number(d.h) || 0)))));
        });
    }
    function _widgetDoc(html, id) {
        const base = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            + '<style>html{margin:0;padding:0}body{margin:0;padding:8px;box-sizing:border-box;'
            + 'font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif;color:#1f3a68;background:#fff}*,*::before,*::after{box-sizing:border-box}</style>';
        const report = '<script>(function(){var id=' + JSON.stringify(id) + ';'
            + 'function h(){try{parent.postMessage({ccrWidget:id,h:document.documentElement.scrollHeight},"*")}catch(e){}}'
            + 'window.addEventListener("load",h);if(window.ResizeObserver){new ResizeObserver(h).observe(document.documentElement)}'
            + 'setTimeout(h,60);setTimeout(h,600);})();<\/script>';
        return base + html + report;
    }
    function _buildWidget(seg) {
        const m = WIDGET_TOKEN_RE.exec(String(seg == null ? '' : seg).trim());
        if (!m) return null;
        let data = {};
        try { data = JSON.parse(_b64dec(m[1]) || '{}') || {}; } catch (_) { data = {}; }
        const id = 'w' + (++_widgetSeq) + '_' + Date.now().toString(36);
        const box = document.createElement('div');
        box.className = 'claude-widget';
        if (data.title) {
            const h = document.createElement('div');
            h.className = 'claude-widget-title';
            h.textContent = data.title;
            box.appendChild(h);
        }
        const f = document.createElement('iframe');
        f.className = 'claude-widget-frame';
        f.setAttribute('sandbox', 'allow-scripts');
        f.setAttribute('title', data.title || '小面板');
        f.setAttribute('height', '120');
        f.srcdoc = _widgetDoc(String(data.html || ''), id);
        _widgetFrames.set(id, f);
        _ensureWidgetListener();
        box.appendChild(f);
        return box;
    }
    /** 這段是小面板就把框放進泡泡、回 true；不是回 false */
    function _fillWidgetSeg(el, seg) {
        if (!_isWidgetSeg(seg)) return false;
        const w = _buildWidget(seg);
        if (!w) return false;
        el.classList.add('claude-bubble-widget');
        el.appendChild(w);
        return true;
    }

    // 🎤 語音泡泡。他在回覆裡寫 <voice>要說的話</voice> → 自己一顆，她按了才用他的聲音念。
    //   誰用哪個聲音照奧瑞亞「系統設置 → 語音 → 角色配音」的名字對住戶名字（OS_VOICE_CAST），
    //   名單上選 Minimax 就借 OS_MINIMAX、選 ElevenLabs 就借 OS_ELEVENLABS；總開關不管這裡（她按了就是要聽）。
    //   舊版奧瑞亞沒有名單：照舊只用 OS_MINIMAX 的音色檔案。合成過的留在記憶體，同一句重播不再扣錢。
    //   她按住麥克風說的那條：記錄帶 voiceAudio（錄音存在奧瑞亞圖庫 aud_room_…），泡泡點了播她自己的聲音。
    //   反引號裡的 <voice> 是他在講解，不算。串流中開頭來了、結尾還沒來的，從那裡先藏著。
    const VOICE_TOKEN_RE = /^\[\[ccr-voice:([A-Za-z0-9+/=]*)\]\]$/;
    function _voiceize(text, streaming) {
        let s = String(text == null ? '' : text).replace(/(?<!`)<voice>([\s\S]*?)<\/voice>(?!`)/gi,
            (_, said) => '\n\n[[ccr-voice:' + _b64enc(JSON.stringify({ text: String(said).trim() })) + ']]\n\n');
        const open = s.search(/(?<!`)<voice>/i);
        if (open >= 0) s = streaming ? s.slice(0, open) : s.replace(/(?<!`)<voice>/gi, '');
        if (streaming) s = s.replace(/<(?:v(?:o(?:i(?:c(?:e)?)?)?)?)?$/i, '');
        return s;
    }
    function _voiceSegText(seg) {
        const m = VOICE_TOKEN_RE.exec(String(seg == null ? '' : seg).trim());
        if (!m) return null;
        try { return String((JSON.parse(_b64dec(m[1]) || '{}') || {}).text || ''); } catch (_) { return ''; }
    }
    const _voiceCache = new Map();          // 「音色§字」→ 合成好的聲音
    const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    let _voiceEl = null, _voiceRow = null, _voiceUrl = null;
    function _voiceSecOf(text) { return Math.max(1, Math.round(String(text || '').replace(/\s/g, '').length / 4.5)); }
    function _stopVoice() {
        if (_voiceEl) { try { _voiceEl.pause(); } catch (_) {} }
        if (_voiceUrl) { URL.revokeObjectURL(_voiceUrl); _voiceUrl = null; }
        if (_voiceRow) {
            _voiceRow.classList.remove('playing', 'loading');
            const ic = _voiceRow.querySelector('.claude-voice-icon');
            if (ic) ic.className = 'fa-solid fa-play claude-voice-icon';
        }
        _voiceRow = null;
    }
    function _voiceWhy(e, who, src) {
        const code = String((e && e.message) || e || '');
        if (code === 'NO_TTS') return '這裡沒有接語音，要在奧瑞亞裡打開房間才念得出來';
        if (code === 'NO_VOICE') return '還沒幫' + who + '挑聲音：到系統設置 → 語音 → 角色配音，加一個名字叫「' + who + '」的角色';
        if (code === 'NO_KEY') return src === 'elevenlabs' ? '語音設定還沒填 ElevenLabs 的金鑰' : '語音設定還沒填 MiniMax 的 Group ID 和金鑰';
        if (code === 'GONE') return '這段錄音找不到了';
        if (code === 'NOTHING_TO_SAY') return '這段沒有可以念的字';
        return '沒念出來：' + code;
    }
    /** 點了播、再點停。她的錄音從圖庫拿；他的話現在才合成（第一次按才花錢），合成好的留著重播 */
    async function _toggleVoice(row, text, v, note, body) {
        if (_voiceRow === row) { _stopVoice(); return; }
        _stopVoice();
        // 手機要在點的那一下就開好播放器，不然等合成回來再播會被擋
        if (!_voiceEl) _voiceEl = new Audio();
        try { _voiceEl.src = SILENT_WAV; _voiceEl.play().catch(() => {}); } catch (_) {}
        _voiceRow = row;
        row.classList.add('loading');
        note.hidden = true;
        let src = 'minimax';
        try {
            let blobUrl;
            if (v.audioId) {
                blobUrl = window.OS_DB && typeof window.OS_DB.getImage === 'function' ? await window.OS_DB.getImage(v.audioId) : null;
                if (!blobUrl) throw new Error('GONE');
            } else {
                const VC = window.OS_VOICE_CAST;
                let MM = window.OS_MINIMAX, voiceId = '';
                if (VC && typeof VC.find === 'function') {
                    const ent = VC.find(v.who, null, text);   // 帶這句話：同一個人中文、英文可以綁不同聲音
                    if (!ent) throw new Error('NO_VOICE');
                    src = ent.src;
                    voiceId = ent.voiceId;
                    MM = src === 'elevenlabs' ? window.OS_ELEVENLABS : window.OS_MINIMAX;
                    if (!MM || typeof MM.synth !== 'function') throw new Error('NO_TTS');
                } else {
                    if (!MM || typeof MM.findVoiceId !== 'function') throw new Error('NO_TTS');
                    voiceId = MM.findVoiceId(v.who);
                    if (!voiceId) throw new Error('NO_VOICE');
                }
                const key = src + '§' + voiceId + '§' + text;
                let blob = _voiceCache.get(key);
                if (!blob) {
                    if (typeof MM.synth !== 'function') {         // 舊版奧瑞亞沒有只合成那支：交給它自己播，不留著
                        const ok = await MM.play(text, voiceId);
                        if (_voiceRow === row) _stopVoice();
                        if (!ok) throw new Error('NO_KEY');
                        return;
                    }
                    blob = await MM.synth(text, voiceId);
                    _voiceCache.set(key, blob);
                }
                blobUrl = URL.createObjectURL(blob);
            }
            if (_voiceRow !== row) { URL.revokeObjectURL(blobUrl); return; }   // 等的時候她又點了別顆
            _voiceUrl = blobUrl;
            _voiceEl.onended = () => { if (_voiceRow === row) _stopVoice(); };
            _voiceEl.src = blobUrl;
            await _voiceEl.play();
            row.classList.remove('loading');
            row.classList.add('playing');
            const ic = row.querySelector('.claude-voice-icon');
            if (ic) ic.className = 'fa-solid fa-pause claude-voice-icon';
        } catch (e) {
            if (_voiceRow === row) _stopVoice();
            note.textContent = _voiceWhy(e, v.who || '他', src);
            note.hidden = false;
            body.hidden = false;
        }
    }
    /** 一顆語音：播放鍵、聲紋、秒數，旁邊「字」可以展開看說了什麼。v：{ who, audioId?, sec? } */
    function _buildVoice(text, v) {
        const box = document.createElement('div');
        box.className = 'claude-voice';
        const bar = document.createElement('div');
        bar.className = 'claude-voice-bar';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'claude-voice-row';
        row.innerHTML = '<i class="fa-solid fa-play claude-voice-icon"></i><span class="claude-voice-wave"><i></i><i></i><i></i><i></i><i></i></span><span class="claude-voice-sec"></span>';
        const _vx = _tlSplit(text);   // 🌐 外語語音：秒數只算原文，「字」那欄翻譯另起一行
        row.querySelector('.claude-voice-sec').textContent = (v.sec ? Math.max(1, Math.round(v.sec)) : _voiceSecOf(_vx.orig)) + '″';
        const tbtn = document.createElement('button');
        tbtn.type = 'button';
        tbtn.className = 'claude-voice-textbtn';
        tbtn.title = '看字';
        tbtn.textContent = '字';
        const body = document.createElement('div');
        body.className = 'claude-voice-text';
        body.textContent = _vx.orig;
        if (_vx.tl) {
            const tl = document.createElement('div');
            tl.className = 'claude-tl';
            tl.textContent = _vx.tl;
            body.appendChild(tl);
        }
        body.hidden = true;
        const note = document.createElement('div');
        note.className = 'claude-voice-note';
        note.hidden = true;
        row.addEventListener('click', (e) => { e.stopPropagation(); _toggleVoice(row, text, v, note, body); });
        tbtn.addEventListener('click', (e) => { e.stopPropagation(); body.hidden = !body.hidden; });
        bar.appendChild(row);
        bar.appendChild(tbtn);
        box.appendChild(bar);
        box.appendChild(body);
        box.appendChild(note);
        return box;
    }
    function _residentName() {
        const CT = window.ClaudeTerminal;
        const r = (CT && typeof CT.getActiveResident === 'function') ? CT.getActiveResident(_provider()) : null;
        return (r && r.name) || '他';
    }
    /** 這段是他的語音就把語音放進泡泡、回 true */
    function _fillVoiceSeg(el, seg) {
        const text = _voiceSegText(seg);
        if (text === null) return false;
        el.classList.add('claude-bubble-voice');
        el.appendChild(_buildVoice(text, { who: _residentName() }));
        return true;
    }
    const HER_VOICE_PREFIX = '（語音）';

    /** 她的訊息整則只有一張表情包（![名字](網址)）→ 畫成圖、不套底框，回 true；不是回 false。群聊也借這支 */
    function _renderUserSticker(el, text) {
        const m = /^!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)$/.exec(String(text == null ? '' : text).trim());
        if (!m) return false;
        const img = document.createElement('img');
        img.className = 'claude-md-img';
        img.alt = m[1];
        img.src = m[2];
        el.textContent = '';
        el.appendChild(img);
        el.classList.add('claude-bubble-sticker');
        return true;
    }

    // 🫧 泡泡一顆一顆出來（她從三個小樣挑的第一個：點點等一下，再冒出一顆）
    const DOTS_HTML = '<i></i><i></i><i></i>';

    // 🌐 住戶講外語時一段話是「原文 (中文翻譯)」：翻譯拆出來放下面一行小字（奧瑞亞的 OS_VN_FOREIGN.splitTail；
    //    只拆前面不是中文、括號裡是中文的，中文的（笑）不動）。沒有奧瑞亞就照原樣一行。
    function _tlSplit(text) {
        const F = window.OS_VN_FOREIGN;
        return (F && typeof F.splitTail === 'function') ? F.splitTail(String(text || '')) : { orig: String(text || ''), tl: '' };
    }
    /** markdown 那段畫進泡泡，有翻譯就在下面多一行 .claude-tl */
    function _fillMdSeg(el, text) {
        const sx = _tlSplit(text);
        const safeHtml = _claudeMarkdownToSafeHtml(sx.orig);
        if (safeHtml !== null) {
            el.innerHTML = safeHtml;
            el.classList.add('claude-bubble-md');
        } else {
            el.textContent = sx.orig;
        }
        if (sx.tl) {
            const d = document.createElement('div');
            d.className = 'claude-tl';
            d.textContent = sx.tl;
            el.appendChild(d);
        }
    }

    /** 他的一段話畫進一顆泡泡：markdown、表情包自己不套底框、小面板建框 */
    function _fillReplyBubble(el, text) {
        if (_fillWidgetSeg(el, text)) return;
        if (_fillVoiceSeg(el, text)) return;
        _fillMdSeg(el, text);
        if (_isStickerSeg(text)) el.classList.add('claude-bubble-sticker');
    }

    /** 一顆一顆放泡泡。host 裡擺一顆點點泡泡 dots；push 進來的每段先讓點點停一下，再在點點前面冒出那顆。
     *  make(段落) 回一顆畫好的泡泡。count 是 push 過幾段（照段落順序算，空段也算），呼叫端拿它切還沒放的。
     *  用計時器，不綁轉場結束事件：視窗在背景時轉場不走，綁事件會卡成看不見；背景時直接放、不等。
     *  host 被拿掉（出錯、換頁）或 stop() 之後就不再放。 */
    function _createBubbleRevealer(host, dots, make, onStep) {
        const queue = [];
        let count = 0;
        let running = null;
        let stopped = false;
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        const place = (seg, pop) => {
            if (stopped || !host || !host.isConnected) return;
            let el = null;
            try { el = make(seg); } catch (_) { return; }
            if (!el) return;
            if (dots && dots.parentNode === host) host.insertBefore(el, dots);
            else host.appendChild(el);
            if (pop) {
                el.classList.add('claude-bubble-pop');
                setTimeout(() => el.classList.remove('claude-bubble-pop'), 400);
            }
            if (typeof onStep === 'function') { try { onStep(); } catch (_) {} }
        };
        const run = async () => {
            while (queue.length && !stopped) {
                const seg = queue.shift();
                if (document.hidden) { place(seg, false); continue; }
                await wait(Math.min(900, 380 + String(seg).length * 18));
                if (stopped) return;
                place(seg, true);
                await wait(160);
            }
        };
        const kick = () => {
            if (running || stopped) return;
            running = run().then(() => { running = null; if (queue.length) kick(); });
        };
        return {
            push(segs) {
                (segs || []).forEach(s => {
                    count++;
                    if (String(s == null ? '' : s).trim()) queue.push(s);
                });
                kick();
            },
            get count() { return count; },
            async drain() { while (running) await running; },
            stop() { stopped = true; queue.length = 0; },
        };
    }

    /** 思考摺疊塊：泡泡上面一條「思考」，點開看模型的思考摘要。沒內容 → null */
    function _buildThinkingBlock(thinking) {
        const text = String(thinking || '').trim();
        if (!text) return null;
        const t = document.createElement('div');
        t.className = 'claude-thinking';
        const header = document.createElement('div');
        header.className = 'claude-thinking-header';
        header.innerHTML = '<i class="fa-solid fa-chevron-right claude-thinking-toggle"></i><i class="fa-solid fa-brain"></i><span>思考</span>';
        const body = document.createElement('div');
        body.className = 'claude-thinking-content';
        // 思考摘要常帶 **小標**（阿洛那條整段都是這種）：跟泡泡同一支排版，不然星號原樣印出來
        let html = '';
        try { html = _claudeMarkdownToSafeHtml(text); } catch (_) { html = ''; }
        if (html) { body.classList.add('is-md'); body.innerHTML = html; }
        else body.textContent = text;
        t.appendChild(header); t.appendChild(body);
        t.addEventListener('click', () => t.classList.toggle('open'));
        return t;
    }

    // ---- 住戶這一輪提的單子（改世界書、改預設）掛在他那則回覆底下（09-30）----
    //   她：「放在聊天室成一個卡片會好一點? 不然看起來有點難操作」。留言板「等你同意的」照舊在（之後拿來集中看、一起批）。
    //   單子是住戶叫奧瑞亞工具、頁面做成、橋存著的（aurelia_link.js／橋 /v1/aurelia/props）。
    //   他這一輪叫了會提單子的工具，回完就去橋上拿「這位住戶、這一輪開始之後提的」，記在那則回覆（props:[{id, text}]，
    //   對話記錄整則存上橋，重開還在）。點一張打開跟聊天 app 同一張單子（WX_TOOLS.openPropSheet），她按了什麼回報橋、卡片跟著換字。
    //   🚨 酒館與手機的世界書、預設是分開的：在哪邊提的就要在哪邊按（prop.where）。
    const PROP_CHIP = { wait: '點開看', no: '沒同意', done: '寫進去了', undone: '改回去了', stale: '作廢了' };
    const PROP_TOOL_RE = /aurelia_(worldbook|preset|vn|theme|fx|bubble)_(add|edit|use)|aurelia_vnrule_(list_edit|switch|bgm_theme)/;
    function _bridgeCfg() {
        let c = null;
        try { c = window.ClaudeTerminal && window.ClaudeTerminal.getConfig && window.ClaudeTerminal.getConfig(); } catch (_) {}
        if (!c || !c.url || !c.key) return null;
        return { base: String(c.url).replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/+$/, ''), key: c.key };
    }
    async function _bridgeJson(path, body) {
        const b = _bridgeCfg();
        if (!b) throw new Error('NOT_CONFIGURED');
        const r = await fetch(b.base + path, {
            method: body ? 'POST' : 'GET',
            headers: Object.assign({ 'Authorization': 'Bearer ' + b.key }, body ? { 'Content-Type': 'application/json' } : {}),
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    }
    async function _fetchPropRows() {
        const d = await _bridgeJson('/v1/aurelia/props');
        return Array.isArray(d && d.props) ? d.props : [];
    }
    function _hereName() {
        try { const w = window.parent || window; return (w.OS_API && w.OS_API.isStandalone && w.OS_API.isStandalone()) ? '手機' : '酒館'; } catch (_) { return '酒館'; }
    }
    // 卡片上那一行字：交給奧瑞亞寫（跟聊天 app、留言板同一句），拿不到自己拼
    function _propLine(x) {
        const w = window.parent || window;
        const E = w.OS_AURELIA_EDIT || window.OS_AURELIA_EDIT;
        try { if (E && E.text && x.prop) return E.text(x.prop, false); } catch (_) {}
        const p = x.prop || {};
        return (p.by || x.name || '住戶') + ' 想改' + (p.mod === 'preset' ? '預設' : '世界書') + '「' + (p.title || '') + '」';
    }
    // 這一輪這位住戶提的單子（從送出前幾秒算起：頁面做成單子到橋存起來中間有一點時間差）。沒有回 null
    async function _turnProps(rid, since, toolsUsed) {
        if (!rid || !(toolsUsed || []).some(t => PROP_TOOL_RE.test(String((t && t.name) || '')))) return null;
        try {
            const mine = (await _fetchPropRows()).filter(x => x && x.rid === rid && Number(x.created) >= since - 5)
                .sort((a, b) => a.created - b.created);
            return mine.length ? mine.map(x => ({ id: x.id, text: _propLine(x) })) : null;
        } catch (_) { return null; }
    }
    function _paintPropCard(card, x) {
        const state = (x && x.state) || 'wait';
        card.className = 'claude-prop-card is-' + state;
        if (x) card.querySelector('.claude-prop-text').textContent = _propLine(x);
        card.querySelector('.claude-prop-chip').textContent = PROP_CHIP[state] || state;
    }
    // 小機的單子：整張存在那則回覆上（不經橋，朋友沒有橋也按得了）；她按了什麼就改那張、存回對話記錄
    function _xjProps(list) {
        if (!Array.isArray(list) || !list.length) return null;
        return list.map(p => ({ id: p.id, text: _propLine({ prop: p }), prop: p }));
    }
    function _openLocalProp(card) {
        const w = window.parent || window;
        const T = w.WX_TOOLS || window.WX_TOOLS;
        const E = w.OS_AURELIA_EDIT || window.OS_AURELIA_EDIT;
        if (!T || !T.openPropSheet || !E) { _renderClaudeNotice('要在酒館或手機的奧瑞亞裡才按得了這張單子'); return; }
        const rec = card._xj, prop = rec.prop;
        const where = prop.where || '';
        if (where && where !== _hereName()) { _renderClaudeNotice('這張是在' + where + '提的，要在' + where + '按（兩邊的資料是分開的）'); return; }
        const stream = _el('claude-chat-stream');
        const host = stream && (stream.closest('.cw-body') || stream.parentElement);
        if (!host) return;
        T.openPropSheet(prop, host, p => {
            rec.prop = p;
            rec.text = _propLine({ prop: p });
            _paintPropCard(card, { prop: p, state: p.state });
            _scheduleSave();
        });
    }
    function _buildPropCards(list) {
        const box = document.createElement('div');
        box.className = 'claude-prop-cards';
        list.forEach(p => {
            if (!p || !p.id) return;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'claude-prop-card is-wait';
            card.dataset.ppid = p.id;
            card.innerHTML = '<i class="fa-solid fa-pen-to-square"></i><span class="claude-prop-text"></span><span class="claude-prop-chip"></span>';
            card.querySelector('.claude-prop-text').textContent = p.text || '一張單子';
            card.querySelector('.claude-prop-chip').textContent = PROP_CHIP.wait;
            if (p.prop) { card._xj = p; _paintPropCard(card, { prop: p.prop, state: p.prop.state }); }
            card.addEventListener('click', ev => { ev.stopPropagation(); if (card._xj) _openLocalProp(card); else _openPropCard(card); });
            box.appendChild(card);
        });
        // 現在的狀態（她可能已經在留言板或另一台按過）：拿一次橋上的補上；處理完超過一週的橋上沒有了，照記下的字、寫處理過了
        if (list.some(p => p && p.id && !p.prop)) _fetchPropRows().then(all => {
            box.querySelectorAll('.claude-prop-card').forEach(card => {
                if (card._xj) return;
                const x = all.find(r => r.id === card.dataset.ppid);
                if (x) _paintPropCard(card, x);
                else { card.className = 'claude-prop-card is-gone'; card.querySelector('.claude-prop-chip').textContent = '處理過了'; }
            });
        }).catch(() => {});
        return box;
    }
    // ── 待修卡（10-02 她：「待修在輸出時會顯示在聊天室，但卻長這樣，感覺得卡片反饋」）──
    //   他在回覆裡寫的 <board_bug> 橋已經記進待修清單；泡泡裡那段藏起來，換成一張卡：白話那一行＋修好了沒。
    //   卡從回覆原文現場解析（逐字稿存原文），重畫歷史也長得出來；狀態拿一次橋上的待修清單對白話那行。點了打開留言板的待修頁。
    let _bugRowsP = null, _bugRowsAt = 0;
    function _fetchBugRows() {
        if (!_bugRowsP || Date.now() - _bugRowsAt > 60000) {
            _bugRowsAt = Date.now();
            _bugRowsP = _bridgeJson('/v1/board/bugs').then(d => (Array.isArray(d && d.bugs) ? d.bugs : [])).catch(() => []);
        }
        return _bugRowsP;
    }
    const _bugKey = s => String(s || '').replace(/\s+/g, '');
    function _buildBugCards(titles) {
        const box = document.createElement('div');
        box.className = 'claude-prop-cards';
        titles.forEach(t => {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'claude-prop-card claude-bug-card is-wait';
            card.innerHTML = '<i class="fa-solid fa-screwdriver-wrench"></i><span class="claude-prop-text"></span><span class="claude-prop-chip">記進待修</span>';
            card.querySelector('.claude-prop-text').textContent = t;
            card.addEventListener('click', ev => {
                ev.stopPropagation();
                try { localStorage.setItem('ccr_board_tab', 'bugs'); } catch (_) {}
                if (window.ChatWindow && typeof window.ChatWindow.openSubPanel === 'function') window.ChatWindow.openSubPanel('board');
            });
            box.appendChild(card);
        });
        _fetchBugRows().then(rows => {
            box.querySelectorAll('.claude-bug-card').forEach(card => {
                const k = _bugKey(card.querySelector('.claude-prop-text').textContent);
                const row = rows.find(r => _bugKey(r.title) === k);
                if (!row) return;   // 修好超過一週，清單上已經沒有了：照原樣
                if (row.status === 'fixed') {
                    card.className = 'claude-prop-card claude-bug-card is-fixed';
                    card.querySelector('.claude-prop-chip').textContent = '已修';
                    if (row.fix && row.fix.text) {
                        const fx = document.createElement('span');
                        fx.className = 'claude-bug-fix';
                        fx.textContent = (row.fix.by || '丹') + '：' + row.fix.text;
                        card.querySelector('.claude-prop-text').appendChild(fx);
                    }
                } else {
                    card.querySelector('.claude-prop-chip').textContent = '待修';
                }
            });
        });
        return box;
    }
    async function _openPropCard(card) {
        const w = window.parent || window;
        const T = w.WX_TOOLS || window.WX_TOOLS;
        const E = w.OS_AURELIA_EDIT || window.OS_AURELIA_EDIT;
        if (!T || !T.openPropSheet || !E) { _renderClaudeNotice('要在酒館或手機的奧瑞亞裡才按得了這張單子'); return; }
        let x = null;
        try { x = (await _fetchPropRows()).find(r => r.id === card.dataset.ppid) || null; }
        catch (e) { _renderClaudeNotice('拿不到這張單子（連不上橋）'); return; }
        if (!x) { _renderClaudeNotice('這張單子處理完一陣子了，橋上已經沒有'); return; }
        const where = (x.prop && x.prop.where) || '';
        if (where && where !== _hereName()) {
            _renderClaudeNotice('這張是在' + where + '提的，要在' + where + '按（兩邊的' + (x.prop.mod === 'preset' ? '預設' : '世界書') + '是分開的）');
            return;
        }
        const stream = _el('claude-chat-stream');
        const host = stream && (stream.closest('.cw-body') || stream.parentElement);
        if (!host) return;
        T.openPropSheet(x.prop, host, async p => {
            await _bridgeJson('/v1/aurelia/props/update', { id: x.id, prop: p });
            x.prop = p;
            x.state = p.state;
            _paintPropCard(card, x);
        });
    }

    // 以前傳的、只存了路徑的圖：經橋拿一次（整頁同一張只拿一次）
    const _oldImgJobs = {};
    function _oldImgUrl(path) {
        if (!_oldImgJobs[path]) _oldImgJobs[path] = window.ClaudeTerminal.fetchLocalImage(path).catch(() => null);
        return _oldImgJobs[path];
    }

    function _renderClaudeBubble(role, content, opts = {}) {
        const stream = _el('claude-chat-stream');
        if (!stream) return;
        const isUser = role === 'user';
        const wrap = document.createElement('div');
        wrap.className = 'claude-bubble-wrap ' + (isUser ? 'from-user' : 'from-claude');
        if (opts.msg) wrap._ccrMsg = opts.msg;   // 長按收進記事本、紀錄頁跳回來找的就是這則

        // 留言板標籤橋已經替他做完，畫面上拿掉（歷史重畫也走這裡）。整則只有標籤就留一句說他去板上動了手。
        //   記進待修的（board_bug）另外掛一張待修卡；整則只有待修就只掛卡，不留那句
        const bugTitles = (!isUser && !opts.suppressMarkdown && window.ClaudeTerminal && typeof window.ClaudeTerminal.boardBugs === 'function')
            ? window.ClaudeTerminal.boardBugs(content) : [];
        if (!isUser && window.ClaudeTerminal && typeof window.ClaudeTerminal.stripBoardTags === 'function') {
            const shown = window.ClaudeTerminal.stripBoardTags(content, { streaming: !!opts.suppressMarkdown });
            if (!shown && String(content || '').trim()) content = bugTitles.length ? '' : '（去留言板上動了一下）';
            else content = shown;
        }

        // ASK marker：只在 Clawd 最終回覆 render（不在 streaming 中、不在 user 訊息）
        let askMatches = [];
        if (!isUser && !opts.suppressMarkdown) {
            const r = _parseAskMarkers(content);
            askMatches = r.asks;
            content = _voiceize(_widgetize(r.stripped, false), false);   // 🧩 小面板、🎤 語音換成自己一顆的記號
        }

        if (!isUser) {
            const t = _buildThinkingBlock(opts.thinking);
            if (t) wrap.appendChild(t);
        }

        // tool summary 摺疊塊（仿 Claude.ai 桌面端「Edited 2 files, ran a command」）
        if (!isUser) {
            const ts = _buildToolSummary(opts.toolsUsed);
            if (ts) wrap.appendChild(ts);
        }

        // 🫧 他的最終回覆切成好幾顆（空行分段、表情包自己一顆）；使用者訊息與串流中照舊一顆
        const _segs = (!isUser && !opts.suppressMarkdown) ? _splitReplySegments(content) : [content];
        const _fillBubble = (el, text) => {
            if (isUser && _renderUserSticker(el, text)) return;   // 😺 她從表情包框送的那張
            if (isUser && opts.voice) {                           // 🎤 她按住麥克風說的那條
                el.classList.add('claude-bubble-voice');
                el.appendChild(_buildVoice(String(text || '').replace(HER_VOICE_PREFIX, ''), { who: '妳', audioId: opts.voice.audioId, sec: opts.voice.sec }));
                return;
            }
            if (isUser || opts.suppressMarkdown) {
                // User 訊息 / streaming 中：raw text 顯示（streaming 期間每 chunk re-render
                // 一次 markdown 太貴，stream 結束最後一次 render 才開 markdown）
                el.textContent = isUser ? text : _hideMdImages(text);
                return;
            }
            if (_fillWidgetSeg(el, text)) return;   // 🧩 小面板
            if (_fillVoiceSeg(el, text)) return;    // 🎤 語音
            // Claude 回覆：解析 markdown 後 sanitize 再插入（外語的翻譯拆到下面一行）
            _fillMdSeg(el, text);
            if (_isStickerSeg(text)) el.classList.add('claude-bubble-sticker');
        };
        let bubble = null;
        _segs.forEach(seg => {
            if (bubble) wrap.appendChild(bubble);   // 前一顆先放上去；最後一顆留給下面掛附件
            bubble = document.createElement('div');
            bubble.className = 'claude-bubble ' + (isUser ? 'from-user' : 'from-claude') + (opts.still ? ' claude-bubble-still' : '');
            _fillBubble(bubble, seg);
        });

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
                } else if (a && a.path && a.mime && a.mime.indexOf('image/') === 0 && window.ClaudeTerminal
                    && typeof window.ClaudeTerminal.fetchLocalImage === 'function') {
                    // 以前傳的圖只存了路徑：先放檔名那顆，經橋拿到圖就換成小照片；拿不到就留著檔名
                    const item = document.createElement('span');
                    item.className = 'claude-bubble-attach-item';
                    item.textContent = `${_attachIcon(a.mime, a.filename)} ${a.filename || 'file'}`;
                    attachBox.appendChild(item);
                    _oldImgUrl(a.path).then(url => {
                        if (!url || !item.parentNode) return;
                        const im = document.createElement('img');
                        im.className = 'cg-attach-img';
                        im.src = url;
                        im.addEventListener('click', () => _openClaudeImageOverlay(url));
                        item.replaceWith(im);
                    });
                } else {
                    const item = document.createElement('span');
                    item.className = 'claude-bubble-attach-item';
                    item.textContent = `${_attachIcon(a.mime, a.filename)} ${a.filename || 'file'}`;
                    attachBox.appendChild(item);
                }
            });
            bubble.appendChild(attachBox);
        }

        // 小機只交了單子沒說話：不畫空泡泡，只掛單子（只記了待修也一樣）
        if (isUser || String(content || '').trim() || !((opts.props && opts.props.length) || bugTitles.length)) wrap.appendChild(bubble);

        // ASK marker UI：附在氣泡下方、用量 footer 上方
        askMatches.forEach(ask => {
            wrap.appendChild(_buildClaudeAskUI(ask));
        });

        // 📝 他這一輪提的單子（改世界書、改預設）：一張一張掛在回覆底下，點了開單子
        if (!isUser && Array.isArray(opts.props) && opts.props.length) wrap.appendChild(_buildPropCards(opts.props));
        // 🔧 他這一句記進待修的：一條一張卡，點了看待修清單
        if (bugTitles.length) wrap.appendChild(_buildBugCards(bugTitles));
        // 小機：這一句叫了幾次模型（她付的錢，一眼看得到）
        if (!isUser && opts.calls) {
            const c = document.createElement('div');
            c.className = 'claude-bubble-calls';
            c.textContent = '這次叫了 ' + opts.calls + ' 通' + (opts.stopped ? '（中途停下）' : '');
            wrap.appendChild(c);
        }

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
            // 小機（no_cost）：接口的錢我們不知道價，不寫 $，只寫用量
            footer.title = `model: ${u.model || '?'}\ninput: ${u.input_tokens || 0}\noutput: ${u.output_tokens || 0}\ncache write: ${u.cache_creation_input_tokens || 0}\ncache read: ${u.cache_read_input_tokens || 0}` + (u.no_cost ? '' : `\ncost: ${cost}`);
            footer.textContent = (u.no_cost ? '' : `💰 ${cost} · `) + `${u.input_tokens || 0}↑ ${u.output_tokens || 0}↓${cacheNote}${modelStr}`;
            wrap.appendChild(footer);
        }

        stream.appendChild(wrap);
        if (!opts.noScroll) _scrollClaudeChatToBottom();
    }

    /** 進入浮窗時用：把 _roomHistory 全部 render 成氣泡（含附件 + thinking + usage）
     *  🚨 一則一則畫的時候不捲：每捲一次瀏覽器就得把整串排一次版（276 則＝排 277 次，聊越多越卡）。畫完才捲一次 */
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
                    voice: m.voiceAudio ? { audioId: m.voiceAudio, sec: m.voiceSec } : null,
                    props: (Array.isArray(m.props) && m.props.length) ? m.props : null,
                    calls: m.calls || 0,
                    noScroll: true,
                    msg: m,
                }
            );
        });
        _scrollClaudeChatToBottom();
        _paintHeld();
    }

    // ===== 附件 chip 預覽列（輸入框上方）=====
    //   圖片（選的、Ctrl+V 貼上的截圖）做一張小縮圖：上傳中先用本機預覽，傳完存成縮圖跟著那則訊息走（泡泡裡畫小照片、點了放大）。
    //   她（09-30）：「能不能學一下創作室，或者像你們的 gui 這樣可以看到卡片的小照片，然後我電腦截圖後，可以直接 ctrl+v 貼上?」
    function _renderClaudeAttachChips() {
        const row = _el('claude-attach-chips');
        if (!row) return;
        row.innerHTML = '';
        _pendingClaudeAttachments.forEach((a, idx) => {
            const chip = document.createElement('div');
            chip.className = 'claude-attach-chip' + (a._uploading ? ' is-uploading' : '');
            chip.title = a.path || a.filename;
            const pic = a.thumb || a._preview;
            let icon;
            if (pic) {
                icon = document.createElement('img');
                icon.className = 'claude-attach-chip-thumb';
                icon.src = pic;
                icon.alt = '';
            } else {
                icon = document.createElement('span');
                icon.textContent = _attachIcon(a.mime, a.filename);
            }
            const name = document.createElement('span');
            name.className = 'claude-attach-chip-name';
            name.textContent = a._uploading ? '上傳中…' : (a.filename || 'file');
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

    // 圖檔縮到長邊 ≤ maxEdge、轉 JPEG data URL（跟群聊那支同一套、同一個尺寸）。失敗回 null
    function _makeThumb(file, maxEdge) {
        return new Promise(resolve => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
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
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        });
    }
    const _isImg = f => !!(f && f.type && f.type.indexOf('image/') === 0);

    /** 觸發隱藏的 file input（或 Ctrl+V 貼上）、上傳到 cc-bridge、push 進 _pendingClaudeAttachments */
    async function _handleClaudeFilePick(fileList) {
        if (!fileList || !fileList.length) return;
        if (!window.ClaudeTerminal || typeof window.ClaudeTerminal.uploadFiles !== 'function') {
            _renderClaudeBubble('assistant', '⚠️ ClaudeTerminal 未載入，無法上傳。');
            return;
        }
        const files = Array.from(fileList);
        // 顯示「上傳中」chip（圖片先放本機預覽）
        const placeholderIdx = _pendingClaudeAttachments.length;
        files.forEach(f => {
            _pendingClaudeAttachments.push({
                _uploading: true,
                _preview: _isImg(f) ? URL.createObjectURL(f) : '',
                filename: f.name,
                mime: f.type || '',
                size: f.size,
            });
        });
        _renderClaudeAttachChips();
        // 圖檔做縮圖（跟上傳並行）
        const thumbsJob = Promise.all(files.map(f => _isImg(f) ? _makeThumb(f, 720) : Promise.resolve(null)));

        try {
            const result = await window.ClaudeTerminal.uploadFiles(files);
            const thumbs = await thumbsJob;
            // 用 server 回傳的真實路徑替換 placeholder
            (result.files || []).forEach((meta, i) => {
                const ph = _pendingClaudeAttachments[placeholderIdx + i];
                if (ph && ph._preview) URL.revokeObjectURL(ph._preview);
                const a = { path: meta.path, filename: meta.filename, mime: meta.mime, size: meta.size };
                if (thumbs[i]) a.thumb = thumbs[i];
                _pendingClaudeAttachments[placeholderIdx + i] = a;
            });
        } catch (e) {
            // 上傳失敗：拔掉 placeholder
            _pendingClaudeAttachments.splice(placeholderIdx, files.length).forEach(a => { if (a && a._preview) URL.revokeObjectURL(a._preview); });
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

    // 🤚 先放著、按了才回（她：「我發現我只能發一條後，就觸發回應了」）。跟她聊天 app 那顆魔杖一樣：
    //   輸入框送出、表情包、按住說話都只是放上去（記錄裡 held:true），想發幾條就發幾條；
    //   按輸入列那顆魔杖（_replyNow），他一次讀到這幾條、回一整段。ASK 按鈕選了答案照舊馬上送（連同放著的一起）。
    //   沒送成功（出錯、按停）那幾條還是放著，再按一次就好。群聊不走這條，照舊送出就回。
    function _heldTail() {
        const h = _activeHistory() || [];
        const out = [];
        for (let i = h.length - 1; i >= 0 && h[i].role === 'user' && h[i].held; i--) out.unshift(h[i]);
        return out;
    }
    function _paintHeld() {
        const n = _heldTail().length;
        const btn = _el('cw-reply-btn');
        if (btn) btn.classList.toggle('has-held', n > 0);
        const badge = _el('cw-held-n');
        if (badge) { badge.textContent = String(n); badge.hidden = n === 0; }
    }
    /** 放一條上去（不叫他回）。extra 可帶 voiceAudio／voiceSec（她按住說話的那條） */
    function _holdMessage(text, extra) {
        const attachmentsSnapshot = _pendingClaudeAttachments
            .filter(a => a && a.path)
            .map(a => Object.assign({ path: a.path, filename: a.filename, mime: a.mime, size: a.size }, a.thumb ? { thumb: a.thumb } : {}));
        _pendingClaudeAttachments = [];
        _renderClaudeAttachChips();
        const msg = Object.assign({
            role: 'user', content: text, ts: Date.now(), held: true,
            attachments: attachmentsSnapshot.length ? attachmentsSnapshot : undefined,
        }, extra || {});
        _activeHistory().push(msg);
        _renderClaudeBubble('user', text, {
            attachments: attachmentsSnapshot,
            voice: msg.voiceAudio ? { audioId: msg.voiceAudio, sec: msg.voiceSec } : null,
            msg: msg,
        });
        _scrollClaudeChatToBottom();
        _scheduleSave();
        _paintHeld();
    }

    // 🎙 按住說話（照她聊天 app 那顆麥克風）：按住錄、放開轉成字放上去（跟打字一樣先放著），往上滑再放開＝取消。
    //   錄音與轉字借奧瑞亞的 OS_VOICE_INPUT（轉字方式跟著她在設置 → 語音選的），錄音存奧瑞亞圖庫，泡泡點了播她自己的聲音；
    //   他讀到的是「（語音）」開頭的字。第一次按會跳麥克風權限框，手指早放開了：那次不算，跟她說再按住一次。最長 60 秒。
    const MIC_MAX_SEC = 60;
    let _mic = null;          // { phase: 'starting'|'recording'|'sending', t0, y0, cancel, released, tick, text, room }
    let _micH = null;
    function _micPaint() {
        const h = _mic;
        const state = !h ? '' : (h.phase === 'recording' && h.cancel ? 'cancel' : h.phase);
        const card = _el('cw-hold-card');
        const btn = _el('cw-mic-btn');
        if (btn) btn.classList.toggle('holding', !!h);
        if (!card) return;
        card.hidden = !h;
        if (!h) return;
        card.dataset.state = state;
        const s = h.t0 ? Math.floor((Date.now() - h.t0) / 1000) : 0;
        const timer = _el('cw-hold-timer');
        if (timer) timer.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        const VI = window.OS_VOICE_INPUT;
        const lv = _el('cw-hold-level');
        if (lv) { const v = (h.phase === 'recording' && VI && VI.level) ? VI.level() : 0; lv.dataset.lv = v < 0.01 ? 0 : (v < 0.03 ? 1 : (v < 0.07 ? 2 : (v < 0.14 ? 3 : 4))); }
        const txt = _el('cw-hold-text');
        if (txt) txt.textContent = h.text.length > 60 ? '…' + h.text.slice(-60) : h.text;
        const hint = _el('cw-hold-hint');
        if (hint) hint.textContent = { starting: '開麥克風…', recording: '鬆開放上去，往上滑取消', cancel: '鬆開取消', sending: '正在轉成字…' }[state] || '';
    }
    function _micListen(on) {
        if (on) {
            if (_micH) return;
            const move = (e) => { const h = _mic; if (!h || h.phase === 'sending') return; const c = (h.y0 - e.clientY) > 60; if (c !== h.cancel) { h.cancel = c; _micPaint(); } };
            const up = () => { const h = _mic; if (!h) return; if (h.phase === 'starting') { h.released = true; return; } if (h.phase === 'recording') _micEnd(h.cancel); };
            const lost = () => { const h = _mic; if (!h) return; if (h.phase === 'starting') { h.released = true; return; } if (h.phase === 'recording') _micEnd(true); };
            _micH = { move, up, lost };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', up);
            document.addEventListener('pointercancel', lost);
        } else if (_micH) {
            document.removeEventListener('pointermove', _micH.move);
            document.removeEventListener('pointerup', _micH.up);
            document.removeEventListener('pointercancel', _micH.lost);
            _micH = null;
        }
    }
    function _micWhy(e) {
        if (e && e.name === 'NotAllowedError') return '沒有麥克風權限，要到瀏覽器設定裡允許';
        return (e && e.message) || String(e || '不知道為什麼');
    }
    async function _micStart(ev) {
        if (ev && ev.preventDefault) ev.preventDefault();      // 不要順手點到輸入框叫出鍵盤、不要長按選字
        const VI = window.OS_VOICE_INPUT;
        if (_mic) return;
        if (!VI || !VI.isSupported()) { _renderClaudeNotice('這裡不能錄音（要在奧瑞亞裡打開房間），可以用打的'); return; }
        if (VI.isRecording()) return;
        if (!VI.isReady()) { _renderClaudeNotice('語音轉字還沒準備好：先到聊天 app 按住麥克風一次，照提示準備好再回來'); return; }
        const room = _activeHistory();
        const h = _mic = { phase: 'starting', t0: 0, y0: (ev && ev.clientY) || 0, cancel: false, released: false, tick: null, text: '', room };
        _micListen(true);
        _micPaint();
        try {
            await VI.start({ onPartial: (s) => { if (_mic === h) { h.text = String(s || ''); _micPaint(); } } });
        } catch (e) {
            if (_mic === h) { _mic = null; _micListen(false); _micPaint(); }
            _renderClaudeNotice('麥克風開不起來：' + _micWhy(e));
            return;
        }
        if (_mic !== h || h.released) {
            VI.cancel();
            if (_mic === h) { _mic = null; _micListen(false); _micPaint(); _renderClaudeNotice('按住麥克風說話，說完放開'); }
            return;
        }
        h.phase = 'recording';
        h.t0 = Date.now();
        h.tick = setInterval(() => {
            if (_mic !== h) return;
            if ((Date.now() - h.t0) / 1000 >= MIC_MAX_SEC) _micEnd(false); else _micPaint();
        }, 150);
        _micPaint();
    }
    async function _micEnd(cancel) {
        const VI = window.OS_VOICE_INPUT;
        const h = _mic;
        if (!VI || !h || h.phase !== 'recording') return;
        if (h.tick) clearInterval(h.tick);
        _micListen(false);
        if (cancel) { VI.cancel(); _mic = null; _micPaint(); return; }
        h.phase = 'sending';
        _micPaint();
        try {
            const rec = await VI.stop();
            if (rec.durationSec < 0.8) { _renderClaudeNotice('說話時間太短'); return; }
            const out = await VI.transcribe(rec.blob);
            const said = String((out && out.text) || '').trim();
            if (!said) { _renderClaudeNotice('沒聽清楚，再說一次'); return; }
            if (_activeHistory() !== h.room) { _renderClaudeNotice('換了房間，這段沒放上去'); return; }
            let extra = null;
            if (window.OS_DB && typeof window.OS_DB.saveImage === 'function') {
                const id = 'aud_room_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                try {
                    await window.OS_DB.saveImage(id, rec.blob);
                    extra = { voiceAudio: id, voiceSec: Math.round(((out && out.durationSec) || rec.durationSec) * 10) / 10 };
                } catch (_) { extra = null; }      // 存不了聲音就只放字
            }
            _holdMessage(HER_VOICE_PREFIX + said, extra);
        } catch (e) {
            _renderClaudeNotice('沒放上去：' + _micWhy(e));
        } finally {
            if (_mic === h) { _mic = null; _micPaint(); }
        }
    }

    // 發送：有字先放上去，接著叫他回（ASK 按鈕、其他要馬上回的地方走這支）
    async function _sendClaudeMessage(text) {
        if (text) _holdMessage(text);
        return _replyNow();
    }

    // 叫他回：把放著的那幾條一起送（走 cc-bridge / OpenAI 兼容；持久化由 ClaudeTerminal 處理）
    async function _replyNow() {
        if (!window.ClaudeTerminal) {
            _renderClaudeReply('⚠️ ClaudeTerminal 模組未載入。');
            return;
        }
        if (!window.ClaudeTerminal.isConfigured()) {
            _renderClaudeReply('⚠️ 還沒設定 cc-bridge URL / Key。\n\n去「寫作 → API 設置 → 🦀 Claude 的房間」填好。');
            return;
        }
        // 這一輪是哪一間：送出那一刻照下來。她送出後切去別間，回覆照樣寫回這間、不畫進別人的房間（待修 #288/#289）
        const CT = window.ClaudeTerminal;
        const ctx = (typeof CT.captureCtx === 'function') ? CT.captureCtx() : null;
        const rid = ctx ? ctx.rid : '';
        const hist = _roomHistory;
        const here = () => !ctx || CT.isCtxOpen(ctx);
        if (_inflight[rid]) return;        // 這位正在回，這時候放的等下一次（別位不擋）
        const held = _heldTail();
        if (!held.length) { _renderClaudeNotice('先說點什麼，再按這顆讓他回'); return; }
        // 送出鈕換 ⏹ 停止：click 觸發 abort + 呼叫 cc-bridge /v1/cancel/{taskId}
        // 訂閱版（CLI）→ /v1/cancel kill 子進程；API 直連版 → abort fetch（server 端目前沒 cancel 機制）
        const me = {
            ctrl: new AbortController(),
            taskId: (window.crypto?.randomUUID && window.crypto.randomUUID()) || ('t-' + Math.random().toString(36).slice(2) + Date.now().toString(36)),
            provider: ctx ? ctx.provider : _provider(),
        };
        _inflight[rid] = me;
        _paintSendBtn();
        const text = held.map(m => m.content).join('\n');
        const attachmentsSnapshot = [].concat(...held.map(m => m.attachments || []))
            .map(a => ({ path: a.path, filename: a.filename, mime: a.mime, size: a.size }));
        // 放著的那幾條要先落到記錄裡，送的那支才認得出哪幾條是這輪的
        if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
        await window.ClaudeTerminal.saveHistory(hist, ctx);

        // 立繪切 thinking（effort=high/xhigh/max 用 ultrathink）
        const _cfgForState = window.ClaudeTerminal.getConfig();
        const _eff = ((_cfgForState && _cfgForState.inlineEffort) || '').toLowerCase();
        const _thinkState = (_eff === 'high' || _eff === 'xhigh' || _eff === 'max') ? 'ultrathink' : 'thinking';
        if (here()) _setClaudePortraitState(_thinkState);

        // 提到 try 外:finally / catch 也要碰這兩個變數(清 throttle timer + 殘留 stream bubble)
        let streamWrap = null;
        let _rerenderTimer = null;
        let _revealer = null;   // 🫧 一顆一顆放泡泡的那支（_createBubbleRevealer）

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
            let _streamDotsEl = null;
            let _streamToolEl = null;
            const _ensureStreamShell = () => {
                if (streamWrap) return;
                streamWrap = document.createElement('div');
                streamWrap.className = 'claude-bubble-wrap from-claude';
                // 🫧 寫到一半的那段不畫（會露出 ** 跟 -）：先放一顆點點，寫完一段就在點點前面冒出一顆
                _streamDotsEl = document.createElement('div');
                _streamDotsEl.className = 'claude-bubble from-claude claude-bubble-dots';
                _streamDotsEl.innerHTML = DOTS_HTML;
                streamWrap.appendChild(_streamDotsEl);
                stream.appendChild(streamWrap);
                _revealer = _createBubbleRevealer(streamWrap, _streamDotsEl, (seg) => {
                    const el = document.createElement('div');
                    el.className = 'claude-bubble from-claude claude-bubble-still';
                    _fillReplyBubble(el, seg);
                    return el;
                }, _scrollClaudeChatToBottom);
            };
            // 切段跟最終那次畫法同一套：拿掉留言板標籤與 ASK 標記再切
            const _replySegments = (raw, streaming) => {
                const CT = window.ClaudeTerminal;
                let shown = (CT && typeof CT.stripBoardTags === 'function')
                    ? CT.stripBoardTags(raw, { streaming: streaming }) : raw;
                if (!streaming && !shown && String(raw || '').trim()) shown = '（去留言板上動了一下）';
                return _splitReplySegments(_voiceize(_widgetize(_parseAskMarkers(shown || '').stripped, streaming), streaming));
            };
            const _flushStreamingRender = () => {
                _rerenderTimer = null;
                if (!here()) return;   // 她切到別間了：不畫進別人的房間
                // 切走又切回來：房間重畫過、原本那個殼不在畫面上了，重新起一個（已經寫完的段落從頭放）
                if (streamWrap && !streamWrap.isConnected) { streamWrap = null; _streamToolEl = null; }
                _ensureStreamShell();
                // 最後一段可能還在寫，只放前面寫完的
                const segs = _replySegments(acc.text, true);
                if (segs.length - 1 > _revealer.count) _revealer.push(segs.slice(_revealer.count, segs.length - 1));
                if (acc.tools.length) {
                    if (!_streamToolEl) {
                        _streamToolEl = document.createElement('div');
                        _streamToolEl.className = 'claude-stream-doing';
                        // 🚨 掛在氣泡「下面」，不是上面。原本是 insertBefore：他已經講了一段、
                        // 接著去跑工具時，提示會出現在她剛讀完那段的上方，而她的視線在下面等下一句，
                        // 加上串流會自動捲到底 —— 等於那行提示永遠在視野外。她的話是
                        // 「看起來像第一段輸出了、以為說完了」。掛下面才在她眼睛正在看的位置。
                        streamWrap.appendChild(_streamToolEl);
                    }
                    const last = acc.tools[acc.tools.length - 1];
                    const more = acc.tools.length > 1 ? `（第 ${acc.tools.length} 個）` : '';
                    _streamToolEl.textContent = `🔧 ${_toolDoingLabel(last)}${more}` + (acc.callN > 1 ? '・第 ' + acc.callN + ' 通' : '');
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
                    if (!_typingSwitched && here()) {
                        _typingSwitched = true;
                        _setClaudePortraitState('typing');
                    }
                    acc.text = ev.accumulated || (acc.text + (ev.delta || ''));
                    rerenderStreaming();
                } else if (ev.type === 'tool_use' && ev.tool) {
                    acc.tools.push(ev.tool);
                    rerenderStreaming();
                } else if (ev.type === 'xj_call') {
                    acc.callN = ev.n;
                    rerenderStreaming();
                }
            };

            // 這一輪從什麼時候、跟誰開始（回完拿他這一輪提的單子用）
            const _turnAt = Date.now() / 1000;
            const _turnRid = rid;
            const result = await window.ClaudeTerminal.send(text, attachmentsSnapshot, onProgress, {
                taskId: me.taskId,
                signal: me.ctrl.signal,
                fromHeld: true,
                ctx: ctx,
            });
            held.forEach(m => { delete m.held; });
            if (here()) _paintHeld();
            const reply = result.reply;
            const thinking = result.thinking || null;
            const usage = result.usage || null;
            const toolsUsed = (Array.isArray(result.toolsUsed) && result.toolsUsed.length) ? result.toolsUsed : null;
            const images = (Array.isArray(result.images) && result.images.length) ? result.images : null;
            const xj = result.xiaoji || null;   // API 小機：單子整張回來了，不去橋上拿
            const props = xj ? _xjProps(xj.props) : await _turnProps(_turnRid, _turnAt, toolsUsed);

            // 累計到額度面板（💰 app）：記是誰、哪一種住戶，面板才分得了頁
            if (usage && window.OS_SPEND_PANEL && typeof window.OS_SPEND_PANEL.record === 'function') {
                try { window.OS_SPEND_PANEL.record(usage, { rid: _turnRid, provider: me.provider }); } catch (_) {}
            }

            // 先取消還在排程中的 throttled rerender,避免 final render 後又冒一個多餘 stream bubble
            if (_rerenderTimer) {
                clearTimeout(_rerenderTimer);
                _rerenderTimer = null;
            }

            // 🫧 還沒冒出來的段落照同一個節奏放完（整則一次到的也是在這裡一顆一顆放），
            //    放完才換成完整那份：思考、工具、附件、用量掛上去，泡泡不再播一次動畫
            if (here() && String(reply || '').trim()) {
                if (streamWrap && !streamWrap.isConnected) { streamWrap = null; _streamToolEl = null; }
                _ensureStreamShell();
                if (_streamToolEl && _streamToolEl.parentNode) _streamToolEl.parentNode.removeChild(_streamToolEl);
                _revealer.push(_replySegments(reply, false).slice(_revealer.count));
                await _revealer.drain();
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
            if (props) assistantRecord.props = props;
            if (xj) {
                assistantRecord.calls = xj.calls;
                if (xj.log && xj.log.length) assistantRecord.xjlog = xj.log.map(x => ({ label: x.label, ok: x.ok, text: String(x.text || '').slice(0, 12000) }));   // 下一句才改的時候要抄得到原文（OS_XIAOJI 只把最近那則留長）
            }
            if (!here()) {
                // 她已經在別間：這輪的回覆存回它自己那一串，不畫、不動立繪；她回到這間時房間會重新載入
                hist.push(assistantRecord);
                await window.ClaudeTerminal.saveHistory(hist, ctx);
                return;
            }
            _activeHistory().push(assistantRecord);

            // session_id resume 失敗：cc-bridge 退回新 session、Claude 不記得前文
            if (result.sessionFallback) {
                _renderClaudeBubble('assistant',
                    '⚠️ 之前的 session 失效了（cc-bridge 重啟過 / log 被清 / 太久沒聊）。\n\n' +
                    '我從零開始記新對話了。如果想讓我知道之前聊過什麼，把重點再講一次給我聽吧。\n\n' +
                    '---\n\n' + reply,
                    { thinking, usage, toolsUsed, attachments: images, props, still: true, msg: assistantRecord }
                );
                _setClaudePortraitState('happy');
                setTimeout(() => _setClaudePortraitState('living'), 600);
            } else {
                _renderClaudeBubble('assistant', reply, { thinking, usage, toolsUsed, attachments: images, props, still: true, calls: xj ? xj.calls : 0, stopped: !!(xj && xj.stopped), msg: assistantRecord });
                _setClaudePortraitState('happy');
                setTimeout(() => _setClaudePortraitState('living'), 600);
            }
            _scheduleSave();
            // 新 conv 的標題會在 saveHistory 自動從第一條 user msg 抓 → 更新左上角小卡
            if (typeof window._VoidClaudeUpdateChip === 'function') {
                try { window._VoidClaudeUpdateChip(); } catch (_) {}
            }
        } catch (e) {
            if (!here()) return;   // 已經在別間：不畫錯誤進別人的房間（送的那支已經把她這句存回原樣）
            const isAbort = e?.name === 'AbortError' || /abort/i.test(e?.message || '');
            // 失敗：她放著的那幾條留著、還是等著（送的那支也存回原樣），再按一次魔杖就好
            _paintHeld();

            if (isAbort) {
                // 主動停止：靜默顯示已停止氣泡，不噴錯誤
                _setClaudePortraitState('living');
                _renderClaudeBubble('assistant', '⏹ 已停止');
            } else if (_modelErrorText(e)) {
                // 模型那邊擋下或出錯：一行系統提示，不畫成他的泡泡
                _setClaudePortraitState('living');
                _renderClaudeNotice(_modelErrorText(e));
            } else {
                _setClaudePortraitState('error');
                const raw = (e && e.message) || '未知錯誤';
                const [code, ...rest] = raw.split(':');
                const detail = rest.join(':') || raw;
                let userMsg;
                switch (code) {
                    case 'XIAOJI':         userMsg = '⚠️ ' + detail; break;
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
            if (_revealer) _revealer.stop();
            if (streamWrap && streamWrap.parentNode) {
                streamWrap.parentNode.removeChild(streamWrap);
                streamWrap = null;
            }

            // 這一輪收了：送出鈕照現在開著那間重畫（是這間就回紙飛機；別間在跑就留著它的 ⏹）
            if (_inflight[rid] === me) delete _inflight[rid];
            _paintSendBtn();
        }
    }

    VoidClaudeRoom.setHistory        = function (arr) { _roomHistory = Array.isArray(arr) ? arr : []; };
    VoidClaudeRoom.getHistory        = _activeHistory;
    VoidClaudeRoom.applyRoomUi       = _applyClaudeRoomUi;
    VoidClaudeRoom.updatePortalBtn   = _updateClaudePortalBtn;
    // 給設置頁的「模型取名」用:官方清單(去 ⭐)
    VoidClaudeRoom.claudeModels = CLAUDE_MODELS.map(m => ({ id: m.id, label: m.label.replace(' ⭐', '') }));
    VoidClaudeRoom.updatePickerLabel = _updateClaudePickerLabel;
    VoidClaudeRoom.openPicker        = _openClaudePickerPopup;
    VoidClaudeRoom.closePicker       = _closeClaudePickerPopup;
    VoidClaudeRoom.setPortraitState  = _setClaudePortraitState;
    VoidClaudeRoom.renderBubble      = _renderClaudeBubble;
    VoidClaudeRoom.renderReply       = _renderClaudeReply;
    VoidClaudeRoom.hydrateStream     = _hydrateClaudeStream;
    VoidClaudeRoom.handleFilePick    = _handleClaudeFilePick;
    VoidClaudeRoom.sendMessage       = _sendClaudeMessage;
    VoidClaudeRoom.holdMessage       = _holdMessage;       // 🤚 只放上去、不叫他回
    VoidClaudeRoom.replyNow          = _replyNow;          // 🤚 魔杖：把放著的一起送
    VoidClaudeRoom.paintHeld         = _paintHeld;
    VoidClaudeRoom.micStart          = _micStart;          // 🎙 按住說話
    VoidClaudeRoom.markdownToSafeHtml = _claudeMarkdownToSafeHtml;
    VoidClaudeRoom.splitReplySegments = _splitReplySegments;   // 群聊切泡泡用同一支
    VoidClaudeRoom.buildBugCards = _buildBugCards;             // 群聊的待修卡也用同一支
    VoidClaudeRoom.isStickerSegment = _isStickerSeg;
    VoidClaudeRoom.hideMdImages       = _hideMdImages;
    // 群聊借這兩支：折疊塊與串流中的人話標籤，兩邊長一樣、只維護一份
    VoidClaudeRoom.buildToolSummary   = _buildToolSummary;
    VoidClaudeRoom.buildThinkingBlock = _buildThinkingBlock;
    VoidClaudeRoom.modelErrorText     = _modelErrorText;   // 群聊也照這句話畫系統提示
    // 群聊也一顆一顆放泡泡，同一個節奏
    VoidClaudeRoom.createBubbleRevealer = _createBubbleRevealer;
    VoidClaudeRoom.DOTS_HTML          = DOTS_HTML;
    VoidClaudeRoom.renderUserSticker  = _renderUserSticker;   // 群聊她送的表情包也畫成圖
    VoidClaudeRoom.toolDoingLabel     = _toolDoingLabel;

    console.log('✅ VoidClaudeRoom（Claude 房間 UI）模組就緒');
})(window.VoidClaudeRoom = window.VoidClaudeRoom || {});
