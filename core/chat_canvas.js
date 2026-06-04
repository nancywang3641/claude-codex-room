/**
 * core/chat_canvas.js — 群聊區通用畫布
 * AI 用 <lobbyPanel> marker 產互動 HTML，渲染進群聊浮窗上方的畫布區。
 * panel JS 透過 LP 走訂閱(cc-bridge) 跟 Claude / Codex 互動。
 * 解析 / rewire 共用 VoidCanvas。
 */
(function (ChatCanvas) {
    'use strict';

    let _canvasEl = null;   // #cw-canvas（含 bar + content）
    let _tabEl = null;      // 收合後的細 tab
    let _onMoveCb = null;   // panel 透過 LP.onMove 註冊的落子顯示回調

    // ── host 接口 LP（訂閱版）──
    function _makeChatPanelAPI() {
        return {
            // panel 向某個 AI 問一句、回純文字
            chat: async function (text, opts) {
                opts = opts || {};
                const provider = opts.provider === 'codex' ? 'codex' : 'claude';
                if (!window.ClaudeTerminal || typeof window.ClaudeTerminal.sendRaw !== 'function') {
                    throw new Error('ClaudeTerminal 未載入');
                }
                const r = await window.ClaudeTerminal.sendRaw({
                    provider: provider,
                    messages: [{ role: 'user', content: String(text == null ? '' : text) }],
                });
                return (r.reply || '').trim();
            },

            // 生圖，回圖片 URL
            image: async function (prompt, type) {
                if (window.__IS_PREVIEW || !window.OS_IMAGE_MANAGER) {
                    return 'https://via.placeholder.com/400x300/1e1e2a/cfd2e6?text=Preview';
                }
                return await window.OS_IMAGE_MANAGER.generate(prompt, type || 'item');
            },

            close: function () { ChatCanvas.close(); },

            // 遊戲：panel 註冊落子顯示回調。host 每有一手 → cb(payload, mover)
            onMove: function (cb) {
                _onMoveCb = (typeof cb === 'function') ? cb : null;
            },

            // 遊戲：panel 把使用者(Rae)的一手推進編排迴圈（不要自己畫，畫圖等 onMove 回呼）
            submitMove: function (payload) {
                if (window.ChatGroup && typeof window.ChatGroup.submitPlayerMove === 'function') {
                    window.ChatGroup.submitPlayerMove(String(payload == null ? '' : payload));
                }
            },

            // 遊戲：panel 偵測到勝負 → 收場
            gameEnd: function (resultText) {
                if (window.ChatGroup && typeof window.ChatGroup.endGame === 'function') {
                    window.ChatGroup.endGame(String(resultText == null ? '' : resultText));
                }
            },
        };
    }

    function _hasContent() {
        const c = _canvasEl && _canvasEl.querySelector('.cw-canvas-content');
        return !!(c && c.children.length);
    }

    // ── 掛載畫布區（由 chat_window 在群聊模式給 #cw-canvas / #cw-canvas-tab 元素）──
    ChatCanvas.mount = function (canvasEl, tabEl) {
        _canvasEl = canvasEl;
        _tabEl = tabEl;
        if (_canvasEl) {
            const collapseBtn = _canvasEl.querySelector('.cw-canvas-collapse');
            const closeBtn = _canvasEl.querySelector('.cw-canvas-close');
            if (collapseBtn) collapseBtn.addEventListener('click', function () { ChatCanvas.collapse(); });
            if (closeBtn) closeBtn.addEventListener('click', function () { ChatCanvas.close(); });
        }
        if (_tabEl) _tabEl.addEventListener('click', function () { ChatCanvas.expand(); });
    };

    ChatCanvas.expand = function () {
        if (_canvasEl) _canvasEl.style.display = 'flex';
        if (_tabEl) _tabEl.style.display = 'none';
    };

    // 收合：藏畫布、留 tab（內容保留，可重新展開）
    ChatCanvas.collapse = function () {
        if (_canvasEl) _canvasEl.style.display = 'none';
        if (_tabEl) _tabEl.style.display = _hasContent() ? 'flex' : 'none';
    };

    // 關閉：清掉內容、收 tab
    ChatCanvas.close = function () {
        if (_canvasEl) {
            _canvasEl.style.display = 'none';
            const c = _canvasEl.querySelector('.cw-canvas-content');
            if (c) c.innerHTML = '';
        }
        if (_tabEl) _tabEl.style.display = 'none';
        window.__CW_LP = null;
        _onMoveCb = null;
        if (window.ChatGroup && typeof window.ChatGroup.endGame === 'function') {
            window.ChatGroup.endGame('（畫布關閉，對局中止）');
        }
    };

    // ── 套用一手：host 抽到 [MOVE] / Rae 落子時呼叫，觸發 panel 註冊的 onMove 回調 ──
    ChatCanvas.applyMove = function (payload, mover) {
        if (typeof _onMoveCb === 'function') {
            try { _onMoveCb(payload, mover); }
            catch (e) { console.warn('[ChatCanvas] onMove 回調錯誤：', e); }
        }
    };

    // ── 渲染一個 panel（panelData: {title, html, css, js}）──
    ChatCanvas.render = function (panelData) {
        if (!_canvasEl || !panelData) return;
        const content = _canvasEl.querySelector('.cw-canvas-content');
        const titleEl = _canvasEl.querySelector('.cw-canvas-title');
        if (!content) return;

        let styleEl = document.getElementById('cw-canvas-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'cw-canvas-style';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = panelData.css || '';

        _onMoveCb = null;
        content.innerHTML = panelData.html || '';
        if (titleEl) titleEl.textContent = panelData.title || '🎮 畫布';
        ChatCanvas.expand();

        const LP = _makeChatPanelAPI();
        window.__CW_LP = LP;
        if (panelData.js) {
            try {
                new Function('container', 'LP', panelData.js)(content, LP);
            } catch (e) {
                content.innerHTML += '<div class="cw-canvas-err">⚠️ 畫布 JS 錯誤：' + ((e && e.message) || e) + '</div>';
            }
        }
        // 重綁 onclick（共用 VoidCanvas 的 rewire，讓 onclick 在有 LP 的作用域跑）
        if (window.VoidCanvas && typeof window.VoidCanvas.rewireOnclicks === 'function') {
            window.VoidCanvas.rewireOnclicks(content, LP);
        }
    };

    console.log('✅ ChatCanvas（群聊區通用畫布）模組就緒');
})(window.ChatCanvas = window.ChatCanvas || {});
