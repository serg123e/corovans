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
  decideShop(/* view */) {
    return { action: 'pick', index: 0 };
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
    if (!view.offer || view.offer.length === 0) {
      return { action: 'skip' };
    }
    let idx = 0;
    if (this.cardPick === 'random') {
      const rand = view.rng ? view.rng.next : Math.random;
      idx = Math.floor(rand() * view.offer.length);
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
    if (!view.offer || view.offer.length === 0) {
      return { action: 'skip' };
    }
    // 1. Highest-ranked preferred card present in the offer.
    for (const id of this.prefer) {
      if (this.avoid.has(id)) continue;
      const idx = view.offer.findIndex(c => c.id === id);
      if (idx >= 0) return { action: 'pick', index: idx };
    }
    // 2. First non-forbidden card.
    const idx = view.offer.findIndex(c => !this.avoid.has(c.id));
    if (idx >= 0) return { action: 'pick', index: idx };
    // 3. Everything forbidden — skip without picking.
    return { action: 'skip' };
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
    return { action: 'pick', index: 0 };
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
};
