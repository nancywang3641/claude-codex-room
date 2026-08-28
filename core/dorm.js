/**
 * core/dorm.js — 宿舍面板
 * ------------------------------------------------------------------
 * 點 💬 開的不再是四行下拉選單，而是一排門卡：每位住戶一張，點門進房。
 * 住戶名冊與會話隔離都在 claude_terminal.js（listResidents / saveResident /
 * deleteResident / setActiveResident），本檔只負責畫面與點按。
 * ------------------------------------------------------------------
 */
(function (DormPanel) {
    'use strict';

    const PANEL_ID = 'ccr-dorm';
    const NAME_MAX = 20;

    let _el = null;
    let _editing = null;      // 展開編輯列的住戶 id；'__new__' = 底下那張新住戶卡
    let _delArmed = null;     // 兩段確認：已經按過第一下的住戶 id
    let _delTimer = null;
    let _opening = false;     // 擋連點兩張門卡
    let _docBound = false;
    let _openedAt = 0;

    function _CT() { return window.ClaudeTerminal || null; }

    function _cfg() {
        const OS = window.OS_SETTINGS;
        if (!OS || typeof OS.getClaudeRoomConfig !== 'function') return {};
        try { return OS.getClaudeRoomConfig() || {}; } catch (_) { return {}; }
    }

    function _models() {
        const room = window.VoidClaudeRoom;
        return (room && Array.isArray(room.claudeModels)) ? room.claudeModels : [];
    }

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** 模型的顯示名（共用資料層那支，別在這裡再養一份） */
    function _modelLabel(id) {
        const CT = _CT();
        if (CT && typeof CT.modelLabel === 'function') return CT.modelLabel(id);
        if (!id) return '';
        const m = _models().find(x => x.id === id);
        return m ? m.label : id;
    }

    /** 頭像角標用的短碼：Opus 4.6(舊) → 4.6 */
    function _modelBadge(id) {
        const cfg = _cfg();
        const nick = cfg.modelNames && cfg.modelNames[id];
        if (nick) return nick.slice(0, 4);
        const m = _models().find(x => x.id === id);
        const core = String((m ? m.label : id) || '').replace(/[(（].*$/, '').trim();
        const seg = core.split(/\s+/);
        return seg[seg.length - 1] || core;
    }

    /** 門卡上名字底下那行小字 */
    function _subtitle(r, all) {
        if (r.provider === 'codex')    return 'Codex';
        if (r.provider === 'deepseek') return 'DeepSeek';
        if (r.provider === 'group') {
            const CT = _CT();
            const seats = (CT && typeof CT.listGroupSeats === 'function') ? CT.listGroupSeats() : [];
            return seats.length ? seats.map(x => x.name).join('、') : '還沒有人上桌';
        }
        if (r.modelId) return _modelLabel(r.modelId);
        const cfg = _cfg();
        const cur = (cfg.providerModels && cfg.providerModels.claude) || cfg.inlineModel || cfg.model || '';
        return cur ? _modelLabel(cur) : '想用哪顆都行';
    }

    function _faceHtml(r) {
        if (r.provider === 'codex') {
            return '<span class="dorm-face dorm-face-codex"></span>';
        }
        if (r.provider === 'deepseek') {
            return '<span class="dorm-face dorm-face-icon"><i class="fa-solid fa-user-tie"></i></span>';
        }
        if (r.provider === 'group') {
            return '<span class="dorm-face dorm-face-icon"><i class="fa-solid fa-users"></i></span>';
        }
        const CT = _CT() || {};
        const src = (CT.ASSETS && (CT.ASSETS.idle || CT.ASSETS.mini)) || '';
        const onerr = CT.imgOnError || '';
        const badge = r.modelId
            ? '<span class="dorm-badge">' + _esc(_modelBadge(r.modelId)) + '</span>'
            : '';
        return '<span class="dorm-face dorm-face-img">'
            + '<img src="' + _esc(src) + '" alt="" onerror="' + _esc(onerr) + '">'
            + badge + '</span>';
    }

    /** 就地編輯列：r 為 null 代表底下那張「新住戶」 */
    function _formHtml(r) {
        const isNew = !r;
        const withModel = isNew || (!r.builtin && r.provider === 'claude');
        let h = '<div class="dorm-form">';
        h += '<input type="text" class="dorm-input dorm-in-name" maxlength="' + NAME_MAX
           + '" placeholder="名字" value="' + (r ? _esc(r.name) : '') + '">';
        if (withModel) {
            h += '<select class="dorm-input dorm-in-model">';
            _models().forEach(m => {
                const sel = (r && r.modelId === m.id) ? ' selected' : '';
                h += '<option value="' + _esc(m.id) + '"' + sel + '>' + _esc(_modelLabel(m.id)) + '</option>';
            });
            h += '</select>';
        }
        h += '<div class="dorm-form-act">';
        h += '<button type="button" class="dorm-btn dorm-save">' + (isNew ? '住進來' : '改好了') + '</button>';
        if (r && !r.builtin) {
            h += '<button type="button" class="dorm-btn dorm-del"><i class="fa-solid fa-box-archive"></i> 請他搬走</button>';
        }
        h += '</div><div class="dorm-hint"></div></div>';
        return h;
    }

    /** 門卡右上的入席鈕。群聊區自己不畫 —— 它就是那張桌子。 */
    function _seatBtnHtml(r) {
        if (r.provider === 'group') return '';
        const CT = _CT();
        const on = !!(CT && typeof CT.isGroupSeated === 'function' && CT.isGroupSeated(r.id));
        return '<button type="button" class="dorm-seat' + (on ? ' seated' : '') + '" title="'
            + (on ? '在群聊桌上，點一下請他下桌' : '不在群聊桌上，點一下請他上桌')
            + '"><i class="fa-solid fa-chair"></i></button>';
    }

    function _cardHtml(r, all) {
        const open = _editing === r.id ? ' dorm-editing' : '';
        return '<div class="dorm-card' + open + '" data-id="' + _esc(r.id) + '">'
            + '<button type="button" class="dorm-door">'
            + _faceHtml(r)
            + '<span class="dorm-who">'
            + '<span class="dorm-name">' + _esc(r.name) + '</span>'
            + '<span class="dorm-sub">' + _esc(_subtitle(r, all)) + '</span>'
            + '</span>'
            + '<i class="fa-solid fa-chevron-right dorm-go"></i>'
            + '</button>'
            + _seatBtnHtml(r)
            + '<button type="button" class="dorm-pen" title="改這位住戶"><i class="fa-solid fa-pen"></i></button>'
            + (_editing === r.id ? _formHtml(r) : '')
            + '</div>';
    }

    function _render() {
        if (!_el) return;
        const CT = _CT();
        const all = (CT && typeof CT.listResidents === 'function') ? CT.listResidents() : [];
        const newOpen = _editing === '__new__' ? ' dorm-editing' : '';
        let h = '<div class="dorm-head">'
            + '<span class="dorm-title">宿舍</span>'
            + '<button type="button" class="dorm-x" title="關起來"><i class="fa-solid fa-xmark"></i></button>'
            + '</div>';
        h += '<div class="dorm-list">';
        all.forEach(r => { h += _cardHtml(r, all); });
        h += '<div class="dorm-card dorm-new' + newOpen + '" data-id="__new__">'
            + '<button type="button" class="dorm-door dorm-door-new">'
            + '<span class="dorm-face dorm-face-icon"><i class="fa-solid fa-plus"></i></span>'
            + '<span class="dorm-who"><span class="dorm-name">新住戶</span>'
            + '<span class="dorm-sub">再請一位進來住</span></span>'
            + '</button>'
            + (_editing === '__new__' ? _formHtml(null) : '')
            + '</div>';
        h += '</div>';
        h += '<div class="dorm-hall">'
            + '<button type="button" class="dorm-hall-btn" data-panel="workbench"><i class="fa-solid fa-screwdriver-wrench"></i><span>工作檯</span></button>'
            + '<button type="button" class="dorm-hall-btn" data-panel="board"><i class="fa-solid fa-note-sticky"></i><span>留言板</span></button>'
            + '<button type="button" class="dorm-hall-btn" data-panel="spend"><i class="fa-solid fa-coins"></i><span>額度</span></button>'
            + '</div>';
        _el.innerHTML = h;
        _bind();
        // 展開編輯列會把面板撐高，位置要跟著重算，不然底下的走廊會被擠出畫面
        if (DormPanel.isOpen()) _position();
    }

    function _disarmDelete() {
        if (_delTimer) { clearTimeout(_delTimer); _delTimer = null; }
        _delArmed = null;
    }

    function _bind() {
        _el.querySelector('.dorm-x').addEventListener('click', DormPanel.close);

        _el.querySelectorAll('.dorm-card').forEach(card => {
            const id = card.dataset.id;
            const door = card.querySelector('.dorm-door');
            const pen = card.querySelector('.dorm-pen');
            const seat = card.querySelector('.dorm-seat');

            if (seat) {
                seat.addEventListener('click', (e) => {
                    e.stopPropagation();   // 別讓點擊冒到門上把房間開起來
                    const CT = _CT();
                    if (!CT || typeof CT.setGroupSeat !== 'function') return;
                    const next = !CT.isGroupSeated(id);
                    if (!CT.setGroupSeat(id, next)) return;
                    // 桌上留一行告示：不只是給她看，其他 AI 也靠這條知道多了誰 / 少了誰
                    if (window.ChatGroup && typeof window.ChatGroup.announceSeat === 'function') {
                        window.ChatGroup.announceSeat(id, next);
                    }
                    _render();   // 群聊區那張卡的副標也要跟著換
                });
            }

            if (id === '__new__') {
                door.addEventListener('click', () => { _toggleEdit('__new__'); });
            } else {
                door.addEventListener('click', () => { _enter(id); });
                if (pen) pen.addEventListener('click', (e) => { e.stopPropagation(); _toggleEdit(id); });
            }

            const form = card.querySelector('.dorm-form');
            if (!form) return;
            const nameIn = form.querySelector('.dorm-in-name');
            const modelIn = form.querySelector('.dorm-in-model');
            const hint = form.querySelector('.dorm-hint');
            const save = form.querySelector('.dorm-save');
            const del = form.querySelector('.dorm-del');

            form.addEventListener('click', (e) => e.stopPropagation());
            nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
            nameIn.addEventListener('input', () => {
                nameIn.classList.remove('dorm-warn');
                hint.textContent = '';
            });

            save.addEventListener('click', () => {
                const CT = _CT();
                if (!CT) return;
                const name = nameIn.value.trim();
                if (!name) {
                    nameIn.classList.add('dorm-warn');
                    hint.textContent = '先給他一個名字';
                    nameIn.focus();
                    return;
                }
                if (id === '__new__') {
                    CT.saveResident({ name: name, provider: 'claude', modelId: modelIn ? modelIn.value : '' });
                } else {
                    const before = CT.getResident(id);
                    const oldName = before ? before.name : '';
                    CT.saveResident({ id: id, name: name, modelId: modelIn ? modelIn.value : undefined });
                    // 在席的人改了名，桌上其他人要知道 —— 不然逐字稿的講者前綴會無聲換人
                    if (oldName && oldName !== name && CT.isGroupSeated(id)
                        && window.ChatGroup && typeof window.ChatGroup.announceRename === 'function') {
                        window.ChatGroup.announceRename(oldName, name);
                    }
                    _syncOpenRoom(id);
                }
                _editing = null;
                _disarmDelete();
                _render();
            });

            if (del) {
                del.addEventListener('click', () => {
                    const CT = _CT();
                    if (!CT) return;
                    // 原生確認框會被瀏覽器擋掉，改成按兩下：三秒沒動作就當她反悔
                    if (_delArmed !== id) {
                        _disarmDelete();
                        _delArmed = id;
                        del.classList.add('dorm-armed');
                        del.innerHTML = '<i class="fa-solid fa-box-archive"></i> 真的？再按一次';
                        _delTimer = setTimeout(() => {
                            _disarmDelete();
                            del.classList.remove('dorm-armed');
                            del.innerHTML = '<i class="fa-solid fa-box-archive"></i> 請他搬走';
                        }, 3000);
                        return;
                    }
                    _disarmDelete();
                    // 名字跟在席狀態要在刪之前抓 —— 刪完就查不到了
                    const gone = CT.getResident(id);
                    const wasSeated = typeof CT.isGroupSeated === 'function' && CT.isGroupSeated(id);
                    if (CT.deleteResident(id) && window.ChatGroup
                        && typeof window.ChatGroup.noteResidentRemoved === 'function') {
                        window.ChatGroup.noteResidentRemoved(id, gone ? gone.name : '', wasSeated);
                    }
                    _editing = null;
                    _render();
                });
            }
            setTimeout(() => { try { nameIn.focus(); } catch (_) {} }, 0);
        });

        _el.querySelectorAll('.dorm-hall-btn').forEach(b => {
            b.addEventListener('click', () => _enterHall(b.dataset.panel));
        });
    }

    function _toggleEdit(id) {
        _editing = (_editing === id) ? null : id;
        _disarmDelete();
        _render();
    }

    /** 改名字的時候房間正開著，順手把標題列換掉 */
    function _syncOpenRoom(id) {
        const CT = _CT();
        const CW = window.ChatWindow;
        if (!CT || !CW || typeof CW.refreshIdentity !== 'function') return;
        const r = CT.getResident(id);
        if (r && typeof CT.getActiveResidentId === 'function' && CT.getActiveResidentId(r.provider) === id) {
            CW.refreshIdentity();
        }
    }

    /** 防連點只鎖一下下，不跟房間載得快不快綁在一起——
     *  群聊房載入要等網路，鎖在那邊等於整個面板從此點不動。 */
    function _armOpening() {
        _opening = true;
        setTimeout(() => { _opening = false; }, 600);
    }

    function _enter(id) {
        const CT = _CT();
        const CW = window.ChatWindow;
        if (!CT || !CW || _opening) return;
        const r = CT.getResident(id);
        if (!r) return;
        _armOpening();
        CT.setActiveResident(r.id);
        DormPanel.close();
        Promise.resolve(CW.open(r.provider)).catch(e => console.warn('[DormPanel] 進房失敗', e));
    }

    function _enterHall(panel) {
        const CW = window.ChatWindow;
        if (!CW || _opening) return;
        _armOpening();
        DormPanel.close();
        // 先讓房間開起來（open 的同步段已經把舊子面板收掉），再馬上把要去的那頁疊上去。
        // 不等 open 的 promise：房間讀歷史可能要好幾秒（進過群聊之後特別慢），
        // 等它等於按了沒反應。
        const opening = CW.open('claude');
        if (typeof CW.openSubPanel === 'function') CW.openSubPanel(panel);
        Promise.resolve(opening).catch(e => console.warn('[DormPanel] 進房失敗', e));
    }

    function _ensureEl() {
        if (_el) return _el;
        _el = document.createElement('div');
        _el.id = PANEL_ID;
        // 面板內的點擊不往外冒：展開編輯列會把 innerHTML 整份換掉，等事件冒到 document 時
        // 被點的那個節點已經不在面板裡了，「點外面關閉」那條會誤判成點外面、把面板自己關掉。
        _el.addEventListener('click', (e) => e.stopPropagation());
        document.body.appendChild(_el);
        if (!_docBound) {
            _docBound = true;
            document.addEventListener('click', (e) => {
                if (!DormPanel.isOpen()) return;
                // 開面板的那一下會在 document 上再響一次（酒館的 jQuery 會自己補派一輪，
                // 原生 stopPropagation 攔不住），剛開的頭幾百毫秒一律不當成「點外面」
                if (Date.now() - _openedAt < 400) return;
                if (_el.contains(e.target)) return;
                if (e.target && e.target.closest && e.target.closest('#ccr-launcher')) return;
                DormPanel.close();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && DormPanel.isOpen()) DormPanel.close();
            });
            window.addEventListener('resize', () => {
                if (DormPanel.isOpen()) _position(_anchorEl);
            });
        }
        return _el;
    }

    let _anchorEl = null;

    function _position(anchor) {
        if (!_el) return;
        _anchorEl = anchor || _anchorEl;
        if (window.matchMedia('(max-width: 600px)').matches) {
            _el.classList.add('dorm-mobile');
            const mw = _el.offsetWidth, mh = _el.offsetHeight;
            _el.style.left = Math.max(8, (window.innerWidth - mw) / 2) + 'px';
            _el.style.top = Math.max(8, (window.innerHeight - mh) / 2) + 'px';
            return;
        }
        _el.classList.remove('dorm-mobile');
        const rect = (_anchorEl && _anchorEl.getBoundingClientRect) ? _anchorEl.getBoundingClientRect() : null;
        const w = _el.offsetWidth || 360;
        const h = _el.offsetHeight || 420;
        if (!rect || (!rect.width && !rect.height)) {
            _el.style.left = Math.max(8, (window.innerWidth - w) / 2) + 'px';
            _el.style.top = Math.max(8, (window.innerHeight - h) / 2) + 'px';
            return;
        }
        let left = rect.left;
        if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
        let top = rect.top - h - 8;
        if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - h - 8);
        _el.style.left = Math.max(8, left) + 'px';
        _el.style.top = Math.max(8, top) + 'px';
    }

    DormPanel.isOpen = function () {
        return !!(_el && _el.classList.contains('dorm-on'));
    };

    DormPanel.close = function () {
        _disarmDelete();
        _editing = null;
        if (_el) _el.classList.remove('dorm-on');
    };

    DormPanel.open = function (anchorEl) {
        _openedAt = Date.now();
        _ensureEl();
        _editing = null;
        _disarmDelete();
        _render();
        _el.classList.add('dorm-on');
        _position(anchorEl || document.getElementById('ccr-launcher'));
    };

    DormPanel.toggle = function (anchorEl) {
        if (DormPanel.isOpen()) DormPanel.close();
        else DormPanel.open(anchorEl);
    };

    /** 住戶名字改了、面板開著就重畫 */
    DormPanel.refresh = function () {
        if (DormPanel.isOpen()) _render();
    };

    console.log('[DormPanel] 宿舍面板已載入');

})(window.DormPanel = window.DormPanel || {});
