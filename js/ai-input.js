// AIInput - Input-compatible adapter for AI-controlled gameplay.
//
// Implements the same interface as Input (getMovement, wantsAttack,
// wasPressed, etc.) but movement/attack/dash come from an AIController
// instead of keyboard/mouse hardware.
//
// A small set of real keyboard keys (M, Escape, P, L, U) are forwarded
// so the human spectator can still mute audio, pause, and export logs.

const FORWARD_KEYS = new Set(['KeyM', 'Escape', 'KeyP', 'KeyL', 'KeyU']);

export class AIInput {
  constructor() {
    this._move = { x: 0, y: 0 };
    this._aiPressed = {};
    this._userPressed = {};
    this.keys = {};
    this.mouse = { x: 0, y: 0, down: false, rightDown: false, clicked: false };
    this.touch = { active: false, x: 0, y: 0 };

    this._onKeyDown = (e) => {
      if (FORWARD_KEYS.has(e.code)) {
        this._userPressed[e.code] = true;
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  // --- Called by AIController at the start of each tick ---

  beginTick() {
    this._aiPressed = {};
    this._move.x = 0;
    this._move.y = 0;
    this.mouse.clicked = false;
  }

  // --- Written by AIController ---

  setMove(x, y) {
    const len = Math.sqrt(x * x + y * y);
    if (len > 0.0001) {
      this._move.x = x / len;
      this._move.y = y / len;
    } else {
      this._move.x = 0;
      this._move.y = 0;
    }
  }

  press(code) {
    this._aiPressed[code] = true;
  }

  click(x, y) {
    this.mouse.clicked = true;
    this.mouse.x = x;
    this.mouse.y = y;
  }

  // --- Read by Game (Input interface) ---

  getMovement() {
    return this._move;
  }

  wantsAttack() {
    return !!this._aiPressed['Space'];
  }

  wasPressed(code) {
    return !!this._aiPressed[code] || !!this._userPressed[code];
  }

  isDown(code) {
    return !!this.keys[code];
  }

  setPlayerScreen() { }

  endFrame() {
    this._aiPressed = {};
    this._userPressed = {};
    this.keys = {};
    this.mouse.clicked = false;
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
  }
}
