// Combat - attack handling, hit detection, damage calculations, and projectiles

import { Vec2, CONST, circlesOverlap } from './utils.js';

// Projectile entity (arrows from archer guards)
export class Projectile {
  constructor(x, y, dirX, dirY, damage) {
    this.pos = new Vec2(x, y);
    this.dir = new Vec2(dirX, dirY).normalize();
    this.vel = this.dir.mul(CONST.PROJECTILE_SPEED);
    this.damage = damage;
    this.radius = CONST.PROJECTILE_RADIUS;
    this.alive = true;
    this.lifetime = CONST.PROJECTILE_LIFETIME;
  }

  update(dt, playerPos, playerRadius) {
    if (!this.alive) return false;

    this.pos = this.pos.add(this.vel.mul(dt));
    this.lifetime -= dt;

    if (this.lifetime <= 0) {
      this.alive = false;
      return false;
    }

    // Check hit against player
    if (circlesOverlap(this.pos.x, this.pos.y, this.radius,
                        playerPos.x, playerPos.y, playerRadius)) {
      this.alive = false;
      return true; // hit player
    }

    return false;
  }

  render(renderer) {
    if (!this.alive) return;
    // Arrow: small brown line in direction of travel
    const tail = this.pos.sub(this.dir.mul(8));
    renderer.line(tail.x, tail.y, this.pos.x, this.pos.y, '#6a4a2a', 2);
    // Arrowhead
    renderer.circle(this.pos.x, this.pos.y, 2, '#4a3a1a');
  }
}

// Calculate damage dealt by attacker to target
// Returns effective damage after armor reduction
export function calcDamage(baseDamage, armor = 0) {
  // Armor reduces damage: effective = base * (100 / (100 + armor))
  const reduction = 100 / (100 + armor);
  return Math.max(1, Math.round(baseDamage * reduction));
}

// Find all entities within attack range of the attacker
// attacker needs: pos, facing, attackRange
// targets is an array of entities with: pos, radius, alive
// Returns array of hit targets
export function findAttackTargets(attacker, targets, attackRange) {
  const hits = [];
  const attackReach = attackRange + attacker.radius;
  const fullArc = !!attacker.fullArcAttack;

  for (const target of targets) {
    if (!target.alive) continue;

    const dist = attacker.pos.dist(target.pos);
    if (dist < attackReach + target.radius) {
      if (fullArc) {
        hits.push(target);
        continue;
      }
      // Check that target is roughly in front of the attacker (180 degree arc)
      const toTarget = target.pos.sub(attacker.pos);
      const dot = toTarget.normalize().dot(attacker.facing);
      // Allow hits in a wide arc in front (dot > -0.3 means roughly 110 degrees each side)
      if (dot > -0.3 || dist < attacker.radius + target.radius) {
        hits.push(target);
      }
    }
  }

  return hits;
}

// Perform a player attack: find targets, apply damage, return hit results
// Returns array of { target, damage } objects
export function performAttack(player, guards, caravans) {
  const results = [];

  // Find guards in range
  const hitGuards = findAttackTargets(player, guards, player.attackRange);
  for (const guard of hitGuards) {
    const dmg = calcDamage(player.damage, guard.armor || 0);
    guard.takeDamage(dmg);
    results.push({ target: guard, damage: dmg, type: 'guard' });
  }

  // Find caravans in range (can attack caravans directly too)
  const hitCaravans = findAttackTargets(player, caravans, player.attackRange);
  for (const caravan of hitCaravans) {
    const dmg = calcDamage(player.damage);
    caravan.takeDamage(dmg);
    results.push({ target: caravan, damage: dmg, type: 'caravan' });
  }

  return results;
}
