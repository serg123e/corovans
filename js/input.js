// Input - keyboard and mouse state tracking

export class Input {
  constructor(canvas) {
    this.keys = {};
    this.keysPressed = {};  // true only on the frame the key was first pressed
    this.mouse = { x: 0, y: 0, down: false, clicked: false };
    this._canvas = canvas;

    this._onKeyDown = (e) => {
      if (!this.keys[e.code]) {
        this.keysPressed[e.code] = true;
      }
      this.keys[e.code] = true;
      // Prevent default for game keys
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    };

    this._onKeyUp = (e) => {
      this.keys[e.code] = false;
    };

    this._onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      this.mouse.x = (e.clientX - rect.left) * scaleX;
      this.mouse.y = (e.clientY - rect.top) * scaleY;
    };

    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        this.mouse.clicked = true;
      }
    };

    this._onMouseUp = (e) => {
      if (e.button === 0) {
        this.mouse.down = false;
      }
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    canvas.addEventListener('mouseup', this._onMouseUp);
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

  // Movement vector from WASD / arrow keys, normalized
  getMovement() {
    let x = 0, y = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    const len = Math.sqrt(x * x + y * y);
    if (len > 0) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  wantsAttack() {
    return this.wasPressed('Space') || this.mouse.clicked;
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this._canvas.removeEventListener('mousemove', this._onMouseMove);
    this._canvas.removeEventListener('mousedown', this._onMouseDown);
    this._canvas.removeEventListener('mouseup', this._onMouseUp);
  }
}
