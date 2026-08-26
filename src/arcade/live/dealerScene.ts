import { Application, Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import { bakeCardAtlas, CARD_ASPECT, type CardAtlas } from '../common/cards/atlas';
import { GOLD, GOLD_DEEP, IVORY, MUTED, TEXT } from '../theme';
import { dealtBy, locate, phaseAt, ROUND_DURATION, type RoundCue, type StreamCues } from './schedule';

/**
 * 荷官視角的牌桌——**離線渲染成影片用的場景，不是玩家看到的那一層。**
 *
 * 玩家最後看到的是「這支場景錄出來的影片」加上疊在它之上的遊戲 UI。所以這裡刻意
 * 只畫實體世界會有的東西：桌面、牌靴、落下的牌、桌邊的牌號與時鐘。**注區、籌碼、
 * 路圖一律不畫**——那些是客戶端的東西，畫進影片裡就等於把 UI 燒死在畫面上，
 * 換一個語系或換一種版面都改不動了。
 *
 * ## 為什麼整支場景是 seek 出來的
 *
 * 每一格畫面都由 `seek(t)` 直接算出來，沒有任何跨幀累積的狀態，也沒有 gsap。
 * 這不是潔癖：離線渲染是**一幀一幀跳著截**的，中間不存在真實時間流逝。動畫若靠
 * 「上一幀的位置 + 這一幀的位移」推進，截出來的序列就會跟時間對不上，而且每次
 * 重新產生的素材都不一樣——牌序明明固定，畫面卻不可重現。
 *
 * 順帶得到的好處是這支場景也能直接掛在頁面上當「不用影片的退路」：同一個 `seek`
 * 餵牆鐘就是即時畫面。素材還沒生出來時的開發預覽就是這樣跑的。
 */

/** 素材的解析度。視訊桌台的畫面在版面上只佔上半條，640×360 綽綽有餘，而且切片才不會太肥 */
export const STREAM_WIDTH = 640;
export const STREAM_HEIGHT = 360;

/** 牌在畫面上的寬度。52 試過太小——牌角的點數在 640 寬的畫面上快要讀不出來 */
const CARD_W = 60;
/** 前兩張牌的間距 */
const CARD_GAP = 66;

/** 一張牌從牌靴飛到位置要多久 */
const FLY_DURATION = 0.45;
/** 翻牌動作的長度 */
const FLIP_DURATION = 0.36;
/** 收牌動作裡每張牌淡出的長度 */
const FADE_DURATION = 0.5;

/** 牌靴的位置。牌都從這裡出來 */
const SHOE = { x: 566, y: 92 };

/** 兩側牌區的中心。前兩張在中心偏上，補牌橫放在下面（見 restingPlace） */
const SPOTS = {
    player: { x: 196, y: 205 },
    banker: { x: 428, y: 205 },
};

/** 前兩張相對牌區中心往上讓出的距離，讓出來的空間給補牌 */
const PAIR_RISE = 24;
/** 補牌橫放的位置，相對牌區中心往下 */
const THIRD_DROP = 44;

export interface DealerScene {
    view: Container;
    /**
     * 畫出素材第 `t` 秒的樣子。
     *
     * `t` 會自己對總長取餘數，所以餵牆鐘算出來的全域時間也可以——循環是這一層的事，
     * 呼叫端不必知道素材有多長。
     */
    seek(t: number): void;
    destroy(): void;
}

/** 一張牌在畫面上的呈現物件。位置與翻面狀態每幀被 seek 重設，自己不記任何東西 */
interface CardSlot {
    sprite: Sprite;
    shadow: Graphics;
}

export function createDealerScene(app: Application, cues: StreamCues): DealerScene {
    const view = new Container();
    const atlas = bakeCardAtlas(app);

    view.addChild(drawTable());

    const cardLayer = new Container();
    view.addChild(cardLayer);

    // 一局最多六張牌。**先配置好、之後只改屬性**——離線渲染會跑上千幀，
    // 每幀 new 一批 Sprite 再丟掉會讓 GC 的節奏跟截圖的節奏打架
    const slots: CardSlot[] = [];
    for (let i = 0; i < 6; i++) {
        const shadow = new Graphics();
        const sprite = new Sprite();
        sprite.anchor.set(0.5);
        cardLayer.addChild(shadow, sprite);
        slots.push({ sprite, shadow });
    }

    const hud = createHud();
    view.addChild(hud.view);

    function seek(t: number): void {
        const { index, local } = locate(cues, t);
        const cue = cues.rounds[index];
        const phase = phaseAt(cue, local);

        layoutCards(slots, atlas, cue, local, phase);
        hud.update(cue, local, phase, index, cues.rounds.length, t);
    }

    return {
        view,
        seek,
        destroy(): void {
            view.destroy({ children: true });
            // atlas 的底圖是烘出來的，不連同底層一起還就會留在 GPU 上
            atlas.source.destroy(true);
        },
    };
}

// ---- 牌 -----------------------------------------------------------------

/**
 * 把六個牌位擺到這一刻該有的樣子。
 *
 * 每個牌位的狀態完全由 `local` 決定——飛到哪、翻了沒、淡出多少全是插值出來的。
 * 用不到的牌位設成 `visible = false`，而不是移到畫面外：移到畫面外的東西仍然
 * 要走一次 transform 與 batch。
 */
function layoutCards(slots: CardSlot[], atlas: CardAtlas, cue: RoundCue, local: number, phase: string): void {
    for (const s of slots) {
        s.sprite.visible = false;
        s.shadow.visible = false;
    }

    const dealt = dealtBy(cue, local);

    for (let i = 0; i < dealt.length && i < slots.length; i++) {
        const d = dealt[i];
        const slot = slots[i];
        const target = restingPlace(d.side, d.index);

        // 飛行：從牌靴到定位。用 easeOutCubic，手把牌推出去是先快後慢的
        const flyT = clamp01((local - d.at) / FLY_DURATION);
        const e = 1 - Math.pow(1 - flyT, 3);
        let x = SHOE.x + (target.x - SHOE.x) * e;
        let y = SHOE.y + (target.y - SHOE.y) * e;

        // 翻面：前四張等到 revealAt 一起翻，補牌落地就翻（真實桌台就是這樣，
        // 補牌是為了決定勝負，沒有留懸念的餘地）
        const flipAt = d.index < 2 ? cue.revealAt : d.at + FLY_DURATION;
        const flipT = clamp01((local - flipAt) / FLIP_DURATION);
        const faceUp = flipT >= 0.5;
        // 翻牌用橫向壓扁模擬立起來的那一瞬間。0.5 處寬度為 0，正好換貼圖
        const squash = Math.abs(flipT * 2 - 1);

        const tex = faceUp ? faceTexture(atlas, d.card.suit, d.card.rank) : atlas.back;
        slot.sprite.texture = tex;
        slot.sprite.visible = true;

        const h = CARD_W * CARD_ASPECT;
        slot.sprite.width = CARD_W * (flipT > 0 && flipT < 1 ? Math.max(0.04, squash) : 1);
        slot.sprite.height = h;

        // 第三張橫放。真實桌台的補牌就是壓在前兩張旁邊橫著擺的，
        // 這個細節比什麼都容易讓看過真桌的人認出畫面對不對
        slot.sprite.rotation = d.index === 2 ? Math.PI / 2 : 0;

        // 收牌：往牌靴方向收走並淡出。
        // 只淡出的話牌會跟綠呢混成一片灰綠，看起來像變色而不是被拿走——**動作的方向
        // 才是「收牌」的意思所在**，荷官是把牌撥回牌靴那一側的
        let fade = 1;
        if (phase === 'clearing') {
            const k = clamp01((local - cue.clearAt) / FADE_DURATION);
            fade = 1 - k;
            x += (SHOE.x - x) * k * 0.55;
            y += (SHOE.y - y) * k * 0.55;
        }
        slot.sprite.x = x;
        slot.sprite.y = y;
        slot.sprite.alpha = fade;

        slot.shadow.visible = fade > 0.02;
        slot.shadow.alpha = fade * 0.5;
        slot.shadow.clear();
        slot.shadow
            .roundRect(x - CARD_W / 2 + 3, y - h / 2 + 5, CARD_W, h, 5)
            .fill({ color: 0x000000, alpha: 0.45 });
        if (d.index === 2) {
            slot.shadow.clear();
            slot.shadow.roundRect(x - h / 2 + 3, y - CARD_W / 2 + 5, h, CARD_W, 5).fill({ color: 0x000000, alpha: 0.45 });
        }
    }
}

/** 某一側第 n 張牌的定位 */
function restingPlace(side: 'player' | 'banker', index: number): { x: number; y: number } {
    const spot = SPOTS[side];
    if (index === 2) {
        // 補牌橫放在前兩張的**正下方**，不是旁邊。
        //
        // 旁邊擺不下：橫放的牌半寬是牌高的一半（42px），而前兩張的外緣已經在 63px 處，
        // 要不重疊得偏移 109px——那會超出注區框，莊家那張還會壓到牌靴。往下擺同時解掉
        // 這兩件事，而且真實桌台的補牌本來就常壓在兩張牌的下緣
        return { x: spot.x, y: spot.y + THIRD_DROP };
    }
    return { x: spot.x + (index === 0 ? -CARD_GAP / 2 : CARD_GAP / 2), y: spot.y - PAIR_RISE };
}

function faceTexture(atlas: CardAtlas, suit: Parameters<typeof atlas.frames.get>[0], rank: number): Texture {
    return atlas.frames.get(suit)?.[rank] ?? atlas.back;
}

// ---- 桌面 ---------------------------------------------------------------

/**
 * 桌面。一次畫好，之後不再重畫——它跟時間無關。
 *
 * 質感靠三層疊出來：底色、往中央提亮的橢圓（頂燈）、桌緣的金線。**沒有貼圖**，
 * 跟這一頁其他地方一樣是程序化畫的，所以素材裡不含任何外部素材。
 */
function drawTable(): Container {
    const g = new Container();

    const felt = new Graphics();
    felt.rect(0, 0, STREAM_WIDTH, STREAM_HEIGHT).fill(0x123024);
    g.addChild(felt);

    // 頂燈：中央偏上一點，因為光源在荷官後上方
    const light = new Graphics();
    for (let i = 10; i >= 1; i--) {
        const r = i / 10;
        light.ellipse(STREAM_WIDTH / 2, 200, 330 * r, 190 * r).fill({ color: 0x1d4a37, alpha: 0.13 });
    }
    g.addChild(light);

    // 荷官側的桌緣弧線
    const arc = new Graphics();
    arc.ellipse(STREAM_WIDTH / 2, 4, 300, 86).stroke({ color: GOLD_DEEP, width: 2, alpha: 0.55 });
    arc.ellipse(STREAM_WIDTH / 2, 4, 288, 76).stroke({ color: GOLD_DEEP, width: 1, alpha: 0.3 });
    g.addChild(arc);

    // 兩側的下注區框——實體桌上真的印在呢面上，所以它屬於畫面而不是 UI
    for (const [side, spot] of Object.entries(SPOTS)) {
        const box = new Graphics();
        box.roundRect(spot.x - 82, spot.y - 72, 164, 150, 8).stroke({ color: GOLD_DEEP, width: 1.5, alpha: 0.5 });
        g.addChild(box);

        const label = new Text({
            text: side === 'player' ? 'PLAYER' : 'BANKER',
            style: new TextStyle({ fontFamily: 'Menlo, monospace', fontSize: 13, fill: GOLD_DEEP, letterSpacing: 3 }),
        });
        label.anchor.set(0.5);
        label.x = spot.x;
        label.y = spot.y - 88;
        label.alpha = 0.75;
        g.addChild(label);
    }

    g.addChild(drawShoe());
    return g;
}

/** 牌靴。牌從它嘴上滑出來，所以它得在畫面裡看得見 */
function drawShoe(): Container {
    const c = new Container();
    const body = new Graphics();
    body.roundRect(SHOE.x - 34, SHOE.y - 40, 68, 78, 5).fill(0x2b1d16);
    body.roundRect(SHOE.x - 34, SHOE.y - 40, 68, 78, 5).stroke({ color: GOLD_DEEP, width: 1.5, alpha: 0.7 });
    // 出牌口
    body.rect(SHOE.x - 26, SHOE.y + 26, 52, 8).fill(0x0d0906);
    c.addChild(body);

    const stack = new Graphics();
    for (let i = 0; i < 5; i++) {
        stack.rect(SHOE.x - 25, SHOE.y - 32 + i * 5, 50, 3).fill({ color: IVORY, alpha: 0.32 - i * 0.04 });
    }
    c.addChild(stack);
    return c;
}

// ---- 桌邊的字 ------------------------------------------------------------

/**
 * 桌邊的牌號、時鐘與階段字。
 *
 * 為什麼這些燒進影片而不是做成 overlay：它們是**攝影機拍得到的東西**——真實視訊桌台
 * 的桌邊就有一塊顯示局號與倒數的牌子。把它留在影片裡，畫面自己就能證明「這是即時的」，
 * 而且時鐘一直在走，任何人打開頁面都看得出畫面沒有凍住。
 *
 * 反過來說，倒數秒數**同時也會出現在 overlay 上**，那一份才是玩家真正該看的
 * （會跟著自己的網路延遲修正）。兩份不一致正是視訊桌台的日常，也是這一頁想展示的
 * 東西之一。
 */
function createHud(): { view: Container; update(cue: RoundCue, local: number, phase: string, index: number, total: number, t: number): void } {
    const view = new Container();

    const plate = new Graphics();
    plate.roundRect(14, 14, 176, 34, 4).fill({ color: 0x000000, alpha: 0.42 });
    view.addChild(plate);

    const mono = (size: number, fill: number, letterSpacing = 1): TextStyle =>
        new TextStyle({ fontFamily: 'Menlo, monospace', fontSize: size, fill, letterSpacing });

    const liveDot = new Graphics();
    view.addChild(liveDot);

    const liveText = new Text({ text: 'LIVE', style: mono(13, 0xe05a5a, 2) });
    liveText.x = 42;
    liveText.y = 22;
    view.addChild(liveText);

    const clock = new Text({ text: '', style: mono(13, TEXT, 1) });
    clock.x = 92;
    clock.y = 22;
    view.addChild(clock);

    const roundText = new Text({ text: '', style: mono(12, MUTED, 2) });
    roundText.x = 14;
    roundText.y = 56;
    view.addChild(roundText);

    const phaseText = new Text({ text: '', style: mono(16, GOLD, 3) });
    phaseText.anchor.set(0.5, 0);
    phaseText.x = STREAM_WIDTH / 2;
    phaseText.y = STREAM_HEIGHT - 44;
    view.addChild(phaseText);

    const countdown = new Text({ text: '', style: mono(28, IVORY, 2) });
    countdown.anchor.set(0.5, 1);
    countdown.x = STREAM_WIDTH / 2;
    // anchor 錨在底邊而不是頂邊：字級會因為內容變（倒數是兩位數、比分是「4 : 8」），
    // 錨在頂邊時底下那行的間距就會跟著飄
    countdown.y = STREAM_HEIGHT - 50;
    view.addChild(countdown);

    return {
        view,
        update(cue, local, phase, index, total, t): void {
            // LIVE 的紅點呼吸。**這是畫面「活著」最直接的證據**——截圖若停住，
            // 第一個看得出來的就是它
            const pulse = 0.55 + 0.45 * Math.sin(t * Math.PI * 1.4);
            liveDot.clear();
            liveDot.circle(28, 29, 5).fill({ color: 0xe05a5a, alpha: pulse });

            // 時鐘走的是素材時間，不是真實時鐘——素材是循環的，掛真實時鐘會在
            // 接圈的地方跳回去，反而露餡
            const total_s = Math.floor(t);
            const hh = String(Math.floor(total_s / 3600) % 24).padStart(2, '0');
            const mm = String(Math.floor(total_s / 60) % 60).padStart(2, '0');
            const ss = String(total_s % 60).padStart(2, '0');
            clock.text = `${hh}:${mm}:${ss}`;

            roundText.text = `TABLE 01 · ROUND ${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`;

            if (phase === 'betting') {
                phaseText.text = 'PLACE YOUR BETS';
                countdown.text = String(Math.max(0, Math.ceil(cue.lockAt - local)));
            } else if (phase === 'dealing') {
                phaseText.text = 'NO MORE BETS';
                countdown.text = '';
            } else if (phase === 'result') {
                const r = cue.round;
                const who = r.outcome === 'tie' ? 'TIE' : r.outcome === 'player' ? 'PLAYER WINS' : 'BANKER WINS';
                phaseText.text = who;
                countdown.text = `${r.playerTotal} : ${r.bankerTotal}`;
            } else {
                phaseText.text = '';
                countdown.text = '';
            }
        },
    };
}

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 一局多長。給生成腳本算總長用，不必再 import schedule */
export { ROUND_DURATION };
