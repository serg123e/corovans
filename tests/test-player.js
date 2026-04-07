// Tests for Player class

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

// Mock input that returns a fixed movement direction (normalized like real Input)
function mockInput(mx = 0, my = 0) {
  const len = Math.sqrt(mx * mx + my * my);
  const nx = len > 0 ? mx / len : 0;
  const ny = len > 0 ? my / len : 0;
  return {
    getMovement() { return { x: nx, y: ny }; },
    wasPressed() { return false; },
    wantsAttack() { return false; },
    mouse: { x: 0, y: 0, down: false, clicked: false },
  };
}

// --- Construction ---
{
  const p = new Player(100, 200);
  assert(p.pos.x === 100, 'Player initial pos x');
  assert(p.pos.y === 200, 'Player initial pos y');
  assert(p.hp === CONST.PLAYER_MAX_HP, 'Player initial hp');
  assert(p.gold === 0, 'Player initial gold');
  assert(p.alive === true, 'Player starts alive');
  assert(p.speed === CONST.PLAYER_SPEED, 'Player initial speed');
  assert(p.damage === CONST.PLAYER_BASE_DAMAGE, 'Player initial damage');
}

// --- Movement ---
{
  const p = new Player(500, 500);
  const dt = 1 / 60;
  // Move right for several frames
  for (let i = 0; i < 60; i++) {
    p.update(dt, mockInput(1, 0), CONST.WORLD_W, CONST.WORLD_H);
  }
  assert(p.pos.x > 500, 'Player moved right');
  assert(Math.abs(p.pos.y - 500) < 1, 'Player stayed on y axis');
}

// --- Movement with friction stops ---
{
  const p = new Player(500, 500);
  const dt = 1 / 60;
  // Move right briefly, then release
  for (let i = 0; i < 10; i++) {
    p.update(dt, mockInput(1, 0), CONST.WORLD_W, CONST.WORLD_H);
  }
  const posAfterMove = p.pos.x;
  // Let friction slow us down
  for (let i = 0; i < 120; i++) {
    p.update(dt, mockInput(0, 0), CONST.WORLD_W, CONST.WORLD_H);
  }
  assert(p.vel.lenSq() < 1, 'Player velocity near zero after friction');
}

// --- Diagonal movement is normalized ---
{
  const p1 = new Player(500, 500);
  const p2 = new Player(500, 500);
  const dt = 1 / 60;
  // Move right only
  for (let i = 0; i < 30; i++) {
    p1.update(dt, mockInput(1, 0), CONST.WORLD_W, CONST.WORLD_H);
  }
  // Move diagonally
  for (let i = 0; i < 30; i++) {
    p2.update(dt, mockInput(1, 1), CONST.WORLD_W, CONST.WORLD_H);
  }
  // Diagonal total distance should be similar to straight (due to normalization)
  const dist1 = p1.pos.dist(new Vec2(500, 500));
  const dist2 = p2.pos.dist(new Vec2(500, 500));
  assert(Math.abs(dist1 - dist2) < dist1 * 0.2, 'Diagonal movement similar speed to straight');
}

// --- World boundary clamping ---
{
  const p = new Player(10, 10);
  const dt = 1 / 60;
  // Move left/up into the wall
  for (let i = 0; i < 120; i++) {
    p.update(dt, mockInput(-1, -1), 800, 600);
  }
  assert(p.pos.x >= p.radius, 'Player clamped to left boundary');
  assert(p.pos.y >= p.radius, 'Player clamped to top boundary');
}

{
  const p = new Player(790, 590);
  const dt = 1 / 60;
  // Move right/down into the wall
  for (let i = 0; i < 120; i++) {
    p.update(dt, mockInput(1, 1), 800, 600);
  }
  assert(p.pos.x <= 800 - p.radius, 'Player clamped to right boundary');
  assert(p.pos.y <= 600 - p.radius, 'Player clamped to bottom boundary');
}

// --- Facing direction ---
{
  const p = new Player(500, 500);
  const dt = 1 / 60;
  p.update(dt, mockInput(-1, 0), CONST.WORLD_W, CONST.WORLD_H);
  assert(p.facing.x < 0, 'Player faces left when moving left');

  p.update(dt, mockInput(1, 0), CONST.WORLD_W, CONST.WORLD_H);
  assert(p.facing.x > 0, 'Player faces right when moving right');

  p.update(dt, mockInput(0, -1), CONST.WORLD_W, CONST.WORLD_H);
  assert(p.facing.y < 0, 'Player faces up when moving up');
}

// --- Animation state ---
{
  const p = new Player(500, 500);
  const dt = 1 / 60;
  // Start idle
  p.update(dt, mockInput(0, 0), CONST.WORLD_W, CONST.WORLD_H);
  assert(p.anim === 'idle', 'Player idle when not moving');

  // Move to trigger walk
  for (let i = 0; i < 10; i++) {
    p.update(dt, mockInput(1, 0), CONST.WORLD_W, CONST.WORLD_H);
  }
  assert(p.anim === 'walk', 'Player walks when moving');

  // Stop and wait for velocity to decay
  for (let i = 0; i < 120; i++) {
    p.update(dt, mockInput(0, 0), CONST.WORLD_W, CONST.WORLD_H);
  }
  assert(p.anim === 'idle', 'Player returns to idle when stopped');
}

// --- Damage ---
{
  const p = new Player(100, 100);
  p.takeDamage(30);
  assert(p.hp === CONST.PLAYER_MAX_HP - 30, 'Player takes damage');
  assert(p.alive === true, 'Player alive after partial damage');

  p.takeDamage(p.hp);
  assert(p.hp === 0, 'Player HP goes to zero');
  assert(p.alive === false, 'Player dies at 0 hp');
}

// --- Damage doesn't go below 0 ---
{
  const p = new Player(100, 100);
  p.takeDamage(9999);
  assert(p.hp === 0, 'Player HP doesn\'t go below 0');
  assert(p.alive === false, 'Player dead after massive damage');
}

// --- Dead player doesn't update ---
{
  const p = new Player(500, 500);
  p.takeDamage(9999);
  const oldX = p.pos.x;
  p.update(1 / 60, mockInput(1, 0), CONST.WORLD_W, CONST.WORLD_H);
  assert(p.pos.x === oldX, 'Dead player doesn\'t move');
}

// --- Healing ---
{
  const p = new Player(100, 100);
  p.takeDamage(50);
  p.heal(20);
  assert(p.hp === CONST.PLAYER_MAX_HP - 30, 'Player heals');

  p.heal(9999);
  assert(p.hp === CONST.PLAYER_MAX_HP, 'Player hp capped at max');
}

// --- Gold ---
{
  const p = new Player(100, 100);
  p.addGold(50);
  assert(p.gold === 50, 'Player gains gold');
  p.addGold(30);
  assert(p.gold === 80, 'Player accumulates gold');
}

// --- Reset ---
{
  const p = new Player(100, 100);
  p.takeDamage(50);
  p.addGold(100);
  p.vel = new Vec2(100, 50);
  p.reset(500, 300);
  assert(p.pos.x === 500, 'Reset position x');
  assert(p.pos.y === 300, 'Reset position y');
  assert(p.hp === p.maxHp, 'Reset restores hp');
  assert(p.alive === true, 'Reset restores alive');
  assert(p.vel.x === 0, 'Reset clears velocity x');
  assert(p.vel.y === 0, 'Reset clears velocity y');
}

// --- Attack cooldown ticks down ---
{
  const p = new Player(100, 100);
  p.attackTimer = 0.5;
  p.update(1 / 60, mockInput(0, 0), CONST.WORLD_W, CONST.WORLD_H);
  assert(p.attackTimer < 0.5, 'Attack timer decreases');
}

console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
