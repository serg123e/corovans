// Particles - particle system with emitters, gravity, and fade

import { Vec2, randRange } from './utils.js';

export class Particle {
  constructor(x, y, vx, vy, color, life, size = 2, gravity = 0) {
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(vx, vy);
    this.color = color;
    this.life = life;
    this.maxLife = life;
    this.size = size;
    this.gravity = gravity;
    this.alive = true;
  }

  update(dt) {
    if (!this.alive) return;
    this.vel.y += this.gravity * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.life -= dt;
    if (this.life <= 0) {
      this.alive = false;
    }
  }

  render(renderer) {
    if (!this.alive) return;
    const alpha = Math.max(0, this.life / this.maxLife);
    const currentSize = this.size * (0.3 + 0.7 * alpha);
    renderer.setAlpha(alpha);
    renderer.rect(
      Math.round(this.pos.x - currentSize / 2),
      Math.round(this.pos.y - currentSize / 2),
      Math.ceil(currentSize),
      Math.ceil(currentSize),
      this.color
    );
    renderer.resetAlpha();
  }
}

// Spawn dust particles behind a moving entity
export function spawnDust(particles, x, y, velX, velY) {
  const count = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    const px = x + randRange(-4, 4);
    const py = y + randRange(2, 6); // below feet
    const vx = -velX * 0.1 + randRange(-15, 15);
    const vy = randRange(-20, -5);
    const color = Math.random() < 0.5 ? '#c4a25e' : '#d4b46c';
    const life = randRange(0.2, 0.5);
    particles.push(new Particle(px, py, vx, vy, color, life, randRange(2, 4), 30));
  }
}

// Spark particles on melee hit
export function spawnHitSparks(particles, x, y) {
  const count = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const angle = randRange(0, Math.PI * 2);
    const speed = randRange(60, 160);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const color = Math.random() < 0.5 ? '#fff' : '#ffcc00';
    const life = randRange(0.15, 0.35);
    particles.push(new Particle(x, y, vx, vy, color, life, randRange(2, 4)));
  }
}

// Gold sparkle on loot pickup
export function spawnGoldSparkle(particles, x, y) {
  const count = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const angle = randRange(0, Math.PI * 2);
    const speed = randRange(30, 80);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed - 30;
    const color = Math.random() < 0.6 ? '#ffd700' : '#ffee66';
    const life = randRange(0.3, 0.6);
    particles.push(new Particle(x, y, vx, vy, color, life, randRange(2, 3), 40));
  }
}

// Blood/death particles when guard dies
export function spawnDeathBurst(particles, x, y) {
  const count = 8 + Math.floor(Math.random() * 5);
  for (let i = 0; i < count; i++) {
    const angle = randRange(0, Math.PI * 2);
    const speed = randRange(40, 120);
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const color = Math.random() < 0.5 ? '#884444' : '#aa5555';
    const life = randRange(0.3, 0.7);
    particles.push(new Particle(x, y, vx, vy, color, life, randRange(2, 5), 60));
  }
}

// Update all particles, remove dead ones
export function updateParticles(particles, dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update(dt);
    if (!particles[i].alive) {
      particles.splice(i, 1);
    }
  }
}

// Render all particles
export function renderParticles(particles, renderer) {
  for (const p of particles) {
    p.render(renderer);
  }
}
