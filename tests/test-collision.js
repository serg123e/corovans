// Tests for collision detection, projectiles, and wave scaling

import { Vec2, CONST, circlesOverlap, pointInRect, rectOverlap, pointInCircle } from '../js/utils.js';
import { Projectile } from '../js/combat.js';
import { Guard, GuardType, spawnWave } from '../js/caravan.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function assertApprox(a, b, message, epsilon = 0.5) {
  assert(Math.abs(a - b) < epsilon, `${message} (expected ${b}, got ${a})`);
}

// --- Circle-circle collision ---

{
  // Exact overlap
  assert(circlesOverlap(0, 0, 10, 0, 0, 10), 'circles: exact overlap');
}

{
  // Barely touching
  assert(circlesOverlap(0, 0, 5, 9, 0, 5), 'circles: barely touching');
}

{
  // Just separated
  assert(!circlesOverlap(0, 0, 5, 11, 0, 5), 'circles: just separated');
}

{
  // Diagonal overlap
  assert(circlesOverlap(0, 0, 10, 7, 7, 10), 'circles: diagonal overlap');
}

{
  // Diagonal no overlap
  assert(!circlesOverlap(0, 0, 5, 10, 10, 5), 'circles: diagonal no overlap');
}

{
  // Zero radius
  assert(!circlesOverlap(0, 0, 0, 1, 0, 0), 'circles: zero radius no overlap');
  // Two zero-radius circles at same point: strict inequality means no overlap (0 < 0 is false)
  assert(!circlesOverlap(0, 0, 0, 0, 0, 0), 'circles: two zero-radius at same point no overlap (strict)');
}

{
  // One circle inside another
  assert(circlesOverlap(0, 0, 50, 5, 5, 2), 'circles: small inside large');
}

{
  // Negative coordinates
  assert(circlesOverlap(-10, -10, 5, -8, -8, 5), 'circles: negative coordinates overlap');
}

// --- Point-in-rectangle ---

{
  // Center of rect
  assert(pointInRect(5, 5, 0, 0, 10, 10), 'pointInRect: center');
}

{
  // On edge
  assert(pointInRect(0, 0, 0, 0, 10, 10), 'pointInRect: top-left corner');
  assert(pointInRect(10, 10, 0, 0, 10, 10), 'pointInRect: bottom-right corner');
}

{
  // Outside each side
  assert(!pointInRect(-1, 5, 0, 0, 10, 10), 'pointInRect: left of rect');
  assert(!pointInRect(11, 5, 0, 0, 10, 10), 'pointInRect: right of rect');
  assert(!pointInRect(5, -1, 0, 0, 10, 10), 'pointInRect: above rect');
  assert(!pointInRect(5, 11, 0, 0, 10, 10), 'pointInRect: below rect');
}

{
  // Non-origin rect
  assert(pointInRect(15, 25, 10, 20, 10, 10), 'pointInRect: non-origin rect inside');
  assert(!pointInRect(9, 25, 10, 20, 10, 10), 'pointInRect: non-origin rect outside');
}

// --- Rectangle-rectangle overlap ---

{
  // Identical rects
  assert(rectOverlap(0, 0, 10, 10, 0, 0, 10, 10), 'rectOverlap: identical');
}

{
  // Partial overlap
  assert(rectOverlap(0, 0, 10, 10, 5, 5, 10, 10), 'rectOverlap: partial overlap');
}

{
  // Adjacent (touching edge) - should not overlap (strict inequality)
  assert(!rectOverlap(0, 0, 10, 10, 10, 0, 10, 10), 'rectOverlap: adjacent no overlap');
}

{
  // Fully separated
  assert(!rectOverlap(0, 0, 10, 10, 20, 0, 10, 10), 'rectOverlap: separated horizontally');
  assert(!rectOverlap(0, 0, 10, 10, 0, 20, 10, 10), 'rectOverlap: separated vertically');
}

{
  // One inside the other
  assert(rectOverlap(0, 0, 100, 100, 10, 10, 5, 5), 'rectOverlap: small inside large');
}

// --- Point-in-circle ---

{
  // At center
  assert(pointInCircle(0, 0, 0, 0, 10), 'pointInCircle: at center');
}

{
  // Inside
  assert(pointInCircle(3, 4, 0, 0, 10), 'pointInCircle: inside (dist=5, r=10)');
}

{
  // Outside
  assert(!pointInCircle(10, 0, 0, 0, 5), 'pointInCircle: outside');
}

{
  // Boundary (at radius) - strict inequality, so on boundary returns false
  assert(!pointInCircle(10, 0, 0, 0, 10), 'pointInCircle: on boundary returns false');
}

{
  // Negative coords
  assert(pointInCircle(-3, -4, 0, 0, 10), 'pointInCircle: negative coords inside');
}

// --- Projectile collision ---

{
  // Projectile hits player at target position
  const proj = new Projectile(100, 100, 1, 0, 10);
  // Player standing right in front
  const playerPos = new Vec2(110, 100);
  const playerRadius = 12;

  // Advance a few frames
  let hit = false;
  for (let i = 0; i < 10; i++) {
    if (proj.update(1 / 60, playerPos, playerRadius)) {
      hit = true;
      break;
    }
  }
  assert(hit, 'Projectile: hits player in path');
  assert(!proj.alive, 'Projectile: dies on hit');
}

{
  // Projectile misses (going the other way)
  const proj = new Projectile(100, 100, -1, 0, 10);
  const playerPos = new Vec2(200, 100);

  let hit = false;
  for (let i = 0; i < 60; i++) {
    if (proj.update(1 / 60, playerPos, 12)) {
      hit = true;
      break;
    }
  }
  assert(!hit, 'Projectile: misses player going opposite direction');
}

{
  // Projectile expires after lifetime
  const proj = new Projectile(100, 100, 1, 0, 10);
  const farAway = new Vec2(9999, 9999);
  for (let i = 0; i < 300; i++) {
    proj.update(1 / 60, farAway, 12);
  }
  assert(!proj.alive, 'Projectile: expires after lifetime');
}

{
  // Projectile damage value preserved
  const proj = new Projectile(0, 0, 1, 0, 25);
  assert(proj.damage === 25, 'Projectile: damage value preserved');
}

// --- Guard types ---

{
  // Basic guard
  const mockCaravan = { pos: new Vec2(100, 100), alive: true };
  const guard = new Guard(100, 100, mockCaravan, GuardType.BASIC);
  assert(guard.type === 'basic', 'Guard type: basic');
  assert(guard.maxHp === CONST.GUARD_BASE_HP, 'Guard basic HP matches constant');
  assert(guard.damage === CONST.GUARD_BASE_DAMAGE, 'Guard basic damage matches constant');
}

{
  // Armored guard has more HP
  const mockCaravan = { pos: new Vec2(100, 100), alive: true };
  const guard = new Guard(100, 100, mockCaravan, GuardType.ARMORED);
  assert(guard.type === 'armored', 'Guard type: armored');
  assert(guard.maxHp === CONST.ARMORED_GUARD_HP, 'Armored guard HP matches constant');
  assert(guard.speed === CONST.ARMORED_GUARD_SPEED, 'Armored guard is slower');
}

{
  // Archer guard has ranged attack
  const mockCaravan = { pos: new Vec2(100, 100), alive: true };
  const guard = new Guard(100, 100, mockCaravan, GuardType.ARCHER);
  assert(guard.type === 'archer', 'Guard type: archer');
  assert(guard.attackRange === CONST.ARCHER_GUARD_ATTACK_RANGE, 'Archer guard has long range');
  assert(guard.maxHp === CONST.ARCHER_GUARD_HP, 'Archer guard has less HP');
}

// --- Wave scaling ---

{
  // Mock world for wave spawning
  const mockWorld = {
    width: 2400,
    height: 1600,
    getRoadPosition(t) {
      return { x: t * 2400, y: 800 };
    },
  };

  // Early wave: fewer caravans
  const wave1 = spawnWave(1, mockWorld);
  assert(wave1.length >= 1, 'Wave 1: at least 1 caravan');

  // Later wave: more caravans
  const wave6 = spawnWave(6, mockWorld);
  assert(wave6.length >= wave1.length, 'Wave 6: at least as many caravans as wave 1');

  // Boss wave (5): has a boss caravan
  const wave5 = spawnWave(5, mockWorld);
  const bossCaravans = wave5.filter(c => c.isBoss);
  assert(bossCaravans.length === 1, 'Wave 5 (boss): exactly 1 boss caravan');
  assert(bossCaravans[0].maxHp > 100, 'Boss caravan: has high HP');
  assert(bossCaravans[0].lootValue > 150, 'Boss caravan: has large loot value');

  // Wave 10 is also a boss wave
  const wave10 = spawnWave(10, mockWorld);
  const bosses10 = wave10.filter(c => c.isBoss);
  assert(bosses10.length === 1, 'Wave 10 (boss): exactly 1 boss caravan');
}

{
  // Non-boss wave has no boss
  const mockWorld = {
    width: 2400,
    height: 1600,
    getRoadPosition(t) { return { x: t * 2400, y: 800 }; },
  };
  const wave3 = spawnWave(3, mockWorld);
  const bosses = wave3.filter(c => c.isBoss);
  assert(bosses.length === 0, 'Wave 3: no boss caravan');
}

// --- Summary ---
console.log(`\nTests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  process.exit(1);
}
