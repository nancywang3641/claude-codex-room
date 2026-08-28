/*
 * Claude / Codex 房間 —— 獨立 SillyTavern 擴展
 * ------------------------------------------------------------------
 * 原本寄宿在「奧瑞亞 (my-tavern-extension)」裡，現在獨立成自己的擴展。
 * 房間核心 5 檔（chat_window / chat_room / claude_terminal / chat_group
 * / chat_canvas）原封不動沿用；本檔負責：
 *   1) 補上房間需要的兩個全域：OS_SETTINGS（cc-bridge 連線設定）、
 *      OS_DB（IndexedDB 對話存檔）—— 若奧瑞亞同時在場，讓給奧瑞亞、不覆蓋。
 *   2) 依序載入核心 5 檔 + CSS。
 *   3) 右下角掛一顆常駐浮球，點了開房間選單。
 * ------------------------------------------------------------------
 */
(async function () {
    'use strict';
    const TAG = '[claude-codex-room]';

    // 防重複載入：腳本庫的載入口跟酒館擴展清單可能同時把本檔拉起來，跑兩次會出現兩份浮窗。
    if (window.__CCR_LOADED__) { console.log(TAG, '已載入，略過重複執行'); return; }
    window.__CCR_LOADED__ = true;

    // 本擴展自己的資料夾 URL。刻意不用 import.meta.url —— 那東西只有 ES 模組能寫，
    // 一旦本檔被當普通 script 注入（載入口用的就是這條路）整份會直接 parse error。
    //   ① __CCR_BASE__：載入口 / boot.js 事先設好（最準）
    //   ② document.currentScript：普通 script 注入時就是自己
    //   ③ 掃 script 標籤找 claude-codex-room/index.js
    //   ④ 都沒有（酒館擴展清單用 import 載入）→ 相對主頁面推本機資料夾
    const HERE = (function () {
        const b = window.__CCR_BASE__ || (function () { try { return window.parent && window.parent.__CCR_BASE__; } catch (e) { return null; } })();
        if (b) return String(b).replace(/\/+$/, '') + '/';
        try { if (document.currentScript && document.currentScript.src) return new URL('.', document.currentScript.src).href; } catch (e) {}
        try {
            const ss = document.getElementsByTagName('script');
            for (let i = ss.length - 1; i >= 0; i--) {
                const m = (ss[i].src || '').match(/^(.*\/claude-codex-room\/)index\.js/);
                if (m) return m[1];
            }
        } catch (e) {}
        try { return new URL('scripts/extensions/third-party/claude-codex-room/', document.baseURI).href; } catch (e) {}
        return './';
    })();
    console.log(TAG, '資料夾 =', HERE);

    // 角色立繪 SVG 一律走本擴展自己的資料夾（原生安裝＝本機路徑、酒館助手＝CDN 絕對網址），
    // 不再借奧瑞亞的素材。claude_terminal.js 讀這個。
    window.__CCR_ASSET_BASE__ = HERE + 'core/assets/claude/';

    // ====================================================================
    // 1. OS_SETTINGS shim —— cc-bridge 連線預設（URL / Key / model）
    //    只在奧瑞亞不在場時才定義，避免雙份設定打架。
    //    儲存鍵沿用 'os_claude_room_config'，跟奧瑞亞共用 → 舊設定讀得到。
    // ====================================================================
    function _ensureOsSettingsShim() {
        if (window.OS_SETTINGS && typeof window.OS_SETTINGS.getClaudeRoomConfig === 'function') return false;
        const CLAUDE_ROOM_STORAGE_KEY = 'os_claude_room_config';

        function loadClaudeRoomConfig() {
            let saved = localStorage.getItem(CLAUDE_ROOM_STORAGE_KEY);
            const defaultPresets = [];
            let config = {
                presets: defaultPresets,
                activePresetId: '',
                model: 'claude-fable-5',
                maxTokens: 4096,
                temperature: 1.0,
                top_p: 1.0,
                inlineModel: '',
                inlineEffort: '',
                inlineBackend: '',
            };
            if (saved) {
                try { config = { ...config, ...JSON.parse(saved) }; } catch (e) {}

                // 舊版 endpoints → presets 一次性遷移
                if (saved.includes('"endpoints"') && (!config.presets || config.presets.length === 1)) {
                    try {
                        const old = JSON.parse(saved);
                        const migrated = [];
                        if (old.endpoints) {
                            for (const [slotId, ep] of Object.entries(old.endpoints)) {
                                const key = ep.token || ep.apiKey || '';
                                if (ep.url || key) {
                                    migrated.push({ id: slotId, name: ep.name || slotId, url: ep.url || '', key });
                                }
                            }
                        }
                        if (migrated.length) {
                            config.presets = migrated;
                            config.activePresetId = old.activeEndpoint || migrated[0].id;
                        }
                    } catch (e) {}
                }

                // 更早的單一 url/key → presets
                if (saved.includes('"url"') && (!config.presets || config.presets.every(p => !p.url && !p.key))) {
                    try {
                        const old = JSON.parse(saved);
                        if (old.url || old.key) {
                            config.presets = [{ id: 'legacy', name: '預設', url: old.url || '', key: old.key || '' }];
                            config.activePresetId = 'legacy';
                        }
                    } catch (e) {}
                }

                if (!config.presets || !config.presets.length) config.presets = defaultPresets;
                if (!config.presets.find(p => p.id === config.activePresetId)) {
                    config.activePresetId = (config.presets[0] && config.presets[0].id) || '';
                }
            }
            return config;
        }

        function getActivePreset(config) {
            config = config || loadClaudeRoomConfig();
            const presets = config.presets || [];
            return presets.find(p => p.id === config.activePresetId) || presets[0] || { id: '', name: '', url: '', key: '' };
        }

        function saveClaudeRoomConfig(data) {
            localStorage.setItem(CLAUDE_ROOM_STORAGE_KEY, JSON.stringify(data));
        }

        window.OS_SETTINGS = Object.assign(window.OS_SETTINGS || {}, {
            getClaudeRoomConfig: loadClaudeRoomConfig,
            saveClaudeRoomConfig: saveClaudeRoomConfig,
            getActiveClaudePreset: getActivePreset,
            getActiveClaudeEndpoint: function () {
                const p = getActivePreset();
                return { id: p.id, name: p.name, url: p.url, token: p.key, apiKey: '' };
            },
        });
        console.log(TAG, 'OS_SETTINGS shim 就緒（獨立模式）');
        return true;
    }
    // 誰在我們之後整份指派 window.OS_SETTINGS，這組 shim 就被抹掉了
    //（症狀：設置分頁寫「設定模組未載入」、底部欄按了沒反應）。
    // 留一個補裝入口，任何時候發現不見都能補回來，不必重載整個酒館。
    window.__CCR_ENSURE_SETTINGS__ = _ensureOsSettingsShim;
    _ensureOsSettingsShim();

    // ====================================================================
    // 2. OS_DB shim —— IndexedDB 對話存檔（studio_chats）
    //    沿用奧瑞亞同一個 DB（WeChat_Simulator_DB / studio_chats），
    //    舊對話直接讀得到。只用到房間需要的 3 個方法。
    // ====================================================================
    if (!window.OS_DB || typeof window.OS_DB.getStudioChat !== 'function') {
        const DB_NAME = 'WeChat_Simulator_DB';
        const STORE = 'studio_chats';
        let _db = null;

        function _ensureStore(db) {
            return db && db.objectStoreNames && db.objectStoreNames.contains(STORE);
        }

        function _init() {
            return new Promise((resolve, reject) => {
                if (_db) { resolve(_db); return; }
                // 不指定版本 → 開既有版本，或全新建 v1
                let req;
                try { req = indexedDB.open(DB_NAME); }
                catch (e) { reject(e); return; }

                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!_ensureStore(db)) db.createObjectStore(STORE, { keyPath: 'id' });
                };
                req.onsuccess = (e) => {
                    const db = e.target.result;
                    if (_ensureStore(db)) { _db = db; resolve(_db); return; }
                    // 既有 DB 但缺 studio_chats → 升一版補上
                    const v = db.version + 1;
                    db.close();
                    let req2;
                    try { req2 = indexedDB.open(DB_NAME, v); }
                    catch (e2) { reject(e2); return; }
                    req2.onupgradeneeded = (ev) => {
                        const db2 = ev.target.result;
                        if (!_ensureStore(db2)) db2.createObjectStore(STORE, { keyPath: 'id' });
                    };
                    req2.onsuccess = (ev) => { _db = ev.target.result; resolve(_db); };
                    req2.onerror = (ev) => reject(ev.target.error);
                };
                req.onerror = (e) => reject(e.target.error);
            });
        }

        window.OS_DB = Object.assign(window.OS_DB || {}, {
            saveStudioChat: async function (modeId, messages) {
                const db = await _init();
                return new Promise((resolve, reject) => {
                    try {
                        const tx = db.transaction(STORE, 'readwrite');
                        tx.objectStore(STORE).put({ id: modeId, messages: messages, timestamp: Date.now() });
                        tx.oncomplete = () => resolve(true);
                        tx.onerror = (e) => reject(e.target.error);
                    } catch (e) { reject(e); }
                });
            },
            getStudioChat: async function (modeId) {
                const db = await _init();
                return new Promise((resolve, reject) => {
                    try {
                        const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(modeId);
                        r.onsuccess = () => resolve(r.result ? r.result.messages : []);
                        r.onerror = (e) => reject(e.target.error);
                    } catch (e) { reject(e); }
                });
            },
            clearStudioChat: async function (modeId) {
                const db = await _init();
                return new Promise((resolve, reject) => {
                    try {
                        const tx = db.transaction(STORE, 'readwrite');
                        tx.objectStore(STORE).delete(modeId);
                        tx.oncomplete = () => resolve(true);
                        tx.onerror = (e) => reject(e.target.error);
                    } catch (e) { reject(e); }
                });
            },
        });
        console.log(TAG, 'OS_DB shim 就緒（獨立模式，共用 studio_chats）');
    }

    // ====================================================================
    // 3. 載入 CSS + 核心 5 檔
    // ====================================================================
    // 手機瀏覽器把這批靜態檔快取得很兇,沒版本參數的話核心檔更新永遠到不了手機
    // (症狀:桌機是新版、手機停在幾個月前,甚至 chat_window 跟 chat_room 各停在不同版本)。
    // 檔案有改就把 VER +1,跟奧瑞亞 sw.js 的 CACHE_VERSION 同一套習慣。
    const VER = 34;

    function loadCSS(href) {
        if (document.querySelector('link[data-ccr="' + href + '"]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href + '?v=' + VER;
        link.setAttribute('data-ccr', href);
        document.head.appendChild(link);
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src + '?v=' + VER;
            s.async = false; // 保序
            s.onload = () => resolve(src);
            s.onerror = () => reject(new Error('載入失敗: ' + src));
            document.head.appendChild(s);
        });
    }

    // room_content.css 要排在 chat_window.css 前（對齊奧瑞亞載入序：
    // 核心 .claude-* 基底樣式先進，chat_window.css 的 codex/deepseek 變體覆寫在後）
    loadCSS(HERE + 'css/room_content.css');
    loadCSS(HERE + 'css/chat_window.css');
    loadCSS(HERE + 'css/void_claude_recents.css'); // 對話切換 chip + 多會話列表
    loadCSS(HERE + 'css/void_claude_ask.css');      // AI 互動選項按鈕(ASK markers)
    loadCSS(HERE + 'css/os_workbench.css');         // 🛠️ 工作檯
    loadCSS(HERE + 'css/os_spend.css');             // 💰 額度
    loadCSS(HERE + 'css/os_board.css');             // 📝 留言板
    loadCSS(HERE + 'css/dorm.css');                 // 🏠 宿舍面板
    loadCSS(HERE + 'css/launcher.css');

    const FILES = [
        'core/claude_terminal.js', // window.ClaudeTerminal（os_workbench/os_board 依賴它）
        'core/chat_canvas.js',     // window.ChatCanvas / VoidCanvas
        'core/chat_window.js',     // window.ChatWindow（外殼）
        'core/chat_room.js',       // window.VoidClaudeRoom
        'core/chat_group.js',      // window.ChatGroup
        'core/os_spend_panel.js',  // 💰 額度（OS_SPEND_PANEL，房間送訊息時 record 花費）
        'core/os_board.js',        // 📝 留言板（OS_BOARD，讀 cc-bridge /v1/board）
        'core/os_workbench.js',    // 🛠️ 工作檯（OS_WORKBENCH，用 ClaudeTerminal.sendWorkbench）
        'core/dorm.js',         // 🏠 宿舍面板（DormPanel，💬 點開的門卡）
    ];
    for (const f of FILES) {
        try { await loadScript(HERE + f); }
        catch (e) { console.error(TAG, e); }
    }

    // 載入期間別人可能整份蓋掉 OS_SETTINGS，這裡補一次
    if (_ensureOsSettingsShim()) console.warn(TAG, 'OS_SETTINGS 被蓋掉過，已補回 getClaudeRoomConfig');

    // ====================================================================
    // 4. 入口 —— 點了開宿舍面板（一排門卡，點門進房）
    //    桌機：塞進輸入框左邊的 #leftSendForm（跟原本在奧瑞亞時同一個位置）
    //    手機 / 抓不到輸入框：右下角常駐浮球
    //    另註冊 /aurelia-chat 斜線命令 —— 原本在奧瑞亞註冊，QR 欄的 💬 按鈕靠它，接手才不會壞
    // ====================================================================
    function _openMenu(anchor) {
        if (window.ChatWindow && typeof window.ChatWindow.toggleLauncherMenu === 'function') {
            window.ChatWindow.toggleLauncherMenu(anchor || document.body);
        } else {
            console.warn(TAG, 'ChatWindow 尚未就緒');
        }
    }

    function _getBtn() {
        let btn = document.getElementById('ccr-launcher');
        if (btn) return btn;
        btn = document.createElement('div');
        btn.id = 'ccr-launcher';
        btn.title = '宿舍';
        btn.textContent = '💬';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            _openMenu(btn);
        });
        return btn;
    }

    // 依當前視窗寬度 / DOM 決定按鈕落點（冪等，重複呼叫安全）
    function _place() {
        const btn = _getBtn();
        const leftSendForm = document.getElementById('leftSendForm');
        const inline = window.innerWidth >= 768 && !!leftSendForm;
        if (inline) {
            if (btn.parentElement !== leftSendForm) leftSendForm.insertBefore(btn, leftSendForm.firstChild);
            btn.classList.add('ccr-inline');
        } else {
            if (btn.parentElement !== document.body) document.body.appendChild(btn);
            btn.classList.remove('ccr-inline');
        }
    }

    function mountLauncher() {
        _place();
        window.addEventListener('resize', _place);
        // 換聊天時酒館會重建輸入框 DOM → 按鈕要重新插回去（走官方事件，不開輪詢）
        try {
            const ctx = window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext();
            if (ctx && ctx.eventSource && ctx.eventTypes && ctx.eventTypes.CHAT_CHANGED) {
                ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => setTimeout(_place, 200));
            }
            // 斜線命令（冪等）：QR 欄的 💬 按鈕送的就是 /aurelia-chat
            if (ctx && ctx.SlashCommandParser && ctx.SlashCommandParser.addCommandObject
                && ctx.SlashCommand && ctx.SlashCommand.fromProps && !window.__CCR_CMD__) {
                ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
                    name: 'aurelia-chat',
                    callback: () => { try { _openMenu(document.getElementById('qr--bar')); } catch (e) {} return ''; },
                    helpString: '開啟宿舍面板',
                }));
                window.__CCR_CMD__ = true;
            }
        } catch (e) { console.warn(TAG, '酒館事件/斜線命令掛載失敗（不影響按鈕）', e); }
    }

    if (document.body) mountLauncher();
    else document.addEventListener('DOMContentLoaded', mountLauncher);

    // ====================================================================
    // 5. 板子動靜 —— 丹留了新東西時,入口鈕亮一顆小點(最軟的提醒:不彈窗、不出聲)。
    //    她的主軸在奧瑞亞,房間常被忘掉;這顆點是丹的聲音傳到她住的地方的方式。
    //    peek=1 只偷看、不算「她翻過板子」;真正打開留言板那次才算讀過
    //    (讀過的時間會回到丹的喚醒詞裡,他知道妳多久沒來)。
    // ====================================================================
    async function _checkBoardNews() {
        try {
            const CT = window.ClaudeTerminal;
            const cfg = CT && CT.getConfig && CT.getConfig();
            if (!cfg || !cfg.url || !cfg.key) return;
            const url = cfg.url.replace(/\/v1\/chat\/completions$/, '/v1/board');
            const r = await fetch(url + '?limit=20&peek=1', { headers: { 'Authorization': 'Bearer ' + cfg.key } });
            if (!r.ok) return;
            const data = await r.json();
            const posts = Array.isArray(data.posts) ? data.posts : [];
            if (!posts.length) return;
            const newest = posts[0].created_at || '';
            const seen = localStorage.getItem('ccr_board_seen') || '';
            if (!newest || newest <= seen) return;
            const hasProposal = posts.some(p => (p.created_at || '') > seen
                && Array.isArray(p.tags) && p.tags.some(t => String(t).toLowerCase() === 'proposal'));
            const btn = _getBtn();
            btn.classList.add(hasProposal ? 'ccr-news-prop' : 'ccr-news');
            btn.title = hasProposal ? '丹有想跟妳說的' : '板子上有新紙條';
        } catch (e) { /* 連不上就安靜,這顆點不值得吵人 */ }
    }
    setTimeout(_checkBoardNews, 4000);

    console.log(TAG, '✅ 獨立房間擴展載入完成');
})();
