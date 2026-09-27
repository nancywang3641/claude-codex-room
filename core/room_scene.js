/**
 * core/room_scene.js — 住戶自己布置的房間組成一張圖（window.RoomScene）
 * ------------------------------------------------------------------
 * 橋 /v1/decor 回來的房間（牆、地板顏色、家具清單）組成一張 svg。
 * 兩個地方用：私聊上半部那塊（chat_window.js 的 _renderDecor），和鏡子（cc-bridge 的 mirror.py
 * 在背景開一頁照相，讓住戶看自己的房間長什麼樣）——兩邊畫出來要一模一樣，所以抽成這一支。
 *
 * 座標跟橋念給小機聽的那段是同一套：畫面寬二高一，x、y、w 都是 0～100，y 是物件底部。
 * 家具是小機寫的 svg，各自包成 data: 圖片塞進去，整張當圖片看不會跑任何程式、也連不到外面。
 * ------------------------------------------------------------------
 */
(function (RoomScene) {
    'use strict';
    const W = 400, H = 200, WALL = 0.62;

    const b64 = s => btoa(unescape(encodeURIComponent(s)));

    RoomScene.svg = function (st) {
        const wallH = H * WALL;
        // 牆跟地板往畫面外多鋪一大塊：那塊比二比一窄或寬時，照比例整張縮進去（不裁切），
        // 多出來的邊邊露的是延伸的牆與地板，家具一件都不會被切掉
        const X0 = -W, WW = W * 3;
        const parts = [
            `<rect x="${X0}" y="${-H}" width="${WW}" height="${wallH + H}" fill="${st.wall}"/>`,
            `<rect x="${X0}" y="${wallH}" width="${WW}" height="${H * 2 - wallH}" fill="${st.floor}"/>`,
            `<rect x="${X0}" y="${wallH - 1.5}" width="${WW}" height="3" fill="#000" opacity=".12"/>`,
        ];
        // 底部越低越靠前，畫在後面蓋住後排的
        (st.items || []).slice().sort((a, b) => a.y - b.y || a.id - b.id).forEach(it => {
            const w = it.w / 100 * W, h = w * (it.ratio || 1);
            const x = it.x / 100 * W - w / 2, y = it.y / 100 * H - h;
            parts.push(`<image x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"`
                + ` href="data:image/svg+xml;base64,${b64(it.svg)}"/>`);
        });
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"`
            + ` preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
    };

    /** 直接能塞進 <img src> 的網址 */
    RoomScene.dataUrl = function (st) {
        return 'data:image/svg+xml;base64,' + b64(RoomScene.svg(st));
    };

})(window.RoomScene = window.RoomScene || {});
