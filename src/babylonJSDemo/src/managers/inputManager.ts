export interface KeyAction {
    onPressed?: () => void;
    onReleased?: () => void;
    onHold?: () => void;
}

export type ActionMap = {
    [key: string]: KeyAction;
};

interface RegisteredAction extends KeyAction {
    id: string;
    sourceId: string;
    key: string;
    isActive: boolean;
}

/**
 * 輸入管理器
 * 使用 ActionMap 註冊/解除鍵盤事件，並集中管理滑鼠拖曳行為
 */
export class InputManager {
    private bindingsByKey: Map<string, Map<string, RegisteredAction>> = new Map();
    private bindingsById: Map<string, RegisteredAction> = new Map();
    private bindingsBySource: Map<string, Set<string>> = new Map();
    private pressedKeys: Set<string> = new Set();

    private pointerTargets: Map<string, { rotateBy?(dx: number, dy: number): void }> = new Map();

    private listenersBound = false;
    private isDragging = false;
    private lastX = 0;
    private lastY = 0;
    private idCounter = 0;

    /**
     * 綁定鍵盤與滑鼠事件，僅需呼叫一次
     */
    public bindEvents() {
        if (this.listenersBound) return;
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        window.addEventListener('mousedown', this.handleMouseDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
        this.listenersBound = true;
    }

    /**
     * 註冊一組按鍵事件
     * @returns dispose 函式，用於解除註冊
     */
    public registerActionMap(sourceId: string, actionMap: ActionMap): () => void {
        const registeredIds: string[] = [];

        Object.entries(actionMap).forEach(([key, action]) => {
            const normalizedKey = this.normalizeKey(key);
            const id = this.createBindingId(sourceId, normalizedKey);
            const record: RegisteredAction = {
                ...action,
                id,
                sourceId,
                key: normalizedKey,
                isActive: false,
            };

            if (!this.bindingsByKey.has(normalizedKey)) {
                this.bindingsByKey.set(normalizedKey, new Map());
            }
            this.bindingsByKey.get(normalizedKey)!.set(id, record);
            this.bindingsById.set(id, record);

            if (!this.bindingsBySource.has(sourceId)) {
                this.bindingsBySource.set(sourceId, new Set());
            }
            this.bindingsBySource.get(sourceId)!.add(id);
            registeredIds.push(id);
        });

        return () => {
            this.unregisterBindings(registeredIds);
        };
    }

    /**
     * 註冊滑鼠拖曳目標（通常為可旋轉的相機）
     */
    public registerPointerTarget(sourceId: string, target: { rotateBy?(dx: number, dy: number): void }): () => void {
        this.pointerTargets.set(sourceId, target);
        return () => {
            this.pointerTargets.delete(sourceId);
        };
    }

    /**
     * 更新：執行所有按住鍵位的 onHold 行為
     */
    public update() {
        this.pressedKeys.forEach((key) => {
            const bindings = this.bindingsByKey.get(key);
            if (!bindings) {
                return;
            }
            bindings.forEach((binding) => {
                if (binding.isActive) {
                    binding.onHold?.();
                }
            });
        });
    }

    /**
     * 判斷指定鍵是否正在按住
     */
    public isKeyPressed(key: string): boolean {
        return this.pressedKeys.has(this.normalizeKey(key));
    }

    private unregisterBindings(ids: string[]) {
        ids.forEach((id) => {
            const binding = this.bindingsById.get(id);
            if (!binding) return;

            const keyMap = this.bindingsByKey.get(binding.key);
            keyMap?.delete(id);
            if (keyMap && keyMap.size === 0) {
                this.bindingsByKey.delete(binding.key);
            }

            const sourceSet = this.bindingsBySource.get(binding.sourceId);
            sourceSet?.delete(id);
            if (sourceSet && sourceSet.size === 0) {
                this.bindingsBySource.delete(binding.sourceId);
            }

            this.bindingsById.delete(id);
        });
    }

    private createBindingId(sourceId: string, key: string) {
        return `${sourceId}:${key}:${this.idCounter++}`;
    }

    private normalizeKey(key: string) {
        return key.toLowerCase();
    }

    private handleKeyDown = (event: KeyboardEvent) => {
        const key = this.normalizeKey(event.key);
        this.pressedKeys.add(key);

        const bindings = this.bindingsByKey.get(key);
        if (!bindings) return;

        bindings.forEach((binding) => {
            if (!binding.isActive) {
                binding.isActive = true;
                binding.onPressed?.();
            }
        });
    };

    private handleKeyUp = (event: KeyboardEvent) => {
        const key = this.normalizeKey(event.key);
        this.pressedKeys.delete(key);

        const bindings = this.bindingsByKey.get(key);
        if (!bindings) return;

        bindings.forEach((binding) => {
            if (binding.isActive) {
                binding.isActive = false;
                binding.onReleased?.();
            }
        });
    };

    private handleMouseDown = (event: MouseEvent) => {
        this.isDragging = true;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
    };

    private handleMouseMove = (event: MouseEvent) => {
        if (!this.isDragging) return;
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.pointerTargets.forEach((target) => {
            target.rotateBy?.(dx, dy);
        });
        this.lastX = event.clientX;
        this.lastY = event.clientY;
    };

    private handleMouseUp = () => {
        this.isDragging = false;
    };
}
