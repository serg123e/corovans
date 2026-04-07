// UI - HUD, menus, and shop
// Manages all user interface screens: main menu, in-game HUD, shop, game over

import { CONST, pointInRect } from './utils.js';

// Upgrade definitions
const UPGRADES = [
  {
    id: 'damage',
    label: 'Урон',
    desc: '+5 к урону',
    stat: 'damage',
    amount: 5,
    baseCost: 30,
    costScale: 1.5,
    icon: '⚔',
  },
  {
    id: 'maxHp',
    label: 'Здоровье',
    desc: '+25 макс. HP',
    stat: 'maxHp',
    amount: 25,
    baseCost: 25,
    costScale: 1.4,
    icon: '❤',
  },
  {
    id: 'speed',
    label: 'Скорость',
    desc: '+20 к скорости',
    stat: 'speed',
    amount: 20,
    baseCost: 20,
    costScale: 1.3,
    icon: '👢',
  },
  {
    id: 'attackRange',
    label: 'Радиус атаки',
    desc: '+4 к радиусу',
    stat: 'attackRange',
    amount: 4,
    baseCost: 35,
    costScale: 1.6,
    icon: '🗡',
  },
];

export class UI {
  constructor() {
    // Track how many times each upgrade has been purchased
    this.upgradeCounts = {};
    for (const upg of UPGRADES) {
      this.upgradeCounts[upg.id] = 0;
    }

    // Button rects for shop items (computed during render, used for click detection)
    this._shopButtons = [];
    // "Next wave" button rect
    this._nextWaveButton = null;
  }

  reset() {
    for (const upg of UPGRADES) {
      this.upgradeCounts[upg.id] = 0;
    }
    this._shopButtons = [];
    this._nextWaveButton = null;
  }

  // Get the current cost of an upgrade
  getUpgradeCost(upgrade) {
    const count = this.upgradeCounts[upgrade.id];
    return Math.floor(upgrade.baseCost * Math.pow(upgrade.costScale, count));
  }

  // Try to purchase an upgrade. Returns true if successful.
  tryPurchase(upgradeIndex, player) {
    if (upgradeIndex < 0 || upgradeIndex >= UPGRADES.length) return false;
    const upgrade = UPGRADES[upgradeIndex];
    const cost = this.getUpgradeCost(upgrade);
    if (player.gold < cost) return false;

    player.gold -= cost;
    player[upgrade.stat] += upgrade.amount;
    this.upgradeCounts[upgrade.id]++;

    // If we upgraded maxHp, also heal the same amount
    if (upgrade.stat === 'maxHp') {
      player.hp += upgrade.amount;
    }

    return true;
  }

  // Check if a shop button was clicked, return upgrade index or -1
  handleShopClick(mouseX, mouseY) {
    for (let i = 0; i < this._shopButtons.length; i++) {
      const btn = this._shopButtons[i];
      if (pointInRect(mouseX, mouseY, btn.x, btn.y, btn.w, btn.h)) {
        return i;
      }
    }
    return -1;
  }

  // Check if "next wave" button was clicked
  isNextWaveClicked(mouseX, mouseY) {
    if (!this._nextWaveButton) return false;
    const btn = this._nextWaveButton;
    return pointInRect(mouseX, mouseY, btn.x, btn.y, btn.w, btn.h);
  }

  // --- Render methods ---

  renderMenu(r) {
    const cx = r.width / 2;
    const cy = r.height / 2;

    // Overlay
    r.setAlpha(0.7);
    r.rect(0, 0, r.width, r.height, '#1a1a2e');
    r.resetAlpha();

    // Title
    r.textOutlined('КОРОВАНЫ', cx, cy - 100, '#ffd700', '#000', 64, 'center', 'middle');

    // Subtitle
    r.textOutlined('грабь корованы!', cx, cy - 30, '#e8c872', '#000', 24, 'center', 'middle');

    // Instructions
    r.textOutlined('WASD / стрелки - движение', cx, cy + 40, '#ccc', '#000', 16, 'center', 'middle');
    r.textOutlined('Пробел / клик - атака', cx, cy + 65, '#ccc', '#000', 16, 'center', 'middle');

    // Start prompt
    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      r.textOutlined('[ Нажми чтобы начать ]', cx, cy + 130, '#fff', '#000', 20, 'center', 'middle');
    }
  }

  renderHUD(r, game) {
    const player = game.player;
    r.rect(0, 0, r.width, CONST.HUD_HEIGHT, 'rgba(0,0,0,0.5)');
    const isBossWave = game.wave > 0 && game.wave % 5 === 0;
    const waveColor = isBossWave ? '#ff4444' : '#fff';
    const waveText = isBossWave ? `Волна: ${game.wave} [БОСС]` : `Волна: ${game.wave}`;
    r.text(waveText, 10, 10, waveColor, 16);
    r.text(`Счёт: ${game.score}`, 180, 10, CONST.COLOR_GOLD, 16);
    if (player) {
      // HP bar in HUD
      r.healthBar(310, 12, 100, 14, player.hp / player.maxHp, CONST.COLOR_HP_BAR, CONST.COLOR_HP_BG);
      r.text(`${player.hp}/${player.maxHp}`, 420, 10, '#fff', 14);
      // Gold
      r.text(`\u2B50 ${player.gold}`, 500, 10, CONST.COLOR_GOLD, 16);
    }
    // Enemy/caravan count
    const aliveCaravans = game.caravans.filter(c => c.alive).length;
    const aliveGuards = game.guards.filter(g => g.alive).length;
    r.text(`Корованы: ${aliveCaravans}  Охрана: ${aliveGuards}`, 600, 10, '#ddd', 14);
  }

  renderShop(r, player) {
    const cx = r.width / 2;

    r.rect(0, 0, r.width, r.height, '#1a1a2e');

    // Title
    r.textOutlined('МАГАЗИН', cx, 50, '#ffd700', '#000', 40, 'center', 'middle');

    // Gold display
    r.textOutlined(`Золото: ${player ? player.gold : 0}`, cx, 100, CONST.COLOR_GOLD, '#000', 22, 'center', 'middle');

    // Upgrade buttons
    this._shopButtons = [];
    const btnW = 260;
    const btnH = 60;
    const startY = 150;
    const gap = 15;

    for (let i = 0; i < UPGRADES.length; i++) {
      const upg = UPGRADES[i];
      const cost = this.getUpgradeCost(upg);
      const canAfford = player && player.gold >= cost;
      const bx = cx - btnW / 2;
      const by = startY + i * (btnH + gap);

      this._shopButtons.push({ x: bx, y: by, w: btnW, h: btnH });

      // Button background
      const bgColor = canAfford ? '#2a4a2a' : '#3a2a2a';
      r.rect(bx, by, btnW, btnH, bgColor);
      r.strokeRect(bx, by, btnW, btnH, canAfford ? '#4a8a4a' : '#5a3a3a', 2);

      // Icon and label
      const textColor = canAfford ? '#fff' : '#666';
      r.text(`${upg.icon} ${upg.label}`, bx + 10, by + 8, textColor, 18);

      // Description
      r.text(upg.desc, bx + 10, by + 34, canAfford ? '#aaa' : '#555', 13);

      // Cost
      const costText = `${cost}`;
      r.text(costText, bx + btnW - 10, by + 18, canAfford ? CONST.COLOR_GOLD : '#664400', 18, 'right');

      // Current level
      const lvl = this.upgradeCounts[upg.id];
      if (lvl > 0) {
        r.text(`x${lvl}`, bx + btnW - 10, by + 40, '#888', 12, 'right');
      }
    }

    // Player stats summary
    if (player) {
      const statsY = startY + UPGRADES.length * (btnH + gap) + 20;
      r.textOutlined('Характеристики:', cx, statsY, '#aaa', '#000', 16, 'center', 'middle');
      r.text(`Урон: ${player.damage}`, cx - 120, statsY + 25, '#ccc', 14);
      r.text(`HP: ${player.hp}/${player.maxHp}`, cx - 120, statsY + 45, '#ccc', 14);
      r.text(`Скорость: ${player.speed}`, cx + 20, statsY + 25, '#ccc', 14);
      r.text(`Радиус: ${player.attackRange}`, cx + 20, statsY + 45, '#ccc', 14);
    }

    // Next wave button
    const nwBtnW = 240;
    const nwBtnH = 45;
    const nwBtnX = cx - nwBtnW / 2;
    const nwBtnY = r.height - 80;
    this._nextWaveButton = { x: nwBtnX, y: nwBtnY, w: nwBtnW, h: nwBtnH };

    r.rect(nwBtnX, nwBtnY, nwBtnW, nwBtnH, '#2a3a5a');
    r.strokeRect(nwBtnX, nwBtnY, nwBtnW, nwBtnH, '#4a6a8a', 2);
    r.textOutlined('Следующая волна >', cx, nwBtnY + nwBtnH / 2, '#fff', '#000', 18, 'center', 'middle');
  }

  renderGameOver(r, game) {
    const cx = r.width / 2;
    const cy = r.height / 2;

    r.rect(0, 0, r.width, r.height, '#1a1a2e');
    r.textOutlined('КОНЕЦ ИГРЫ', cx, cy - 80, '#e74c3c', '#000', 48, 'center', 'middle');
    r.textOutlined(`Волн пережито: ${game.wave}`, cx, cy - 10, '#fff', '#000', 20, 'center', 'middle');
    r.textOutlined(`Корованов ограблено: ${game.caravansRobbed}`, cx, cy + 25, '#fff', '#000', 20, 'center', 'middle');
    r.textOutlined(`Счёт: ${game.score}`, cx, cy + 60, CONST.COLOR_GOLD, '#000', 24, 'center', 'middle');

    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      r.textOutlined('[ Нажми чтобы продолжить ]', cx, cy + 130, '#aaa', '#000', 16, 'center', 'middle');
    }
  }
}

// Export for testing
export { UPGRADES };
