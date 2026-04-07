// Loot - gold coin entities that drop from defeated caravans and can be collected

import { Vec2, CONST, randRange } from './utils.js';

export class Loot {
  constructor(x, y, value) {
    this.pos = new Vec2(x, y);
    this.value = value;
    this.radius = CONST.LOOT_RADIUS;
    this.alive = true;

    // Scatter animation: coins fly out a bit when spawned
    const angle = randRange(0, Math.PI * 2);
    const speed = randRange(40, 100);
    this.vel = new Vec2(Math.cos(angle) * speed, Math.sin(angle) * speed);
    this.friction = 5;

    // Visual bobbing
    this.bobTimer = randRange(0, Math.PI * 2);
  }

  update(dt, playerPos) {
    if (!this.alive) return;

    // Apply scatter velocity with friction
    if (this.vel.lenSq() > 1) {
      const frictionMul = Math.exp(-this.friction * dt);
      this.vel = this.vel.mul(frictionMul);
      this.pos = this.pos.add(this.vel.mul(dt));
    }

    // Bob animation
    this.bobTimer += dt * 3;

    // Magnet toward player when close
    const distToPlayer = this.pos.dist(playerPos);
    if (distToPlayer < CONST.LOOT_MAGNET_RANGE) {
      const dir = playerPos.sub(this.pos).normalize();
      this.pos = this.pos.add(dir.mul(CONST.LOOT_MAGNET_SPEED * dt));
    }

    // Collect if touching player
    if (distToPlayer < this.radius + CONST.PLAYER_RADIUS) {
      this.alive = false;
      return this.value;
    }

    return 0;
  }

  render(renderer) {
    if (!this.alive) return;

    const bobY = Math.sin(this.bobTimer) * 2;
    const x = this.pos.x;
    const y = this.pos.y + bobY;

    // Gold coin - outer circle
    renderer.circle(x, y, this.radius, CONST.COLOR_GOLD);
    // Inner highlight
    renderer.circle(x - 1, y - 1, this.radius - 2, '#ffe44d');
    // Tiny dark center dot for depth
    renderer.circle(x, y, 1, '#c9a100');
  }
}

// Spawn loot coins from a defeated caravan
export function spawnLoot(caravan) {
  const coins = [];
  const totalValue = caravan.lootValue;

  // Split into several coins for satisfying pickup
  const coinCount = Math.max(3, Math.min(8, Math.floor(totalValue / 5)));
  const valuePerCoin = Math.floor(totalValue / coinCount);
  let remaining = totalValue;

  for (let i = 0; i < coinCount; i++) {
    const isLast = i === coinCount - 1;
    const coinValue = isLast ? remaining : valuePerCoin;
    remaining -= coinValue;

    const coin = new Loot(caravan.pos.x, caravan.pos.y, coinValue);
    coins.push(coin);
  }

  return coins;
}
