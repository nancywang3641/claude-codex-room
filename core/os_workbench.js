// ----------------------------------------------------------------
// [檔案] os_workbench.js
// 路徑：os_phone/os/os_workbench.js
// 職責：🛠️ 工作檯 — Rae（需求者）/ 指導者 / 執行者 三方協作
//       Rae 下模糊需求 → 指導者規畫任務清單 →〔關卡〕Rae 放行 →
//       執行者照清單逐項做（真的改檔）→ 指導者逐項審 → 全打勾完工
// 角色可互換（預設 指導=Claude、執行=Codex）
// 資料：localStorage aurelia_workbench_state = {targetDir, roles, need, tasks, log}
// 入口：data-app-launch="workbench"
// ----------------------------------------------------------------
(function () {
    'use strict';
    const win = window.parent || window;

    const LS_KEY = 'aurelia_workbench_state';
    const LOG_CONTEXT_LIMIT = 24;   // 餵 AI 時最多帶最近 N 則工作日誌
    const MAX_ATTEMPTS = 2;          // 同一任務執行者最多嘗試幾次（被打回會重做）

    const NAME   = { rae: 'Rae', claude: 'Claude', codex: 'Codex' };
    const AVATAR = { rae: '🌙',  claude: '🦀',     codex: '🔷' };
    const ROLE_LABEL = { requester: '需求', director: '指導', executor: '執行' };
    function _nameOf(a)   { return NAME[a]   || a; }
    function _avatarOf(a) { return AVATAR[a] || '·'; }

    // ===== 狀態 =====
    function _blankState() {
        return {
            targetDir: '',
            roles: { director: 'claude', executor: 'codex' },
            need: '',
            tasks: [],   // {id, text, status: pending|doing|done}
            log: [],     // {author, role, content, ts}
        };
    }
    let _state = _blankState();
    let _phase = 'idle';      // idle | gate | running | done
    let _running = false;
    let _abortCtrl = null;

    function _loadState() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                _state = Object.assign(_blankState(), s);
                if (!_state.roles || !_state.roles.director) _state.roles = { director: 'claude', executor: 'codex' };
            }
        } catch (e) { console.warn('[OS_WORKBENCH] loadState failed:', e); }
        // 重開時迴圈早停了：把卡在「執行中」的任務狀態退回 pending
        _state.tasks.forEach(t => { if (t.status === 'doing') t.status = 'pending'; });
        // phase 由 tasks 推導（不存 phase：重開時迴圈早就停了）
        if (!_state.tasks.length)                          _phase = 'idle';
        else if (_state.tasks.every(t => t.status === 'done')) _phase = 'done';
        else                                               _phase = 'gate';
    }
    function _saveState() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(_state)); }
        catch (e) { console.warn('[OS_WORKBENCH] saveState failed:', e); }
    }

    function _fmtTime(ts) {
        const d = new Date(ts || Date.now());
        const p = n => String(n).padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}`;
    }

    // ===== 解析 =====
    /** 從指導者回覆抽 [PLAN]...[/PLAN] 區塊，回傳任務字串陣列 */
    function _parsePlan(reply) {
        if (!reply) return [];
        let block = '';
        const m = reply.match(/\[PLAN\]([\s\S]*?)\[\/PLAN\]/i);
        if (m) block = m[1];
        else   block = reply;   // 沒區塊就退而求其次掃整段
        const tasks = [];
        block.split('\n').forEach(line => {
            const t = line.trim()
                .replace(/^[-*•]\s*/, '')
                .replace(/^\[[ x]\]\s*/i, '')
                .replace(/^\d+[.)、]\s*/, '')
                .trim();
            if (t && t.length > 1) tasks.push(t);
        });
        return tasks;
    }
    /** 從指導者審查回覆抽結論：'pass' | 'redo' | null */
    function _parseVerdict(reply) {
        if (!reply) return null;
        const m = reply.match(/\[VERDICT\|(PASS|REDO)\]/i);
        if (m) return m[1].toLowerCase();
        return null;
    }
    /** 給卡片顯示用：把 [PLAN]/[VERDICT] 標記從正文清掉 */
    function _stripMarkers(text) {
        return String(text || '')
            .replace(/\[\/?PLAN\]/gi, '')
            .replace(/\[VERDICT\|(PASS|REDO)\]/gi, '')
            .trim();
    }

    // ===== 組 messages =====
    function _logForPrompt() {
        return _state.log.slice(-LOG_CONTEXT_LIMIT)
            .map(p => `【${_nameOf(p.author)}·${ROLE_LABEL[p.role] || ''}】${p.content}`)
            .join('\n\n');
    }
    function _tasksForPrompt() {
        return _state.tasks
            .map(t => `${t.status === 'done' ? '✅' : t.status === 'doing' ? '🔄' : '⬜'} ${t.id}. ${t.text}`)
            .join('\n');
    }

    function _planMessages() {
        const sys =
            `你是「奧瑞亞工作檯」的指導者。使用者 Rae 是需求者，她的需求可能講不清楚 —— ` +
            `你的工作是把她的需求變成一份「具體、可執行」的任務清單，交給執行者去做。\n` +
            `工作目標資料夾：${_state.targetDir || '(未指定)'}\n` +
            `你可以讀這個資料夾來了解現況再規畫。`;
        const user =
            `Rae 的需求：\n${_state.need}\n\n` +
            (_state.log.length ? `目前工作日誌：\n${_logForPrompt()}\n\n` : '') +
            `請規畫任務清單。先寫一兩句你對需求的理解，然後給一個 [PLAN] 區塊，` +
            `裡面每行一個任務、用 1. 2. 3. 編號。每個任務要具體、夠小、可一步做完。\n` +
            `格式：\n[PLAN]\n1. ...\n2. ...\n[/PLAN]`;
        return [{ role: 'system', content: sys }, { role: 'user', content: user }];
    }

    function _executorMessages(task) {
        const sys =
            `你是「奧瑞亞工作檯」的執行者。你能在工作資料夾「${_state.targetDir}」裡` +
            `實際讀寫檔案、跑命令。照指導者排的任務清單，做「當前指定的這一項」。`;
        const user =
            `整體需求：\n${_state.need}\n\n` +
            `任務清單：\n${_tasksForPrompt()}\n\n` +
            (_state.log.length ? `工作日誌（之前的進展）：\n${_logForPrompt()}\n\n` : '') +
            `———\n現在只做這一項：「${task.text}」\n` +
            `在「${_state.targetDir}」裡實際動手。做完後簡短回報你做了什麼（改了哪些檔、跑了什麼）。` +
            `只做這一項，不要跑去做清單上的其他項。`;
        return [{ role: 'system', content: sys }, { role: 'user', content: user }];
    }

    function _reviewMessages(task, executorReply) {
        const sys = `你是「奧瑞亞工作檯」的指導者，負責審查執行者剛做完的成果。` +
            `工作資料夾：${_state.targetDir}（你可以讀它來核對）。`;
        const user =
            `整體需求（只是背景參考，不是這次的審查標準）：\n${_state.need}\n\n` +
            `這次唯一要審的任務：「${task.text}」\n\n` +
            `執行者的回報：\n${executorReply}\n\n` +
            `———\n只審查「這一項任務」本身做得對不對、夠不夠好。` +
            `不要因為它沒做到清單上「其他項」的事就判不通過 —— 那些是別的任務的範圍，輪到時自然會做。\n` +
            `簡短講評（兩三句）。最後一行一定要給結論：` +
            `這一項本身 OK 就寫 [VERDICT|PASS]，這一項本身有問題、需要重做才寫 [VERDICT|REDO] 並說清楚要改什麼。`;
        return [{ role: 'system', content: sys }, { role: 'user', content: user }];
    }

    // ===== 卡片 / 任務清單 渲染 =====
    function _appendLogCard(container, post, pending) {
        const feed = container.querySelector('#wb-log');
        if (!feed) return null;
        const empty = feed.querySelector('.wb-log-empty');
        if (empty) empty.remove();

        const card = document.createElement('div');
        card.className = `wb-card wb-card-${post.author}` + (pending ? ' wb-card-pending' : '');

        const avatar = document.createElement('div');
        avatar.className = 'wb-card-avatar';
        avatar.textContent = _avatarOf(post.author);

        const main = document.createElement('div');
        main.className = 'wb-card-main';
        const head = document.createElement('div');
        head.className = 'wb-card-head';
        const nameEl = document.createElement('span');
        nameEl.className = 'wb-card-name';
        nameEl.textContent = _nameOf(post.author);
        const roleEl = document.createElement('span');
        roleEl.className = 'wb-card-role';
        roleEl.textContent = ROLE_LABEL[post.role] || '';
        const timeEl = document.createElement('span');
        timeEl.className = 'wb-card-time';
        timeEl.textContent = _fmtTime(post.ts);
        head.appendChild(nameEl);
        head.appendChild(roleEl);
        head.appendChild(timeEl);

        const body = document.createElement('div');
        body.className = 'wb-card-body';
        body.textContent = pending ? '' : _stripMarkers(post.content);

        main.appendChild(head);
        main.appendChild(body);
        card.appendChild(avatar);
        card.appendChild(main);
        feed.appendChild(card);
        feed.scrollTop = feed.scrollHeight;
        return card;
    }
    function _setCardBody(card, text) {
        if (!card) return;
        const body = card.querySelector('.wb-card-body');
        if (body) body.textContent = _stripMarkers(text);
        const feed = card.parentElement;
        if (feed) feed.scrollTop = feed.scrollHeight;
    }

    function _renderLog(container) {
        const feed = container.querySelector('#wb-log');
        if (!feed) return;
        feed.innerHTML = '';
        if (!_state.log.length) {
            const e = document.createElement('div');
            e.className = 'wb-log-empty';
            e.textContent = '工作日誌會記在這裡。';
            feed.appendChild(e);
            return;
        }
        _state.log.forEach(p => _appendLogCard(container, p, false));
    }

    function _renderTasks(container) {
        const wrap = container.querySelector('#wb-tasks');
        if (!wrap) return;
        if (!_state.tasks.length) {
            wrap.innerHTML = '<div class="wb-tasks-empty">還沒有任務清單。<br>在下面描述你的需求，按「規畫」。</div>';
            return;
        }
        const ICON = { pending: '⬜', doing: '🔄', done: '✅' };
        const rows = _state.tasks.map(t => `
            <div class="wb-task wb-task-${t.status}">
                <span class="wb-task-icon">${ICON[t.status] || '⬜'}</span>
                <span class="wb-task-text"></span>
            </div>
        `).join('');
        const doneN = _state.tasks.filter(t => t.status === 'done').length;
        wrap.innerHTML = `
            <div class="wb-tasks-head">
                <span class="wb-tasks-title">📋 任務清單</span>
                <span class="wb-tasks-prog">${doneN} / ${_state.tasks.length}</span>
            </div>
            <div class="wb-tasks-list">${rows}</div>
            ${_phase === 'gate' ? `<button class="wb-approve" id="wb-approve" type="button">👍 開始執行</button>` : ''}
        `;
        // 任務文字用 textContent 填（避免注入）
        wrap.querySelectorAll('.wb-task-text').forEach((el, i) => {
            if (_state.tasks[i]) el.textContent = `${_state.tasks[i].id}. ${_state.tasks[i].text}`;
        });
        const approve = wrap.querySelector('#wb-approve');
        if (approve) approve.addEventListener('click', () => _onApprove(container));
    }

    // ===== setup bar / composer 狀態 =====
    function _renderSetup(container) {
        const dirInput = container.querySelector('#wb-dir');
        if (dirInput && dirInput.value !== _state.targetDir) dirInput.value = _state.targetDir;
        const roleEl = container.querySelector('#wb-roles');
        if (roleEl) {
            roleEl.innerHTML =
                `🦀🔷 指導 <b>${_nameOf(_state.roles.director)}</b> · ` +
                `執行 <b>${_nameOf(_state.roles.executor)}</b>`;
        }
    }
    function _updateRunBtn(container) {
        const btn = container.querySelector('#wb-run');
        if (!btn) return;
        if (_running) {
            btn.textContent = '⏹ 停';
            btn.className = 'wb-run wb-run-stop';
            return;
        }
        btn.className = 'wb-run';
        if (_phase === 'gate')      btn.textContent = '🔄 重新規畫';
        else                        btn.textContent = '📋 規畫';
    }
    function _render(container) {
        _renderSetup(container);
        _renderTasks(container);
        _updateRunBtn(container);
    }

    // ===== 一個 AI 回合 =====
    async function _turn(container, roleKey, messages, signal) {
        const speaker = _state.roles[roleKey];
        const opts = { cwd: _state.targetDir };
        if (roleKey === 'executor') opts.sandbox = 'workspace-write';   // 執行者開寫權限

        const card = _appendLogCard(container, { author: speaker, role: roleKey, content: '', ts: Date.now() }, true);
        let result;
        try {
            result = await win.ClaudeTerminal.sendWorkbench(messages, speaker, opts, (ev) => {
                if (ev && ev.type === 'text') _setCardBody(card, ev.accumulated);
            }, signal);
        } catch (e) {
            const aborted = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
            if (aborted) { if (card) card.remove(); throw e; }
            _setCardBody(card, '⚠️ ' + ((e && e.message) || '出錯了'));
            if (card) card.classList.remove('wb-card-pending');
            throw e;
        }
        const post = { author: speaker, role: roleKey, content: result.reply, ts: Date.now() };
        _state.log.push(post);
        _saveState();
        _setCardBody(card, result.reply);
        if (card) card.classList.remove('wb-card-pending');
        return result.reply;
    }

    // ===== 規畫 =====
    async function _runPlanning(container) {
        if (_running) return;
        if (!_state.targetDir) { _toast(container, '先填「工作資料夾」'); return; }
        if (!_state.need)      { _toast(container, '先描述你的需求'); return; }
        _running = true;
        _abortCtrl = new AbortController();
        _updateRunBtn(container);
        try {
            const reply = await _turn(container, 'director', _planMessages(), _abortCtrl.signal);
            const taskTexts = _parsePlan(reply);
            if (taskTexts.length) {
                _state.tasks = taskTexts.map((t, i) => ({ id: i + 1, text: t, status: 'pending' }));
                _phase = 'gate';
            } else {
                _phase = 'idle';
                _toast(container, '指導者沒給出可解析的清單，再試一次或補充需求');
            }
            _saveState();
        } catch (e) {
            const benign = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
            if (!benign) console.warn('[OS_WORKBENCH] 規畫中止:', e);
        } finally {
            _running = false;
            _abortCtrl = null;
            _render(container);
        }
    }

    // ===== 執行迴圈 =====
    async function _runExecution(container) {
        if (_running) return;
        if (!_state.tasks.length) return;
        _running = true;
        _phase = 'running';
        _abortCtrl = new AbortController();
        const signal = _abortCtrl.signal;
        _updateRunBtn(container);

        try {
            for (let i = 0; i < _state.tasks.length; i++) {
                if (signal.aborted) break;
                const task = _state.tasks[i];
                if (task.status === 'done') continue;

                let passed = false;
                for (let attempt = 1; attempt <= MAX_ATTEMPTS && !passed && !signal.aborted; attempt++) {
                    task.status = 'doing';
                    _saveState(); _renderTasks(container);

                    const exReply = await _turn(container, 'executor', _executorMessages(task), signal);
                    if (signal.aborted) break;
                    const rvReply = await _turn(container, 'director', _reviewMessages(task, exReply), signal);
                    if (_parseVerdict(rvReply) === 'pass') passed = true;
                    // REDO 且還有 attempt：迴圈會讓執行者重做（它看得到 log 裡的審查意見）
                }
                // 通過、或試滿次數 → 標完成往下走（指導者的意見都在日誌裡，Rae 自己把關）
                task.status = 'done';
                _saveState(); _renderTasks(container);
            }
        } catch (e) {
            const benign = e && (e.name === 'AbortError' || /abort/i.test(e.message || ''));
            if (!benign) console.warn('[OS_WORKBENCH] 執行中止:', e);
        } finally {
            _running = false;
            _abortCtrl = null;
            _phase = _state.tasks.every(t => t.status === 'done') ? 'done' : 'gate';
            _saveState();
            _render(container);
        }
    }

    // ===== 互動 =====
    let _toastTimer = null;
    function _toast(container, msg) {
        let el = container.querySelector('.wb-toast');
        if (!el) {
            el = document.createElement('div');
            el.className = 'wb-toast';
            container.querySelector('.wb-root').appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
    }

    function _autoGrow(input) {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }

    /** 主按鈕：跑迴圈中→停；否則→（存需求）規畫 */
    function _onRunClick(container) {
        if (_running) {
            if (_abortCtrl) _abortCtrl.abort();
            return;
        }
        const input = container.querySelector('#wb-input');
        const text = (input && input.value || '').trim();
        if (text) {
            _state.need = text;
            _state.log.push({ author: 'rae', role: 'requester', content: text, ts: Date.now() });
            _appendLogCard(container, { author: 'rae', role: 'requester', content: text, ts: Date.now() }, false);
            input.value = '';
            _autoGrow(input);
            _saveState();
        }
        _runPlanning(container);
    }

    /** 〔關卡〕Rae 按「開始執行」*/
    function _onApprove(container) {
        if (_running) return;
        _runExecution(container);
    }

    function _onSwapRoles(container) {
        if (_running) return;
        const r = _state.roles;
        _state.roles = { director: r.executor, executor: r.director };
        _saveState();
        _renderSetup(container);
    }

    async function _onReset(container) {
        if (_running) return;
        if (!confirm('清空整個工作檯（需求、任務清單、日誌）？此動作不可逆。')) return;
        const dir = _state.targetDir, roles = _state.roles;   // 保留資料夾與角色設定
        _state = _blankState();
        _state.targetDir = dir;
        _state.roles = roles;
        _phase = 'idle';
        _saveState();
        _renderLog(container);
        _render(container);
    }

    // ===== 入口 =====
    function launch(container) {
        if (!container) return;
        if (_running && _abortCtrl) _abortCtrl.abort();
        _running = false;
        _abortCtrl = null;
        _loadState();

        container.innerHTML = `
            <div class="wb-root">
                <button class="wb-close" id="wb-close" title="關閉">✕</button>
                <div class="wb-header">
                    <div class="wb-title">🛠️ 工作檯</div>
                    <div class="wb-sub">需求者 Rae · 指導者 · 執行者 —— 規畫、把關、執行</div>
                </div>
                <div class="wb-setup">
                    <input class="wb-dir" id="wb-dir" type="text" spellcheck="false"
                        placeholder="工作資料夾路徑（執行者只能在這裡動手）例：D:\\MyProject">
                    <div class="wb-setup-row">
                        <span class="wb-roles" id="wb-roles"></span>
                        <button class="wb-swap" id="wb-swap" type="button" title="對調指導／執行">⇄ 互換</button>
                    </div>
                </div>
                <div class="wb-tasks" id="wb-tasks"></div>
                <div class="wb-log" id="wb-log"></div>
                <div class="wb-composer">
                    <textarea class="wb-input" id="wb-input" rows="1"
                        placeholder="描述你的需求（講不清楚也沒關係，指導者會幫你理清）…"></textarea>
                    <div class="wb-composer-row">
                        <button class="wb-reset" id="wb-reset" type="button" title="清空工作檯">🗑️</button>
                        <button class="wb-run" id="wb-run" type="button">📋 規畫</button>
                    </div>
                </div>
            </div>
        `;

        const dirInput = container.querySelector('#wb-dir');
        const input    = container.querySelector('#wb-input');
        const runBtn   = container.querySelector('#wb-run');
        const swapBtn  = container.querySelector('#wb-swap');
        const resetBtn = container.querySelector('#wb-reset');
        const closeBtn = container.querySelector('#wb-close');

        _renderLog(container);
        _render(container);

        if (dirInput) {
            dirInput.addEventListener('change', () => {
                _state.targetDir = (dirInput.value || '').trim();
                _saveState();
            });
        }
        if (input) {
            input.addEventListener('input', () => _autoGrow(input));
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    _onRunClick(container);
                }
            });
        }
        if (runBtn)   runBtn.addEventListener('click', () => _onRunClick(container));
        if (swapBtn)  swapBtn.addEventListener('click', () => _onSwapRoles(container));
        if (resetBtn) resetBtn.addEventListener('click', () => _onReset(container));
        if (closeBtn) closeBtn.addEventListener('click', () => {
            if (_running && _abortCtrl) _abortCtrl.abort();
            if (win.PhoneSystem && typeof win.PhoneSystem.goHome === 'function') win.PhoneSystem.goHome();
        });
    }

    win.OS_WORKBENCH = { launch };
    console.log('✅ 工作檯 (OS_WORKBENCH) 模組就緒');
})();
