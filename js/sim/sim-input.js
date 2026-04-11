// SimInput - minimal Input stand-in for the headless simulator.
//
// Player.update() only reads `getMovement()`, so that's all we expose.
// wasPressed / mouse / touch are left empty because the simulator drives
// attacks and dashes by calling Player methods directly.

export class SimInput {
  constructor() {
    this._move = { x: 0, y: 0 };
    // Mirror the minimal Input API used elsewhere so stray checks are safe.
    this.keys = {};
    this.mouse = { x: 0, y: 0, down: false, rightDown: false, clicked: false };
    this.touch = { active: false, x: 0, y: 0 };
  }

  setMove(x, y) {
    // Normalize so entities see a unit vector like the real Input produces.
    const len = Math.sqrt(x * x + y * y);
    if (len > 0.0001) {
      this._move.x = x / len;
      this._move.y = y / len;
    } else {
      this._move.x = 0;
      this._move.y = 0;
    }
  }

  getMovement() {
    return this._move;
  }

  wasPressed() {
    return false;
  }

  wantsAttack() {
    return false;
  }

  isDown() {
    return false;
  }

  setPlayerScreen() { /* no-op */ }
  endFrame() { /* no-op */ }
}
