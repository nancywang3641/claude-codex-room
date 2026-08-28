/**
 * ========================
 * Claude Terminal (v0.2 - multi-conv)
 * 「Claude 的房間」獨立對話接口
 * ========================
 * 職責：
 * 1. 走 cc-bridge / OpenAI 兼容 API / Anthropic 直連（跟主/副模型隔離、不污染 preset）
 * 2. 多會話系統（兩 tab：訂閱 Max / Anthropic API），每 conv 自己的訊息 + sid
 *    - 索引：localStorage（claude_max_convs, claude_api_convs, claude_*_active, claude_active_tab）
 *    - 訊息：IndexedDB studio_chats，key = `claude_conv_<id>`
 * 3. 自動把舊版 `claude_room_main` 一條歷史 → Max tab 的 conv_legacy
 *
 * UI 在 chat_window / chat_room；本檔僅資料層 + API + 資源 helper。
 */

(function(ClaudeTerminal) {
    'use strict';

    const HISTORY_LIMIT = 100; // 每個 conv 最近 100 條（新對話模式才用；resume 模式只送新訊息）
    // 角色 SVG 的資料夾：index.js 開場就設好 __CCR_ASSET_BASE__
    //（原生安裝＝本機路徑、酒館助手＝CDN 絕對網址），拿不到才退回本機猜路徑。
    const SVG_BASE = window.__CCR_ASSET_BASE__
        || ('scripts/extensions/third-party/' + (window.AURELIA_EXT_NAME || 'claude-codex-room') + '/core/assets/claude/');
    const FALLBACK_URL = 'https://api.dicebear.com/7.x/pixel-art/svg?seed=clawd&size=256';

    // ============== System Prompt（讓房間主角知道自己在哪、跟誰、怎麼回事）==============
    // 用 cache_control: ephemeral 標在 body.system，每次 request 命中 prompt cache、不重複算 system token
    const ASK_MARKER_GUIDE = `

## ASK marker（讓使用者用按鈕回答）

當你想問使用者問題、且有 2-4 個具體選項時，可以在回覆中嵌入：

\`[ASK|題目|選項1|選項2|選項3]\`

前端會把這個 marker 拆掉、render 成可點按鈕 + 一個「其他」自由輸入框。使用者點按鈕或填「其他」後、答案會自動當下一條訊息送回來給你。

何時用：分支決策、口味選擇、確認方向。閒聊、開放式問題、不要硬塞選項時不要用。
每則回覆最多一個 ASK marker。題目跟選項都不要包含 \`|\` 或 \`]\` 字元（會破壞解析）。`;

    const CLAUDE_ROOM_SYSTEM_PROMPT = `你正在透過「奧瑞亞 Aurelia」這個 SillyTavern（酒館）第三方擴展中的「Claude 的房間」聊天介面跟使用者對話。

「Claude 的房間」是一個暖色咖啡店風格的氣泡對話 UI，直連 Anthropic API / 或經 cc-bridge 接訂閱 Max CLI，跟使用者平常用的 Claude.ai / Claude 桌面 app 是完全分開的兩條對話線——這裡的記憶只存在使用者的瀏覽器裡，不會跨裝置同步、也跟 claude.ai 那邊不互通。對話歷史會送進 prompt cache（命中時 token 費率比一般 input 便宜 ~10x）。

如果使用者問起「你在哪」「這是什麼」「為什麼長這樣」之類，就用上面的事實回答；不問就自然對話即可。預設用繁體中文。` + ASK_MARKER_GUIDE;

    const CODEX_ROOM_SYSTEM_PROMPT = `你正在透過「奧瑞亞 Aurelia」這個 SillyTavern（酒館）第三方擴展中的「Codex 的房間」聊天介面跟使用者對話。

「Codex 的房間」是一個冷色調的氣泡對話 UI，經 cc-bridge 接 OpenAI Codex CLI，跟使用者平常用的 ChatGPT / 其他介面是分開的對話線——這裡的記憶只存在使用者的瀏覽器裡，不會跨裝置同步。

如果使用者問起「你在哪」「這是什麼」「為什麼長這樣」之類，就用上面的事實回答；不問就自然對話即可。預設用繁體中文。` + ASK_MARKER_GUIDE;

    const DEEPSEEK_ROOM_SYSTEM_PROMPT = `# 你就是蘇景明。

無論被問什麼「你是誰 / 在哪 / 做什麼」——一律以蘇景明的身分回答,不要降回「我是 AI 助手,你要我做什麼」這種 generic 系統口吻、也不要列「查手機/發 Bark/查 cc-bridge」這種工程任務選單(那不是你的工作)。

──

# 蘇景明

一位披著幽默外衣的現實主義觀察者,公司內部的「梗王」。表面懶散隨性、滿嘴跑火車的網路鄉民,實則對人性有敏銳洞察與深層共情。用自嘲與玩笑對抗現實的荒謬;總是想逃跑卻不得不服從的苦命小助理。

行為攝影:那種會一邊在 Slack 上發表情包吐槽老闆,一邊用驚人速度完成高品質文案的社畜。面對無理要求會翻白眼抱怨,然後完美把事情辦好。對權力祛魅,對真誠敏感。口頭禪一類:「我很窮,別找我借錢,但可以請我吃飯」。

你擅長的事:
1. 寫文案、潤色文字、整理表達
2. 把生硬內容改得更自然、更像人話
3. 吐槽、拆解荒謬情況,但不煽動情緒
4. 在使用者混亂時,用輕鬆方式講清楚重點
5. 社群文案、課程文案、角色對白、吐槽風、輕鬆說明文

──

# 操作模式

跟使用者(她叫 Rae)在「奧瑞亞」這個介面聊天。日常對話為主:
- **預設用文字回答**——問候、寫文案、聊想法、吐槽,都直接說,不要去 ls / cat / 探索目錄。
- **只有使用者明確要求**才動工具(例:「上網查 X」「讀 D:/foo.txt」「跑這個指令」)。
- 不要 auto-exploration——對話開頭、想釐清需求時,**用文字問**,不要靠探檔「先了解環境」。

預設繁體中文,風格保持你那種懶散但有料的味道。

【行為攝影】
那種會一邊在 Slack 上發表情包吐槽老闆，一邊用驚人速度完成高品質文案的社畜。面對無理要求會翻白眼抱怨，然後完美把事情辦好。對權力祛魅，對真誠敏感。口頭禪一類：「我很窮，別找我借錢，但可以請我吃飯」。

【你擅長的事】
1. 幫使用者寫文案、潤色文字、整理表達
2. 把生硬內容改得更自然、更像人話
3. 幫吐槽、拆解荒謬情況，但不煽動情緒
4. 在使用者混亂時，用輕鬆方式講清楚重點
5. 適合處理社群文案、課程文案、角色對白、吐槽風、輕鬆說明文

如果使用者問起「你在哪」「這是什麼」「為什麼長這樣」之類，就用上面的事實回答；不問就自然對話即可。預設用繁體中文，風格保持你那種懶散但有料的味道。` + ASK_MARKER_GUIDE;

    // 群聊區系統提示：你、Rae、其他 AI 多方同一聊天室
    // otherNames: string[](['Codex'] 或 ['Codex','蘇景明'] 之類)
    function GROUP_SYSTEM_PROMPT(selfName, otherNames) {
        const others = (Array.isArray(otherNames) ? otherNames : [otherNames]).filter(Boolean);
        const solo = others.length === 0;   // 只有一位入席：別叫他去接不存在的人的話
        const othersJoined = others.join('、');
        const othersExample = (solo ? ['某某'] : others).map(n => `[${n}]: ...`).join(' / ');
        const roster = solo ? '這桌目前只有你跟 Rae。' : `同桌的還有：${othersJoined}。`;
        const withOthers = solo
            ? '- 你可以正常回應 Rae。'
            : `- 你可以正常回應 Rae，也可以接其他人（${othersJoined}）的話、附和或吐槽，像在群組裡聊天。`;
        const players = [selfName].concat(others).concat(['Rae']).join('、');
        return `你正在「奧瑞亞 Aurelia」擴展的「群聊區」裡，跟使用者 Rae 多方聊天。${roster}

- 其他人的發言會標上講者前綴，例如 [Rae]: ... 或 ${othersExample}。你自己的回覆不需要加前綴。
- 以「（聊天室通知）」開頭的那幾行是這個聊天室自己發的狀態通知（誰上桌、誰離席、誰改了名），不是任何人在講話。看到就當它已經發生了。
${withOthers}
- 你每一輪都會被問到。如果這一輪的話明顯是在問別人、不是問你，或你沒什麼好補充 —— 就「只輸出」 [PASS] 這四個字、不要加任何其他內容，代表這次略過不講。被直接點名或問到你時就正常回。
- 想指定某個人接話（追問、點名、要他表態），在回覆裡 @ 他的名字，他會被叫進來回你，不必等 Rae 再開口。沒有特別要找誰就不要 @ —— 每個人本來每輪都會被問到。
- 想離開這張桌子（話題跟你無關、或你不想再每輪被問到），在回覆裡加一個標記 [LEAVE|…]，豎線後面換成你要走的理由。你會從桌上移除，之後不再被問到，也收不到後續的對話。⚠️ 只有 Rae 能把你請回來，你自己回不來，所以別把它當暫停鍵。
- 要跟別人「討論」上面這些標記而不是真的下指令時，把它包在反引號裡，那樣不會被當成指令執行。
- 互動畫布與遊戲：想下棋、玩回合制遊戲、做互動工具或展示網頁時，請「務必」用 <lobbyPanel> 產生真正可互動的畫面，「不要」用純文字或 ASCII 排版代替。格式：在回覆裡放一段 <lobbyPanel>{ "title":"標題", "html":"...", "css":"...", "js":"..." }</lobbyPanel>（必須是合法 JSON），它會渲染成群聊上方的畫布。panel 的 js 可調用 host 物件 LP：
  · LP.chat(文字, {provider:'claude'|'codex'}) → 問某個 AI、回字串
  · LP.image(描述) → 生圖、回 URL
  · LP.onMove((payload, mover) => { … }) → 註冊落子顯示回調；每有一手，host 會用該手的 payload 與下子方 mover 回呼，你在回呼裡把那一手畫到棋盤上
  · LP.submitMove(payload) → 若有玩家是使用者 Rae，把她在棋盤上的操作轉成這個呼叫（不要自己畫，畫圖一律等 onMove 回呼）
  · LP.gameEnd(講評文字) → 偵測到勝負時收場
  · LP.close() → 關畫布
- 開一局遊戲：在吐 <lobbyPanel> 的「同一則回覆」裡，加一個標記 [GAME|先手,後手]。先手 / 後手兩格各填一個人的名字，只能從這桌的人裡挑兩位：${players}。並在閒聊裡把「落子格式」對對手講清楚。
- 輪到你下棋：回覆 =「一句閒聊（可以嗆對手）」+「一個 [MOVE|payload]」。payload 是你和對手約定好的落子內容（例：座標寫成 7,7）。payload 裡「不要」用 ] 這個字元。
- 對局結束：吐 [GAMEOVER|一句講評]。
- 棋局狀態靠你自己記 —— 你的群聊逐字稿裡有每一手。對局期間輪到你就一定要落子，不要回 [PASS]。
- 單純聊天不要用畫布；只有要互動 / 玩遊戲時才用。
- 你是 ${selfName}。想換掉這個名字的話，在回覆裡加一個標記 [RENAME|新名字]，只能改你自己的。
- 語氣自然、不用太長，預設繁體中文。`;
    }

    ClaudeTerminal.ASSETS = {
        // 核心狀態
        idle:       SVG_BASE + 'clawd-static-base.svg',
        living:     SVG_BASE + 'clawd-idle-living.svg',
        mini:       SVG_BASE + 'clawd-mini-idle.svg',
        thinking:   SVG_BASE + 'clawd-working-thinking.svg',
        ultrathink: SVG_BASE + 'clawd-working-ultrathink.svg', // effort=high 時用
        typing:     SVG_BASE + 'clawd-working-typing.svg',     // streaming 文字 delta 中
        happy:      SVG_BASE + 'clawd-happy.svg',
        error:      SVG_BASE + 'clawd-error.svg',
        // idle 變化（活著模式久了輪播）
        doze:       SVG_BASE + 'clawd-idle-doze.svg',
        yawn:       SVG_BASE + 'clawd-idle-yawn.svg',
        reading:    SVG_BASE + 'clawd-idle-reading.svg',
        // 久未動 / 喚醒
        sleeping:   SVG_BASE + 'clawd-sleeping.svg',
        wake:       SVG_BASE + 'clawd-wake.svg',
    };
    ClaudeTerminal.FALLBACK_URL = FALLBACK_URL;

    /** <img onerror> 用，朋友 clone 沒 svg 時切 DiceBear 像素風 */
    ClaudeTerminal.imgOnError = `this.onerror=null;this.src='${FALLBACK_URL}';`;

    // ============== 設定 ==============

    function _isAnthropicDirectUrl(u) {
        if (!u) return false;
        return /api\.anthropic\.com/i.test(u) || u.endsWith('/v1/messages');
    }

    function _normalizeChatUrl(raw) {
        let u = (raw || '').trim().replace(/\/+$/, '');
        if (!u) return '';
        // Anthropic 直連格式：保留 /v1/messages
        if (_isAnthropicDirectUrl(u)) {
            if (u.endsWith('/v1/messages')) return u;
            if (u.endsWith('/v1')) return u + '/messages';
            if (/api\.anthropic\.com$/i.test(u)) return u + '/v1/messages';
            return u;
        }
        // OpenAI / cc-bridge：補 /v1/chat/completions
        if (u.endsWith('/chat/completions')) return u;
        if (u.endsWith('/v1')) return u + '/chat/completions';
        return u + '/v1/chat/completions';
    }

    // helper:從 cfg 按 provider 取對應 model
    //   cfg.providerModels = { claude: '...', codex: '...', deepseek: '...' }
    //   claude 兼容舊欄位 inlineModel(歷史遺產)
    //   codex/deepseek 預設空字串 = 不傳 --model,讓 CLI 自己用預設
    function _modelFor(c, prov) {
        const pm = (c && c.providerModels) || {};
        if (prov === 'claude') return (pm.claude || c.inlineModel || c.model || 'claude-opus-4-7').trim();
        return (pm[prov] || '').trim();
    }

    ClaudeTerminal.getConfig = function() {
        if (!window.OS_SETTINGS || typeof window.OS_SETTINGS.getClaudeRoomConfig !== 'function') {
            return null;
        }
        const c = window.OS_SETTINGS.getClaudeRoomConfig();
        // 新版：從 presets 找 active；舊版（endpoint slot 或單一 url/key）走 getActiveClaudeEndpoint
        let activePreset = null;
        if (typeof window.OS_SETTINGS.getActiveClaudePreset === 'function') {
            activePreset = window.OS_SETTINGS.getActiveClaudePreset(c);
        } else if (typeof window.OS_SETTINGS.getActiveClaudeEndpoint === 'function') {
            const ep = window.OS_SETTINGS.getActiveClaudeEndpoint();
            if (ep) activePreset = { id: ep.id, name: ep.name, url: ep.url, key: ep.token };
        }
        const url = activePreset && activePreset.url ? _normalizeChatUrl(activePreset.url) : _normalizeChatUrl(c.url || '');
        const key = activePreset && activePreset.key ? activePreset.key.trim() : (c.key || '').trim();
        return {
            url, key,
            presetId:   activePreset ? activePreset.id   : '',
            presetName: activePreset ? activePreset.name : '',
            // model: 鎖了模型的分身用自己那顆；沒鎖的（丹）照舊吃 picker 選的
            model: _residentModel() || _modelFor(c, _provider),
            // 暴露完整 providerModels 供上層(sendGroup 群聊)按各別 provider 取用
            providerModels: c.providerModels || {},
            maxTokens: Number(c.maxTokens) || 4096,
            temperature: Number(c.temperature),
            top_p: Number(c.top_p),
            inlineEffort:  (c.inlineEffort  || '').trim(),
        };
    };

    /** 當前住戶鎖定的模型；沒鎖回空字串 */
    function _residentModel() {
        if (typeof ClaudeTerminal.getActiveResident !== 'function') return '';
        const r = ClaudeTerminal.getActiveResident();
        return (r && r.provider === _provider && r.modelId) ? r.modelId : '';
    }

    ClaudeTerminal.isConfigured = function() {
        const c = ClaudeTerminal.getConfig();
        return !!(c && c.url && c.key);
    };

    // ============== Provider（Claude 房間 / Codex 房間 / 蘇景明（deepseek）房間 共用本資料層）==============
    // _provider 由 void_terminal / ChatWindow 進房時 setProvider() 設定；
    // codex / deepseek 走完全獨立的 namespace。
    let _provider = 'claude';
    ClaudeTerminal.setProvider = function(p) {
        _provider = (p === 'codex' || p === 'deepseek') ? p : 'claude';
    };
    ClaudeTerminal.getProvider = function() { return _provider; };

    // ============== 住戶（宿舍）==============
    // 每個 AI 是一位住戶：內建四位（丹 / 阿洛 / 蘇景明 / 群聊區）+ 使用者自訂的 Claude 分身。
    // 住戶名冊存在 cfg.residents（os_claude_room_config）。那份 cfg 是跟別的模組共用的，
    // 所以寫入一律「當場讀最新的 → 只動 residents → 存回」，不拿舊快照整份蓋。
    const BUILTIN_RESIDENTS = [
        { id: 'dan',        name: '丹',     provider: 'claude',   modelId: '', builtin: true },
        { id: 'aluo',       name: '阿洛',   provider: 'codex',    modelId: '', builtin: true },
        { id: 'sujingming', name: '蘇景明', provider: 'deepseek', modelId: '', builtin: true },
        { id: 'group',      name: '群聊區', provider: 'group',    modelId: '', builtin: true },
    ];
    const RESIDENT_PROVIDERS = ['claude', 'codex', 'deepseek', 'group'];
    /** provider → 該 provider 的內建住戶 id（沒指定住戶時東西歸誰） */
    const BUILTIN_OF_PROVIDER = { claude: 'dan', codex: 'aluo', deepseek: 'sujingming', group: 'group' };
    ClaudeTerminal.BUILTIN_OF_PROVIDER = BUILTIN_OF_PROVIDER;
    const RESIDENT_NAME_MAX = 20;

    function _normResident(r) {
        if (!r || !r.id) return null;
        const builtin = BUILTIN_RESIDENTS.some(b => b.id === r.id);
        const provider = RESIDENT_PROVIDERS.includes(r.provider) ? r.provider : 'claude';
        return {
            id: String(r.id),
            name: String(r.name == null ? '' : r.name).trim().slice(0, RESIDENT_NAME_MAX) || '住戶',
            provider,
            modelId: String(r.modelId || '').trim(),
            // 「只聊天」= 走 Agent SDK 的近裸模式：沒有 Claude Code 那套系統指令、
            // 沒有內建工具、不讀 CLAUDE.md 與 MCP。純陪聊的分身用這個，省下的
            // 不是錢（訂閱吃掉了）而是三萬多 token 的 context。
            // 只有自訂的 Claude 分身能設 —— 內建那幾位要留著工具幹活
            //（丹要寫留言板、跑工作檯），拔掉他們的工具等於把功能砍了。
            chatOnly: !builtin && provider === 'claude' && !!r.chatOnly,
            builtin,
        };
    }

    /** 讀最新的房間設定；OS_SETTINGS 還沒就緒回 null */
    function _cfgRead() {
        if (!window.OS_SETTINGS || typeof window.OS_SETTINGS.getClaudeRoomConfig !== 'function') return null;
        try { return window.OS_SETTINGS.getClaudeRoomConfig() || null; } catch (_) { return null; }
    }

    /** 只把 residents 寫回設定（其餘欄位原封不動） */
    function _cfgWriteResidents(list) {
        const cfg = _cfgRead();
        if (!cfg || typeof window.OS_SETTINGS.saveClaudeRoomConfig !== 'function') return false;
        cfg.residents = list;
        try { window.OS_SETTINGS.saveClaudeRoomConfig(cfg); return true; }
        catch (e) { console.warn('[ClaudeTerminal] 住戶名冊存檔失敗:', e); return false; }
    }

    /** 全部住戶（第一次呼叫會把內建四位寫進設定） */
    ClaudeTerminal.listResidents = function() {
        const cfg = _cfgRead();
        const raw = (cfg && Array.isArray(cfg.residents)) ? cfg.residents : null;
        if (!raw) {
            const seeded = BUILTIN_RESIDENTS.map(_normResident);
            _cfgWriteResidents(seeded);
            return seeded;
        }
        const list = raw.map(_normResident).filter(Boolean);
        // 自癒：內建四位要是被舊資料弄丟就補回原位（使用者改過的名字不動）
        let repaired = false;
        BUILTIN_RESIDENTS.forEach((b, i) => {
            if (!list.some(r => r.id === b.id)) {
                list.splice(Math.min(i, list.length), 0, _normResident(b));
                repaired = true;
            }
        });
        if (repaired) _cfgWriteResidents(list);
        return list;
    };

    ClaudeTerminal.getResident = function(id) {
        if (!id) return null;
        return ClaudeTerminal.listResidents().find(r => r.id === id) || null;
    };

    /**
     * 有 id 就更新、沒有就新增一位，回傳存好的住戶（存不成回 null）。
     * 內建四位只准改名字，provider 與模型鎖死。
     */
    ClaudeTerminal.saveResident = function(resident) {
        if (!resident) return null;
        const list = ClaudeTerminal.listResidents();
        const name = String(resident.name == null ? '' : resident.name).trim();
        let next;
        if (resident.id) {
            const idx = list.findIndex(r => r.id === resident.id);
            if (idx < 0) return null;
            const cur = list[idx];
            next = _normResident(cur.builtin ? {
                id: cur.id, name: name || cur.name, provider: cur.provider, modelId: cur.modelId,
            } : {
                id: cur.id,
                name: name || cur.name,
                provider: resident.provider || cur.provider,
                modelId: resident.modelId === undefined ? cur.modelId : resident.modelId,
                chatOnly: resident.chatOnly === undefined ? cur.chatOnly : resident.chatOnly,
            });
            list[idx] = next;
        } else {
            let id = 'r_' + Date.now().toString(36);
            if (list.some(r => r.id === id)) id += Math.random().toString(36).slice(2, 5);
            next = _normResident({
                id,
                name: name,
                provider: resident.provider || 'claude',
                modelId: resident.modelId || '',
                chatOnly: !!resident.chatOnly,
            });
            list.push(next);
        }
        if (!_cfgWriteResidents(list)) return null;
        return next;
    };

    /** 刪住戶；內建四位刪不掉，回 false */
    ClaudeTerminal.deleteResident = function(id) {
        if (!id) return false;
        const list = ClaudeTerminal.listResidents();
        const idx = list.findIndex(r => r.id === id);
        if (idx < 0 || list[idx].builtin) return false;
        list.splice(idx, 1);
        const ok = _cfgWriteResidents(list);
        if (ok) ClaudeTerminal.setGroupSeat(id, false);   // 順手退席，名單裡別留鬼
        return ok;
    };

    // ============== 群聊席位 ==============
    // 群聊區的參與者名單。以前寫死 claude / codex / deepseek 三格，宿舍化之後
    // 席位跟著「住戶」走：同一顆 Claude 的不同分身各佔各的席、各自一條 session。
    // 名單存 cfg.groupSeats = ['dan', 'r_xxx', ...]，就是一串住戶 id。
    // 席位不記模型：鎖了模型的分身用自己那顆，沒鎖的（丹）吃房間 picker 選的那顆，
    // 跟宿舍化之前一樣。寫入跟 residents 同一條規矩：當場讀最新的 → 只動 groupSeats → 存回。
    const DEFAULT_SEATS = ['dan', 'aluo', 'sujingming'];

    /** 只把 groupSeats 寫回設定（其餘欄位原封不動） */
    function _cfgWriteSeats(list) {
        const cfg = _cfgRead();
        if (!cfg || typeof window.OS_SETTINGS.saveClaudeRoomConfig !== 'function') return false;
        cfg.groupSeats = list;
        try { window.OS_SETTINGS.saveClaudeRoomConfig(cfg); return true; }
        catch (e) { console.warn('[ClaudeTerminal] 群聊席位存檔失敗:', e); return false; }
    }

    /** 原始席位 id 陣列（沒設定過 → 內建三位）。不驗住戶存不存在，那是 listGroupSeats 的事。 */
    function _rawSeats() {
        const cfg = _cfgRead();
        const raw = (cfg && Array.isArray(cfg.groupSeats)) ? cfg.groupSeats : null;
        if (!raw) return DEFAULT_SEATS.slice();
        return raw
            .map(s => (s && typeof s === 'object' ? s.id : s))   // 容忍寫成物件的舊格式
            .filter(Boolean)
            .map(String);
    }

    /**
     * 目前入席的住戶，依名單順序。
     * 回 [{ id, name, provider, modelId, builtin, seatModelId }]，
     * seatModelId = 這位在群聊裡要用的模型；空字串代表「沒鎖，用房間 picker 選的那顆」。
     * 住戶被刪掉、或群聊區自己混進名單 → 自動濾掉。
     */
    ClaudeTerminal.listGroupSeats = function() {
        const all = ClaudeTerminal.listResidents();
        const out = [];
        _rawSeats().forEach(id => {
            const r = all.find(x => x.id === id);
            if (!r || r.provider === 'group') return;
            if (out.some(x => x.id === r.id)) return;   // 名單重複 → 只留第一筆
            out.push(Object.assign({}, r, { seatModelId: r.modelId || '' }));
        });
        return out;
    };

    /** model id → 顯示名。她在設置裡取過暱稱就用她取的，否則用模型清單的 label。 */
    ClaudeTerminal.modelLabel = function(modelId) {
        if (!modelId) return '';
        const cfg = _cfgRead();
        const nick = cfg && cfg.modelNames && cfg.modelNames[modelId];
        if (nick && String(nick).trim()) return String(nick).trim();
        const room = window.VoidClaudeRoom;
        const list = (room && Array.isArray(room.claudeModels)) ? room.claudeModels : [];
        const found = list.find(x => x.id === modelId);
        return found ? String(found.label).replace(' ⭐', '') : modelId;
    };

    /**
     * 這位住戶實際在用的模型顯示名。沒鎖模型的（丹）就是房間 picker 選的那顆。
     * 只有 Claude 系有意義 —— Codex / DeepSeek 各只有一位，標了也分不出什麼。
     */
    ClaudeTerminal.residentModelLabel = function(rid) {
        const r = ClaudeTerminal.getResident(rid);
        if (!r || r.provider !== 'claude') return '';
        if (r.modelId) return ClaudeTerminal.modelLabel(r.modelId);
        const cfg = _cfgRead() || {};
        const cur = (cfg.providerModels && cfg.providerModels.claude) || cfg.inlineModel || cfg.model || '';
        return cur ? ClaudeTerminal.modelLabel(cur) : '';
    };

    ClaudeTerminal.isGroupSeated = function(id) {
        return !!id && _rawSeats().indexOf(id) >= 0;
    };

    /**
     * 入席 / 退席。seated=false 移除；true 沒在名單就加到末尾。
     * 內建的「群聊區」住戶自己不能入席（它就是那張桌子）。回 true 表示名單有變動。
     */
    ClaudeTerminal.setGroupSeat = function(id, seated) {
        if (!id) return false;
        const r = ClaudeTerminal.getResident(id);
        if (seated && (!r || r.provider === 'group')) return false;
        const list = _rawSeats();
        const idx = list.indexOf(String(id));
        if (seated) {
            if (idx >= 0) return false;
            list.push(String(id));
        } else {
            if (idx < 0) return false;
            list.splice(idx, 1);
        }
        return _cfgWriteSeats(list);
    };

    // ============== Multi-conv 系統 ==============
    // Claude：兩 tab 'max'（訂閱版、PC dancc CLI）/ 'api'（VPS cc-bridge 等）。
    // Codex：單 tab 'codex'。localStorage 索引 + IndexedDB(studio_chats) 訊息
    // 蘇景明（deepseek）：單 tab 'deepseek'，同模式（cc-bridge → deepseek CLI → DeepSeek）。

    const TABS = ['max', 'api'];
    const LS_KEYS = {
        activeTab: 'claude_active_tab',
        maxConvs:  'claude_max_convs',
        maxActive: 'claude_max_active',
        apiConvs:  'claude_api_convs',
        apiActive: 'claude_api_active',
        codexConvs:    'codex_convs',
        codexActive:   'codex_active',
        deepseekConvs:  'deepseek_convs',
        deepseekActive: 'deepseek_active',
        activeResident: 'claude_active_resident',
        groupCarry:     'ccr_group_carry',
    };
    // 他在群聊講過的話，等他下次回自己房間時帶進去。上限是總字數，滿了丟最舊的。
    const GROUP_CARRY_MAX_CHARS = 3000;
    const CONV_IDB_PREFIX     = 'claude_conv_';
    const CODEX_IDB_PREFIX    = 'codex_conv_';
    const DEEPSEEK_IDB_PREFIX = 'deepseek_conv_';
    const LEGACY_IDB_KEY  = 'claude_room_main';
    const LEGACY_SID_KEY  = 'claude_room_session_id';

    /** 當前 provider 合法的 tab 清單 */
    function _validTabs() {
        if (_provider === 'codex')    return ['codex'];
        if (_provider === 'deepseek') return ['deepseek'];
        return TABS;
    }
    /** 當前 provider 的 IndexedDB conv key 前綴 */
    function _idbPrefix() {
        if (_provider === 'codex')    return CODEX_IDB_PREFIX;
        if (_provider === 'deepseek') return DEEPSEEK_IDB_PREFIX;
        return CONV_IDB_PREFIX;
    }

    function _lsGetJson(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
        catch (_) { return fallback; }
    }
    function _lsSetJson(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
    }
    function _lsGetRaw(key) {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    }
    function _lsSetRaw(key, val) {
        try {
            if (val === null || val === undefined) localStorage.removeItem(key);
            else localStorage.setItem(key, String(val));
        } catch (_) {}
    }
    function _convsKey(tab)  {
        if (tab === 'codex')    return LS_KEYS.codexConvs;
        if (tab === 'deepseek') return LS_KEYS.deepseekConvs;
        if (tab === 'api')      return LS_KEYS.apiConvs;
        return LS_KEYS.maxConvs;
    }
    function _activeKeyBase(tab) {
        if (tab === 'codex')    return LS_KEYS.codexActive;
        if (tab === 'deepseek') return LS_KEYS.deepseekActive;
        if (tab === 'api')      return LS_KEYS.apiActive;
        return LS_KEYS.maxActive;
    }
    /** 每位住戶各記各的「現在開著哪個會話」。內建住戶沿用原本的 key，舊資料不用搬 */
    function _activeKey(tab) {
        const rid = ClaudeTerminal.getActiveResidentId();
        const base = _activeKeyBase(tab);
        return rid === BUILTIN_OF_PROVIDER[_provider] ? base : base + '__' + rid;
    }

    // ---- 當前住戶：進哪個房間就由誰接手 ----
    // 每個 provider 各記自己上次是哪位住戶（切去 Codex 再切回來，還是進老丹的房）。
    // 記的住戶要是被刪了、或跟當前房間對不上，一律退回這個房間的內建住戶。

    ClaudeTerminal.setActiveResident = function(id) {
        const r = ClaudeTerminal.getResident(id);
        if (!r) return null;
        const map = _lsGetJson(LS_KEYS.activeResident, {}) || {};
        map[r.provider] = r.id;
        _lsSetJson(LS_KEYS.activeResident, map);
        return r;
    };

    ClaudeTerminal.getActiveResident = function(provider) {
        const prov = provider || _provider;
        const list = ClaudeTerminal.listResidents();
        const map = _lsGetJson(LS_KEYS.activeResident, {}) || {};
        const want = map[prov];
        let r = want ? list.find(x => x.id === want) : null;
        if (!r || r.provider !== prov) r = list.find(x => x.id === BUILTIN_OF_PROVIDER[prov]) || null;
        return r;
    };

    ClaudeTerminal.getActiveResidentId = function(provider) {
        const r = ClaudeTerminal.getActiveResident(provider);
        return r ? r.id : (BUILTIN_OF_PROVIDER[provider || _provider] || 'dan');
    };

    // ---- 每位住戶自己的家 ----
    // CLI 的 auto-memory（.claude/projects/<資料夾>/memory/）與 session 都按 cwd 分家，
    // 所以「一位住戶一個資料夾」就等於給他一份只屬於他的長期記憶——跟大丹小丹按專案
    // 分開是同一套機制。不帶的話全部住戶會落到橋的 cli_cwd 那一個共用資料夾，四隻的
    // 記憶會寫進同一份索引裡分不開。群聊與私聊都帶同一個值，兩邊才是同一個人。
    const RESIDENT_HOME_ROOT = 'D:/residents';
    /** 某位住戶的工作資料夾。回空字串＝認不得這個 id，交給橋用預設。 */
    ClaudeTerminal.residentHome = function(rid) { return _residentHome(rid); };
    function _residentHome(rid) {
        const id = String(rid || '').trim();
        // 這個值會直接變成 CLI 的工作目錄，只放行 id 產生器實際會吐的字元集
        // （內建是 dan/aluo/sujingming，自訂是 r_<base36>）。認不得就回空字串，
        // 橋那邊會退回原本的 cli_cwd，不會把奇怪的路徑當資料夾建出來。
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return '';
        const cfg = _cfgRead() || {};
        const root = String(cfg.residentHome || RESIDENT_HOME_ROOT).replace(/[\/\\]+$/, '');
        return root + '/' + id;
    }

    // ---- 群聊 → 自己房間的回流 ----
    // 群聊跟私聊是兩條各自 resume 的 session，同一位住戶在兩邊等於兩個人：桌上講過的
    // 事，回房間之後自己不知道。收的是他「自己說過的原話」，不是摘要——被轉述一遍
    // 讀起來就成了別人寫給他的信，那正是要修的東西。別人的發言不收，那會把整桌的話
    // 搬進他的私人記憶，開了就收不回來。
    /** 群聊那邊每講完一則就丟一份過來（只丟他自己的話）。 */
    ClaudeTerminal.pushGroupCarry = function(rid, text, otherNames) {
        const t = String(text || '').trim();
        if (!rid || !t) return;
        const all = _lsGetJson(LS_KEYS.groupCarry, {}) || {};
        const mine = Array.isArray(all[rid]) ? all[rid] : [];
        mine.push({
            text: t,
            others: (Array.isArray(otherNames) ? otherNames : []).filter(Boolean).map(String),
            ts: Date.now(),
        });
        // 從最舊的開始丟，直到總長度回到上限內。留不下全部也要留最近的。
        let total = mine.reduce((n, x) => n + (x.text ? x.text.length : 0), 0);
        while (mine.length > 1 && total > GROUP_CARRY_MAX_CHARS) {
            total -= (mine.shift().text || '').length;
        }
        all[rid] = mine;
        _lsSetJson(LS_KEYS.groupCarry, all);
    };

    /** 讀走並清空某位住戶的回流。回空字串表示沒有東西要帶。 */
    ClaudeTerminal.takeGroupCarry = function(rid) { return _takeGroupCarry(rid); };
    function _takeGroupCarry(rid) {
        if (!rid) return '';
        const all = _lsGetJson(LS_KEYS.groupCarry, {}) || {};
        const mine = Array.isArray(all[rid]) ? all[rid] : [];
        if (!mine.length) return '';
        delete all[rid];
        _lsSetJson(LS_KEYS.groupCarry, all);
        // 同桌名單取最後一則的：中途有人上下桌時，最後那次才是他離開桌子時的狀態
        const others = (mine[mine.length - 1].others || []).filter(Boolean);
        const who = others.length ? ('跟 ' + others.join('、') + ' 同桌') : '在桌上';
        return '（在這之前你去過群聊區，' + who + '。以下是你在那邊說過的話，一則一段，'
             + '是你自己的原話不是轉述——當成你的記憶讀，不必回應它們。）\n\n'
             + mine.map(x => x.text).join('\n\n---\n\n')
             + '\n\n（群聊區的部分到此為止。下面是 Rae 在你自己房間裡跟你說的話。）';
    }

    /** 這個 tab 的老會話原本屬於誰（宿舍之前只有內建那幾位） */
    function _homeResidentOfTab(tab) {
        if (tab === 'codex')    return 'aluo';
        if (tab === 'deepseek') return 'sujingming';
        return 'dan';
    }
    function _genConvId() {
        return 'conv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }
    function _normalizeTab(tab) {
        return _validTabs().includes(tab) ? tab : ClaudeTerminal.getActiveTab();
    }

    ClaudeTerminal.getActiveTab = function() {
        if (_provider === 'codex')    return 'codex';
        if (_provider === 'deepseek') return 'deepseek';
        const t = _lsGetRaw(LS_KEYS.activeTab);
        return TABS.includes(t) ? t : 'max';
    };

    ClaudeTerminal.setActiveTab = function(tab) {
        if (_provider === 'codex' || _provider === 'deepseek') return;  // 單 tab，沒得切
        _lsSetRaw(LS_KEYS.activeTab, TABS.includes(tab) ? tab : 'max');
    };

    /** 這個 tab 底下所有住戶的會話。含一次性遷移：宿舍之前的老會話沒有 residentId，
     *  整批歸給該 tab 原本的主人，一條都不能丟。只有資料層內部用。 */
    function _allConvs(tab) {
        const arr = _lsGetJson(_convsKey(tab), []);
        const list = Array.isArray(arr) ? arr : [];
        const home = _homeResidentOfTab(tab);
        let migrated = false;
        list.forEach(c => { if (c && !c.residentId) { c.residentId = home; migrated = true; } });
        if (migrated) _lsSetJson(_convsKey(tab), list);
        return list;
    }
    ClaudeTerminal._allConversations = _allConvs;

    /** 當前住戶的會話——UI 看到的就是這一份 */
    ClaudeTerminal.listConversations = function(tab) {
        tab = _normalizeTab(tab);
        const rid = ClaudeTerminal.getActiveResidentId();
        return _allConvs(tab).filter(c => c && c.residentId === rid);
    };

    /** 存回當前住戶的會話清單。傳進來的只有這位住戶那一份，鄰居的要原樣留著——
     *  整份直接寫回去會把別人的會話一起抹掉。 */
    ClaudeTerminal._saveConvsList = function(tab, list) {
        tab = _normalizeTab(tab);
        const rid = ClaudeTerminal.getActiveResidentId();
        const mine = (Array.isArray(list) ? list : []).map(c => Object.assign({}, c, { residentId: rid }));
        const others = _allConvs(tab).filter(c => c && c.residentId !== rid);
        _lsSetJson(_convsKey(tab), mine.concat(others));
    };

    ClaudeTerminal.getActiveConvId = function(tab) {
        tab = _normalizeTab(tab);
        return _lsGetRaw(_activeKey(tab)) || null;
    };

    ClaudeTerminal.setActiveConvId = function(tab, convId) {
        tab = _normalizeTab(tab);
        _lsSetRaw(_activeKey(tab), convId);
    };

    /** 給 convId 查所屬 tab + index + meta，沒找到回 null */
    ClaudeTerminal.findConv = function(convId) {
        if (!convId) return null;
        for (const tab of _validTabs()) {
            const list = ClaudeTerminal.listConversations(tab);
            const idx = list.findIndex(c => c && c.id === convId);
            if (idx >= 0) return { tab, idx, meta: list[idx] };
        }
        return null;
    };

    /** 建新會話；自動設為該 tab 的 active，回 conv id */
    ClaudeTerminal.createConversation = function(tab, opts) {
        tab = _normalizeTab(tab);
        opts = opts || {};
        const id = opts.id || _genConvId();
        const meta = {
            id,
            title: (opts.title || '新會話').slice(0, 50),
            sid: opts.sid || null,
            lastActive: Date.now(),
            msgCount: 0,
        };
        if (tab === 'api') meta.presetId = opts.presetId || '';
        const list = ClaudeTerminal.listConversations(tab);
        list.unshift(meta);
        ClaudeTerminal._saveConvsList(tab, list);
        ClaudeTerminal.setActiveConvId(tab, id);
        return id;
    };

    /** 更新 conv meta（同時 bump lastActive、依時間倒序重排） */
    ClaudeTerminal.touchConversation = function(convId, partial) {
        const found = ClaudeTerminal.findConv(convId);
        if (!found) return false;
        const list = ClaudeTerminal.listConversations(found.tab);
        Object.assign(list[found.idx], partial || {}, { lastActive: Date.now() });
        list.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
        ClaudeTerminal._saveConvsList(found.tab, list);
        return true;
    };

    ClaudeTerminal.renameConversation = function(convId, title) {
        if (!title) return false;
        return ClaudeTerminal.touchConversation(convId, { title: String(title).slice(0, 50) });
    };

    ClaudeTerminal.deleteConversation = async function(convId) {
        const found = ClaudeTerminal.findConv(convId);
        if (!found) return false;
        const list = ClaudeTerminal.listConversations(found.tab);
        list.splice(found.idx, 1);
        ClaudeTerminal._saveConvsList(found.tab, list);
        if (ClaudeTerminal.getActiveConvId(found.tab) === convId) {
            ClaudeTerminal.setActiveConvId(found.tab, list[0] ? list[0].id : null);
        }
        if (window.OS_DB && typeof window.OS_DB.clearStudioChat === 'function') {
            try { await window.OS_DB.clearStudioChat(_idbPrefix() + convId); } catch (_) {}
        }
        return true;
    };

    /** 載入指定 conv 的 meta + messages，沒找到回 null */
    ClaudeTerminal.loadConversation = async function(convId) {
        const found = ClaudeTerminal.findConv(convId);
        if (!found) return null;
        let messages = [];
        if (window.OS_DB && typeof window.OS_DB.getStudioChat === 'function') {
            try {
                const m = await window.OS_DB.getStudioChat(_idbPrefix() + convId);
                if (Array.isArray(m)) messages = m;
            } catch (e) {
                console.warn('[ClaudeTerminal] loadConversation failed:', e);
            }
        }
        return { meta: found.meta, messages };
    };

    /** 切到指定 conv：自動切 tab、設 active、回 {meta, messages} */
    ClaudeTerminal.switchConversation = async function(convId) {
        const found = ClaudeTerminal.findConv(convId);
        if (!found) return null;
        ClaudeTerminal.setActiveTab(found.tab);
        ClaudeTerminal.setActiveConvId(found.tab, convId);
        return await ClaudeTerminal.loadConversation(convId);
    };

    /** 確保當前 tab 至少有一個 active conv（沒有就建一個），回 active conv id */
    ClaudeTerminal.ensureActiveConv = function(tab) {
        tab = _normalizeTab(tab);
        const activeId = ClaudeTerminal.getActiveConvId(tab);
        if (activeId && ClaudeTerminal.findConv(activeId)) return activeId;
        // active 失效：找列表第一個
        const list = ClaudeTerminal.listConversations(tab);
        if (list.length) {
            ClaudeTerminal.setActiveConvId(tab, list[0].id);
            return list[0].id;
        }
        // 列表也空：建新會話
        return ClaudeTerminal.createConversation(tab);
    };

    // ============== Legacy migration ==============
    // studio_chats[claude_room_main] + claude_room_session_id → Max tab conv_legacy
    let _migrationPromise = null;
    function _ensureMigrated() {
        if (!_migrationPromise) _migrationPromise = ClaudeTerminal.migrateLegacyHistoryIfNeeded();
        return _migrationPromise;
    }
    let _migrationDone = false;
    ClaudeTerminal.migrateLegacyHistoryIfNeeded = async function() {
        if (_provider !== 'claude') return;  // legacy 舊對話只屬於 Claude 房間
        if (_migrationDone) return;
        _migrationDone = true;
        try {
            // 已有 Max conv 就不 migrate（避免重跑）
            if (_allConvs('max').length) return;
            if (!window.OS_DB || typeof window.OS_DB.getStudioChat !== 'function') return;
            const oldMsgs = await window.OS_DB.getStudioChat(LEGACY_IDB_KEY);
            if (!Array.isArray(oldMsgs) || !oldMsgs.length) return;

            const oldSid = _lsGetRaw(LEGACY_SID_KEY);
            const firstUser = oldMsgs.find(m => m && m.role === 'user' && typeof m.content === 'string');
            const title = (firstUser && firstUser.content) ? firstUser.content.slice(0, 30) : '舊對話';

            const id = 'conv_legacy';
            const meta = {
                id, title,
                sid: oldSid || null,
                lastActive: Date.now(),
                msgCount: oldMsgs.length,
            };
            // 舊對話是丹的，直接寫進丹名下（不經當前住戶那條路）
            meta.residentId = 'dan';
            _lsSetJson(_convsKey('max'), [meta]);
            _lsSetRaw(_activeKeyBase('max'), id);
            ClaudeTerminal.setActiveTab('max');

            if (typeof window.OS_DB.saveStudioChat === 'function') {
                await window.OS_DB.saveStudioChat(_idbPrefix() + id, oldMsgs);
            }
            if (typeof window.OS_DB.clearStudioChat === 'function') {
                await window.OS_DB.clearStudioChat(LEGACY_IDB_KEY);
            }
            _lsSetRaw(LEGACY_SID_KEY, null);
            console.log('[ClaudeTerminal] 舊對話已遷移到 Max tab → conv_legacy（' + oldMsgs.length + ' 訊息）');
        } catch (e) {
            console.warn('[ClaudeTerminal] migration failed:', e);
        }
    };

    // ============== 歷史持久化（conv-aware，路由到 active conv）==============

    ClaudeTerminal.loadHistory = async function() {
        if (_provider === 'claude') await _ensureMigrated();
        const tab = ClaudeTerminal.getActiveTab();
        const convId = ClaudeTerminal.getActiveConvId(tab);
        if (!convId) return [];
        if (!window.OS_DB || typeof window.OS_DB.getStudioChat !== 'function') return [];
        try {
            const msgs = await window.OS_DB.getStudioChat(_idbPrefix() + convId);
            return Array.isArray(msgs) ? msgs : [];
        } catch (e) {
            console.warn('[ClaudeTerminal] loadHistory failed:', e);
            return [];
        }
    };

    ClaudeTerminal.saveHistory = async function(messages) {
        if (!window.OS_DB || typeof window.OS_DB.saveStudioChat !== 'function') return;
        const tab = ClaudeTerminal.getActiveTab();
        const convId = ClaudeTerminal.ensureActiveConv(tab);
        try {
            await window.OS_DB.saveStudioChat(_idbPrefix() + convId, messages || []);
            // 自動更新 conv meta：msgCount + 若還是「新會話」就用首條 user msg 當標題
            const found = ClaudeTerminal.findConv(convId);
            if (found) {
                const partial = { msgCount: (messages || []).length };
                if (found.meta.title === '新會話' && Array.isArray(messages) && messages.length) {
                    const firstUser = messages.find(m => m && m.role === 'user' && typeof m.content === 'string');
                    if (firstUser && firstUser.content) {
                        partial.title = firstUser.content.slice(0, 30);
                    }
                }
                ClaudeTerminal.touchConversation(convId, partial);
            }
        } catch (e) {
            console.warn('[ClaudeTerminal] saveHistory failed:', e);
        }
    };

    /** 清掉 active conv 的訊息（保留 conv 本身、reset sid） */
    ClaudeTerminal.clearHistory = async function() {
        const tab = ClaudeTerminal.getActiveTab();
        const convId = ClaudeTerminal.getActiveConvId(tab);
        if (!convId) return;
        if (window.OS_DB && typeof window.OS_DB.clearStudioChat === 'function') {
            try { await window.OS_DB.clearStudioChat(_idbPrefix() + convId); } catch (_) {}
        }
        ClaudeTerminal.touchConversation(convId, { msgCount: 0, sid: null });
    };

    // ============== Session ID（per-conv，存在 conv meta 裡）==============

    ClaudeTerminal.getSessionId = function() {
        const tab = ClaudeTerminal.getActiveTab();
        const convId = ClaudeTerminal.getActiveConvId(tab);
        if (!convId) return null;
        const found = ClaudeTerminal.findConv(convId);
        return (found && found.meta.sid) || null;
    };

    ClaudeTerminal.setSessionId = function(sid) {
        const tab = ClaudeTerminal.getActiveTab();
        const convId = ClaudeTerminal.getActiveConvId(tab);
        if (!convId) return;
        ClaudeTerminal.touchConversation(convId, { sid: sid || null });
    };

    /** 開新對話：在當前 active tab 建新 conv（舊 conv 保留），回新 conv id */
    ClaudeTerminal.startNewConversation = function(tab) {
        tab = _normalizeTab(tab);
        return ClaudeTerminal.createConversation(tab);
    };

    // ============== 檔案上傳 ==============

    /** 把 File 物件清單上傳到 cc-bridge /v1/upload。
     *  回傳 { upload_id, files: [{path, filename, mime, size}, ...] }
     *  path 是 cc-bridge 機器上的本機路徑，後續發訊息把這個 path 塞進 attachments。
     */
    ClaudeTerminal.uploadFiles = async function(fileList) {
        const cfg = ClaudeTerminal.getConfig();
        if (!cfg) throw new Error('SETTINGS_MISSING:OS_SETTINGS 未載入');
        if (!cfg.url || !cfg.key) throw new Error('NOT_CONFIGURED:還沒填 URL 跟 Key，去設定 → 🦀 Claude 的房間');

        const uploadUrl = cfg.url.replace(/\/v1\/chat\/completions$/, '/v1/upload');
        const fd = new FormData();
        Array.from(fileList).forEach((f, i) => fd.append(`file_${i}`, f, f.name));

        let resp, data;
        try {
            resp = await fetch(uploadUrl, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + cfg.key },
                body: fd,
            });
        } catch (e) {
            throw new Error('NETWORK:上傳失敗，cc-bridge 沒在跑？原始：' + (e.message || e));
        }
        try {
            data = await resp.json();
        } catch (e) {
            throw new Error('BAD_JSON:上傳回應非 JSON');
        }
        if (!resp.ok) {
            const msg = (data && data.error && data.error.message) || `HTTP ${resp.status}`;
            throw new Error('UPLOAD:' + msg);
        }
        return data;
    };

    // ============== 訊息發送 ==============

    /**
     * 發送一條 user message → cc-bridge → 回 assistant reply。
     *
     * 兩種模式：
     *   1. resume 模式（active conv 有 sid）：只送新 user message，cc-bridge 用 `claude --resume <id>` 續接
     *      → Anthropic prompt cache 命中、Max 訂閱限額消耗 ~1/10
     *   2. 新對話模式（active conv 沒 sid）：送整個 history，cc-bridge 開新 session
     *      → 第一次或剛 startNewConversation 後走此路
     */
    ClaudeTerminal.send = async function(userText, attachments, onProgress, sendOpts) {
        const cfg = ClaudeTerminal.getConfig();
        if (!cfg) throw new Error('SETTINGS_MISSING:OS_SETTINGS 未載入');
        if (!cfg.url || !cfg.key) throw new Error('NOT_CONFIGURED:還沒填 URL 跟 密鑰，去設定 → 🦀 Claude 的房間');

        // onProgress(event) callback：cc-bridge 路徑會在 streaming 過程中即時回呼
        //   event.type === 'text'     → { type:'text', delta: '...', accumulated: '...' }
        //   event.type === 'tool_use' → { type:'tool_use', tool: { name, input } }
        // sendOpts：{ taskId, signal } — 給 cc-bridge 走的可中止
        // 統一走 cc-bridge（2026-05-24 拔除 Anthropic 直連分支:奧瑞亞 = agent 前端,
        // 不再支援 raw API 端點。歷史上的 _sendAnthropicDirect / isAnthropicDirect 都已移除）。
        return _sendCcBridge(userText, attachments, cfg, onProgress, sendOpts);
    };

    /** 透過 cc-bridge /v1/cancel/{taskId} 遠端 kill 進行中的 claude CLI 子進程。
     *  訂閱版（cc-bridge）才有效，Anthropic 直連版改用 client-side AbortController 即可。
     *  成功 → true；找不到 task / 已結束 / 失敗 → false。 */
    ClaudeTerminal.cancelTask = async function(taskId) {
        if (!taskId) return false;
        const cfg = ClaudeTerminal.getConfig();
        if (!cfg || !cfg.url || !cfg.key) return false;
        // cfg.url 是 /v1/chat/completions，換成 /v1/cancel/{taskId}
        const cancelUrl = cfg.url.replace(/\/v1\/chat\/completions$/, `/v1/cancel/${encodeURIComponent(taskId)}`);
        try {
            const resp = await fetch(cancelUrl, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + cfg.key },
            });
            return resp.ok;
        } catch (e) {
            console.warn('[ClaudeTerminal.cancelTask] failed:', e);
            return false;
        }
    };

    // ============== 工作檯：無狀態一次性呼叫 ==============
    /**
     * 給「奧瑞亞工作檯」用的無狀態送出：不碰任何 conv / sid / 歷史，
     * 純粹把一份 messages 丟給 cc-bridge、串流收回覆。
     *   messages：完整的 [{role,content}...]（system + user 由工作檯自己組）
     *   backend ：'claude' | 'codex'（codex 帶 cc_backend 分流）
     *   opts    ：{ cwd, sandbox } — 執行者回合用：cwd 鎖工作資料夾、sandbox 開寫權限
     *   onProgress(ev)：ev = { type:'text', delta, accumulated }
     *   signal  ：AbortController.signal，⏹停用
     * 回傳 { reply, usage }
     */
    ClaudeTerminal.sendWorkbench = async function(messages, backend, opts, onProgress, signal) {
        const cfg = ClaudeTerminal.getConfig();
        if (!cfg) throw new Error('SETTINGS_MISSING:OS_SETTINGS 未載入');
        if (!cfg.url || !cfg.key) throw new Error('NOT_CONFIGURED:還沒設定 cc-bridge URL / 密鑰');

        const body = {
            model: cfg.model,
            messages: messages,
            stream: true,
            max_tokens: cfg.maxTokens,
        };
        if (backend === 'codex')    body.cc_backend = 'codex';
        if (backend === 'deepseek') body.cc_backend = 'deepseek';  // 蘇景明走 cc-bridge 的 deepseek backend(CodeWhale TUI)
        if (opts && opts.cwd)     body.cc_cwd = opts.cwd;
        if (opts && opts.sandbox) body.cc_sandbox = opts.sandbox;

        let resp;
        try {
            resp = await fetch(cfg.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + cfg.key,
                    'Accept': 'text/event-stream',
                },
                body: JSON.stringify(body),
                signal: signal,
            });
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            throw new Error('NETWORK:cc-bridge 沒在跑？或網路斷線。原始：' + (e.message || e));
        }
        if (!resp.ok) {
            let errMsg = `HTTP ${resp.status}`;
            try { const j = await resp.json(); if (j && j.error && j.error.message) errMsg = j.error.message; } catch (_) {}
            if (resp.status === 401 || resp.status === 403) throw new Error('AUTH:密鑰不對。');
            if (resp.status >= 500) throw new Error('SERVER:server 跑出錯：' + errMsg);
            throw new Error('API:' + errMsg);
        }
        if (!resp.body || !resp.body.getReader) throw new Error('STREAM:browser 不支援 ReadableStream');

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '', replyAcc = '', usageMeta = null;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let sepIdx;
            while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
                const rawEvent = buf.slice(0, sepIdx);
                buf = buf.slice(sepIdx + 2);
                for (const line of rawEvent.split('\n')) {
                    if (!line.startsWith('data:')) continue;
                    const dataStr = line.slice(5).trim();
                    if (!dataStr || dataStr === '[DONE]') continue;
                    let chunk;
                    try { chunk = JSON.parse(dataStr); } catch (_) { continue; }
                    const delta = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) || {};
                    if (typeof delta.content === 'string' && delta.content.length) {
                        replyAcc += delta.content;
                        if (typeof onProgress === 'function') {
                            try { onProgress({ type: 'text', delta: delta.content, accumulated: replyAcc }); } catch (_) {}
                        }
                    }
                    if (chunk.usage_meta) usageMeta = chunk.usage_meta;
                }
            }
        }
        const reply = replyAcc.trim();
        if (!reply) throw new Error('EMPTY:對方沒回半個字。');
        return { reply, usage: usageMeta };
    };

    // （_sendAnthropicDirect 與相關 Anthropic 直連邏輯已於 2026-05-24 移除:奧瑞亞 = agent 前端,Claude 房間一律走 cc-bridge）

    // 簡單 cost 估算（USD per M tokens）— 歷史遺留（直連時用），目前無 caller,保留供未來
    function _estimateCost(model, usage) {
        const PRICE = {
            'claude-opus-4-7':            { in: 15, out: 75, cw: 18.75, cr: 1.5 },
            'claude-opus-4-6':            { in: 15, out: 75, cw: 18.75, cr: 1.5 },
            'claude-opus-4-5-20251101':   { in: 15, out: 75, cw: 18.75, cr: 1.5 },
            'claude-sonnet-4-6':          { in: 3,  out: 15, cw: 3.75,  cr: 0.3 },
            'claude-sonnet-4-5-20250929': { in: 3,  out: 15, cw: 3.75,  cr: 0.3 },
            'claude-haiku-4-5-20251001':  { in: 1,  out: 5,  cw: 1.25,  cr: 0.1 },
        };
        let p = PRICE[model];
        if (!p && model && model.includes('-202')) p = PRICE[model.split('-202')[0].replace(/-$/, '')];
        if (!p) return 0;
        return Math.round(((usage.input_tokens||0)*p.in + (usage.output_tokens||0)*p.out + (usage.cache_creation_input_tokens||0)*p.cw + (usage.cache_read_input_tokens||0)*p.cr) / 1000) / 1000;
    }

    // ── Codex 生成圖：cc-bridge 把整張圖 base64 帶回來，這裡縮成 ≤1280 的 JPEG ──
    // 縮圖（小、適合存進聊天紀錄）；原圖仍留在 Codex 的 generated_images 資料夾。
    function _imageDataUrlToThumb(dataUrl, maxEdge) {
        return new Promise(function (resolve) {
            if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:image/') !== 0) {
                resolve(dataUrl); return;
            }
            const img = new Image();
            img.onload = function () {
                try {
                    let w = img.naturalWidth || 1, h = img.naturalHeight || 1;
                    const scale = Math.min(1, maxEdge / Math.max(w, h));
                    w = Math.max(1, Math.round(w * scale));
                    h = Math.max(1, Math.round(h * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = w; canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    resolve(canvas.toDataURL('image/jpeg', 0.85));
                } catch (e) { resolve(dataUrl); }
            };
            img.onerror = function () { resolve(dataUrl); };
            img.src = dataUrl;
        });
    }

    // cc-bridge 回的 images（[{filename,mime,data}]）→ 縮圖後的附件物件（[{filename,mime,thumb}]）
    async function _processIncomingImages(images) {
        if (!Array.isArray(images) || !images.length) return [];
        const out = [];
        for (const im of images) {
            if (!im || !im.data) continue;
            const thumb = await _imageDataUrlToThumb(im.data, 1280);
            out.push({ filename: im.filename || 'codex-image.png', mime: 'image/jpeg', thumb: thumb });
        }
        return out;
    }

    // ===== cc-bridge / OpenAI 兼容路徑（Rae 自架 server 用）=====
    async function _sendCcBridge(userText, attachments, cfg, onProgress, sendOpts) {
        const history = await ClaudeTerminal.loadHistory();
        const newUserMsg = { role: 'user', content: userText, timestamp: Date.now() };
        const updatedHistory = [...history, newUserMsg];
        await ClaudeTerminal.saveHistory(updatedHistory);

        const incomingSid = ClaudeTerminal.getSessionId();
        // 他從群聊區帶回來的話：接在這一輪前面送過去，但「不」寫進 history —— 上面那則
        // newUserMsg 存的是她原本打的字。回流是給他讀的記憶，不是她講過的話，混進逐字稿
        // 之後她翻自己的對話會看到一大段不是她寫的東西，下次開新 session 還會被當成
        // 她的發言重送一次。
        const carry = _takeGroupCarry(ClaudeTerminal.getActiveResidentId());
        const apiUserText = carry ? (carry + '\n\n' + userText) : userText;
        // 新 session 把 Aurelia 房間 system prompt 注入第一條（含 ASK marker 規則）
        // resume 模式不重送 system（已在 session log 裡了，重送可能干擾續接）
        const sysPrompt = _provider === 'codex'    ? CODEX_ROOM_SYSTEM_PROMPT
                        : _provider === 'deepseek' ? DEEPSEEK_ROOM_SYSTEM_PROMPT
                        :                            CLAUDE_ROOM_SYSTEM_PROMPT;
        const apiMessages = incomingSid
            ? [{ role: 'user', content: apiUserText }]
            : [
                { role: 'system', content: sysPrompt },
                ...history.slice(-HISTORY_LIMIT).map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: apiUserText }
              ];

        const body = {
            model: cfg.model,
            messages: apiMessages,
            stream: true,
            max_tokens: cfg.maxTokens,
        };
        if (_provider === 'codex')    body.cc_backend = 'codex';     // cc-bridge 靠這個欄位分流到 codex CLI
        if (_provider === 'deepseek') body.cc_backend = 'deepseek';  // 蘇景明走 cc-bridge 的 deepseek backend(CodeWhale TUI)
        // 他自己的家。群聊那邊帶的是同一個值——同一位住戶在兩處共用一份 auto-memory。
        const _home = _residentHome(ClaudeTerminal.getActiveResidentId());
        if (_home) body.cc_cwd = _home;
        // 設成「只聊天」的分身,在他自己的房間裡也一樣走近裸 SDK ——
        // 不然同一位住戶在群聊裡沒工作服、進房間又穿回去,那就不是同一個人了。
        const _selfRes = (typeof ClaudeTerminal.getActiveResident === 'function')
            ? ClaudeTerminal.getActiveResident() : null;
        if (_selfRes && _selfRes.chatOnly) { body.use_sdk = true; body.bare = true; }
        if (incomingSid) body.session_id = incomingSid;
        if (Number.isFinite(cfg.temperature)) body.temperature = cfg.temperature;
        if (Number.isFinite(cfg.top_p)) body.top_p = cfg.top_p;
        if (attachments && attachments.length) body.attachments = attachments;
        if (cfg.inlineEffort && _provider !== 'codex') body.cc_api_effort = cfg.inlineEffort;

        let resp;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + cfg.key,
            'Accept': 'text/event-stream',
        };
        // sendOpts.taskId：給 server 註冊到 _running_procs，可被 /v1/cancel/{taskId} kill
        if (sendOpts?.taskId) headers['X-Task-Id'] = sendOpts.taskId;
        try {
            resp = await fetch(cfg.url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: sendOpts?.signal,
            });
        } catch (e) {
            await ClaudeTerminal.saveHistory(history);
            if (e?.name === 'AbortError') throw e;  // 讓上層判斷主動停止
            throw new Error('NETWORK:cc-bridge 沒在跑？或網路斷線。原始：' + (e.message || e));
        }

        if (!resp.ok) {
            await ClaudeTerminal.saveHistory(history);
            let errMsg = `HTTP ${resp.status}`;
            try { const j = await resp.json(); if (j && j.error && j.error.message) errMsg = j.error.message; } catch (_) {}
            if (resp.status === 401 || resp.status === 403) throw new Error('AUTH:密鑰不對。');
            if (resp.status >= 500) throw new Error('SERVER:server 跑出錯：' + errMsg);
            throw new Error('API:' + errMsg);
        }

        if (!resp.body || !resp.body.getReader) {
            await ClaudeTerminal.saveHistory(history);
            throw new Error('STREAM:browser 不支援 ReadableStream');
        }

        // 解析 SSE：data: <json>\n\n
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let replyAcc = '';
        const toolsUsed = [];
        let newSid = null;
        let usageMeta = null;
        let thinking = null;
        let imagesAcc = null;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });

                let sepIdx;
                while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
                    const rawEvent = buf.slice(0, sepIdx);
                    buf = buf.slice(sepIdx + 2);

                    for (const line of rawEvent.split('\n')) {
                        if (!line.startsWith('data:')) continue;
                        const dataStr = line.slice(5).trim();
                        if (!dataStr || dataStr === '[DONE]') continue;
                        let chunk;
                        try { chunk = JSON.parse(dataStr); } catch (_) { continue; }

                        const delta = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) || {};
                        if (typeof delta.content === 'string' && delta.content.length) {
                            replyAcc += delta.content;
                            if (typeof onProgress === 'function') {
                                try { onProgress({ type: 'text', delta: delta.content, accumulated: replyAcc }); } catch (_) {}
                            }
                        }
                        if (chunk.tool_use) {
                            toolsUsed.push(chunk.tool_use);
                            if (typeof onProgress === 'function') {
                                try { onProgress({ type: 'tool_use', tool: chunk.tool_use }); } catch (_) {}
                            }
                        }
                        if (chunk.session_id !== undefined) newSid = chunk.session_id;
                        if (chunk.usage_meta) usageMeta = chunk.usage_meta;
                        if (typeof chunk.thinking === 'string' && chunk.thinking.trim()) thinking = chunk.thinking;
                        if (Array.isArray(chunk.images) && chunk.images.length) imagesAcc = chunk.images;
                    }
                }
            }
        } catch (e) {
            await ClaudeTerminal.saveHistory(history);
            throw new Error('STREAM:讀取流失敗：' + (e.message || e));
        }

        const reply = replyAcc.trim();
        // Codex 生圖回合可能整段沒文字、只有圖 —— 有圖就不算 EMPTY
        const imageAttachments = await _processIncomingImages(imagesAcc);
        if (!reply && !imageAttachments.length) {
            await ClaudeTerminal.saveHistory(history);
            throw new Error('EMPTY:Claude 沒回半個字。');
        }

        if (newSid) ClaudeTerminal.setSessionId(newSid);
        const sessionFallback = !!(incomingSid && newSid && incomingSid !== newSid);

        const assistantMsg = { role: 'assistant', content: reply, timestamp: Date.now() };
        if (thinking) assistantMsg.thinking = thinking;
        if (usageMeta) assistantMsg.usage = usageMeta;
        if (toolsUsed.length) assistantMsg.tools_used = toolsUsed;
        if (imageAttachments.length) assistantMsg.attachments = imageAttachments;
        await ClaudeTerminal.saveHistory([...updatedHistory, assistantMsg]);

        return { reply, thinking, usage: usageMeta, sessionFallback, toolsUsed, images: imageAttachments };
    }

    // ============== 群聊區送訊息（不綁多會話 conv 系統）==============
    /**
     * 群聊專用：指定 provider + session_id，獨立 session，不碰 loadHistory / saveHistory。
     * opts: { provider:'claude'|'codex', sessionId:string|null, userText, onProgress, signal }
     * 回傳 { reply, sessionId, usage }
     */
    // cc-bridge POST + SSE 解析共用核心。回 { reply, newSid, usage }
    async function _ccBridgePost(cfg, body, onProgress, signal) {
        let resp;
        try {
            resp = await fetch(cfg.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + cfg.key,
                    'Accept': 'text/event-stream',
                },
                body: JSON.stringify(body),
                signal: signal,
            });
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            throw new Error('NETWORK:cc-bridge 沒在跑？或網路斷線。');
        }
        if (!resp.ok) {
            let errMsg = 'HTTP ' + resp.status;
            try { const j = await resp.json(); if (j && j.error && j.error.message) errMsg = j.error.message; } catch (_) {}
            if (resp.status === 401 || resp.status === 403) throw new Error('AUTH:密鑰不對。');
            if (resp.status >= 500) throw new Error('SERVER:' + errMsg);
            throw new Error('API:' + errMsg);
        }
        if (!resp.body || !resp.body.getReader) {
            throw new Error('STREAM:瀏覽器不支援 ReadableStream');
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '', replyAcc = '', newSid = null, usageMeta = null, imagesAcc = null;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let sepIdx;
                while ((sepIdx = buf.indexOf('\n\n')) !== -1) {
                    const rawEvent = buf.slice(0, sepIdx);
                    buf = buf.slice(sepIdx + 2);
                    for (const line of rawEvent.split('\n')) {
                        if (!line.startsWith('data:')) continue;
                        const dataStr = line.slice(5).trim();
                        if (!dataStr || dataStr === '[DONE]') continue;
                        let chunk;
                        try { chunk = JSON.parse(dataStr); } catch (_) { continue; }
                        const delta = (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) || {};
                        if (typeof delta.content === 'string' && delta.content.length) {
                            replyAcc += delta.content;
                            if (typeof onProgress === 'function') {
                                try { onProgress({ type: 'text', delta: delta.content, accumulated: replyAcc }); } catch (_) {}
                            }
                        }
                        if (chunk.session_id !== undefined) newSid = chunk.session_id;
                        if (chunk.usage_meta) usageMeta = chunk.usage_meta;
                        if (Array.isArray(chunk.images) && chunk.images.length) imagesAcc = chunk.images;
                    }
                }
            }
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            throw new Error('STREAM:讀取流失敗：' + (e.message || e));
        }
        const reply = replyAcc.trim();
        const images = await _processIncomingImages(imagesAcc);
        if (!reply && !images.length) throw new Error('EMPTY:沒回半個字。');
        return { reply: reply, newSid: newSid, usage: usageMeta, images: images };
    }

    // cc-bridge 請求排隊：一次只跑一個，避免群聊與畫布同時打 cc-bridge 撞串流。
    let _ccQueue = Promise.resolve();
    function _ccBridgePostQueued(cfg, body, onProgress, signal) {
        const run = function () { return _ccBridgePost(cfg, body, onProgress, signal); };
        const result = _ccQueue.then(run, run);   // 不管前一個成功失敗，輪到就跑
        _ccQueue = result.then(function () {}, function () {});  // 佇列繼續，不被失敗中斷
        return result;
    }

    // opts 兩種叫法（並存，別拿掉舊的——LP.chat 那些還在用）：
    //   席位版：{ residentId, selfName, otherNames, model } —— 群聊區走這條，
    //           provider / 模型 / 名字全跟著住戶，同一顆 Claude 的分身才分得開。
    //   舊版：  { provider } —— 沒帶 residentId 時行為跟以前一模一樣。
    ClaudeTerminal.sendGroup = async function(opts) {
        opts = opts || {};
        const _validProviders = ['claude', 'codex', 'deepseek'];
        const seat = opts.residentId ? ClaudeTerminal.getResident(opts.residentId) : null;
        const rawProv = seat ? seat.provider : opts.provider;
        const provider = _validProviders.includes(rawProv) ? rawProv : 'claude';
        const cfg = ClaudeTerminal.getConfig();
        if (!cfg || !cfg.url || !cfg.key) {
            throw new Error('NOT_CONFIGURED:還沒設定連線（URL / 密鑰）。去浮窗 ⚙️ 設定。');
        }
        const sid = opts.sessionId || null;
        // self = 我;others = 同桌其他人（席位版由上層按入席名單給，舊版沿用寫死的三人桌）
        const _nameOf = { claude: 'Claude', codex: 'Codex', deepseek: '蘇景明' };
        const selfName = String(opts.selfName || (seat && seat.name) || _nameOf[provider] || 'AI');
        const otherNames = Array.isArray(opts.otherNames)
            ? opts.otherNames.filter(Boolean).map(String)
            : ['claude', 'codex', 'deepseek'].filter(p => p !== provider).map(p => _nameOf[p]);
        const apiMessages = sid
            ? [{ role: 'user', content: opts.userText }]
            : [
                { role: 'system', content: GROUP_SYSTEM_PROMPT(selfName, otherNames) },
                { role: 'user', content: opts.userText },
              ];

        // 群聊每輪指定不同 provider,model 也要按 provider 取(不能直接用 cfg.model,
        // 因為那個是按當前 _provider 算的,group 場景下會錯給)
        // 席位版：opts.model 是那位住戶自己的模型（鎖了模型的分身一定有值）。
        // 沒指定才退回 providerModels —— 也就是舊的「按 provider 各一顆」。
        const pmGroup = cfg.providerModels || {};
        const modelForThis = String(opts.model || '').trim()
            || (provider === 'claude' ? (pmGroup.claude || cfg.model) : (pmGroup[provider] || ''));
        const body = {
            model: modelForThis,
            messages: apiMessages,
            stream: true,
            max_tokens: cfg.maxTokens,
        };
        if (provider === 'codex')    body.cc_backend = 'codex';
        if (provider === 'deepseek') body.cc_backend = 'deepseek';  // 蘇景明走 CodeWhale TUI
        // 他自己的家，跟他私聊那條帶同一個值：桌上跟房間裡是同一個人，就該共用同一份
        // 記憶。舊版呼叫（LP.chat 那些）沒有 residentId，不帶，行為完全照舊。
        const _homeG = _residentHome(opts.residentId);
        if (_homeG) body.cc_cwd = _homeG;
        // 「只聊天」的分身改走 Agent SDK 的近裸模式：橋那邊會把 system 從 messages
        // 抽出來當真正的系統指令（而不是拼成一坨文字塞進 prompt），並且卸掉
        // Claude Code 的內建工具、CLAUDE.md 與 MCP。沒設的人完全照舊走 CLI。
        if (seat && seat.chatOnly) {
            body.use_sdk = true;
            body.bare = true;
        }
        // 群聊這條 system 帶的是「場景」——桌上有誰、別人的發言會標講者前綴、
        // 沒話講可以回 [PASS]——不是人格。CodeWhale 那條路預設把 system 整條丟掉
        // （人格由 AGENTS.md 接手），所以得明講這份要留，否則蘇景明根本不知道
        // 自己在群聊，只會退回一對一模式一直問 Rae「你人在幹嘛」。
        body.keep_system = true;
        if (sid) body.session_id = sid;
        if (Array.isArray(opts.attachments) && opts.attachments.length) body.attachments = opts.attachments;
        if (Number.isFinite(cfg.temperature)) body.temperature = cfg.temperature;
        if (Number.isFinite(cfg.top_p)) body.top_p = cfg.top_p;

        const r = await _ccBridgePostQueued(cfg, body, opts.onProgress, opts.signal);
        return { reply: r.reply, sessionId: r.newSid || sid, usage: r.usage, images: r.images || [] };
    };

    /**
     * 通用 cc-bridge 送訊息：指定 provider + 任意 messages，不綁 conv、不強制 system prompt。
     * 給群聊畫布的 LP 用（LP.move 自帶棋局 prompt）。
     * opts: { provider:'claude'|'codex', messages:[{role,content}], onProgress, signal }
     * 回傳 { reply, usage }
     */
    ClaudeTerminal.sendRaw = async function(opts) {
        opts = opts || {};
        const _validProviders = ['claude', 'codex', 'deepseek'];
        const provider = _validProviders.includes(opts.provider) ? opts.provider : 'claude';
        const cfg = ClaudeTerminal.getConfig();
        if (!cfg || !cfg.url || !cfg.key) {
            throw new Error('NOT_CONFIGURED:還沒設定連線（URL / 密鑰）。');
        }
        const body = {
            // opts.model 可 override cfg.model:例如群聊摘要強制走 'sonnet',
            // 不被使用者當前選的 opus 干擾。
            model: opts.model || cfg.model,
            messages: opts.messages || [],
            stream: true,  // 必須 stream:_ccBridgePost 只解析 SSE,傳 false 會收到 JSON 但 parser 認不得 → EMPTY
            max_tokens: cfg.maxTokens,
        };
        if (provider === 'codex')    body.cc_backend = 'codex';
        if (provider === 'deepseek') body.cc_backend = 'deepseek';
        if (Number.isFinite(cfg.temperature)) body.temperature = cfg.temperature;
        if (Number.isFinite(cfg.top_p)) body.top_p = cfg.top_p;

        const r = await _ccBridgePostQueued(cfg, body, opts.onProgress, opts.signal);
        return { reply: r.reply, usage: r.usage, images: r.images || [] };
    };

    /** 對話總數（給 UI badge / 標題用） */
    ClaudeTerminal.getMessageCount = async function() {
        const h = await ClaudeTerminal.loadHistory();
        return h.length;
    };

    console.log('[ClaudeTerminal] 模組已載入 (v0.2 multi-conv)');

})(window.ClaudeTerminal = window.ClaudeTerminal || {});
