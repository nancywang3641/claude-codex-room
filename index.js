/*
 * Claude / Codex ?輸? ???函? SillyTavern ?游?
 * ------------------------------------------------------------------
 * ?撖挪?具尼?? (my-tavern-extension)?ㄐ嚗?函蝡??芸楛?撅? * ?輸??詨? 5 瑼?chat_window / chat_room / claude_terminal / chat_group
 * / chat_canvas嚗?撠??窒?剁??祆?鞎痊嚗? *   1) 鋆??輸??閬??拙??OS_SETTINGS嚗c-bridge ???閮剖?嚗? *      OS_DB嚗ndexedDB 撠店摮?嚗??亙尼?????典嚗?蝯血尼????閬??? *   2) 靘?頛?詨? 5 瑼?+ CSS?? *   3) ?喃?閫?銝憿虜擏筑??暺????柴? * ------------------------------------------------------------------
 */
(async function () {
    'use strict';
    const TAG = '[claude-codex-room]';

    // ?脤?銴??伐??單摨怎?頛????尹?游?皜?航???瑼?韏瑚?嚗??拇活??曉隞賣筑蝒?    if (window.__CCR_LOADED__) { console.log(TAG, '撌脰??伐??仿????瑁?'); return; }
    window.__CCR_LOADED__ = true;

    // ?祆撅撌梁?鞈?憭?URL?????import.meta.url ????镼踹??ES 璅∠??賢神嚗?    // 銝?行瑼◤?嗆??script 瘜典嚗??亙?函?撠望??頝荔??港遢???parse error??    //   ??__CCR_BASE__嚗??亙 / boot.js 鈭?閮剖末嚗?皞?
    //   ??document.currentScript嚗??script 瘜典?停?航撌?    //   ????script 璅惜??claude-codex-room/index.js
    //   ???賣????尹?游?皜??import 頛嚗? ?詨?銝駁??Ｘ?祆?鞈?憭?    const HERE = (function () {
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
    console.log(TAG, '鞈?憭?=', HERE);

    // 閫蝡鼓 SVG 銝敺粥?祆撅撌梁?鞈?憭橘???摰?嚗璈楝敺?擗典??CDN 蝯?蝬脣?嚗?
    // 銝??尼?????laude_terminal.js 霈??    window.__CCR_ASSET_BASE__ = HERE + 'core/assets/claude/';

    // ====================================================================
    // 1. OS_SETTINGS shim ??cc-bridge ????身嚗RL / Key / model嚗?    //    ?芸憟抒?鈭??典??摰儔嚗??隞質身摰??嗚?    //    ?脣??菜窒??'os_claude_room_config'嚗?憟抒?鈭?????身摰?敺??    // ====================================================================
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

                // ?? endpoints ??presets 銝甈⊥折蝘?                if (saved.includes('"endpoints"') && (!config.presets || config.presets.length === 1)) {
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

                // ?湔?銝 url/key ??presets
                if (saved.includes('"url"') && (!config.presets || config.presets.every(p => !p.url && !p.key))) {
                    try {
                        const old = JSON.parse(saved);
                        if (old.url || old.key) {
                            config.presets = [{ id: 'legacy', name: '?身', url: old.url || '', key: old.key || '' }];
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
        console.log(TAG, 'OS_SETTINGS shim 撠梁?嚗蝡芋撘?');
        return true;
    }
    // 隤啣??敺隞賣?瘣?window.OS_SETTINGS嚗? shim 撠梯◤?寞?鈭?    //嚗??嚗身蝵桀??神?身摰芋蝯頛???冽???瘝?????    // ????鋆???隞颱???曆?閬?質???嚗?敹?頛??擗具?    window.__CCR_ENSURE_SETTINGS__ = _ensureOsSettingsShim;
    _ensureOsSettingsShim();

    // ====================================================================
    // 2. OS_DB shim ??IndexedDB 撠店摮?嚗tudio_chats嚗?    //    瘝輻憟抒?鈭?銝??DB嚗eChat_Simulator_DB / studio_chats嚗?
    //    ??閰梁?亥?敺??典?輸??閬? 3 ?瘜?    // ====================================================================
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
                // 銝?摰?????????穿???啣遣 v1
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
                    // ?Ｘ? DB 雿撩 studio_chats ??????銝?                    const v = db.version + 1;
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
        console.log(TAG, 'OS_DB shim 撠梁?嚗蝡芋撘??梁 studio_chats嚗?);
    }

    // ====================================================================
    // 3. 頛 CSS + ?詨? 5 瑼?    // ====================================================================
    // ???汗?冽????瑼翰??敺?,瘝??砍??貊?閰望敹??湔瘞賊??唬?鈭?璈?    // (??:獢??舀??璈??典嗾????? chat_window 頝?chat_room ???其???????    // 瑼??撠望? VER +1,頝尼?? sw.js ??CACHE_VERSION ??憟????    const VER = 11;

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
            s.async = false; // 靽?
            s.onload = () => resolve(src);
            s.onerror = () => reject(new Error('頛憭望?: ' + src));
            document.head.appendChild(s);
        });
    }

    // room_content.css 閬???chat_window.css ??撠?憟抒?鈭??亙?嚗?    // ?詨? .claude-* ?箏?璅???莎?chat_window.css ??codex/deepseek 霈?閬神?典?嚗?    loadCSS(HERE + 'css/room_content.css');
    loadCSS(HERE + 'css/chat_window.css');
    loadCSS(HERE + 'css/void_claude_recents.css'); // 撠店?? chip + 憭?閰勗?銵?    loadCSS(HERE + 'css/void_claude_ask.css');      // AI 鈭??賊???(ASK markers)
    loadCSS(HERE + 'css/os_workbench.css');         // ??儭?撌乩?瑼?    loadCSS(HERE + 'css/os_spend.css');             // ? 憿漲
    loadCSS(HERE + 'css/os_board.css');             // ?? ????    loadCSS(HERE + 'css/dorm.css');                 // ?? 摰輯??Ｘ
    loadCSS(HERE + 'css/launcher.css');

    const FILES = [
        'core/claude_terminal.js', // window.ClaudeTerminal嚗s_workbench/os_board 靘陷摰?
        'core/chat_canvas.js',     // window.ChatCanvas / VoidCanvas
        'core/chat_window.js',     // window.ChatWindow嚗?畾潘?
        'core/chat_room.js',       // window.VoidClaudeRoom
        'core/chat_group.js',      // window.ChatGroup
        'core/os_spend_panel.js',  // ? 憿漲嚗S_SPEND_PANEL嚗???舀? record ?梯祥嚗?        'core/os_board.js',        // ?? ???選?OS_BOARD嚗? cc-bridge /v1/board嚗?        'core/os_workbench.js',    // ??儭?撌乩?瑼荔?OS_WORKBENCH嚗 ClaudeTerminal.sendWorkbench嚗?        'core/dorm.js',         // ?? 摰輯??Ｘ嚗ormPanel嚗??暺????∴?
    ];
    for (const f of FILES) {
        try { await loadScript(HERE + f); }
        catch (e) { console.error(TAG, e); }
    }

    // 頛???乩犖?航?港遢?? OS_SETTINGS嚗ㄐ鋆?甈?    if (_ensureOsSettingsShim()) console.warn(TAG, 'OS_SETTINGS 鋡怨???嚗歇鋆? getClaudeRoomConfig');

    // ====================================================================
    // 4. ?亙 ??暺??挪??選?銝???∴?暺??脫嚗?    //    獢?嚗??脰撓?交?撌阡???#leftSendForm嚗???典尼????銝??蝵殷?
    //    ?? / ???啗撓?交?嚗銝?撣賊?瘚桃?
    //    ?西酉??/aurelia-chat ???賭誘 ????典尼??閮餃?嚗R 甈? ? ????嚗??銝?憯?    // ====================================================================
    function _openMenu(anchor) {
        if (window.ChatWindow && typeof window.ChatWindow.toggleLauncherMenu === 'function') {
            window.ChatWindow.toggleLauncherMenu(anchor || document.body);
        } else {
            console.warn(TAG, 'ChatWindow 撠撠梁?');
        }
    }

    function _getBtn() {
        let btn = document.getElementById('ccr-launcher');
        if (btn) return btn;
        btn = document.createElement('div');
        btn.id = 'ccr-launcher';
        btn.title = '摰輯?';
        btn.textContent = '?';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            _openMenu(btn);
        });
        return btn;
    }

    // 靘??蝒祝摨?/ DOM 瘙箏????賡?嚗蝑????澆摰嚗?    function _place() {
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
        // ??憭拇??尹??撱箄撓?交? DOM ????閬??唳??嚗粥摰鈭辣嚗??憚閰ｇ?
        try {
            const ctx = window.SillyTavern && window.SillyTavern.getContext && window.SillyTavern.getContext();
            if (ctx && ctx.eventSource && ctx.eventTypes && ctx.eventTypes.CHAT_CHANGED) {
                ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => setTimeout(_place, 200));
            }
            // ???賭誘嚗蝑?嚗R 甈? ? ????撠望 /aurelia-chat
            if (ctx && ctx.SlashCommandParser && ctx.SlashCommandParser.addCommandObject
                && ctx.SlashCommand && ctx.SlashCommand.fromProps && !window.__CCR_CMD__) {
                ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
                    name: 'aurelia-chat',
                    callback: () => { try { _openMenu(document.getElementById('qr--bar')); } catch (e) {} return ''; },
                    helpString: '??摰輯??Ｘ',
                }));
                window.__CCR_CMD__ = true;
            }
        } catch (e) { console.warn(TAG, '?尹鈭辣/???賭誘??憭望?嚗?敶梢??嚗?, e); }
    }

    if (document.body) mountLauncher();
    else document.addEventListener('DOMContentLoaded', mountLauncher);

    console.log(TAG, '???函??輸??游?頛摰?');
})();
