import gsap from 'gsap';
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { GameModule, ModuleContext, ModuleId } from '../core/module';
import { onLangChange, t } from '../../i18n';
import type { GameId } from '../net/protocol';

/**
 * 大廳。
 *
 * 它**也走 GameModule 契約**——不是因為大廳需要那些資源管理，而是因為這樣
 * 「大廳 → 玩法 → 回大廳」的每一步都真的會走一次卸載與核對。大廳如果只是
 * canvas 外的一層選單，舞台就永遠不會回到空的狀態，而「回到空舞台時 texture
 * 有沒有回到基線」正是這一頁最想給人看的那個對照（見 core/module.ts）。
 *
 * 視覺是 Pixi 畫的，操作列在 DOM。這條分界貫穿整頁：**要動、要 GPU、跟遊戲節奏
 * 同步的歸 canvas；要能被鍵盤按到、要能翻譯、不必每幀重畫的歸 DOM。**
 * 機台卡片會發光、會隨滑鼠浮起，所以在 canvas；返回鍵與資源核對數字在 DOM。
 */

interface Machine {
    id: GameId;
    /** 卡片主色。沿用各玩法自己的識別色，進去之後才不會有色彩落差 */
    color: number;
    titleKey: string;
    descKey: string;
}

const MACHINES: Machine[] = [
    { id: 'slot', color: 0xf72585, titleKey: 'arcade.lobby.slot', descKey: 'arcade.lobby.slotDesc' },
    { id: 'baccarat', color: 0x4cc9f0, titleKey: 'arcade.lobby.baccarat', descKey: 'arcade.lobby.baccaratDesc' },
];

export class LobbyModule implements GameModule {
    public readonly id: ModuleId = 'lobby';

    private readonly onPick: (id: GameId) => void;
    private cards: MachineCard[] = [];
    private title: Text | null = null;
    private dead = false;

    constructor(onPick: (id: GameId) => void) {
        this.onPick = onPick;
    }

    public mount(ctx: ModuleContext): void {
        this.title = new Text({
            text: t('arcade.lobby.title'),
            style: new TextStyle({
                fontFamily: 'Archivo, ui-sans-serif, sans-serif',
                fontSize: 34,
                fontWeight: '900',
                fill: 0xffffff,
                letterSpacing: 6,
            }),
        });
        this.title.anchor.set(0.5);
        ctx.root.addChild(this.title);

        for (const machine of MACHINES) {
            const card = new MachineCard(machine, () => this.onPick(machine.id));
            this.cards.push(card);
            ctx.root.addChild(card);
        }

        // i18n 沒有取消訂閱（見 i18n/useT.ts），所以要自己擋——大廳卸載後切語言，
        // 這個 callback 還會醒過來對著已經 destroy 的 Text 動手
        onLangChange(() => {
            if (this.dead) return;
            this.refreshText();
        });
        ctx.onDispose(() => {
            this.dead = true;
            for (const card of this.cards) card.stop();
        });

        ctx.onResize((w, h) => this.layout(w, h));
        this.layout(ctx.screen.width, ctx.screen.height);
    }

    private refreshText(): void {
        if (this.title) this.title.text = t('arcade.lobby.title');
        for (const card of this.cards) card.refreshText();
    }

    private layout(w: number, h: number): void {
        // 窄畫面改直排。門檻抓在兩張卡片並排會低於 240 寬的地方——再窄下去
        // 卡片上的說明就會擠成兩三個字一行
        const stacked = w < 620;

        const cardW = stacked ? Math.min(w - 48, 340) : Math.min((w - 96) / MACHINES.length, 300);
        const cardH = stacked ? 132 : 190;
        const gap = 20;

        const totalW = stacked ? cardW : cardW * MACHINES.length + gap * (MACHINES.length - 1);
        const totalH = stacked ? cardH * MACHINES.length + gap * (MACHINES.length - 1) : cardH;

        const startX = (w - totalW) / 2;
        const startY = (h - totalH) / 2 + 10;

        if (this.title) this.title.position.set(w / 2, startY - 52);

        // 卡片的原點在自己的中心（見 MachineCard.redraw），所以這裡給的是中心點
        for (let i = 0; i < this.cards.length; i++) {
            const card = this.cards[i];
            card.setCardSize(cardW, cardH, stacked);
            if (stacked) card.position.set(startX + cardW / 2, startY + i * (cardH + gap) + cardH / 2);
            else card.position.set(startX + i * (cardW + gap) + cardW / 2, startY + cardH / 2);
        }
    }
}

/**
 * 一張機台卡片。
 *
 * 圖示是**程序化畫的**，跟符號與牌面同一個決定：這一頁不載任何圖檔。
 * 老虎機畫三格轉軸，百家樂畫兩張斜放的牌——這種抽象到只剩輪廓的圖示比寫實的
 * 好用，小尺寸下不會糊成一團。
 */
class MachineCard extends Container {
    private readonly machine: Machine;
    private readonly bg = new Graphics();
    private readonly icon = new Graphics();
    private readonly title: Text;
    private readonly desc: Text;

    private w = 260;
    private h = 190;
    private stacked = false;
    private hover = false;
    private tween: gsap.core.Tween | null = null;

    constructor(machine: Machine, onPick: () => void) {
        super();
        this.machine = machine;

        this.addChild(this.bg);
        this.addChild(this.icon);

        this.title = label(t(machine.titleKey), 21, 0xffffff, '800');
        this.desc = label(t(machine.descKey), 12, 0xffffff, '500');
        this.desc.alpha = 0.62;
        this.addChild(this.title);
        this.addChild(this.desc);

        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointertap', onPick);
        this.on('pointerover', () => this.setHover(true));
        this.on('pointerout', () => this.setHover(false));

        this.redraw();
    }

    public refreshText(): void {
        this.title.text = t(this.machine.titleKey);
        this.desc.text = t(this.machine.descKey);
    }

    public setCardSize(w: number, h: number, stacked: boolean): void {
        this.w = w;
        this.h = h;
        this.stacked = stacked;
        this.redraw();
    }

    public stop(): void {
        this.tween?.kill();
        this.tween = null;
    }

    private setHover(on: boolean): void {
        if (this.hover === on) return;
        this.hover = on;
        this.redraw();

        this.tween?.kill();
        // 只放大 2%：卡片本來就大，再多就會擠到旁邊那張
        this.tween = gsap.to(this.scale, { x: on ? 1.02 : 1, y: on ? 1.02 : 1, duration: 0.2, ease: 'power2.out' });
    }

    private redraw(): void {
        const { w, h } = this;
        const c = this.machine.color;
        const g = this.bg;

        // 所有東西都畫在**以卡片中心為原點**的座標裡，所以 hover 放大自然是從中間脹開，
        // 不必動 pivot。代價是外面設 position 時給的是中心點而不是左上角（見 layout）
        g.clear();
        g.roundRect(-w / 2, -h / 2, w, h, 16).fill({ color: 0x1a0f2b, alpha: 0.92 });
        g.roundRect(-w / 2, -h / 2, w, h, 16).stroke({ color: c, width: this.hover ? 2.5 : 1.5, alpha: this.hover ? 1 : 0.5 });
        // 底部的一條光：讓卡片看起來是站在檯面上的，也把主色帶進來
        g.roundRect(-w / 2 + 18, h / 2 - 3, w - 36, 3, 2).fill({ color: c, alpha: this.hover ? 0.9 : 0.45 });

        // 明確給命中範圍，不要讓 Pixi 去推 bounds。
        // 推 bounds 對「一個 Container 包著幾個 Graphics 與 Text」這種結構是碰運氣的：
        // 命中與否取決於子物件各自的 eventMode 與幾何，hover 會動但點擊不一定會觸發。
        // 下注區（common/chips/BetSpotView）也是同樣的處理
        this.hitArea = {
            contains: (x: number, y: number) => x >= -w / 2 && x <= w / 2 && y >= -h / 2 && y <= h / 2,
        };

        this.drawIcon(c);

        if (this.stacked) {
            // 直排時圖示放左邊，文字靠右，卡片才不會太高
            this.title.anchor.set(0, 0.5);
            this.desc.anchor.set(0, 0.5);
            this.title.position.set(-w / 2 + 108, -8);
            this.desc.position.set(-w / 2 + 108, 16);
        } else {
            this.title.anchor.set(0.5, 0.5);
            this.desc.anchor.set(0.5, 0.5);
            this.title.position.set(0, h / 2 - 52);
            this.desc.position.set(0, h / 2 - 28);
        }
    }

    private drawIcon(color: number): void {
        const g = this.icon;
        g.clear();
        // 百家樂的牌是各自的子物件（要各自旋轉），重畫前得收掉，
        // 否則每次 resize 都會多疊一組上去
        g.removeChildren().forEach((child) => child.destroy());

        const cx = this.stacked ? -this.w / 2 + 54 : 0;
        const cy = this.stacked ? 0 : -this.h / 2 + 62;

        if (this.machine.id === 'slot') {
            // 三格轉軸，中間那格亮著——一眼就是老虎機
            const cw = 20;
            const ch = 30;
            const gap = 6;
            for (let i = -1; i <= 1; i++) {
                const x = cx + i * (cw + gap) - cw / 2;
                g.roundRect(x, cy - ch / 2, cw, ch, 5).fill({ color: 0x0d0716, alpha: 0.9 });
                g.roundRect(x, cy - ch / 2, cw, ch, 5).stroke({ color, width: 1.4, alpha: 0.7 });
            }
            g.roundRect(cx - cw / 2 + 4, cy - 5, cw - 8, 10, 3).fill(color);
        } else {
            // 兩張斜放的牌。角度相反才看得出是兩張疊著，不是一張變形
            const cardW = 26;
            const cardH = 36;
            for (const [dx, angle] of [
                [-9, -0.18],
                [9, 0.16],
            ] as Array<[number, number]>) {
                const card = new Graphics();
                card.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 4).fill(0xf4efe6);
                card.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 4).stroke({ color, width: 1.2, alpha: 0.8 });
                card.position.set(cx + dx, cy);
                card.rotation = angle;
                // 直接畫進同一個 Graphics 會共用變換，所以牌各自是一個物件，
                // 畫完併進 icon 底下由它統一管理生命週期
                this.icon.addChild(card);
            }
            g.circle(cx, cy, 5).fill({ color, alpha: 0.9 });
        }
    }
}

function label(content: string, size: number, fill: number, weight: '500' | '800'): Text {
    const text = new Text({
        text: content,
        style: new TextStyle({
            fontFamily: 'Archivo, ui-sans-serif, sans-serif',
            fontSize: size,
            fontWeight: weight,
            fill,
        }),
    });
    text.anchor.set(0.5);
    return text;
}
