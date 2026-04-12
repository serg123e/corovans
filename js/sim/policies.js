// Policies - AI decision modules for the headless simulator.
//
// Each policy exposes two methods:
//
//   decidePlaying(view) → { moveX, moveY, attack, dash }
//     Called every tick while the player is alive and a wave is running.
//     Must return a movement vector (will be normalized by SimInput) plus
//     `attack`/`dash` booleans. The simulator decides when those fire
//     (e.g. attack only if cooldown allows).
//
//   decideShop(view) → { action, index? }
//     Called once when the wave-end free draft opens.
//     Supported actions: 'pick' (with index), 'reroll', 'skip'.
//
// The view object is a plain read-only snapshot the simulator builds each
// tick. Policies should not mutate it or hold references to entity
// instances across ticks.

import { randFn } from '../rng.js';

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestAlive(from, list) {
  let best = null;
  let bestD = Infinity;
  for (const e of list) {
    if (!e.alive) continue;
    const d = dist(from, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best ? { entity: best, distance: bestD } : null;
}

// Base class so custom policies can compose over shared helpers.
export class AIPolicy {
  constructor(name = 'base') {
    this.name = name;
  }
  decidePlaying(/* view */) {
    return { moveX: 0, moveY: 0, attack: false, dash: false };
  }
  decideShop(view) {
    if (!view.offer || view.offer.length === 0) return { action: 'skip' };
    // Pick the cheapest affordable card, or skip if broke.
    const costs = view.costs || [];
    let best = -1;
    for (let i = 0; i < view.offer.length; i++) {
      if ((costs[i] || 0) <= view.gold) { best = i; break; }
    }
    return best >= 0 ? { action: 'pick', index: best } : { action: 'skip' };
  }
}

// GreedyPolicy
//
// Priority:
//   1. If a guard is within `aggroRange`, kill it first.
//   2. Otherwise chase the nearest alive caravan.
//   3. Attack whenever target is inside melee reach.
//   4. Dash toward target if far and dash is off cooldown.
//   5. Always pick the first offered card.
//
// Deliberately dumb — we want a reproducible baseline for balance
// comparisons across builds. Smart heuristics belong in a separate policy.
export class GreedyPolicy extends AIPolicy {
  constructor(options = {}) {
    super(options.name || 'greedy');
    this.aggroRange = options.aggroRange ?? 220;
    this.dashDistance = options.dashDistance ?? 240;
    this.cardPick = options.cardPick || 'first'; // 'first' | 'random'
  }

  decidePlaying(view) {
    const p = view.player;

    // Priority order:
    //   1. Nearby guards (they hit us if we don't deal with them)
    //   2. Any alive caravan
    //   3. Remaining guards anywhere on the map
    //   4. Uncollected loot (so the wave can actually end)
    const nearestGuard = nearestAlive(p.pos, view.guards);
    const nearestCaravan = nearestAlive(p.pos, view.caravans);

    let target = null;
    let isLoot = false;
    if (nearestGuard && nearestGuard.distance < this.aggroRange) {
      target = nearestGuard;
    } else if (nearestCaravan) {
      target = nearestCaravan;
    } else if (nearestGuard) {
      target = nearestGuard;
    } else {
      // Nothing to fight — walk over to the nearest coin. `alive` on loot
      // means "not yet collected" so nearestAlive works directly.
      const loot = nearestAlive(p.pos, view.loots);
      if (loot) {
        target = loot;
        isLoot = true;
      }
    }

    if (!target) {
      return { moveX: 0, moveY: 0, attack: false, dash: false };
    }

    const dx = target.entity.pos.x - p.pos.x;
    const dy = target.entity.pos.y - p.pos.y;
    const d = target.distance;

    // Loot doesn't need swinging — just walk into it and let the magnet
    // pull it in. Otherwise, melee reach = attack.
    if (!isLoot) {
      const reach = p.radius + p.attackRange + (target.entity.radius || 12);
      if (d < reach * 0.95) {
        return { moveX: 0, moveY: 0, attack: true, dash: false };
      }
    }

    // Far away and dash is ready — close the gap quickly.
    const dash = !isLoot && d > this.dashDistance && p.dashCooldownTimer <= 0;

    return {
      moveX: d > 0 ? dx / d : 0,
      moveY: d > 0 ? dy / d : 0,
      attack: false,
      dash,
    };
  }

  decideShop(view) {
    if (!view.offer || view.offer.length === 0) return { action: 'skip' };
    const costs = view.costs || [];
    // Filter to affordable cards only.
    const affordable = [];
    for (let i = 0; i < view.offer.length; i++) {
      if ((costs[i] || 0) <= view.gold) affordable.push(i);
    }
    if (affordable.length === 0) return { action: 'skip' };
    let idx = affordable[0];
    if (this.cardPick === 'random') {
      const rand = randFn(view.rng);
      idx = affordable[Math.floor(rand() * affordable.length)];
    }
    return { action: 'pick', index: idx };
  }
}

// RandomCardPolicy — same movement as greedy, but randomly picks among
// the 5 offered cards. Useful for aggregate "which card tends to survive
// longer" analysis: run a batch, group by picked card id, compare
// median wave reached.
export class RandomCardPolicy extends GreedyPolicy {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'random-cards', cardPick: 'random' });
  }
}

// PreferencePolicy — greedy movement plus a ranked card whitelist/blacklist.
//
// Construction:
//   new PreferencePolicy({ prefer: ['thorns','lifesteal'], avoid: ['glassCannon'] })
//
// Shop logic (in priority order):
//   1. Walk through `prefer` list. Return the first card that shows up in
//      the current offer AND isn't in `avoid`.
//   2. Otherwise pick the first offered card that isn't in `avoid`.
//   3. If everything is forbidden, skip the draft.
//
// This is the primary tool for balance experiments: force a specific
// build and see how far it reaches vs. a control run that excludes the
// same card.
export class PreferencePolicy extends GreedyPolicy {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'preference' });
    this.prefer = options.prefer || [];
    this.avoid = new Set(options.avoid || []);
  }

  decideShop(view) {
    if (!view.offer || view.offer.length === 0) return { action: 'skip' };
    const costs = view.costs || [];
    const canAfford = (i) => (costs[i] || 0) <= view.gold;
    // 1. Highest-ranked preferred card present and affordable.
    for (const id of this.prefer) {
      if (this.avoid.has(id)) continue;
      const idx = view.offer.findIndex((c, i) => c.id === id && canAfford(i));
      if (idx >= 0) return { action: 'pick', index: idx };
    }
    // 2. First non-forbidden affordable card.
    const idx = view.offer.findIndex((c, i) => !this.avoid.has(c.id) && canAfford(i));
    if (idx >= 0) return { action: 'pick', index: idx };
    // 3. Nothing affordable or everything forbidden — skip.
    return { action: 'skip' };
  }
}

// SmartPolicy — greedy baseline that actually reaches late-game waves.
//
// Why it exists: plain GreedyPolicy dies on wave 4 (median), which collapses
// any late-game balance signal into noise. SmartPolicy layers four cheap
// heuristics on top so the same batch touches wave 10+ when card luck is
// reasonable. It's deliberately not optimal — just "a player who can see".
//
// Decision order per tick (first hit wins):
//   1. Arrow dodge. If a projectile is within ~90px and aimed at us,
//      sidestep perpendicular to its direction (dashes when ready).
//   2. Low HP retreat. Below `lowHpPct` of max HP, kite away from the
//      nearest guard and dash out if they're close.
//   3. Threat-weighted engage. Pick the most dangerous guard in aggro
//      range (archer > armored > basic, weighted by distance) instead of
//      the absolute nearest. Falls back to nearest caravan, then loot.
//   4. Strafe melee. In the neutral HP band, keep moving perpendicular
//      while swinging so melee guards can't stack hits.
//
// Shop: takes a small whitelist of sustain/offense cards in priority
// order and falls back to index 0 if none are offered.
export class SmartPolicy extends AIPolicy {
  constructor(options = {}) {
    super(options.name || 'smart');
    this.aggroRange = options.aggroRange ?? 260;
    this.dashDistance = options.dashDistance ?? 240;
    // HP bands (fractions of maxHp):
    //   [0 .. lowHpPct)   — retreat and kite
    //   [lowHpPct .. medHpPct) — strafe-attack melee guards (move + swing)
    //   [medHpPct .. 1]   — stand-and-swing
    // Retreating above lowHpPct hurts median wave (lost caravan income);
    // standing still below medHpPct makes melee trades lose HP faster.
    this.lowHpPct = options.lowHpPct ?? 0.3;
    this.medHpPct = options.medHpPct ?? 0.7;
    // HP threshold for arrow dodging. Above this fraction the AI ignores
    // incoming arrows and charges through — prevents infinite kiting of
    // archer clusters at full HP.
    this.arrowDodgeHpPct = options.arrowDodgeHpPct ?? 0.7;
    // Arrow dodge window. At PROJECTILE_SPEED=200, 90px ≈ 0.45s of
    // reaction time before the hit lands — enough room to dash or step.
    this.projectileWarnDist = options.projectileWarnDist ?? 90;
    this.projectileWarnTime = options.projectileWarnTime ?? 0.45;
    // Card priority. Sustain first, then offense, then mobility — picked
    // so the policy has a chance to heal between fights instead of
    // stacking glass cannon.
    this.preferCards = options.prefer || [
      'lifesteal', 'regen', 'maxHp', 'damage', 'thorns', 'dashCooldown', 'attackRange',
    ];
  }

  decidePlaying(view) {
    const p = view.player;
    const hpPct = p.maxHp > 0 ? p.hp / p.maxHp : 1;

    const threatGuard = this._mostThreateningGuard(p, view.guards);

    // 1. Arrow dodge — sidestep perpendicular to an incoming arrow; dash
    // when ready. But only below the confident HP threshold — at high HP
    // it's better to tank the ~6 damage and keep closing the gap rather
    // than endlessly kiting a cluster of archers.
    const incoming = this._incomingProjectile(view.projectiles, p);
    if (incoming && hpPct < this.arrowDodgeHpPct) {
      const perpX = -incoming.dir.y;
      const perpY = incoming.dir.x;
      const canDash = p.dashCooldownTimer <= 0;
      const melee = this._meleeTargetInReach(p, view.guards, view.caravans);
      return {
        moveX: perpX,
        moveY: perpY,
        attack: !!melee,
        dash: canDash,
      };
    }

    // 2. Retreat mode — kite away from the cluster, dash out if anyone
    // is close. Two triggers:
    //   a) HP dropped below `lowHpPct` (absolute danger), or
    //   b) HP below half AND multiple guards are already on top of us,
    //      because one more trade will put us in trigger (a) with less
    //      room to recover.
    // Kiting uses the guard-cluster centroid (weighted by 1/dist) instead
    // of the single nearest, otherwise we fled from one guard straight
    // into another standing on our escape path.
    const swarmCount = this._guardsWithin(p, view.guards, 90);
    const retreat = hpPct < this.lowHpPct || (hpPct < 0.5 && swarmCount >= 2);
    if (retreat) {
      const flee = this._guardClusterFleeDir(p, view.guards, this.aggroRange);
      if (flee) {
        const dash = p.dashCooldownTimer <= 0 && flee.nearest < 160;
        return { moveX: flee.x, moveY: flee.y, attack: false, dash };
      }
      const loot = nearestAlive(p.pos, view.loots);
      if (loot) {
        const dx = loot.entity.pos.x - p.pos.x;
        const dy = loot.entity.pos.y - p.pos.y;
        const d = Math.max(1, loot.distance);
        return { moveX: dx / d, moveY: dy / d, attack: false, dash: false };
      }
      // No threats, no loot — fall through to engage and try to earn gold.
    }

    // 3. Pick a target: threatening guard in aggro range, else caravan,
    // else any guard, else loot.
    let target = null;
    let isLoot = false;
    if (threatGuard && threatGuard.distance < this.aggroRange) {
      target = threatGuard;
    } else {
      const caravan = nearestAlive(p.pos, view.caravans);
      if (caravan) {
        target = caravan;
      } else if (threatGuard) {
        target = threatGuard;
      } else {
        const loot = nearestAlive(p.pos, view.loots);
        if (loot) {
          target = loot;
          isLoot = true;
        }
      }
    }

    if (!target) {
      return { moveX: 0, moveY: 0, attack: false, dash: false };
    }

    const dx = target.entity.pos.x - p.pos.x;
    const dy = target.entity.pos.y - p.pos.y;
    const d = target.distance;

    if (!isLoot) {
      const reach = p.radius + p.attackRange + (target.entity.radius || 12);
      if (d < reach * 0.95) {
        // Strafe-attack in the neutral HP band against melee guards: the
        // player can move and swing on the same frame, so a perpendicular
        // step bleeds less HP on the trade without losing DPS. Archers
        // outrange melee so strafing doesn't help — stand and swing.
        const targetType = target.entity.type;
        const isMeleeGuard = targetType === 'basic' || targetType === 'armored';
        if (hpPct < this.medHpPct && isMeleeGuard) {
          const inv = 1 / Math.max(1, d);
          return {
            moveX: -dy * inv,
            moveY: dx * inv,
            attack: true,
            dash: false,
          };
        }
        return { moveX: 0, moveY: 0, attack: true, dash: false };
      }
    }

    const dash = !isLoot && d > this.dashDistance && p.dashCooldownTimer <= 0;
    return {
      moveX: d > 0 ? dx / d : 0,
      moveY: d > 0 ? dy / d : 0,
      attack: false,
      dash,
    };
  }

  decideShop(view) {
    if (!view.offer || view.offer.length === 0) return { action: 'skip' };
    const costs = view.costs || [];
    const canAfford = (i) => (costs[i] || 0) <= view.gold;
    // Pick the highest-priority affordable card.
    for (const id of this.preferCards) {
      const idx = view.offer.findIndex((c, i) => c.id === id && canAfford(i));
      if (idx >= 0) return { action: 'pick', index: idx };
    }
    // Fallback: cheapest affordable card.
    let best = -1, bestCost = Infinity;
    for (let i = 0; i < view.offer.length; i++) {
      if (canAfford(i) && (costs[i] || 0) < bestCost) {
        bestCost = costs[i] || 0;
        best = i;
      }
    }
    return best >= 0 ? { action: 'pick', index: best } : { action: 'skip' };
  }

  // Return the closest projectile that is both near the player AND aimed
  // roughly at the player. Dot-product filter avoids dashing out of the
  // way of arrows that were never going to hit anyway.
  _incomingProjectile(projectiles, player) {
    if (!projectiles || projectiles.length === 0) return null;
    let best = null;
    let bestTime = Infinity;
    for (const proj of projectiles) {
      if (!proj.alive) continue;
      const dx = player.pos.x - proj.pos.x;
      const dy = player.pos.y - proj.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > this.projectileWarnDist) continue;
      const inv = 1 / Math.max(0.001, dist);
      const dot = proj.dir.x * dx * inv + proj.dir.y * dy * inv;
      if (dot < 0.7) continue; // not actually coming at us
      const timeToHit = dist / 200; // PROJECTILE_SPEED
      if (timeToHit < this.projectileWarnTime && timeToHit < bestTime) {
        bestTime = timeToHit;
        best = proj;
      }
    }
    return best;
  }

  // Score each alive guard on "how badly does this one hurt me right now"
  // and return the worst offender. Archers weigh 3× because they chip from
  // outside melee reach; armored weigh 2× because they soak hits. Distance
  // is a soft divisor so far threats still matter but close ones win ties.
  // True if any guard or caravan is inside the player's swing arc right
  // now. Used by the dodge branch to keep attacking through archer volleys.
  _meleeTargetInReach(player, guards, caravans) {
    const reachBase = player.radius + player.attackRange;
    const check = (list) => {
      if (!list) return false;
      for (const e of list) {
        if (!e.alive) continue;
        const dx = e.pos.x - player.pos.x;
        const dy = e.pos.y - player.pos.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const reach = reachBase + (e.radius || 12);
        if (d < reach * 0.95) return true;
      }
      return false;
    };
    return check(guards) || check(caravans);
  }

  // Count alive guards within `range` px of the player. Used to gate
  // multi-threat retreat — a single guard is a trade, a cluster is a
  // death.
  _guardsWithin(player, guards, range) {
    if (!guards) return 0;
    let n = 0;
    const r2 = range * range;
    for (const g of guards) {
      if (!g.alive) continue;
      const dx = g.pos.x - player.pos.x;
      const dy = g.pos.y - player.pos.y;
      if (dx * dx + dy * dy <= r2) n++;
    }
    return n;
  }

  // Build a flee direction from all guards within `range`, weighted by
  // inverse distance — closer guards push harder. Returns null if no
  // guard is in range. Also returns the nearest guard's distance so the
  // caller can decide whether to burn a dash.
  _guardClusterFleeDir(player, guards, range) {
    if (!guards || guards.length === 0) return null;
    let fx = 0, fy = 0, nearest = Infinity;
    let anyInRange = false;
    for (const g of guards) {
      if (!g.alive) continue;
      const dx = player.pos.x - g.pos.x;
      const dy = player.pos.y - g.pos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > range) continue;
      anyInRange = true;
      if (d < nearest) nearest = d;
      const w = 1 / Math.max(20, d);
      fx += (dx / Math.max(0.001, d)) * w;
      fy += (dy / Math.max(0.001, d)) * w;
    }
    if (!anyInRange) return null;
    const len = Math.sqrt(fx * fx + fy * fy);
    if (len < 0.001) return { x: 0, y: -1, nearest };
    return { x: fx / len, y: fy / len, nearest };
  }

  _mostThreateningGuard(player, guards) {
    if (!guards || guards.length === 0) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const g of guards) {
      if (!g.alive) continue;
      const dx = g.pos.x - player.pos.x;
      const dy = g.pos.y - player.pos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const typeWeight = g.type === 'archer' ? 2.5 : (g.type === 'armored' ? 1.5 : 1);
      const dmg = g.damage || 8;
      // Distance floor 40 keeps the denominator from exploding for guards
      // right on top of us — without it, a basic at 10px beats an archer
      // at 200px by 20×, which is right (melee is the immediate threat).
      const score = (dmg * typeWeight * 100) / Math.max(40, d);
      if (score > bestScore) {
        bestScore = score;
        best = { entity: g, distance: d };
      }
    }
    return best;
  }
}

// RunnerPolicy — just runs toward caravans ignoring guards until forced.
// Useful to stress-test boss / elite damage output.
export class RunnerPolicy extends AIPolicy {
  constructor(options = {}) {
    super(options.name || 'runner');
    this.aggroRange = options.aggroRange ?? 60;
  }

  decidePlaying(view) {
    const p = view.player;
    const caravan = nearestAlive(p.pos, view.caravans);
    const guard = nearestAlive(p.pos, view.guards);

    // Only swing at guards if we literally collide with one.
    if (guard && guard.distance < this.aggroRange) {
      const dx = guard.entity.pos.x - p.pos.x;
      const dy = guard.entity.pos.y - p.pos.y;
      const d = guard.distance;
      const reach = p.radius + p.attackRange + (guard.entity.radius || 12);
      if (d < reach * 0.95) {
        return { moveX: 0, moveY: 0, attack: true, dash: false };
      }
      return {
        moveX: d > 0 ? dx / d : 0,
        moveY: d > 0 ? dy / d : 0,
        attack: false,
        dash: p.dashCooldownTimer <= 0,
      };
    }

    if (!caravan) {
      const loot = nearestAlive(p.pos, view.loots);
      if (!loot) return { moveX: 0, moveY: 0, attack: false, dash: false };
      const dx = loot.entity.pos.x - p.pos.x;
      const dy = loot.entity.pos.y - p.pos.y;
      const d = loot.distance;
      return {
        moveX: d > 0 ? dx / d : 0,
        moveY: d > 0 ? dy / d : 0,
        attack: false,
        dash: false,
      };
    }
    const dx = caravan.entity.pos.x - p.pos.x;
    const dy = caravan.entity.pos.y - p.pos.y;
    const d = caravan.distance;
    const reach = p.radius + p.attackRange + (caravan.entity.radius || 14);
    if (d < reach * 0.95) {
      return { moveX: 0, moveY: 0, attack: true, dash: false };
    }
    return {
      moveX: d > 0 ? dx / d : 0,
      moveY: d > 0 ? dy / d : 0,
      attack: false,
      dash: d > 300 && p.dashCooldownTimer <= 0,
    };
  }

  decideShop(view) {
    if (!view.offer || view.offer.length === 0) return { action: 'skip' };
    const costs = view.costs || [];
    for (let i = 0; i < view.offer.length; i++) {
      if ((costs[i] || 0) <= view.gold) return { action: 'pick', index: i };
    }
    return { action: 'skip' };
  }
}

// Registry used by the CLI to look up policies by name. Each entry is a
// factory so the simulator can create a fresh instance per run (policies
// may hold mutable state in the future).
export const POLICIES = {
  greedy: (opts) => new GreedyPolicy(opts),
  'random-cards': (opts) => new RandomCardPolicy(opts),
  runner: (opts) => new RunnerPolicy(opts),
  preference: (opts) => new PreferencePolicy(opts),
  smart: (opts) => new SmartPolicy(opts),
};
