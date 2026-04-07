// Combat - attack handling, hit detection, and damage calculations

import { Vec2, CONST, circlesOverlap } from './utils.js';

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

  for (const target of targets) {
    if (!target.alive) continue;

    const dist = attacker.pos.dist(target.pos);
    if (dist < attackReach + target.radius) {
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
    const dmg = calcDamage(player.damage);
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
