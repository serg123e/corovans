// Tests for combat calculations and loot system

import { calcDamage, findAttackTargets, performAttack } from '../js/combat.js';
import { Loot, spawnLoot } from '../js/loot.js';
import { Player } from '../js/player.js';
import { Vec2, CONST } from '../js/utils.js';

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

// --- calcDamage ---
{
  // No armor: full damage
  const dmg = calcDamage(15, 0);
  assert(dmg === 15, 'calcDamage: no armor returns full damage');
}

{
  // With armor: reduced damage
  const dmg = calcDamage(100, 100);
  assert(dmg === 50, 'calcDamage: 100 armor halves 100 damage');
}

{
  // High armor: still does at least 1
  const dmg = calcDamage(1, 9999);
  assert(dmg >= 1, 'calcDamage: minimum 1 damage with very high armor');
}

{
  // Default armor (0)
  const dmg = calcDamage(20);
  assert(dmg === 20, 'calcDamage: default armor is 0');
}

{
  // Moderate armor
  const dmg = calcDamage(50, 50);
  // 50 * (100 / 150) = 33.33 -> 33
  assert(dmg === 33, 'calcDamage: 50 armor reduces 50 damage to 33');
}

// --- findAttackTargets ---

// Helper: mock entity
function mockEntity(x, y, radius = 10, alive = true) {
  return {
    pos: new Vec2(x, y),
    radius,
    alive,
  };
}

// Helper: mock attacker
function mockAttacker(x, y, facingX = 1, facingY = 0, radius = 12) {
  return {
    pos: new Vec2(x, y),
    facing: new Vec2(facingX, facingY).normalize(),
    radius,
  };
}

{
  // Target in front, in range
  const attacker = mockAttacker(100, 100, 1, 0);
  const target = mockEntity(130, 100);
  const hits = findAttackTargets(attacker, [target], 28);
  assert(hits.length === 1, 'findAttackTargets: hits target in front and in range');
}

{
  // Target too far away
  const attacker = mockAttacker(100, 100, 1, 0);
  const target = mockEntity(200, 100);
  const hits = findAttackTargets(attacker, [target], 28);
  assert(hits.length === 0, 'findAttackTargets: misses target out of range');
}

{
  // Target behind attacker (but not overlapping)
  const attacker = mockAttacker(100, 100, 1, 0);
  const target = mockEntity(60, 100);
  const hits = findAttackTargets(attacker, [target], 28);
  assert(hits.length === 0, 'findAttackTargets: misses target behind attacker');
}

{
  // Dead target is skipped
  const attacker = mockAttacker(100, 100, 1, 0);
  const target = mockEntity(130, 100, 10, false);
  const hits = findAttackTargets(attacker, [target], 28);
  assert(hits.length === 0, 'findAttackTargets: skips dead targets');
}

{
  // Multiple targets, some in range
  const attacker = mockAttacker(100, 100, 1, 0);
  const t1 = mockEntity(130, 100); // in range, in front
  const t2 = mockEntity(200, 100); // out of range
  const t3 = mockEntity(120, 110); // in range, slightly off-center
  const hits = findAttackTargets(attacker, [t1, t2, t3], 28);
  assert(hits.length === 2, 'findAttackTargets: hits multiple in-range targets');
}

{
  // Target very close (overlapping) should always hit regardless of facing
  const attacker = mockAttacker(100, 100, 1, 0);
  const target = mockEntity(95, 100); // behind but overlapping
  const hits = findAttackTargets(attacker, [target], 28);
  assert(hits.length === 1, 'findAttackTargets: hits overlapping target regardless of facing');
}

// --- Player tryAttack ---
{
  const p = new Player(100, 100);
  const result = p.tryAttack();
  assert(result === true, 'Player.tryAttack: succeeds when off cooldown');
  assert(p.attackTimer > 0, 'Player.tryAttack: sets cooldown timer');
  assert(p.isAttacking === true, 'Player.tryAttack: sets attacking flag');
}

{
  const p = new Player(100, 100);
  p.tryAttack();
  const result2 = p.tryAttack();
  assert(result2 === false, 'Player.tryAttack: fails when on cooldown');
}

{
  const p = new Player(100, 100);
  p.alive = false;
  const result = p.tryAttack();
  assert(result === false, 'Player.tryAttack: fails when dead');
}

{
  // Cooldown resets after enough time
  const p = new Player(100, 100);
  p.tryAttack();
  const mockInput = {
    getMovement() { return { x: 0, y: 0 }; },
    wasPressed() { return false; },
    wantsAttack() { return false; },
    mouse: { x: 0, y: 0, down: false, clicked: false },
  };
  // Simulate time passing to clear cooldown
  for (let i = 0; i < 60; i++) {
    p.update(1 / 60, mockInput, 2400, 1600);
  }
  const result = p.tryAttack();
  assert(result === true, 'Player.tryAttack: succeeds after cooldown expires');
}

// --- Attack animation ---
{
  const p = new Player(100, 100);
  p.tryAttack();
  assert(p.anim === 'attack', 'Player attack animation starts immediately');

  const mockInput = {
    getMovement() { return { x: 0, y: 0 }; },
    wasPressed() { return false; },
    wantsAttack() { return false; },
    mouse: { x: 0, y: 0, down: false, clicked: false },
  };

  // Wait for anim to end
  for (let i = 0; i < 30; i++) {
    p.update(1 / 60, mockInput, 2400, 1600);
  }
  assert(p.anim !== 'attack', 'Player attack animation ends after duration');
}

// --- performAttack integration ---
{
  // Mock guard-like object
  const guard = {
    pos: new Vec2(130, 100),
    radius: 10,
    alive: true,
    hp: 40,
    maxHp: 40,
    caravan: null,
    takeDamage(amount) {
      this.hp -= amount;
      if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    },
  };

  const player = new Player(100, 100);
  player.facing = new Vec2(1, 0);

  const results = performAttack(player, [guard], []);
  assert(results.length === 1, 'performAttack: hits guard in range');
  assert(results[0].damage === CONST.PLAYER_BASE_DAMAGE, 'performAttack: deals correct damage');
  assert(guard.hp === 40 - CONST.PLAYER_BASE_DAMAGE, 'performAttack: guard takes damage');
}

{
  // Player attacks caravan directly
  const caravan = {
    pos: new Vec2(130, 100),
    radius: 18,
    alive: true,
    hp: 60,
    maxHp: 60,
    looted: false,
    lootValue: 50,
    takeDamage(amount) {
      this.hp -= amount;
      if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    },
  };

  const player = new Player(100, 100);
  player.facing = new Vec2(1, 0);

  const results = performAttack(player, [], [caravan]);
  assert(results.length === 1, 'performAttack: hits caravan in range');
  assert(results[0].type === 'caravan', 'performAttack: identifies caravan hit');
}

// --- Loot ---
{
  const loot = new Loot(100, 100, 10);
  assert(loot.pos.x === 100, 'Loot initial position x');
  assert(loot.pos.y === 100, 'Loot initial position y');
  assert(loot.value === 10, 'Loot value');
  assert(loot.alive === true, 'Loot starts alive');
}

{
  // Loot collects when player walks over it
  const loot = new Loot(100, 100, 25);
  loot.vel = new Vec2(0, 0); // no scatter
  const playerPos = new Vec2(100, 100); // standing on it
  const collected = loot.update(1 / 60, playerPos);
  assert(collected === 25, 'Loot returns value when collected');
  assert(!loot.alive, 'Loot dies when collected');
}

{
  // Loot not collected when player is far
  const loot = new Loot(100, 100, 25);
  loot.vel = new Vec2(0, 0);
  const playerPos = new Vec2(300, 300);
  const collected = loot.update(1 / 60, playerPos);
  assert(collected === 0, 'Loot returns 0 when not collected');
  assert(loot.alive, 'Loot stays alive when not collected');
}

{
  // Loot magnets toward player when close
  const loot = new Loot(100, 100, 10);
  loot.vel = new Vec2(0, 0);
  const playerPos = new Vec2(120, 100); // within magnet range (40)
  const startDist = loot.pos.dist(playerPos);
  loot.update(1 / 60, playerPos);
  if (loot.alive) { // might have collected
    const endDist = loot.pos.dist(playerPos);
    assert(endDist < startDist, 'Loot moves toward player when in magnet range');
  } else {
    passed++; // collected, which is also fine
  }
}

// --- spawnLoot ---
{
  const mockCaravan = {
    pos: new Vec2(200, 200),
    lootValue: 50,
  };
  const coins = spawnLoot(mockCaravan);
  assert(coins.length >= 3, 'spawnLoot: creates at least 3 coins');
  assert(coins.length <= 8, 'spawnLoot: creates at most 8 coins');

  let totalValue = 0;
  for (const coin of coins) {
    totalValue += coin.value;
  }
  assert(totalValue === 50, 'spawnLoot: total value matches caravan loot');
}

{
  // Small loot still spawns reasonable number of coins
  const mockCaravan = {
    pos: new Vec2(200, 200),
    lootValue: 10,
  };
  const coins = spawnLoot(mockCaravan);
  assert(coins.length >= 3, 'spawnLoot: at least 3 coins even for small loot');

  let totalValue = 0;
  for (const coin of coins) {
    totalValue += coin.value;
  }
  assert(totalValue === 10, 'spawnLoot: small loot total matches');
}

{
  // Large loot
  const mockCaravan = {
    pos: new Vec2(200, 200),
    lootValue: 150,
  };
  const coins = spawnLoot(mockCaravan);
  let totalValue = 0;
  for (const coin of coins) {
    totalValue += coin.value;
  }
  assert(totalValue === 150, 'spawnLoot: large loot total matches');
}

// --- Player death triggers on 0 HP ---
{
  const p = new Player(100, 100);
  p.takeDamage(CONST.PLAYER_MAX_HP);
  assert(!p.alive, 'Player dies when HP reaches 0');
  assert(p.hp === 0, 'Player HP is exactly 0');
}

{
  // Overkill doesn't go negative
  const p = new Player(100, 100);
  p.takeDamage(CONST.PLAYER_MAX_HP + 50);
  assert(p.hp === 0, 'Player HP does not go below 0 on overkill');
}

console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
