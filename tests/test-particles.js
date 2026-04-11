// Tests for particle system

import { Particle, SlashEffect, spawnDust, spawnHitSparks, spawnGoldSparkle, spawnDeathBurst, spawnSlash, updateParticles } from '../js/particles.js';

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

// --- Particle construction ---
{
  const p = new Particle(10, 20, 30, -40, '#fff', 1.0, 3, 50);
  assert(p.pos.x === 10, 'Particle x position');
  assert(p.pos.y === 20, 'Particle y position');
  assert(p.vel.x === 30, 'Particle vel x');
  assert(p.vel.y === -40, 'Particle vel y');
  assert(p.color === '#fff', 'Particle color');
  assert(p.life === 1.0, 'Particle life');
  assert(p.maxLife === 1.0, 'Particle maxLife');
  assert(p.size === 3, 'Particle size');
  assert(p.gravity === 50, 'Particle gravity');
  assert(p.alive === true, 'Particle alive initially');
}

// --- Particle update ---
{
  const p = new Particle(0, 0, 100, 0, '#fff', 1.0, 2, 0);
  p.update(0.5);
  assertApprox(p.pos.x, 50, 'Particle moves in x after 0.5s at 100/s');
  assertApprox(p.pos.y, 0, 'Particle stays at y=0 with no gravity');
  assertApprox(p.life, 0.5, 'Particle life decreases');
  assert(p.alive, 'Particle still alive at 0.5s with 1s life');
}

{
  const p = new Particle(0, 0, 0, 0, '#fff', 0.3);
  p.update(0.5);
  assert(!p.alive, 'Particle dies when life runs out');
}

// --- Gravity ---
{
  const p = new Particle(0, 0, 0, 0, '#fff', 2.0, 2, 100);
  p.update(1.0);
  // After 1s with gravity 100: vel.y should be 100, pos.y = 0 + 100*1 = 100
  assertApprox(p.vel.y, 100, 'Gravity adds to vel.y');
  assertApprox(p.pos.y, 100, 'Gravity moves particle down');
}

// --- Dead particle doesn't update ---
{
  const p = new Particle(10, 10, 100, 100, '#fff', 0);
  p.alive = false;
  p.update(1.0);
  assert(p.pos.x === 10, 'Dead particle does not move x');
  assert(p.pos.y === 10, 'Dead particle does not move y');
}

// --- spawnDust ---
{
  const particles = [];
  spawnDust(particles, 100, 200, 50, 0);
  assert(particles.length >= 1, 'spawnDust creates at least 1 particle');
  assert(particles.length <= 3, 'spawnDust creates at most 3 particles');
  for (const p of particles) {
    assert(p instanceof Particle, 'spawnDust creates Particle instances');
    assert(p.alive, 'Dust particles start alive');
    assert(p.life > 0, 'Dust particles have positive life');
    assert(p.gravity > 0, 'Dust particles have gravity');
  }
}

// --- spawnHitSparks ---
{
  const particles = [];
  spawnHitSparks(particles, 50, 50);
  assert(particles.length >= 5, 'spawnHitSparks creates at least 5 particles');
  assert(particles.length <= 9, 'spawnHitSparks creates at most 9 particles');
  for (const p of particles) {
    assert(p instanceof Particle, 'Spark is a Particle');
    assert(p.alive, 'Spark starts alive');
    // Sparks should have some velocity
    assert(p.vel.x !== 0 || p.vel.y !== 0, 'Sparks have velocity');
  }
}

// --- spawnGoldSparkle ---
{
  const particles = [];
  spawnGoldSparkle(particles, 80, 80);
  assert(particles.length >= 6, 'spawnGoldSparkle creates at least 6 particles');
  assert(particles.length <= 10, 'spawnGoldSparkle creates at most 10 particles');
  for (const p of particles) {
    assert(p instanceof Particle, 'Gold sparkle is a Particle');
    assert(p.gravity > 0, 'Gold sparkle has gravity');
  }
}

// --- spawnDeathBurst ---
{
  const particles = [];
  spawnDeathBurst(particles, 0, 0);
  assert(particles.length >= 8, 'spawnDeathBurst creates at least 8 particles');
  assert(particles.length <= 13, 'spawnDeathBurst creates at most 13 particles');
}

// --- updateParticles removes dead ---
{
  const particles = [
    new Particle(0, 0, 0, 0, '#fff', 0.1),
    new Particle(0, 0, 0, 0, '#fff', 2.0),
    new Particle(0, 0, 0, 0, '#fff', 0.05),
  ];
  updateParticles(particles, 0.2);
  assert(particles.length === 1, 'updateParticles removes dead particles');
  assert(particles[0].alive, 'Remaining particle is alive');
}

// --- Multiple update cycles ---
{
  const particles = [];
  spawnDust(particles, 100, 100, 50, 50);
  const initialCount = particles.length;
  // Update many times until all die
  for (let i = 0; i < 100; i++) {
    updateParticles(particles, 0.02);
  }
  assert(particles.length === 0, 'All dust particles die after enough time');
}

// --- Particle colors from spawners ---
{
  const dustP = [];
  spawnDust(dustP, 0, 0, 0, 0);
  for (const p of dustP) {
    assert(p.color === '#c4a25e' || p.color === '#d4b46c', 'Dust has sand-like color');
  }
}

{
  const sparkP = [];
  spawnHitSparks(sparkP, 0, 0);
  for (const p of sparkP) {
    assert(p.color === '#fff' || p.color === '#ffcc00', 'Hit spark has white or yellow color');
  }
}

{
  const goldP = [];
  spawnGoldSparkle(goldP, 0, 0);
  for (const p of goldP) {
    assert(p.color === '#ffd700' || p.color === '#ffee66', 'Gold sparkle has gold-like color');
  }
}

{
  const deathP = [];
  spawnDeathBurst(deathP, 0, 0);
  for (const p of deathP) {
    assert(p.color === '#884444' || p.color === '#aa5555', 'Death burst has dark red color');
  }
}

// --- Particle initial position from spawn point ---
{
  const particles = [];
  spawnHitSparks(particles, 500, 300);
  for (const p of particles) {
    assertApprox(p.pos.x, 500, 'Hit spark spawns at given x', 1);
    assertApprox(p.pos.y, 300, 'Hit spark spawns at given y', 1);
  }
}

// --- Zero life particle ---
{
  const p = new Particle(0, 0, 0, 0, '#fff', 0);
  p.update(0.01);
  assert(!p.alive, 'Zero-life particle dies on first update');
}

// --- Negative velocity ---
{
  const p = new Particle(50, 50, -100, -200, '#fff', 1.0);
  p.update(0.1);
  assertApprox(p.pos.x, 40, 'Negative vel x moves left');
  assertApprox(p.pos.y, 30, 'Negative vel y moves up');
}

// --- SlashEffect ---
{
  const particles = [];
  spawnSlash(particles, 100, 200, 1, 0, 40);
  assert(particles.length === 1, 'spawnSlash pushes exactly one effect');
  const slash = particles[0];
  assert(slash instanceof SlashEffect, 'spawnSlash creates a SlashEffect');
  assert(slash.alive, 'Slash starts alive');
  assert(slash.x === 100 && slash.y === 200, 'Slash stores origin');
  assertApprox(slash.angle, 0, 'Slash angle matches facing right');
  assert(slash.reach === 40, 'Slash stores reach');
  assert(slash.life > 0 && slash.life === slash.maxLife, 'Slash life initialized');
}

{
  // Slash lives through updateParticles and dies when its life runs out
  const particles = [];
  spawnSlash(particles, 0, 0, 0, 1, 30);
  updateParticles(particles, 0.01);
  assert(particles.length === 1, 'Slash survives short tick');
  updateParticles(particles, 1.0);
  assert(particles.length === 0, 'Slash removed after long tick');
}

// Summary
console.log(`\nParticle tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
