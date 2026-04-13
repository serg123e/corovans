// Input - keyboard, mouse, and touch state tracking

// Thresholds for distinguishing a "tap" (attack) from a "drag" (move).
const TAP_MAX_DURATION_MS = 220;
const TAP_MAX_MOVE_PX = 20;
// Dead zone around the player when computing touch-based movement direction.
const TOUCH_MOVE_DEADZONE_PX = 18;

export class Input {
  constructor(canvas) {
    this.keys = {};
    this.keysPressed = {};  // true only on the frame the key was first pressed
    this.mouse = { x: 0, y: 0, down: false, rightDown: false, clicked: false };
    this.touch = { active: false, x: 0, y: 0 };
    this._canvas = canvas;

    // Player screen position, updated each frame by the game so getMovement()
    // can resolve touch direction without coupling input to player/camera.
    this._playerScreenX = 0;
    this._playerScreenY = 0;

    // Tracks the single active touch (multi-touch is ignored).
    this._touchId = null;
    this._touchStartX = 0;
    this._touchStartY = 0;
    this._touchStartTime = 0;

    this._onKeyDown = (e) => {
      if (!this.keys[e.code]) {
        this.keysPressed[e.code] = true;
      }
      this.keys[e.code] = true;
      // Debug: log telemetry/export hotkeys so we can confirm the event
      // actually reaches the window listener (e.g. rule out focus issues).
      if (e.code === 'KeyL' || e.code === 'KeyU') {
        console.log(`[input] keydown ${e.code} shift=${e.shiftKey} target=${e.target && e.target.tagName}`);
      }
      // Prevent default for game keys
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };

    this._onKeyUp = (e) => {
      this.keys[e.code] = false;
    };

    this._onMouseMove = (e) => {
      const pt = this._toCanvas(e.clientX, e.clientY);
      this.mouse.x = pt.x;
      this.mouse.y = pt.y;
    };

    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        this.mouse.clicked = true;
      } else if (e.button === 2) {
        this.mouse.rightDown = true;
        // Right-click is hold-to-move only; swallow the browser menu.
        e.preventDefault();
      }
    };

    this._onMouseUp = (e) => {
      if (e.button === 0) {
        this.mouse.down = false;
      } else if (e.button === 2) {
        this.mouse.rightDown = false;
      }
    };

    this._onContextMenu = (e) => {
      // Block the native context menu so RMB can be used for movement.
      e.preventDefault();
    };

    this._onTouchStart = (e) => {
      if (this._touchId !== null) {
        e.preventDefault();
        return;
      }
      const t = e.changedTouches[0];
      if (!t) return;
      const pt = this._toCanvas(t.clientX, t.clientY);
      this._touchId = t.identifier;
      this.touch.active = true;
      this.touch.x = pt.x;
      this.touch.y = pt.y;
      this._touchStartX = pt.x;
      this._touchStartY = pt.y;
      this._touchStartTime = performance.now();
      // Keep mouse position in sync so UI hover/hit-tests work.
      this.mouse.x = pt.x;
      this.mouse.y = pt.y;
      e.preventDefault();
    };

    this._onTouchMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._touchId) continue;
        const pt = this._toCanvas(t.clientX, t.clientY);
        this.touch.x = pt.x;
        this.touch.y = pt.y;
        this.mouse.x = pt.x;
        this.mouse.y = pt.y;
        e.preventDefault();
        break;
      }
    };

    this._onTouchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._touchId) continue;
        const duration = performance.now() - this._touchStartTime;
        const dx = this.touch.x - this._touchStartX;
        const dy = this.touch.y - this._touchStartY;
        const moved = Math.sqrt(dx * dx + dy * dy);
        // Short, near-stationary release = tap: route through mouse.clicked so
        // existing attack / UI click code paths fire without special cases.
        if (duration < TAP_MAX_DURATION_MS && moved < TAP_MAX_MOVE_PX) {
          this.mouse.clicked = true;
        }
        this.touch.active = false;
        this._touchId = null;
        e.preventDefault();
        break;
      }
    };

    this._onTouchCancel = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._touchId) continue;
        this.touch.active = false;
        this._touchId = null;
        break;
      }
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseup', this._onMouseUp);
    canvas.addEventListener('contextmenu', this._onContextMenu);
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this._onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this._onTouchCancel, { passive: false });
  }

  _toCanvas(clientX, clientY) {
    const canvas = this._canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  // Call at end of each frame to reset per-frame state
  endFrame() {
    this.keysPressed = {};
    this.mouse.clicked = false;
  }

  isDown(code) {
    return !!this.keys[code];
  }

  wasPressed(code) {
    return !!this.keysPressed[code];
  }

  // Game sets this each frame so getMovement() can resolve touch direction.
  setPlayerScreen(x, y) {
    this._playerScreenX = x;
    this._playerScreenY = y;
  }

  // Movement vector from WASD / arrow keys, normalized.
  // Falls back to touch: direction from player screen position to held touch.
  getMovement() {
    let x = 0, y = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    const len = Math.sqrt(x * x + y * y);
    if (len > 0) {
      return { x: x / len, y: y / len };
    }
    if (this.touch.active) {
      const dx = this.touch.x - this._playerScreenX;
      const dy = this.touch.y - this._playerScreenY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > TOUCH_MOVE_DEADZONE_PX) {
        return { x: dx / d, y: dy / d };
      }
    }
    // Held left mouse button = walk toward cursor, same semantics as
    // holding a touch. Right mouse is reserved for aimed attacks.
    if (this.mouse.down) {
      const dx = this.mouse.x - this._playerScreenX;
      const dy = this.mouse.y - this._playerScreenY;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > TOUCH_MOVE_DEADZONE_PX) {
        return { x: dx / d, y: dy / d };
      }
    }
    return { x: 0, y: 0 };
  }

  wantsAttack() {
    // Space held = auto-repeat attacks (auto-aims at nearest enemy).
    // Right mouse held = aimed attacks toward cursor.
    // Touch tap = single attack (routed through mouse.clicked).
    return this.isDown('Space') || this.mouse.rightDown || this.mouse.clicked;
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this._canvas.removeEventListener('mousemove', this._onMouseMove);
    this._canvas.removeEventListener('mousedown', this._onMouseDown);
    this._canvas.removeEventListener('mouseup', this._onMouseUp);
    this._canvas.removeEventListener('contextmenu', this._onContextMenu);
    this._canvas.removeEventListener('touchstart', this._onTouchStart);
    this._canvas.removeEventListener('touchmove', this._onTouchMove);
    this._canvas.removeEventListener('touchend', this._onTouchEnd);
    this._canvas.removeEventListener('touchcancel', this._onTouchCancel);
  }
}
