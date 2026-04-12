// Simulator - headless runner that drives one full game session using an
// AI policy instead of human input. No rendering, no audio, no particles,
// no pauses. Pure math at maximum speed.
//
// The simulator re-uses the same entity classes the real game uses
// (Player, Guard, Caravan, Projectile, Loot, World, Shop) so gameplay
// rules stay in a single source. What's different from game.js:
//
//   - No Renderer / Camera / Input / GameAudio / ParticleSystem.
//   - Flow is linear instead of state-machine driven: tick → (optional
//     wave end → shop → next wave) → next tick.
//   - Player actions come from an AIPolicy instance.
//   - SessionLogger is used exactly the same way as in the real game,
//     so simulated sessions can be analyzed with the same tooling.
//
// One Simulator instance runs one session and returns the finished
// session object. Use runBatch() from run.js to run many in a row.
//
// Known divergence from the live game:
// - No in-world paid shop. game.js lets the player walk up to a Shop and
//   spend gold on cards mid-run; the sim never drives proximity into
//   beginPaidDraft, so sessions only reflect the end-of-wave free draft.
//   Builds that rely heavily on the paid shop will look weaker in sim
//   results than they are in live play. Add a decidePaidShop hook if/when
//   that matters.

import { World } from '../world.js';
import { Player } from '../player.js';
import { Shop } from '../shop.js';
import { spawnWave, resolveGuardCollisions } from '../caravan.js';
import { performAttack, Projectile } from '../combat.js';
import { spawnLoot } from '../loot.js';
import { UI, CARDS, stackScale } from '../ui.js';
import { SessionLogger } from '../session-logger.js';
import { CONST } from '../utils.js';
import { makeRng } from '../rng.js';
import { SimInput } from './sim-input.js';

// Median of a numeric array. Returns null for empty input so callers can
// decide how to render "no data" (the CLI prints a dash, JSON keeps null).
function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class Simulator {
  constructor(policy, options = {}) {
    this.policy = policy;
    this.dt = options.dt || 1 / 60;
    // Safety ceilings so a runaway policy doesn't loop forever.
    this.maxSteps = options.maxSteps || 60 * 60 * 20; // 20 in-game minutes
    this.maxWaves = options.maxWaves || 30;
    // Metadata attached to the logged session.
    this.commit = options.commit || 'sim';
    this.runId = options.runId || null;
    // Pre-baked cards applied before the first wave. Lets us answer
    // "is build X strong if the player already has it?" independently
    // of draft luck.
    this.startCards = options.startCards || [];
    // Optional seed for reproducible runs. When set, every source of
    // randomness the sim touches (wave spawn, guard types, draft rolls,
    // loot scatter, random card picks) flows through this RNG instead of
    // Math.random(). Same seed ⇒ same summary.
    this.seed = options.seed != null ? options.seed : null;
    this.rng = this.seed != null ? makeRng(this.seed) : null;
  }

  run() {
    const dt = this.dt;
    const rng = this.rng;
    const input = new SimInput();

    const world = new World();
    const player = new Player(world.width / 2, world.height / 2);
    const shop = new Shop(world.width / 2 + 150, world.height / 2 - 140);
    const ui = new UI();

    // Logical clock so two seeded runs produce identical event timestamps
    // and durationMs. Without this, Date.now() leaks wall-clock jitter into
    // the session JSON and breaks byte-level reproducibility.
    let stepCount = 0;
    const clock = rng ? () => stepCount * dt * 1000 : null;

    const logger = new SessionLogger({ commit: this.commit, clock });
    // When seeded, force a deterministic session id so dumps diff cleanly
    // across runs. Without a seed, genId() keeps its wall-clock flavor.
    const forcedId = rng != null
      ? `sim-${this.seed}-${this.runId != null ? this.runId : 0}`
      : undefined;
    logger.startSession({
      id: forcedId,
      sim: true,
      policy: this.policy.name,
      runId: this.runId,
      maxWaves: this.maxWaves,
      startCards: this.startCards,
      seed: this.seed,
    });

    // Apply pre-baked starting cards. Unknown ids are ignored with a
    // warning to the logger so analysts can see something went wrong.
    // Stack diminishing returns apply the same way as live-game picks so
    // combo scans see realistic 3+3 scaling, not raw additive stacking.
    const startStacks = {};
    for (const id of this.startCards) {
      const card = CARDS.find(c => c.id === id);
      if (!card) {
        console.warn(`[sim] unknown start card id: ${id}`);
        continue;
      }
      const owned = startStacks[id] || 0;
      card.apply(player, stackScale(owned));
      startStacks[id] = owned + 1;
      // Don't count these as cardsPicked events — they're pre-bake, not
      // shop picks. They live in session.meta.startCards instead.
    }

    // Mutable run state.
    let wave = 1;
    let score = 0;
    let caravans = [];
    let guards = [];
    let projectiles = [];
    let loots = [];
    let waveDamageTaken = 0;
    let waveStartStep = 0;

    const spawnCurrentWave = () => {
      caravans = spawnWave(wave, world, rng);
      guards = [];
      projectiles = [];
      loots = [];
      for (const c of caravans) guards.push(...c.spawnGuards(wave, rng));
      waveDamageTaken = 0;
      waveStartStep = stepCount;
      logger.logWaveStart(wave, {
        caravans: caravans.length,
        guards: guards.length,
        boss: wave % 5 === 0,
      });
    };

    // Drop loot for a caravan if it should — mirrors Game._checkCaravanLoot.
    const checkCaravanLoot = (caravan) => {
      if (!caravan || caravan.looted) return;
      const allGuardsDead = caravan.guards.every(g => !g.alive);
      const shouldDrop = !caravan.alive || allGuardsDead;
      if (!shouldDrop) return;
      caravan.looted = true;
      if (caravan.alive) caravan.alive = false;
      const coins = spawnLoot(caravan, rng);
      loots.push(...coins);
      logger.logCaravanRobbed(caravan.type, caravan.lootValue, wave, !!caravan.isBoss);
    };

    spawnCurrentWave();

    while (stepCount < this.maxSteps && wave <= this.maxWaves) {
      // --- Policy decision ----------------------------------------
      const view = {
        wave,
        player: this._playerView(player),
        caravans,
        guards,
        projectiles,
        loots,
        shop,
      };
      const action = this.policy.decidePlaying(view) || {};
      input.setMove(action.moveX || 0, action.moveY || 0);

      // Dash before player.update so the new velocity applies this tick.
      if (action.dash && player.dashCooldownTimer <= 0 && player.alive) {
        if (player.startDash(action.moveX || 0, action.moveY || 0)) {
          logger.logDash(wave);
        }
      }

      // --- Player update ------------------------------------------
      player.update(dt, input, world.width, world.height);
      if (!player.alive) break;

      // --- Attack -------------------------------------------------
      if (action.attack && player.tryAttack()) {
        logger.logAttack();
        const hits = performAttack(player, guards, caravans);
        if (player.lifestealPct > 0 && hits.length > 0) {
          const totalDmg = hits.reduce((s, h) => s + h.damage, 0);
          const heal = Math.floor(totalDmg * player.lifestealPct);
          if (heal > 0) player.heal(heal);
        }
        for (const hit of hits) {
          logger.logDamageDealt(hit.damage);
          if (hit.type === 'guard' && !hit.target.alive) {
            logger.logGuardKilled(hit.target.type, wave);
            checkCaravanLoot(hit.target.caravan);
          }
          if (hit.type === 'caravan' && !hit.target.alive) {
            checkCaravanLoot(hit.target);
          }
        }
      }

      // --- Caravans -----------------------------------------------
      for (const c of caravans) c.update(dt, player.pos);

      // --- Guards + guard attacks ---------------------------------
      for (const guard of guards) {
        guard.update(dt, player.pos);
        if (guard.canAttack(player.pos)) {
          const result = guard.attack(player.pos);
          if (result.ranged) {
            projectiles.push(new Projectile(
              result.origin.x, result.origin.y,
              result.dir.x, result.dir.y,
              result.damage
            ));
          } else {
            const hpBefore = player.hp;
            player.takeDamage(result.damage);
            const actual = hpBefore - player.hp;
            if (actual > 0) {
              waveDamageTaken += actual;
              logger.logPlayerDamaged(actual, `guard:${guard.type}`, wave, player.hp);
              if (player.thornsPct > 0 && guard.alive) {
                const reflected = Math.max(1, Math.round(actual * player.thornsPct));
                guard.takeDamage(reflected);
                logger.logDamageReflected(reflected);
                if (!guard.alive) {
                  logger.logGuardKilled(guard.type, wave, 'thorns');
                  checkCaravanLoot(guard.caravan);
                }
              }
            }
          }
        }
      }
      if (!player.alive) break;

      resolveGuardCollisions(guards, caravans);

      // --- Projectiles --------------------------------------------
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const proj = projectiles[i];
        const hit = proj.update(dt, player.pos, player.radius);
        if (hit) {
          const hpBefore = player.hp;
          player.takeDamage(proj.damage);
          const actual = hpBefore - player.hp;
          if (actual > 0) {
            waveDamageTaken += actual;
            logger.logPlayerDamaged(actual, 'arrow', wave, player.hp);
          }
        }
        if (!proj.alive) projectiles.splice(i, 1);
      }
      if (!player.alive) break;

      // --- Loot ---------------------------------------------------
      for (let i = loots.length - 1; i >= 0; i--) {
        const loot = loots[i];
        const collected = loot.update(
          dt, player.pos, world.width, world.height, player.magnetRangeMul
        );
        if (collected > 0) {
          player.addGold(collected);
          score += collected;
          logger.logGoldEarned(collected);
        }
        if (!loot.alive) loots.splice(i, 1);
      }

      // --- Wave completion ----------------------------------------
      if (caravans.length > 0) {
        const allDone = caravans.every(c => !c.alive);
        if (allDone && loots.length === 0) {
          const anyRobbed = caravans.some(c => !c.escaped);
          if (waveDamageTaken === 0 && anyRobbed) {
            const bonus = CONST.FLAWLESS_WAVE_BONUS * wave;
            score += bonus;
            player.addGold(bonus);
            logger.logGoldEarned(bonus);
            logger.logFlawless(wave, bonus);
          }
          const escaped = caravans.filter(c => c.escaped).length;
          const robbed = caravans.filter(c => !c.escaped).length;
          logger.logWaveEnd(wave, {
            durationMs: Math.round((stepCount - waveStartStep) * dt * 1000),
            damageTaken: waveDamageTaken,
            caravansRobbed: robbed,
            caravansEscaped: escaped,
          });

          // End-of-wave free draft. Policies may reroll before picking, so
          // loop until they pick or skip. Cap iterations so a broken policy
          // that keeps requesting rerolls can't burn infinite gold here.
          ui.beginFreeDraft(rng, player);
          logger.logShopOpened('wave', wave);
          const MAX_SHOP_DECISIONS = 8;
          let closed = false;
          for (let step = 0; step < MAX_SHOP_DECISIONS && !closed; step++) {
            const shopOffer = ui.draftOffer.slice();
            const shopView = {
              wave,
              mode: 'free',
              offer: shopOffer,
              costs: shopOffer.map(c => ui.getCardCost(c)),
              player: this._playerView(player),
              gold: player.gold,
              rng,
            };
            const decision = this.policy.decideShop(shopView) || { action: 'skip' };

            if (decision.action === 'pick' && typeof decision.index === 'number') {
              const card = ui.draftOffer[decision.index];
              const pickCost = card ? ui.getCardCost(card) : 0;
              if (card && ui.pickCard(decision.index, player)) {
                logger.logCardPicked(card.id, card.rarity, 'free', pickCost, wave);
                logger.logGoldSpent(pickCost);
              }
              closed = true;
            } else if (decision.action === 'reroll') {
              const cost = ui.getRerollCost();
              if (ui.tryReroll(player, rng)) {
                logger.logReroll('free', cost, wave);
                logger.logGoldSpent(cost);
              } else {
                // Can't afford to reroll — treat as skip so we don't loop.
                closed = true;
              }
            } else {
              // 'skip' or unknown action — done.
              closed = true;
            }
          }
          logger.logShopClosed('wave', wave);

          // Move on.
          wave++;
          if (wave > this.maxWaves) break;
          ui.onWaveStart();
          player.respawnAt(world.width / 2, world.height / 2);
          spawnCurrentWave();
        }
      }

      stepCount++;
    }

    // --- Session terminator --------------------------------------
    const died = !player.alive;
    // `wave` post-increments on wave completion, so a run that clears
    // maxWaves exits with wave = maxWaves + 1 even though the player never
    // entered that wave. Clamp for the summary so survival-to-cap reports
    // the last wave actually played.
    const reached = died ? wave : Math.min(wave, this.maxWaves);
    // A run that burns through maxSteps without dying didn't really survive
    // — the loop was cut short by the runaway safety ceiling. Flag it so
    // summarizeBatch can split "legit survived" from "stalled out".
    const timedOut = !died && stepCount >= this.maxSteps;
    if (died) logger.logDeath(reached, score);
    const finished = logger.endSession({
      died,
      timedOut,
      finalScore: score,
      waveReached: reached,
      totalSteps: stepCount,
    });
    return finished;
  }

  // Build the player snapshot handed to the policy. Kept minimal —
  // policies should not pull references out of entities, just read
  // `pos`/`alive`/stats.
  _playerView(player) {
    return {
      pos: player.pos,
      hp: player.hp,
      maxHp: player.maxHp,
      gold: player.gold,
      damage: player.damage,
      speed: player.speed,
      radius: player.radius,
      attackRange: player.attackRange,
      attackTimer: player.attackTimer,
      dashCooldownTimer: player.dashCooldownTimer,
      dashCooldownMax: player.dashCooldownMax,
      iframeTimer: player.iframeTimer,
      alive: player.alive,
      lifestealPct: player.lifestealPct,
      thornsPct: player.thornsPct,
      magnetRangeMul: player.magnetRangeMul,
    };
  }
}

// Run N sessions back-to-back with the same policy factory.
// Returns an array of finished session objects.
// `options` is passed through to Simulator — supports `maxWaves`, `commit`,
// `startCards`, `maxSteps`, `seed`. When `seed` is set, each run uses
// `seed + runId` so the batch is reproducible but individual runs explore
// different random paths.
export function runBatch(policyFactory, count, options = {}) {
  const results = [];
  const baseSeed = options.seed != null ? options.seed : null;
  for (let i = 0; i < count; i++) {
    const policy = policyFactory();
    const runSeed = baseSeed != null ? baseSeed + i : null;
    const sim = new Simulator(policy, { ...options, runId: i, seed: runSeed });
    const session = sim.run();
    if (session) results.push(session);
  }
  return results;
}

// Compact aggregate stats from a batch. Useful for quick CLI output.
export function summarizeBatch(sessions) {
  if (sessions.length === 0) {
    return { count: 0 };
  }
  const n = sessions.length;
  const waves = sessions.map(s => s.summary.waveReached);
  const scores = sessions.map(s => s.summary.finalScore);
  const deaths = sessions.filter(s => s.summary.died).length;
  const timedOut = sessions.filter(s => s.summary.timedOut).length;
  // Survival rate counts only runs that actually reached the maxWaves cap
  // alive — timeouts (runaway safety-ceiling exits) are a separate bucket
  // so they don't silently inflate the success number.
  const survived = n - deaths - timedOut;
  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;

  // Most-picked card ids across the batch.
  const pickCounts = {};
  for (const s of sessions) {
    for (const p of s.summary.cardsPicked) {
      pickCounts[p.id] = (pickCounts[p.id] || 0) + 1;
    }
  }

  return {
    count: n,
    deaths,
    timedOut,
    survivalRate: survived / n,
    waveReached: {
      min: Math.min(...waves),
      max: Math.max(...waves),
      mean: avg(waves),
      median: median(waves),
    },
    score: {
      min: Math.min(...scores),
      max: Math.max(...scores),
      mean: avg(scores),
      median: median(scores),
    },
    guardsKilled: avg(sessions.map(s => s.summary.guardsKilled)),
    thornsKillsAvg: avg(sessions.map(s => (s.summary.guardsKilledBySource?.thorns) || 0)),
    meleeKillsAvg: avg(sessions.map(s => (s.summary.guardsKilledBySource?.melee) || 0)),
    damageReflectedAvg: avg(sessions.map(s => s.summary.damageReflected || 0)),
    caravansRobbed: avg(sessions.map(s => s.summary.caravansRobbed)),
    damageTaken: avg(sessions.map(s => s.summary.damageTaken)),
    pickCounts,
    cardImpact: cardImpact(sessions),
  };
}

// For every card that appears in the batch, split sessions into "picked at
// least once" vs "never picked" and compute median wave + median score for
// each cohort. Deltas surface OP cards (big positive wave delta) and trap
// cards (negative delta).
//
// Reliability caveat: cohorts below 5 sessions are flagged with `sparse`
// so the caller can filter them out — small splits are mostly noise.
export function cardImpact(sessions) {
  if (sessions.length === 0) return [];

  // Collect every card id seen anywhere in the batch.
  const cardIds = new Set();
  for (const s of sessions) {
    for (const p of s.summary.cardsPicked) cardIds.add(p.id);
  }

  const results = [];
  for (const id of cardIds) {
    const withCard = sessions.filter(s => s.summary.cardsPicked.some(p => p.id === id));
    const withoutCard = sessions.filter(s => !s.summary.cardsPicked.some(p => p.id === id));
    if (withCard.length === 0 || withoutCard.length === 0) continue;

    // Average stack size among runs that took the card at least once.
    const stackSizes = withCard.map(s => s.summary.cardsPicked.filter(p => p.id === id).length);
    const avgStack = stackSizes.reduce((a, b) => a + b, 0) / stackSizes.length;

    const withWave = median(withCard.map(s => s.summary.waveReached));
    const withoutWave = median(withoutCard.map(s => s.summary.waveReached));
    const withScore = median(withCard.map(s => s.summary.finalScore));
    const withoutScore = median(withoutCard.map(s => s.summary.finalScore));

    results.push({
      id,
      withCount: withCard.length,
      withoutCount: withoutCard.length,
      withMedianWave: withWave,
      withoutMedianWave: withoutWave,
      waveDelta: withWave - withoutWave,
      withMedianScore: withScore,
      withoutMedianScore: withoutScore,
      scoreDelta: withScore - withoutScore,
      avgStack,
      sparse: withCard.length < 5 || withoutCard.length < 5,
    });
  }

  // Biggest positive wave delta first — OP candidates rise to the top.
  results.sort((a, b) => b.waveDelta - a.waveDelta);
  return results;
}

// Combo matrix scan — for every unordered pair of cards, pre-bake stacks of
// both and run a batch. Returns pair deltas sorted by impact on median wave
// so OP synergies (thorns+lifesteal, damage+wideArc, etc.) float to the top.
//
// Why it exists: manual hypothesis-testing ("I bet thorns is OP") doesn't
// scale — last time thorns looked strong to the eye but data showed the
// real winner was damage+lifesteal. Automating the pair sweep replaces
// intuition with evidence.
//
// Method:
//   1. Run `count` baseline sessions (no start cards) to anchor the delta.
//   2. For every pair (a, b) from `cards`, run `count` sessions with
//      start cards `[a×stackSize, b×stackSize]`.
//   3. Compute median/mean wave per pair, delta = pairMedian - baseMedian.
//   4. Sort by delta descending.
//
// Reproducibility: when `seed` is set, each pair uses `seed + (pairIdx+1)*10_000`
// so different pairs explore different random sequences but the whole
// scan is still byte-identical across reruns.
//
// Cost guardrail: with 12 cards and count=50, that's 66 pairs × 50 = 3300
// sessions plus 50 baseline. On smart policy ≈ 0.1s/session, total ≈ 6min.
// Drop `count` or trim `cards` to stay within a tight budget.
export function comboScan(policyFactory, options = {}) {
  const {
    count = 50,
    maxWaves = 30,
    commit = 'sim',
    seed = null,
    cards = null, // null → every card in CARDS
    stackSize = 3,
    onProgress = null, // optional (doneCount, totalPairs) hook
  } = options;

  const cardIds = cards || CARDS.map(c => c.id);
  // Enumerate unordered pairs.
  const pairs = [];
  for (let i = 0; i < cardIds.length; i++) {
    for (let j = i + 1; j < cardIds.length; j++) {
      pairs.push([cardIds[i], cardIds[j]]);
    }
  }

  const t0 = Date.now();

  // Baseline: no pre-baked cards. Seeded with the exact `seed` so reruns
  // of the same scan compare against an identical anchor.
  const baselineSessions = runBatch(policyFactory, count, {
    maxWaves, commit, seed, startCards: [],
  });
  const baselineWaves = baselineSessions.map(s => s.summary.waveReached);
  const baselineMedian = median(baselineWaves);
  const baselineMean = baselineWaves.reduce((a, b) => a + b, 0) / Math.max(1, baselineWaves.length);

  const results = [];
  for (let pi = 0; pi < pairs.length; pi++) {
    const [a, b] = pairs[pi];
    const startCards = [];
    for (let k = 0; k < stackSize; k++) startCards.push(a);
    for (let k = 0; k < stackSize; k++) startCards.push(b);
    // Stride the seed so different pairs aren't replaying the same RNG.
    // +1 so pair 0 doesn't collide with the baseline seed.
    const pairSeed = seed != null ? seed + (pi + 1) * 10_000 : null;
    const sessions = runBatch(policyFactory, count, {
      maxWaves, commit, seed: pairSeed, startCards,
    });
    const waves = sessions.map(s => s.summary.waveReached);
    const med = median(waves);
    const mean = waves.reduce((a, b) => a + b, 0) / Math.max(1, waves.length);
    // Fraction of sessions in this pair that survived to maxWaves — extra
    // confidence signal on top of the median, handy when two pairs tie.
    const survival = sessions.filter(s => !s.summary.died && !s.summary.timedOut).length / sessions.length;
    results.push({
      a, b,
      median: med,
      mean,
      survival,
      n: sessions.length,
      delta: med - baselineMedian,
    });
    if (onProgress) onProgress(pi + 1, pairs.length);
  }

  results.sort((x, y) => y.delta - x.delta || y.mean - x.mean);
  return {
    elapsedMs: Date.now() - t0,
    baseline: {
      median: baselineMedian,
      mean: baselineMean,
      n: baselineWaves.length,
    },
    pairs: results,
    stackSize,
    cardIds,
  };
}

// Per-wave breakdown: "where does the difficulty wall sit and how steep is it?"
//
// For every wave the batch touched, count how many sessions reached the
// start of that wave and how many died inside it, then aggregate medians
// for duration / damage taken / kills / flawless count. A single tall
// jump in mortalityPct between wave N and N+1 marks the stall point.
//
// Why walk events instead of trusting summary.waveReached? The simulator
// post-increments `wave` on wave completion, so a run that clears the
// maxWaves cap ends with waveReached = maxWaves + 1. Walking events gives
// the actual last wave the player entered.
export function perWaveStats(sessions) {
  const waves = new Map();

  const getBucket = (w) => {
    let acc = waves.get(w);
    if (!acc) {
      acc = {
        reachedCount: 0,
        diedHere: 0,
        durations: [],
        damages: [],
        kills: [],
        flawlessCount: 0,
      };
      waves.set(w, acc);
    }
    return acc;
  };

  for (const s of sessions) {
    const killsByWave = {};
    const endByWave = {};
    const flawlessWaves = new Set();
    let lastStarted = 0;

    for (const ev of s.events) {
      if (ev.type === 'wave_start') {
        if (ev.wave > lastStarted) lastStarted = ev.wave;
      } else if (ev.type === 'guard_killed') {
        const w = ev.wave;
        if (w) killsByWave[w] = (killsByWave[w] || 0) + 1;
      } else if (ev.type === 'wave_end') {
        endByWave[ev.wave] = {
          duration: ev.durationMs || 0,
          damage: ev.damageTaken || 0,
        };
      } else if (ev.type === 'flawless') {
        flawlessWaves.add(ev.wave);
      }
    }

    if (lastStarted === 0) continue;
    const died = !!s.summary.died;

    for (let w = 1; w <= lastStarted; w++) {
      const acc = getBucket(w);
      acc.reachedCount++;
      if (died && w === lastStarted) acc.diedHere++;
      const end = endByWave[w];
      if (end) {
        acc.durations.push(end.duration);
        acc.damages.push(end.damage);
      }
      acc.kills.push(killsByWave[w] || 0);
      if (flawlessWaves.has(w)) acc.flawlessCount++;
    }
  }

  const result = [];
  const sortedWaves = [...waves.keys()].sort((a, b) => a - b);
  for (const w of sortedWaves) {
    const acc = waves.get(w);
    result.push({
      wave: w,
      reachedCount: acc.reachedCount,
      diedHere: acc.diedHere,
      mortalityPct: acc.reachedCount > 0 ? (acc.diedHere / acc.reachedCount) * 100 : 0,
      medianDuration: median(acc.durations),
      medianDamageTaken: median(acc.damages),
      medianKills: median(acc.kills),
      flawlessCount: acc.flawlessCount,
    });
  }
  return result;
}
