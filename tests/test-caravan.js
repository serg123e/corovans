// Tests for Caravan, Guard, and wave spawning

import { Caravan, CaravanType, Guard, spawnWave, resolveGuardCollisions } from '../js/caravan.js';
import { Vec2, CONST } from '../js/utils.js';
import { World } from '../js/world.js';

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

function assertApprox(a, b, message, epsilon = 1) {
  assert(Math.abs(a - b) < epsilon, `${message} (expected ${b}, got ${a})`);
}

// --- Mock World ---
// Minimal world with a straight road from left to right
class MockWorld {
  constructor() {
    this.width = 800;
    this.height = 600;
  }

  getRoadPosition(t) {
    // Simple straight road across the middle
    return { x: t * this.width, y: this.height / 2 };
  }

  getRoadDirection(t) {
    return { x: 1, y: 0 };
  }
}

// --- Caravan construction ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  assert(c.type === 'donkey', 'Caravan type is donkey');
  assert(c.alive === true, 'Caravan starts alive');
  assert(c.hp > 0, 'Caravan has health');
  assert(c.lootValue > 0, 'Caravan has loot value');
  assert(c.speed === CONST.DONKEY_SPEED, 'Donkey speed matches constant');
}

{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.WAGON, world);
  assert(c.type === 'wagon', 'Wagon type');
  assert(c.speed === CONST.WAGON_SPEED, 'Wagon speed matches constant');
}

{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.ROYAL, world);
  assert(c.type === 'royal', 'Royal type');
  assert(c.speed === CONST.ROYAL_SPEED, 'Royal speed matches constant');
  assert(c.lootValue >= 80, 'Royal has high loot value');
}

// --- Caravan path following ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pathT = 0.1;
  const startPos = world.getRoadPosition(0.1);
  c.pos.x = startPos.x;
  c.pos.y = startPos.y;
  const startX = c.pos.x;

  // Update several frames
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    c.update(dt, new Vec2(400, 300));
  }

  assert(c.pos.x > startX, 'Caravan moved forward along road');
  assert(c.alive, 'Caravan still alive mid-path');
}

// --- Caravan escapes at end of road ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pathT = 0.99;
  c.speed = 10000; // very fast

  c.update(1, new Vec2(400, 300));
  assert(!c.alive, 'Caravan dies when reaching end of road');
  assert(c.looted === true, 'Escaped caravan is marked looted');
}

// --- Caravan takes damage ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.WAGON, world);
  const initialHp = c.hp;

  c.takeDamage(20);
  assert(c.hp === initialHp - 20, 'Caravan takes damage');
  assert(c.alive, 'Caravan still alive after partial damage');

  c.takeDamage(9999);
  assert(c.hp === 0, 'Caravan HP goes to 0');
  assert(!c.alive, 'Caravan dies');
}

// --- Guard construction ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  const g = new Guard(100, 200, c);

  assert(g.pos.x === 100, 'Guard initial x');
  assert(g.pos.y === 200, 'Guard initial y');
  assert(g.alive === true, 'Guard starts alive');
  assert(g.hp > 0, 'Guard has health');
  assert(g.damage > 0, 'Guard has damage');
  assert(g.state === 'patrol', 'Guard starts in patrol state');
}

// --- Guard patrol state (stays near caravan) ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(400, 300);
  const g = new Guard(400, 300, c);

  // Player far away
  const playerPos = new Vec2(1000, 1000);
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    g.update(dt, playerPos);
  }

  assert(g.state === 'patrol', 'Guard stays in patrol when player is far');
  // Guard should stay near caravan
  const distToCaravan = g.pos.dist(c.pos);
  assert(distToCaravan < 80, 'Guard stays near caravan during patrol');
}

// --- Guard chases player when close ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(400, 300);
  const g = new Guard(400, 300, c);
  c.guards.push(g);

  // Player within detection range
  const playerPos = new Vec2(400 + CONST.GUARD_DETECTION_RANGE - 10, 300);
  g.update(1 / 60, playerPos);

  assert(g.state === 'chase', 'Guard chases when player in detection range');
}

// --- Alert propagation: one guard spotting player triggers all siblings ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(400, 300);
  const near = new Guard(400, 300, c);
  const far = new Guard(200, 300, c);
  c.guards.push(near, far);

  const playerPos = new Vec2(400 + CONST.GUARD_DETECTION_RANGE - 10, 300);
  near.update(1 / 60, playerPos);

  assert(near.state === 'chase', 'Alert: spotter enters chase');
  assert(far.state === 'chase', 'Alert: distant sibling also enters chase');
}

// --- Guard moves toward player during chase ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(400, 300);
  const g = new Guard(400, 300, c);

  const playerPos = new Vec2(500, 300); // within detection range
  g.state = 'chase'; // force chase state

  const startDist = g.pos.dist(playerPos);
  const dt = 1 / 60;
  for (let i = 0; i < 30; i++) {
    g.update(dt, playerPos);
  }

  const endDist = g.pos.dist(playerPos);
  assert(endDist < startDist, 'Guard moves closer to player during chase');
}

// --- Melee guard chases directly to the player position ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(400, 300);
  const g = new Guard(420, 300, c);
  g.state = 'chase';

  const playerPos = new Vec2(500, 300);
  const dt = 1 / 60;
  // Run long enough to reach the player.
  for (let i = 0; i < 300; i++) {
    g.update(dt, playerPos);
  }

  const finalDist = g.pos.dist(playerPos);
  const attackReach = CONST.GUARD_ATTACK_RANGE + CONST.PLAYER_RADIUS;
  assert(finalDist < attackReach, 'Guard reaches attack range');
}

// --- Guard keeps chasing even when its caravan is destroyed ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(400, 300);
  const g = new Guard(400, 300, c);

  // Kill the caravan. Put the player far away (beyond normal chase range).
  c.alive = false;
  const playerPos = new Vec2(400 + CONST.GUARD_CHASE_RANGE + 200, 300);

  const startDist = g.pos.dist(playerPos);
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) {
    g.update(dt, playerPos);
  }

  assert(g.state === 'chase', 'Guard stays in chase after its caravan dies');
  assert(g.pos.dist(playerPos) < startDist, 'Guard closes distance to player even without a caravan');
}

// --- Guard returns when player is too far ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(400, 300);
  const g = new Guard(400, 300, c);
  g.state = 'chase';

  // Player way beyond chase range from the guard
  const playerPos = new Vec2(400 + CONST.GUARD_CHASE_RANGE + 100, 300);

  g.update(1 / 60, playerPos);
  assert(g.state === 'return', 'Guard returns when player exceeds chase range');
}

// --- Guard returns to caravan in return state ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(400, 300);
  const g = new Guard(300, 300, c); // start 100 units from caravan
  g.state = 'return';

  const dt = 1 / 60;
  const playerPos = new Vec2(1000, 1000); // far away
  for (let i = 0; i < 180; i++) {
    g.update(dt, playerPos);
  }

  const distToCaravan = g.pos.dist(c.pos);
  assert(distToCaravan < 40, 'Guard returns near caravan');
  assert(g.state === 'patrol', 'Guard resumes patrol after return');
}

// --- Guard can attack ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  const g = new Guard(100, 100, c);

  // Player right next to guard
  const closePlayer = new Vec2(100 + CONST.GUARD_ATTACK_RANGE, 100);
  assert(g.canAttack(closePlayer), 'Guard can attack close player');

  // Player far
  const farPlayer = new Vec2(500, 500);
  assert(!g.canAttack(farPlayer), 'Guard cannot attack far player');

  // After attacking, cooldown prevents another
  g.attack();
  assert(!g.canAttack(closePlayer), 'Guard cannot attack during cooldown');
}

// --- Guard takes damage and dies ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  const g = new Guard(100, 100, c);

  g.takeDamage(20);
  assert(g.hp === g.maxHp - 20, 'Guard takes damage');
  assert(g.alive, 'Guard alive after partial damage');

  g.takeDamage(9999);
  assert(g.hp === 0, 'Guard HP goes to 0');
  assert(!g.alive, 'Guard dies');
}

// --- Dead guard does not update ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  const g = new Guard(100, 100, c);
  g.takeDamage(9999);

  const oldX = g.pos.x;
  g.update(1 / 60, new Vec2(110, 100));
  assert(g.pos.x === oldX, 'Dead guard does not move');
}

// --- Caravan spawns guards ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.WAGON, world);
  const guards = c.spawnGuards();

  assert(guards.length === 2, 'Wagon spawns 2 guards');
  assert(guards[0] instanceof Guard, 'Spawned entities are Guards');
  assert(guards[0].caravan === c, 'Guards reference their caravan');
}

{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.ROYAL, world);
  const guards = c.spawnGuards();
  assert(guards.length === 3, 'Royal spawns 3 guards');
}

// --- Wave spawning ---
{
  const world = new MockWorld();
  const caravans = spawnWave(1, world);
  assert(caravans.length >= 1, 'Wave 1 spawns at least 1 caravan');
  assert(caravans.every(c => c instanceof Caravan), 'All spawned entities are Caravans');
}

{
  const world = new MockWorld();
  const wave5 = spawnWave(5, world);
  const wave1 = spawnWave(1, world);
  assert(wave5.length >= wave1.length, 'Later waves have more or equal caravans');
}

// --- Wave scaling: higher waves have more caravans ---
{
  const world = new MockWorld();
  const wave10 = spawnWave(10, world);
  assert(wave10.length >= 3, 'Wave 10 has at least 3 caravans');
}

// --- Caravans have staggered positions ---
{
  const world = new MockWorld();
  const caravans = spawnWave(3, world);
  if (caravans.length >= 2) {
    const dist = caravans[0].pos.dist(caravans[1].pos);
    assert(dist > 20, 'Caravans have staggered start positions');
  }
}

// --- resolveGuardCollisions separates overlapping guards ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(0, 0);
  c.alive = false; // disable caravan-vs-guard push so only the guard pass runs
  const g1 = new Guard(100, 100, c);
  const g2 = new Guard(105, 100, c); // clearly inside g1 + g2 radius sum

  const before = g1.pos.dist(g2.pos);
  resolveGuardCollisions([g1, g2], [c]);
  const after = g1.pos.dist(g2.pos);
  const minDist = g1.radius + g2.radius;
  assert(before < minDist, 'Setup: guards start overlapping');
  assertApprox(after, minDist, 'Guards separated to exactly radius sum');
}

// --- resolveGuardCollisions pushes guard out of its caravan ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.WAGON, world);
  c.pos = new Vec2(200, 200);
  const g = new Guard(200, 200, c); // dead center
  g.pos = new Vec2(200, 200);

  resolveGuardCollisions([g], [c]);
  const dist = g.pos.dist(c.pos);
  assert(dist >= g.radius + c.radius - 0.1, 'Guard pushed out of caravan body');
}

// --- resolveGuardCollisions skips dead guards and caravans ---
{
  const world = new MockWorld();
  const c = new Caravan(CaravanType.DONKEY, world);
  c.pos = new Vec2(0, 0);
  c.alive = false;
  const g1 = new Guard(100, 100, c);
  const g2 = new Guard(100, 100, c);
  g1.alive = false;

  const p1 = new Vec2(g1.pos.x, g1.pos.y);
  const p2 = new Vec2(g2.pos.x, g2.pos.y);
  resolveGuardCollisions([g1, g2], [c]);
  assert(g1.pos.x === p1.x && g1.pos.y === p1.y, 'Dead guard is not moved');
  assert(g2.pos.x === p2.x && g2.pos.y === p2.y, 'Guard paired with dead guard is not moved');
}

// --- Summary ---
console.log(`\nTests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  process.exit(1);
}
