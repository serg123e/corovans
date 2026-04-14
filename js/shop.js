// Shop - persistent in-world building the player can approach to buy cards.
// Rendering is procedural (no sprite assets) to match the rest of the game.

import { Vec2 } from './utils.js';
import { t } from './i18n.js';

const SHOP_INTERACT_RANGE = 56;

export class Shop {
  constructor(x, y) {
    this.pos = new Vec2(x, y);
    this.interactRange = SHOP_INTERACT_RANGE;
    this.radius = 24; // for rough collision / spacing against entities
  }

  isPlayerNear(playerPos) {
    return this.pos.distSq(playerPos) < this.interactRange * this.interactRange;
  }

  render(renderer) {
    const x = this.pos.x;
    const y = this.pos.y;

    // Stone foundation (darker strip under the hut).
    renderer.rect(x - 26, y + 14, 52, 4, '#4a3a2a');

    // Hut body — brown wood.
    renderer.rect(x - 24, y - 10, 48, 24, '#8b6914');
    renderer.rect(x - 24, y + 6, 48, 8, '#6b4914');

    // Vertical plank seams to suggest wood texture.
    for (let i = -20; i <= 20; i += 8) {
      renderer.rect(x + i, y - 10, 1, 24, '#5a3a0a');
    }

    // Roof — stacked rects from wide to narrow for a peaked look.
    renderer.rect(x - 28, y - 14, 56, 4, '#5a2e1a');
    renderer.rect(x - 22, y - 18, 44, 4, '#6a3a22');
    renderer.rect(x - 14, y - 22, 28, 4, '#7a4a2a');
    renderer.rect(x - 6, y - 26, 12, 4, '#8a5a3a');

    // Door
    renderer.rect(x - 4, y - 2, 8, 16, '#2a1a0a');
    renderer.rect(x - 5, y - 3, 10, 2, '#3a2a1a');
    renderer.rect(x + 2, y + 6, 1, 2, '#ffd700'); // doorknob

    // Window with light
    renderer.rect(x - 18, y - 6, 6, 6, '#ffcc55');
    renderer.rect(x - 17, y - 5, 2, 2, '#ffe699');
    renderer.rect(x + 12, y - 6, 6, 6, '#ffcc55');
    renderer.rect(x + 13, y - 5, 2, 2, '#ffe699');

    // Sign post with a gold coin above the roof peak.
    renderer.rect(x - 1, y - 34, 2, 8, '#3a2a1a');
    renderer.circle(x, y - 38, 5, '#ffd700');
    renderer.circle(x - 1, y - 39, 3, '#ffee66');
    renderer.circle(x, y - 38, 1, '#c9a100');
  }

  // Draw a floating "press E" prompt above the shop when the player is near.
  // Rendered in world-space so it follows the shop with the camera.
  renderInteractPrompt(renderer) {
    const now = performance.now() / 1000;
    const pulse = 0.65 + 0.35 * Math.sin(now * 5);
    const py = this.pos.y - 52;
    renderer.setAlpha(pulse);
    renderer.textOutlined(t('shop.interact'), this.pos.x, py, '#ffd700', '#000', 13, 'center', 'middle');
    renderer.resetAlpha();
  }
}
