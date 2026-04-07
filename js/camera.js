// Camera - follows a target, converts between world and screen coordinates

import { clamp } from './utils.js';

export class Camera {
  constructor(viewW, viewH) {
    this.x = 0;
    this.y = 0;
    this.viewW = viewW;
    this.viewH = viewH;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeTimer = 0;
    this.shakeIntensity = 0;
    this.smoothing = 8; // higher = snappier
  }

  resize(viewW, viewH) {
    this.viewW = viewW;
    this.viewH = viewH;
  }

  follow(target, dt) {
    const tx = target.x - this.viewW / 2;
    const ty = target.y - this.viewH / 2;
    const t = 1 - Math.exp(-this.smoothing * dt);
    this.x += (tx - this.x) * t;
    this.y += (ty - this.y) * t;
  }

  clampToWorld(worldW, worldH) {
    this.x = clamp(this.x, 0, Math.max(0, worldW - this.viewW));
    this.y = clamp(this.y, 0, Math.max(0, worldH - this.viewH));
  }

  shake(intensity, duration = 0.2) {
    this.shakeIntensity = intensity;
    this.shakeTimer = duration;
  }

  updateShake(dt) {
    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      this.shakeX = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      this.shakeY = (Math.random() - 0.5) * 2 * this.shakeIntensity;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  // Apply camera transform to the renderer
  apply(renderer) {
    renderer.translate(
      -Math.round(this.x + this.shakeX),
      -Math.round(this.y + this.shakeY)
    );
  }

  // Convert screen coordinates to world coordinates
  screenToWorld(sx, sy) {
    return {
      x: sx + this.x + this.shakeX,
      y: sy + this.y + this.shakeY,
    };
  }

  // Convert world coordinates to screen coordinates
  worldToScreen(wx, wy) {
    return {
      x: wx - this.x - this.shakeX,
      y: wy - this.y - this.shakeY,
    };
  }

  // Check if a world-space rectangle is visible on screen
  isVisible(wx, wy, ww, wh) {
    return (
      wx + ww > this.x &&
      wx < this.x + this.viewW &&
      wy + wh > this.y &&
      wy < this.y + this.viewH
    );
  }
}
