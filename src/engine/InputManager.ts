export interface InputSnapshot {
  moveForward: number;
  moveRight: number;
  jumpPressed: boolean;
  dashPressed: boolean;
  fireHeld: boolean;
  firePressed: boolean;
  reloadPressed: boolean;
  sandevistanPressed: boolean;
  meleePressed: boolean;
  interactPressed: boolean;
  healPressed: boolean;
  choiceKey: '1' | '2' | null;
  mouseDeltaX: number;
  mouseDeltaY: number;
}

export class InputManager {
  private keys = new Set<string>();
  private justPressed = new Set<string>();
  private mouseDown = false;
  private mouseJustPressed = false;
  private accumMouseX = 0;
  private accumMouseY = 0;
  private locked = false;
  private sensitivity = 0.0021;
  private targetEl: HTMLElement;
  private onLockChange?: (locked: boolean) => void;
  private onEscapePressed?: () => void;
  private onViewportClick?: () => void;
  private lastUnlockTime = -1000;

  constructor(
    targetEl: HTMLElement,
    callbacks?: {
      onLockChange?: (locked: boolean) => void;
      onEscapePressed?: () => void;
      onViewportClick?: () => void;
    },
  ) {
    this.targetEl = targetEl;
    this.onLockChange = callbacks?.onLockChange;
    this.onEscapePressed = callbacks?.onEscapePressed;
    this.onViewportClick = callbacks?.onViewportClick;
    this.bindEvents();
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
    this.targetEl.addEventListener('click', this.handleViewportClick);
  }

  private handleViewportClick = (): void => {
    if (!this.locked) {
      this.onViewportClick?.();
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape') {
      // Ignore Escape keydown if pointer lock is active or was just released by Escape itself
      if (!this.locked && performance.now() - this.lastUnlockTime > 150) {
        this.onEscapePressed?.();
      }
      return;
    }
    if (!this.keys.has(e.code)) {
      this.justPressed.add(e.code);
    }
    this.keys.add(e.code);

    // Prevent browser scrolling on Space during gameplay
    if (this.locked && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    // Clamp extreme jumps that can happen right on pointer lock engagement
    const dx = Math.max(-180, Math.min(180, e.movementX));
    const dy = Math.max(-180, Math.min(180, e.movementY));
    this.accumMouseX += dx * this.sensitivity;
    this.accumMouseY += dy * this.sensitivity;
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    if (!this.locked) return;
    this.mouseDown = true;
    this.mouseJustPressed = true;
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.mouseDown = false;
    }
  };

  private handleBlur = (): void => {
    this.keys.clear();
    this.justPressed.clear();
    this.mouseDown = false;
    this.mouseJustPressed = false;
    this.accumMouseX = 0;
    this.accumMouseY = 0;
  };

  private handlePointerLockChange = (): void => {
    const wasLocked = this.locked;
    this.locked = document.pointerLockElement === this.targetEl;
    if (!this.locked) {
      if (wasLocked) {
        this.lastUnlockTime = performance.now();
      }
      this.keys.clear();
      this.justPressed.clear();
      this.mouseDown = false;
      this.mouseJustPressed = false;
      this.accumMouseX = 0;
      this.accumMouseY = 0;
    }
    this.onLockChange?.(this.locked);
  };

  requestPointerLock(): void {
    try {
      if (document.pointerLockElement !== this.targetEl) {
        const res = this.targetEl.requestPointerLock() as unknown as Promise<void> | undefined;
        if (res && typeof res.catch === 'function') {
          res.catch(() => {
            // Browser may reject if not triggered by direct gesture; safe to ignore.
          });
        }
      }
    } catch {
      // Ignore in non-supporting environments.
    }
  }

  exitPointerLock(): void {
    try {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    } catch {
      // Ignore
    }
  }

  isPointerLocked(): boolean {
    return this.locked;
  }

  setSensitivity(multiplier: number): void {
    this.sensitivity = 0.0021 * Math.max(0.25, Math.min(3.0, multiplier));
  }

  consumeSnapshot(): InputSnapshot {
    const moveForward =
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) -
      (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
    const moveRight =
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) -
      (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);

    let choiceKey: '1' | '2' | null = null;
    if (this.justPressed.has('Digit1') || this.justPressed.has('Numpad1')) choiceKey = '1';
    else if (this.justPressed.has('Digit2') || this.justPressed.has('Numpad2')) choiceKey = '2';

    const snapshot: InputSnapshot = {
      moveForward,
      moveRight,
      jumpPressed: this.justPressed.has('Space'),
      dashPressed: this.justPressed.has('ShiftLeft') || this.justPressed.has('ShiftRight'),
      fireHeld: this.mouseDown,
      firePressed: this.mouseJustPressed,
      reloadPressed: this.justPressed.has('KeyR'),
      sandevistanPressed: this.justPressed.has('KeyQ'),
      meleePressed: this.justPressed.has('KeyF') || this.justPressed.has('KeyV'),
      interactPressed: this.justPressed.has('KeyE'),
      healPressed: this.justPressed.has('KeyX') || this.justPressed.has('KeyH'),
      choiceKey,
      mouseDeltaX: this.accumMouseX,
      mouseDeltaY: this.accumMouseY,
    };

    this.justPressed.clear();
    this.mouseJustPressed = false;
    this.accumMouseX = 0;
    this.accumMouseY = 0;

    return snapshot;
  }

  clearTransient(): void {
    this.justPressed.clear();
    this.mouseJustPressed = false;
    this.accumMouseX = 0;
    this.accumMouseY = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    this.targetEl.removeEventListener('click', this.handleViewportClick);
  }
}
