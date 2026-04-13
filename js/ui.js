// UI - HUD, menus, draft shop, and game over
// Manages all user interface screens: main menu, in-game HUD, draft card pick, game over.

import { CONST, pointInRect } from './utils.js';
import { getBestScore, getBestWave } from './storage.js';
import { countSessions } from './session-logger.js';
import { randFn } from './rng.js';

// Card rarities drive pool weighting and card border colors.
const Rarity = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
};

const RARITY_WEIGHT = {
  [Rarity.COMMON]: 60,
  [Rarity.UNCOMMON]: 30,
  [Rarity.RARE]: 10,
};

const RARITY_COLOR = {
  [Rarity.COMMON]: '#8aa3a8',
  [Rarity.UNCOMMON]: '#4a90e2',
  [Rarity.RARE]: '#e2b44a',
};

// Gold cost per rarity when purchased from the in-world shop (paid mode).
// Free mode (end-of-wave draft) ignores these.
const RARITY_COST = {
  [Rarity.COMMON]: 15,
  [Rarity.UNCOMMON]: 40,
  [Rarity.RARE]: 80,
};

// Diminishing returns on stacked cards. Index = how many copies the player
// already owns BEFORE the current pick; 0 = first stack (full effect).
// Hard cap past index 4 so nth-copy picks still feel non-zero.
const STACK_SCALE = [1, 0.6, 0.3, 0.15, 0.1];
export function stackScale(stackIndex) {
  const i = Math.max(0, stackIndex | 0);
  return STACK_SCALE[Math.min(i, STACK_SCALE.length - 1)];
}

// Card pool. Each card has an apply(player, scale) that mutates player
// stats. `scale` comes from stackScale(ownedCountBeforePick); cards that
// care about stacking multiply their effect by it (additive stats trivially,
// multiplicative stats via (1 − base * scale)). `stackable: false` cards
// drop out of the pool once taken.
export const CARDS = [
  // --- Stat cards (common, multi-take) ---
  {
    id: 'damage',
    label: 'Точный удар',
    desc: '+5 к урону',
    icon: '⚔',
    rarity: Rarity.COMMON,
    stackable: true,
    apply: (p, scale = 1) => { p.damage += 5 * scale; },
  },
  {
    id: 'maxHp',
    label: 'Крепкий череп',
    desc: '+25 макс. HP и исцеление',
    icon: '❤',
    rarity: Rarity.COMMON,
    stackable: true,
    apply: (p, scale = 1) => {
      const bonus = Math.round(25 * scale);
      p.maxHp += bonus;
      p.hp += bonus;
    },
  },
  {
    id: 'speed',
    label: 'Лёгкая походка',
    desc: '+15 к скорости, −6% к перезарядке атаки',
    icon: '👢',
    rarity: Rarity.COMMON,
    stackable: true,
    apply: (p, scale = 1) => {
      p.speed += 15 * scale;
      p.attackCooldown = Math.max(0.12, p.attackCooldown * (1 - 0.06 * scale));
    },
  },
  {
    id: 'attackRange',
    label: 'Длинная рука',
    desc: '+2 к радиусу атаки',
    icon: '🗡',
    rarity: Rarity.COMMON,
    stackable: true,
    apply: (p, scale = 1) => { p.attackRange += 2 * scale; },
  },
  {
    id: 'cooldown',
    label: 'Быстрый замах',
    desc: '−12% к перезарядке атаки',
    icon: '⏱',
    rarity: Rarity.COMMON,
    stackable: true,
    apply: (p, scale = 1) => {
      p.attackCooldown = Math.max(0.12, p.attackCooldown * (1 - 0.12 * scale));
    },
  },
  // --- Mechanical cards (uncommon) ---
  {
    id: 'lifesteal',
    label: 'Вампиризм',
    desc: '+7% HP от нанесённого урона',
    icon: '🩸',
    rarity: Rarity.UNCOMMON,
    stackable: true,
    apply: (p, scale = 1) => { p.lifestealPct += 0.07 * scale; },
  },
  {
    id: 'magnet',
    label: 'Жадные руки',
    desc: '+50% к радиусу магнита',
    icon: '🧲',
    rarity: Rarity.UNCOMMON,
    stackable: true,
    apply: (p, scale = 1) => { p.magnetRangeMul += 0.5 * scale; },
  },
  {
    id: 'thorns',
    label: 'Шипы',
    desc: 'Ближники получают 25% урона в ответ',
    icon: '🌵',
    rarity: Rarity.UNCOMMON,
    stackable: true,
    apply: (p, scale = 1) => { p.thornsPct += 0.25 * scale; },
  },
  {
    id: 'regen',
    label: 'Второе дыхание',
    desc: '+1 HP/сек регенерации',
    icon: '💚',
    rarity: Rarity.UNCOMMON,
    stackable: true,
    apply: (p, scale = 1) => { p.regenPerSec += 1 * scale; },
  },
  {
    id: 'dashCooldown',
    label: 'Быстрые ноги',
    desc: '−25% к кулдауну рывка, +0.05с к окну неуязвимости',
    icon: '⚡',
    rarity: Rarity.UNCOMMON,
    stackable: true,
    apply: (p, scale = 1) => {
      p.dashCooldownMax = Math.max(0.1, p.dashCooldownMax * (1 - 0.25 * scale));
      p.iframeBonus += 0.05 * scale;
    },
  },
  // --- Rare cards ---
  {
    id: 'glassCannon',
    label: 'Берсерк',
    desc: '+8 урона, −15 макс. HP',
    icon: '💀',
    rarity: Rarity.RARE,
    stackable: true,
    apply: (p, scale = 1) => {
      p.damage += 8 * scale;
      p.maxHp = Math.max(10, p.maxHp - Math.round(15 * scale));
      p.hp = Math.min(p.hp, p.maxHp);
    },
  },
  {
    id: 'wideArc',
    label: 'Круговой удар',
    desc: 'Атака бьёт во все стороны',
    icon: '🌀',
    rarity: Rarity.RARE,
    stackable: false,
    apply: (p) => { p.fullArcAttack = true; },
  },
];

// Roll one card from the pool, weighted by rarity, excluding already-drawn ids
// and unstackable cards the player already owns. `rng` is optional — sims
// pass a seeded generator; the live game falls back to Math.random.
function rollCard(exclude, ownedUnstackable, rng) {
  const pool = CARDS.filter(c => {
    if (exclude.has(c.id)) return false;
    if (!c.stackable && ownedUnstackable.has(c.id)) return false;
    return true;
  });
  if (pool.length === 0) return null;

  const totalWeight = pool.reduce((s, c) => s + RARITY_WEIGHT[c.rarity], 0);
  const rand = randFn(rng);
  let roll = rand() * totalWeight;
  for (const card of pool) {
    roll -= RARITY_WEIGHT[card.rarity];
    if (roll <= 0) return card;
  }
  return pool[pool.length - 1];
}

// Draw N distinct cards at once.
function drawCards(count, ownedUnstackable, rng) {
  const drawn = [];
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const card = rollCard(seen, ownedUnstackable, rng);
    if (!card) break;
    drawn.push(card);
    seen.add(card.id);
  }
  return drawn;
}

const REROLL_BASE_COST = 10;
const REROLL_COST_GROWTH = 2;
const DRAFT_SIZE = 5;

// Draft can be entered from two places:
//   FREE — end-of-wave mandatory draft, picks cost nothing.
//   PAID — in-world shop entered by walking up to the hut. Picks cost gold.
export const DraftMode = {
  FREE: 'free',
  PAID: 'paid',
};

export class UI {
  constructor() {
    // Track upgrade/card purchase counts per id (for menu stats / unstackable check).
    this.cardCounts = {};
    // Cards on current draft offer.
    this.draftOffer = [];
    // Current draft mode — determines whether picks cost gold.
    this.draftMode = DraftMode.FREE;
    // Reroll counter for this shop visit.
    this.rerollCount = 0;
    // Wave at which the paid offer was last rolled. Paid offer persists inside
    // a wave so players can't re-roll by exiting and re-entering the shop.
    this._paidOfferWave = -1;
    // At most one paid purchase per wave. Reset in onWaveStart().
    this._paidPicksThisWave = 0;

    // Interaction rects set during render.
    this._cardButtons = [];
    this._rerollButton = null;
    this._skipButton = null;
  }

  reset() {
    this.cardCounts = {};
    this.draftOffer = [];
    this.draftMode = DraftMode.FREE;
    this.rerollCount = 0;
    this._paidOfferWave = -1;
    this._paidPicksThisWave = 0;
    this._cardButtons = [];
    this._rerollButton = null;
    this._skipButton = null;
  }

  _ownedUnstackable() {
    const set = new Set();
    for (const id in this.cardCounts) {
      const card = CARDS.find(c => c.id === id);
      if (card && !card.stackable && this.cardCounts[id] > 0) set.add(id);
    }
    return set;
  }

  // Begin a free draft (end-of-wave). Always rolls a fresh offer. Heals the
  // player for 20% of max HP as a "breath between waves" — applied before the
  // cards roll so it doesn't interact with regen/lifesteal gating.
  beginFreeDraft(rng = null, player = null) {
    this.draftMode = DraftMode.FREE;
    this.rerollCount = 0;
    if (player && player.alive) {
      const heal = Math.floor(player.maxHp * 0.2);
      player.hp = Math.min(player.maxHp, player.hp + heal);
    }
    this.draftOffer = drawCards(DRAFT_SIZE, this._ownedUnstackable(), rng);
  }

  // Begin a paid draft (in-world shop). Offer persists across visits during
  // the same wave; only refreshes when `currentWave` differs from the last
  // roll so exit/re-enter cannot be used as a free reroll.
  // If the player has already bought a paid card this wave, the offer stays
  // empty — paidPickLimitReached() lets the caller show a "sold out" state.
  beginPaidDraft(currentWave, rng = null) {
    this.draftMode = DraftMode.PAID;
    if (this._paidPicksThisWave >= 1) {
      this._paidOfferWave = currentWave;
      this.draftOffer = [];
      return;
    }
    if (currentWave !== this._paidOfferWave || this.draftOffer.length === 0) {
      this._paidOfferWave = currentWave;
      this.rerollCount = 0;
      this.draftOffer = drawCards(DRAFT_SIZE, this._ownedUnstackable(), rng);
    }
  }

  // True once the player has used up their one paid pick for the current
  // wave. Used by the shop renderer to show a "sold out" message and by
  // game.js to route re-entry attempts sensibly.
  paidPickLimitReached() {
    return this._paidPicksThisWave >= 1;
  }

  // Called by game when a new wave starts — invalidates paid offer so the
  // next shop visit shows fresh cards, and refreshes the per-wave paid pick
  // allowance.
  onWaveStart() {
    this._paidOfferWave = -1;
    this._paidPicksThisWave = 0;
  }

  // Shop cost scales with how many stacks the player already owns: each
  // subsequent copy costs +100% more (1x, 2x, 3x, 4x ...). Counters
  // combo-snowball where the same card could be bought cheaply on repeat.
  getCardCost(card) {
    if (!card) return 0;
    const base = RARITY_COST[card.rarity] || 0;
    const owned = this.cardCounts[card.id] || 0;
    return base * (1 + owned);
  }

  getRerollCost() {
    return REROLL_BASE_COST + this.rerollCount * REROLL_COST_GROWTH;
  }

  tryReroll(player, rng = null) {
    if (this.draftMode === DraftMode.PAID && this._paidPicksThisWave >= 1) return false;
    const cost = this.getRerollCost();
    if (!player || player.gold < cost) return false;
    player.gold -= cost;
    this.rerollCount++;
    this.draftOffer = drawCards(DRAFT_SIZE, this._ownedUnstackable(), rng);
    return true;
  }

  // Pick a card from the current offer. Always deducts gold. In world-shop
  // (PAID) mode, also enforces the per-wave pick limit.
  // Returns true if a card was applied.
  pickCard(index, player) {
    if (!player) return false;
    if (index < 0 || index >= this.draftOffer.length) return false;
    const card = this.draftOffer[index];
    if (!card) return false;

    // Per-wave limit: world shop only (wave-end draft is one-and-done by flow).
    if (this.draftMode === DraftMode.PAID && this._paidPicksThisWave >= 1) return false;

    // All cards cost gold.
    const cost = this.getCardCost(card);
    if (player.gold < cost) return false;
    player.gold -= cost;

    const owned = this.cardCounts[card.id] || 0;
    card.apply(player, stackScale(owned));
    this.cardCounts[card.id] = owned + 1;

    if (this.draftMode === DraftMode.PAID) {
      this._paidPicksThisWave++;
    }
    this.draftOffer = [];
    return true;
  }

  // Hit-test the card offers; returns index or -1.
  handleDraftClick(mouseX, mouseY) {
    for (let i = 0; i < this._cardButtons.length; i++) {
      const btn = this._cardButtons[i];
      if (pointInRect(mouseX, mouseY, btn.x, btn.y, btn.w, btn.h)) {
        return i;
      }
    }
    return -1;
  }

  isRerollClicked(mouseX, mouseY) {
    if (!this._rerollButton) return false;
    const b = this._rerollButton;
    return pointInRect(mouseX, mouseY, b.x, b.y, b.w, b.h);
  }

  isSkipClicked(mouseX, mouseY) {
    if (!this._skipButton) return false;
    const b = this._skipButton;
    return pointInRect(mouseX, mouseY, b.x, b.y, b.w, b.h);
  }

  // --- Render methods ---

  renderMenu(r) {
    const cx = r.width / 2;
    const cy = r.height / 2;
    const t = performance.now() / 1000;

    r.setAlpha(0.75);
    r.rect(0, 0, r.width, r.height, '#1a1a2e');
    r.resetAlpha();

    const swordY = cy - 100;
    r.setAlpha(0.2);
    r.line(cx - 80, swordY - 30, cx + 80, swordY + 30, '#ffd700', 3);
    r.line(cx + 80, swordY - 30, cx - 80, swordY + 30, '#ffd700', 3);
    r.resetAlpha();

    const pulse = 0.85 + 0.15 * Math.sin(t * 2);
    r.setAlpha(pulse * 0.3);
    r.textOutlined('КОРОВАНЫ', cx, cy - 99, '#ffaa00', '#000', 68, 'center', 'middle');
    r.resetAlpha();
    r.textOutlined('КОРОВАНЫ', cx, cy - 100, '#ffd700', '#000', 64, 'center', 'middle');

    r.setAlpha(0.5);
    r.line(cx - 100, cy - 55, cx + 100, cy - 55, '#ffd700', 1);
    r.resetAlpha();

    r.textOutlined('грабь корованы!', cx, cy - 30, '#e8c872', '#000', 24, 'center', 'middle');

    // Best record
    const bestScore = getBestScore();
    const bestWave = getBestWave();
    if (bestScore > 0 || bestWave > 0) {
      r.textOutlined(
        `Рекорд: ${bestScore}  •  Волна: ${bestWave}`,
        cx, cy + 10, '#ffc85a', '#000', 16, 'center', 'middle'
      );
    }

    r.textOutlined('WASD / стрелки - движение', cx, cy + 45, '#aaa', '#000', 16, 'center', 'middle');
    r.textOutlined('Пробел / клик - атака   •   Shift - рывок   •   E - магазин', cx, cy + 68, '#aaa', '#000', 14, 'center', 'middle');
    r.textOutlined('Esc - пауза   •   M - звук   •   L - экспорт логов', cx, cy + 89, '#888', '#000', 13, 'center', 'middle');

    // Session log indicator — helps remember that logs are stored locally.
    const n = countSessions();
    if (n > 0) {
      r.text(`Логов сессий: ${n}  (L — скачать, Shift+L — очистить)`, 10, r.height - 20, '#666', 12, 'left');
    }

    r.setAlpha(0.4);
    for (let i = 0; i < 5; i++) {
      const coinX = cx - 160 + i * 80;
      const coinY = cy + 130 + Math.sin(t * 1.5 + i * 1.3) * 8;
      r.circle(coinX, coinY, 4, '#ffd700');
      r.circle(coinX - 1, coinY - 1, 2, '#ffee66');
    }
    r.resetAlpha();

    const promptAlpha = 0.5 + 0.5 * Math.sin(t * 3);
    r.setAlpha(promptAlpha);
    r.textOutlined('[ Enter / клик — начать ]', cx, cy + 170, '#fff', '#000', 20, 'center', 'middle');
    r.resetAlpha();

    r.setAlpha(0.3);
    r.text('v1.1', r.width - 40, r.height - 20, '#888', 12, 'right');
    r.resetAlpha();
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
      r.healthBar(310, 12, 100, 14, player.hp / player.maxHp, CONST.COLOR_HP_BAR, CONST.COLOR_HP_BG);
      r.text(`${player.hp}/${player.maxHp}`, 420, 10, '#fff', 14);
      r.text(`\u2B50 ${player.gold}`, 500, 10, CONST.COLOR_GOLD, 16);

      // Dash cooldown: small bar that fills up as dash recharges. Bright
      // yellow when ready, dim gray while on cooldown.
      const dashX = 560;
      const dashY = 14;
      const dashW = 30;
      const dashH = 10;
      const dashReady = player.dashCooldownTimer <= 0;
      const frac = dashReady ? 1 : 1 - (player.dashCooldownTimer / player.dashCooldownMax);
      r.rect(dashX, dashY, dashW, dashH, '#222');
      r.rect(dashX, dashY, Math.round(dashW * frac), dashH, dashReady ? '#ffd700' : '#886622');
      r.text('⚡', dashX + dashW + 4, 10, dashReady ? '#ffd700' : '#666', 14);
    }
    const aliveCaravans = game.caravans.filter(c => c.alive).length;
    const aliveGuards = game.guards.filter(g => g.alive).length;
    r.text(`Корованы: ${aliveCaravans}  Охрана: ${aliveGuards}`, 630, 10, '#ddd', 14);

    // Mute indicator at the right edge.
    if (game.audio && game.audio.muted) {
      r.text('🔇', r.width - 30, 10, '#ffaa00', 18, 'right');
    }
  }

  renderShop(r, player, game) {
    const cx = r.width / 2;
    const paid = this.draftMode === DraftMode.PAID;

    r.rect(0, 0, r.width, r.height, '#1a1a2e');

    const title = paid ? 'ТОРГОВЕЦ' : 'ВЫБЕРИ КАРТУ';
    r.textOutlined(title, cx, 50, '#ffd700', '#000', 38, 'center', 'middle');
    r.textOutlined(
      `Золото: ${player ? player.gold : 0}`,
      cx, 90, CONST.COLOR_GOLD, '#000', 20, 'center', 'middle'
    );

    // Five narrower cards side-by-side.
    this._cardButtons = [];
    const cardW = 150;
    const cardH = 240;
    const gap = 14;
    const totalW = DRAFT_SIZE * cardW + (DRAFT_SIZE - 1) * gap;
    const startX = cx - totalW / 2;
    const cardY = 130;

    // Paid shop: if the per-wave allowance is spent, show a "sold out"
    // message instead of an empty card area.
    if (paid && this.paidPickLimitReached()) {
      r.textOutlined('РАСПРОДАНО', cx, cardY + cardH / 2 - 10, '#888', '#000', 32, 'center', 'middle');
      r.text('Приходи на следующей волне', cx, cardY + cardH / 2 + 26, '#666', 14, 'center');
      // No reroll button — nothing to reroll.
      this._rerollButton = null;
      const skW = 180;
      const skH = 40;
      const skX = cx - skW / 2;
      const skY = cardY + cardH + 30;
      this._skipButton = { x: skX, y: skY, w: skW, h: skH };
      r.rect(skX, skY, skW, skH, '#2a3a5a');
      r.strokeRect(skX, skY, skW, skH, '#4a6a8a', 2);
      r.textOutlined('Выйти из шопа', skX + skW / 2, skY + skH / 2, '#fff', '#000', 16, 'center', 'middle');
      if (player) {
        const sy = skY + skH + 30;
        r.textOutlined('Характеристики:', cx, sy, '#aaa', '#000', 15, 'center', 'middle');
        r.text(`Урон: ${player.damage}`, cx - 200, sy + 22, '#ccc', 13);
        r.text(`HP: ${player.hp}/${player.maxHp}`, cx - 70, sy + 22, '#ccc', 13);
        r.text(`Скорость: ${player.speed}`, cx + 60, sy + 22, '#ccc', 13);
        r.text(`Радиус: ${player.attackRange}`, cx + 200, sy + 22, '#ccc', 13);
      }
      return;
    }

    for (let i = 0; i < this.draftOffer.length; i++) {
      const card = this.draftOffer[i];
      const x = startX + i * (cardW + gap);
      this._cardButtons.push({ x, y: cardY, w: cardW, h: cardH });

      const cost = this.getCardCost(card);
      const canAfford = player && player.gold >= cost;

      // Background + rarity border
      r.rect(x, cardY, cardW, cardH, canAfford ? '#222237' : '#1a1a24');
      r.strokeRect(x, cardY, cardW, cardH, RARITY_COLOR[card.rarity], 3);

      // Rarity label
      r.text(card.rarity.toUpperCase(), x + cardW / 2, cardY + 12, RARITY_COLOR[card.rarity], 11, 'center');

      // Icon (big)
      const iconColor = canAfford ? '#fff' : '#555';
      r.textOutlined(card.icon, x + cardW / 2, cardY + 64, iconColor, '#000', 44, 'center', 'middle');

      // Title
      r.textOutlined(
        card.label,
        x + cardW / 2, cardY + 128,
        canAfford ? '#fff' : '#666', '#000', 16, 'center', 'middle'
      );

      // Description
      r.text(card.desc, x + cardW / 2, cardY + 155, canAfford ? '#bbb' : '#555', 11, 'center');

      // Cost + owned count
      const costColor = canAfford ? CONST.COLOR_GOLD : '#664400';
      r.textOutlined(
        `${cost} \u2B50`,
        x + cardW / 2, cardY + cardH - 22,
        costColor, '#000', 16, 'center', 'middle'
      );
      const owned = this.cardCounts[card.id] || 0;
      if (owned > 0) {
        r.text(`x${owned}`, x + cardW / 2, cardY + cardH - 6, '#888', 10, 'center');
      }
    }

    // Reroll button
    const rerollCost = this.getRerollCost();
    const canReroll = player && player.gold >= rerollCost;
    const rrW = 180;
    const rrH = 40;
    const rrX = cx - rrW - 10;
    const rrY = cardY + cardH + 30;
    this._rerollButton = { x: rrX, y: rrY, w: rrW, h: rrH };

    r.rect(rrX, rrY, rrW, rrH, canReroll ? '#3a2a5a' : '#2a2a3a');
    r.strokeRect(rrX, rrY, rrW, rrH, canReroll ? '#6a4a8a' : '#4a4a5a', 2);
    r.textOutlined(
      `⟳ Реролл (${rerollCost})`,
      rrX + rrW / 2, rrY + rrH / 2,
      canReroll ? '#fff' : '#666', '#000', 16, 'center', 'middle'
    );

    // Skip / Close button — label adapts to mode.
    const skW = 180;
    const skH = 40;
    const skX = cx + 10;
    const skY = rrY;
    this._skipButton = { x: skX, y: skY, w: skW, h: skH };
    r.rect(skX, skY, skW, skH, '#2a3a5a');
    r.strokeRect(skX, skY, skW, skH, '#4a6a8a', 2);
    const skLabel = paid ? 'Выйти из шопа' : 'Пропустить >';
    r.textOutlined(skLabel, skX + skW / 2, skY + skH / 2, '#fff', '#000', 16, 'center', 'middle');

    // Stats summary
    if (player) {
      const sy = rrY + rrH + 30;
      r.textOutlined('Характеристики:', cx, sy, '#aaa', '#000', 15, 'center', 'middle');
      r.text(`Урон: ${player.damage}`, cx - 200, sy + 22, '#ccc', 13);
      r.text(`HP: ${player.hp}/${player.maxHp}`, cx - 70, sy + 22, '#ccc', 13);
      r.text(`Скорость: ${player.speed}`, cx + 60, sy + 22, '#ccc', 13);
      r.text(`Радиус: ${player.attackRange}`, cx + 200, sy + 22, '#ccc', 13);
      if (player.lifestealPct > 0) {
        r.text(`Вамп: ${Math.round(player.lifestealPct * 100)}%`, cx - 200, sy + 42, '#d46a7a', 13);
      }
      if (player.thornsPct > 0) {
        r.text(`Шипы: ${Math.round(player.thornsPct * 100)}%`, cx - 70, sy + 42, '#6bbf4a', 13);
      }
      if (player.magnetRangeMul > 1) {
        r.text(`Магнит: x${player.magnetRangeMul.toFixed(1)}`, cx + 60, sy + 42, '#d4a020', 13);
      }
      if (player.fullArcAttack) {
        r.text('Круговая атака', cx + 200, sy + 42, '#e2b44a', 13);
      }
    }
  }

  renderPaused(r) {
    r.setAlpha(0.6);
    r.rect(0, 0, r.width, r.height, '#000');
    r.resetAlpha();
    const cx = r.width / 2;
    const cy = r.height / 2;
    r.textOutlined('ПАУЗА', cx, cy - 20, '#ffd700', '#000', 56, 'center', 'middle');
    r.textOutlined('Esc / P - продолжить', cx, cy + 30, '#ccc', '#000', 18, 'center', 'middle');
    r.textOutlined('M - звук', cx, cy + 56, '#888', '#000', 14, 'center', 'middle');
  }

  renderGameOver(r, game) {
    const cx = r.width / 2;
    const cy = r.height / 2;

    r.rect(0, 0, r.width, r.height, '#1a1a2e');
    r.textOutlined('КОНЕЦ ИГРЫ', cx, cy - 110, '#e74c3c', '#000', 48, 'center', 'middle');
    r.textOutlined(`Погиб на волне: ${game.wave}`, cx, cy - 40, '#fff', '#000', 20, 'center', 'middle');
    r.textOutlined(`Корованов ограблено: ${game.caravansRobbed}`, cx, cy - 10, '#fff', '#000', 20, 'center', 'middle');
    r.textOutlined(`Счёт: ${game.score}`, cx, cy + 25, CONST.COLOR_GOLD, '#000', 24, 'center', 'middle');

    const bestScore = getBestScore();
    const bestWave = getBestWave();
    if (game.newRecord) {
      r.textOutlined('НОВЫЙ РЕКОРД!', cx, cy + 65, '#00ff88', '#000', 22, 'center', 'middle');
    } else if (bestScore > 0) {
      r.textOutlined(
        `Рекорд: ${bestScore} (волна ${bestWave})`,
        cx, cy + 65, '#aaa', '#000', 16, 'center', 'middle'
      );
    }

    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      r.textOutlined('[ Enter / клик — продолжить ]', cx, cy + 130, '#aaa', '#000', 16, 'center', 'middle');
    }
  }
}
