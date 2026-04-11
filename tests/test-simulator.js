// Tests for the headless Simulator and policy framework.
//
// localStorage stub must be installed before imports touch SessionLogger,
// which is used through Simulator. The logger's read/write wrappers
// only fire at call time, but we install the stub early anyway to keep
// persistence paths active — lets us verify session objects have real
// shape.

globalThis.localStorage = {
  _store: {},
  getItem(key) { return this._store[key] ?? null; },
  setItem(key, value) { this._store[key] = String(value); },
  removeItem(key) { delete this._store[key]; },
  clear() { this._store = {}; },
};

import { Simulator, runBatch, summarizeBatch, perWaveStats, comboScan } from '../js/sim/simulator.js';
import {
  AIPolicy,
  GreedyPolicy,
  RandomCardPolicy,
  RunnerPolicy,
  SmartPolicy,
  POLICIES,
} from '../js/sim/policies.js';
import { SimInput } from '../js/sim/sim-input.js';
import { SessionLogger } from '../js/session-logger.js';
import { Vec2 } from '../js/utils.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${msg}`); }
}

function resetStorage() {
  globalThis.localStorage._store = {};
}

// --- SimInput normalizes movement vectors ---
{
  const input = new SimInput();
  input.setMove(3, 4);
  const m = input.getMovement();
  assert(Math.abs(m.x - 0.6) < 0.001, 'SimInput: normalizes x');
  assert(Math.abs(m.y - 0.8) < 0.001, 'SimInput: normalizes y');

  input.setMove(0, 0);
  const zero = input.getMovement();
  assert(zero.x === 0 && zero.y === 0, 'SimInput: zero vector stays zero');

  // Required stubs
  assert(input.wasPressed() === false, 'SimInput: wasPressed stub');
  assert(input.isDown() === false, 'SimInput: isDown stub');
}

// --- AIPolicy base defaults ---
{
  const p = new AIPolicy('test');
  assert(p.name === 'test', 'AIPolicy: name');
  const playing = p.decidePlaying({});
  assert(playing.moveX === 0, 'AIPolicy base: no movement');
  assert(playing.attack === false, 'AIPolicy base: no attack');
  const shop = p.decideShop({});
  assert(shop.action === 'pick', 'AIPolicy base: picks card by default');
  assert(shop.index === 0, 'AIPolicy base: picks index 0');
}

// --- GreedyPolicy: attacks guard in melee range ---
{
  const policy = new GreedyPolicy();
  const view = {
    wave: 1,
    player: {
      pos: new Vec2(500, 500),
      hp: 100, maxHp: 100, gold: 0, damage: 15, speed: 160,
      radius: 12, attackRange: 28, attackTimer: 0,
      dashCooldownTimer: 0, dashCooldownMax: 1,
      iframeTimer: 0, alive: true,
      lifestealPct: 0, thornsPct: 0, magnetRangeMul: 1,
    },
    guards: [
      { alive: true, pos: new Vec2(520, 500), type: 'basic', radius: 10 },
    ],
    caravans: [],
    projectiles: [],
    loots: [],
    shop: null,
  };
  const action = policy.decidePlaying(view);
  assert(action.attack === true, 'Greedy: attacks guard in melee range');
  assert(action.moveX === 0 && action.moveY === 0, 'Greedy: stops to swing');
}

// --- GreedyPolicy: walks toward caravan when no guards ---
{
  const policy = new GreedyPolicy();
  const view = {
    wave: 1,
    player: {
      pos: new Vec2(500, 500),
      hp: 100, maxHp: 100, radius: 12, attackRange: 28,
      attackTimer: 0, dashCooldownTimer: 0, dashCooldownMax: 1,
    },
    guards: [],
    caravans: [{ alive: true, pos: new Vec2(700, 500), type: 'donkey', radius: 14 }],
    projectiles: [], loots: [], shop: null,
  };
  const action = policy.decidePlaying(view);
  assert(action.attack === false, 'Greedy: not attacking a far caravan');
  assert(action.moveX > 0.9, 'Greedy: moves east toward caravan');
  assert(Math.abs(action.moveY) < 0.1, 'Greedy: no vertical movement');
}

// --- GreedyPolicy: walks to loot when map is clear ---
{
  const policy = new GreedyPolicy();
  const view = {
    wave: 1,
    player: {
      pos: new Vec2(500, 500),
      radius: 12, attackRange: 28,
      attackTimer: 0, dashCooldownTimer: 0, dashCooldownMax: 1,
    },
    guards: [],
    caravans: [],
    projectiles: [],
    loots: [{ alive: true, pos: new Vec2(500, 600), value: 20 }],
    shop: null,
  };
  const action = policy.decidePlaying(view);
  assert(Math.abs(action.moveX) < 0.1, 'Greedy: no horizontal when loot is south');
  assert(action.moveY > 0.9, 'Greedy: moves south toward loot');
  assert(action.attack === false, 'Greedy: does not attack loot');
  assert(action.dash === false, 'Greedy: does not dash to loot');
}

// --- GreedyPolicy: picks first card in shop ---
{
  const policy = new GreedyPolicy();
  const decision = policy.decideShop({
    mode: 'free',
    offer: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
  });
  assert(decision.action === 'pick', 'Greedy shop: pick action');
  assert(decision.index === 0, 'Greedy shop: picks index 0');
}

// --- RandomCardPolicy: picks within offer bounds ---
{
  const policy = new RandomCardPolicy();
  for (let i = 0; i < 50; i++) {
    const decision = policy.decideShop({
      mode: 'free',
      offer: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
    });
    assert(decision.action === 'pick', 'RandomCards: pick action');
    assert(decision.index >= 0 && decision.index < 5, `RandomCards: index in [0,5): got ${decision.index}`);
  }
}

// --- SmartPolicy: dodges incoming arrow by stepping perpendicular ---
{
  const policy = new SmartPolicy();
  // Arrow flying east toward player, 60px away. Player should step
  // perpendicular (north or south) with dash ready.
  const view = {
    wave: 3,
    player: {
      pos: new Vec2(500, 500),
      hp: 80, maxHp: 100, gold: 0, damage: 15, speed: 160,
      radius: 12, attackRange: 28, attackTimer: 0,
      dashCooldownTimer: 0, dashCooldownMax: 1,
      iframeTimer: 0, alive: true,
      lifestealPct: 0, thornsPct: 0, magnetRangeMul: 1,
    },
    guards: [],
    caravans: [],
    projectiles: [
      { alive: true, pos: new Vec2(440, 500), dir: new Vec2(1, 0), damage: 6 },
    ],
    loots: [],
    shop: null,
  };
  const action = policy.decidePlaying(view);
  assert(action.attack === false, 'Smart dodge: no attack while dodging');
  assert(action.dash === true, 'Smart dodge: dashes when cooldown ready');
  assert(Math.abs(action.moveX) < 0.01, 'Smart dodge: no move along arrow axis');
  assert(Math.abs(action.moveY) > 0.9, 'Smart dodge: perpendicular move (y axis)');
}

// --- SmartPolicy: ignores projectiles flying away from player ---
{
  const policy = new SmartPolicy();
  const view = {
    wave: 3,
    player: {
      pos: new Vec2(500, 500),
      hp: 80, maxHp: 100, radius: 12, attackRange: 28,
      attackTimer: 0, dashCooldownTimer: 0, dashCooldownMax: 1,
      lifestealPct: 0, thornsPct: 0, magnetRangeMul: 1, alive: true,
    },
    guards: [],
    caravans: [{ alive: true, pos: new Vec2(700, 500), type: 'donkey', radius: 14 }],
    // Arrow right next to player but heading east, away from us.
    projectiles: [
      { alive: true, pos: new Vec2(510, 500), dir: new Vec2(1, 0), damage: 6 },
    ],
    loots: [], shop: null,
  };
  const action = policy.decidePlaying(view);
  assert(action.dash === false, 'Smart dodge: does not dash for arrow leaving us');
  assert(action.moveX > 0.9, 'Smart dodge: still walks to caravan past the arrow');
}

// --- SmartPolicy: low HP kites away from nearest guard ---
{
  const policy = new SmartPolicy();
  const view = {
    wave: 5,
    player: {
      pos: new Vec2(500, 500),
      hp: 15, maxHp: 100, radius: 12, attackRange: 28,
      attackTimer: 0, dashCooldownTimer: 0.5, dashCooldownMax: 1,
      lifestealPct: 0, thornsPct: 0, magnetRangeMul: 1, alive: true,
    },
    guards: [
      { alive: true, pos: new Vec2(600, 500), type: 'basic', radius: 10, damage: 8 },
    ],
    caravans: [{ alive: true, pos: new Vec2(700, 500), type: 'donkey', radius: 14 }],
    projectiles: [], loots: [], shop: null,
  };
  const action = policy.decidePlaying(view);
  assert(action.attack === false, 'Smart retreat: no attacking at low HP');
  assert(action.moveX < -0.9, 'Smart retreat: moves away from guard (west)');
}

// --- SmartPolicy: prioritizes archer over closer basic guard ---
{
  const policy = new SmartPolicy();
  const view = {
    wave: 3,
    player: {
      pos: new Vec2(500, 500),
      hp: 100, maxHp: 100, radius: 12, attackRange: 28,
      attackTimer: 0, dashCooldownTimer: 0.5, dashCooldownMax: 1,
      lifestealPct: 0, thornsPct: 0, magnetRangeMul: 1, alive: true,
    },
    guards: [
      // Basic guard due east, reachable.
      { alive: true, pos: new Vec2(580, 500), type: 'basic', radius: 10, damage: 8 },
      // Archer a bit farther south, still within aggro range.
      { alive: true, pos: new Vec2(500, 620), type: 'archer', radius: 10, damage: 6 },
    ],
    caravans: [],
    projectiles: [], loots: [], shop: null,
  };
  const action = policy.decidePlaying(view);
  // Archer gets the threat nod even though basic is closer, so we should
  // be heading south (toward the archer), not east.
  assert(action.moveY > 0.5, 'Smart targeting: heads toward archer (south)');
  assert(Math.abs(action.moveX) < 0.5, 'Smart targeting: not chasing basic (east)');
}

// --- SmartPolicy: picks lifesteal first from shop offer ---
{
  const policy = new SmartPolicy();
  const decision = policy.decideShop({
    mode: 'free',
    offer: [
      { id: 'speed' },
      { id: 'maxHp' },
      { id: 'lifesteal' },
      { id: 'glassCannon' },
    ],
  });
  assert(decision.action === 'pick', 'Smart shop: picks a card');
  assert(decision.index === 2, `Smart shop: picks lifesteal (got ${decision.index})`);
}

// --- SmartPolicy: falls through to index 0 if no preferred card offered ---
{
  const policy = new SmartPolicy();
  const decision = policy.decideShop({
    mode: 'free',
    offer: [
      { id: 'speed' },
      { id: 'magnet' },
      { id: 'glassCannon' },
    ],
  });
  assert(decision.index === 0, 'Smart shop: falls back to index 0');
}

// --- SmartPolicy integration: real sim reaches deeper waves than greedy ---
{
  resetStorage();
  // Small batch with the same seed set so both policies face matched
  // RNG streams — any wave delta is policy-driven, not luck-driven.
  const greedyBatch = runBatch(() => new GreedyPolicy(), 12, { maxWaves: 15, seed: 2026 });
  resetStorage();
  const smartBatch = runBatch(() => new SmartPolicy(), 12, { maxWaves: 15, seed: 2026 });
  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const greedyMean = mean(greedyBatch.map(s => s.summary.waveReached));
  const smartMean = mean(smartBatch.map(s => s.summary.waveReached));
  assert(smartMean > greedyMean,
    `Smart integration: mean wave ${smartMean.toFixed(2)} > greedy ${greedyMean.toFixed(2)}`);
}

// --- POLICIES registry: can build each named policy ---
{
  for (const name of Object.keys(POLICIES)) {
    const p = POLICIES[name]();
    assert(p instanceof AIPolicy, `POLICIES[${name}]: returns AIPolicy`);
    assert(typeof p.decidePlaying === 'function', `POLICIES[${name}]: has decidePlaying`);
    assert(typeof p.decideShop === 'function', `POLICIES[${name}]: has decideShop`);
  }
}

// --- Simulator.run: returns a finished session with expected shape ---
{
  resetStorage();
  const sim = new Simulator(new GreedyPolicy(), { maxWaves: 2, commit: 'test-sim' });
  const session = sim.run();
  assert(session !== null, 'Simulator: returns a session');
  assert(session.commit === 'test-sim', 'Simulator: commit tagged');
  assert(session.endedAt !== null, 'Simulator: endedAt set');
  assert(typeof session.summary.waveReached === 'number', 'Simulator: waveReached numeric');
  assert(session.summary.waveReached >= 1, 'Simulator: at least wave 1 reached');
  assert(typeof session.summary.died === 'boolean', 'Simulator: died flag present');
  // Greedy baseline guarantees at least one attack and one guard kill on wave 1
  assert(session.summary.attacks > 0, 'Simulator: some attacks happened');
  assert(session.events.some(e => e.type === 'session_start'), 'Simulator: session_start event');
  assert(session.events.some(e => e.type === 'wave_start'), 'Simulator: wave_start event');
}

// --- runBatch produces N sessions ---
{
  resetStorage();
  const sessions = runBatch(() => new GreedyPolicy(), 3, { maxWaves: 2, commit: 'batch' });
  assert(sessions.length === 3, 'runBatch: 3 sessions');
  for (const s of sessions) {
    assert(s.commit === 'batch', 'runBatch: commit propagated');
    assert(s.meta.sim === true, 'runBatch: sim flag in meta');
    assert(s.meta.policy === 'greedy', 'runBatch: policy name in meta');
  }
}

// --- summarizeBatch aggregates cleanly ---
{
  const fakeSessions = [
    {
      summary: {
        waveReached: 3, finalScore: 100, died: true,
        guardsKilled: 5, caravansRobbed: 2, damageTaken: 40,
        cardsPicked: [{ id: 'damage' }, { id: 'speed' }],
      },
    },
    {
      summary: {
        waveReached: 5, finalScore: 250, died: false,
        guardsKilled: 10, caravansRobbed: 4, damageTaken: 20,
        cardsPicked: [{ id: 'damage' }, { id: 'maxHp' }],
      },
    },
  ];
  const s = summarizeBatch(fakeSessions);
  assert(s.count === 2, 'summarize: count');
  assert(s.deaths === 1, 'summarize: deaths');
  assert(s.survivalRate === 0.5, 'summarize: survivalRate');
  assert(s.waveReached.min === 3 && s.waveReached.max === 5, 'summarize: wave min/max');
  assert(s.waveReached.mean === 4, 'summarize: wave mean');
  assert(s.waveReached.median === 4, 'summarize: wave median');
  assert(s.score.mean === 175, 'summarize: score mean');
  assert(s.pickCounts.damage === 2, 'summarize: damage picked 2 times');
  assert(s.pickCounts.speed === 1, 'summarize: speed picked 1 time');
}

// --- summarizeBatch handles empty batch ---
{
  const s = summarizeBatch([]);
  assert(s.count === 0, 'summarize empty: count 0');
}

// --- Simulator honors maxWaves as a hard cap ---
{
  resetStorage();
  // Run a greedy sim with a small maxWaves — the player should finish
  // wave 1 or die inside it, nothing higher.
  const sim = new Simulator(new GreedyPolicy(), { maxWaves: 1, commit: 'cap' });
  const session = sim.run();
  assert(session.summary.waveReached === 1,
    `Simulator: waveReached clamped to maxWaves (got ${session.summary.waveReached})`);
}

// --- Seeded reproducibility: same seed → identical summary ---
{
  resetStorage();
  const opts = { maxWaves: 10, commit: 'seed-test', seed: 42 };
  const a = new Simulator(new GreedyPolicy(), opts).run();
  resetStorage();
  const b = new Simulator(new GreedyPolicy(), opts).run();

  assert(a.summary.waveReached === b.summary.waveReached,
    `seed 42: waveReached matches (${a.summary.waveReached} vs ${b.summary.waveReached})`);
  assert(a.summary.finalScore === b.summary.finalScore,
    `seed 42: finalScore matches (${a.summary.finalScore} vs ${b.summary.finalScore})`);
  assert(a.summary.guardsKilled === b.summary.guardsKilled,
    `seed 42: guardsKilled matches (${a.summary.guardsKilled} vs ${b.summary.guardsKilled})`);
  assert(a.summary.damageTaken === b.summary.damageTaken,
    `seed 42: damageTaken matches`);
  assert(a.summary.caravansRobbed === b.summary.caravansRobbed,
    `seed 42: caravansRobbed matches`);
  assert(a.summary.cardsPicked.length === b.summary.cardsPicked.length,
    `seed 42: cardsPicked length matches`);
  const sameCards = a.summary.cardsPicked.every(
    (p, i) => p.id === b.summary.cardsPicked[i].id && p.wave === b.summary.cardsPicked[i].wave
  );
  assert(sameCards, `seed 42: cardsPicked sequence matches`);
  // session.id is forced from seed so it stays stable across runs.
  assert(a.id === b.id, `seed 42: session.id matches (${a.id} vs ${b.id})`);
  // durationMs comes from the logical clock, not wall clock.
  assert(a.summary.durationMs === b.summary.durationMs,
    `seed 42: durationMs matches (${a.summary.durationMs} vs ${b.summary.durationMs})`);

  // Full event sequence must match too — a summary-only check misses RNG
  // desyncs that happen to land on the same final totals. Compare only
  // the deterministic fields (drop `t` which depends on step count but is
  // carried through the logical clock anyway).
  const eventFingerprint = s => s.events.map(e => {
    const { t: _t, ...rest } = e;
    return JSON.stringify(rest);
  }).join('|');
  assert(eventFingerprint(a) === eventFingerprint(b),
    `seed 42: full event sequence matches (${a.events.length} vs ${b.events.length} events)`);
}

// --- Different seeds produce different runs (sanity) ---
{
  resetStorage();
  const a = new Simulator(new GreedyPolicy(), { maxWaves: 10, seed: 1 }).run();
  resetStorage();
  const b = new Simulator(new GreedyPolicy(), { maxWaves: 10, seed: 999 }).run();
  // At least one of the headline fields should differ between totally
  // different seeds — otherwise the RNG isn't actually being consumed.
  const anyDifference =
    a.summary.waveReached !== b.summary.waveReached ||
    a.summary.finalScore !== b.summary.finalScore ||
    a.summary.guardsKilled !== b.summary.guardsKilled;
  assert(anyDifference, 'different seeds: headline summary fields differ');
}

// --- Seeded runBatch: two batches with same seed produce identical series ---
{
  resetStorage();
  const mk = () => new GreedyPolicy();
  const batchA = runBatch(mk, 3, { maxWaves: 8, seed: 7 });
  resetStorage();
  const batchB = runBatch(mk, 3, { maxWaves: 8, seed: 7 });
  assert(batchA.length === 3 && batchB.length === 3, 'seeded runBatch: 3 runs each');
  for (let i = 0; i < 3; i++) {
    assert(batchA[i].summary.waveReached === batchB[i].summary.waveReached,
      `seeded runBatch: run ${i} waveReached matches`);
    assert(batchA[i].summary.finalScore === batchB[i].summary.finalScore,
      `seeded runBatch: run ${i} finalScore matches`);
    assert(batchA[i].id === batchB[i].id,
      `seeded runBatch: run ${i} session.id matches`);
  }
  // runBatch derives per-run seed as baseSeed + runId, so runs within one
  // batch should not all be identical.
  const allSame =
    batchA[0].summary.waveReached === batchA[1].summary.waveReached &&
    batchA[0].summary.finalScore === batchA[1].summary.finalScore &&
    batchA[0].summary.waveReached === batchA[2].summary.waveReached;
  assert(!allSame, 'seeded runBatch: runs within one batch vary (seed+runId)');
}

// --- perWaveStats: empty input returns empty array ---
{
  const curve = perWaveStats([]);
  assert(Array.isArray(curve) && curve.length === 0, 'perWaveStats: empty batch → []');
}

// --- perWaveStats: synthetic sessions produce expected buckets ---
{
  // Hand-build three session objects in the shape the logger emits. Two
  // reach wave 3 (one dies there), one reaches wave 2 (dies there).
  const mkSession = (id, lastWave, died, kills) => ({
    id,
    summary: { waveReached: lastWave, died, durationMs: 0, finalScore: 0, cardsPicked: [] },
    events: [
      ...Array.from({ length: lastWave }, (_, i) => ({ t: 0, type: 'wave_start', wave: i + 1 })),
      ...kills.map(w => ({ t: 0, type: 'guard_killed', wave: w, guardType: 'basic', source: 'melee' })),
      // Emit wave_end only for waves fully cleared (i.e. everything except
      // the death wave when `died` is true).
      ...Array.from(
        { length: died ? lastWave - 1 : lastWave },
        (_, i) => ({ t: 0, type: 'wave_end', wave: i + 1, durationMs: (i + 1) * 1000, damageTaken: (i + 1) * 10 })
      ),
    ],
  });

  const sessions = [
    mkSession('a', 3, true, [1, 1, 2, 3]),   // dies wave 3
    mkSession('b', 3, false, [1, 2, 2, 3, 3]), // survives wave 3 cleanly
    mkSession('c', 2, true, [1, 2]),          // dies wave 2
  ];
  const curve = perWaveStats(sessions);

  assert(curve.length === 3, `perWaveStats: 3 wave buckets (got ${curve.length})`);
  assert(curve[0].wave === 1 && curve[0].reachedCount === 3, 'perWaveStats: wave 1 reached by all 3');
  assert(curve[0].diedHere === 0, 'perWaveStats: nobody died in wave 1');
  assert(curve[0].mortalityPct === 0, 'perWaveStats: wave 1 mortality 0%');
  assert(curve[1].wave === 2 && curve[1].reachedCount === 3, 'perWaveStats: wave 2 reached by all 3');
  assert(curve[1].diedHere === 1, 'perWaveStats: wave 2 killed session c');
  assert(Math.abs(curve[1].mortalityPct - (1 / 3) * 100) < 0.01, 'perWaveStats: wave 2 mortality ≈ 33%');
  assert(curve[2].wave === 3 && curve[2].reachedCount === 2, 'perWaveStats: wave 3 reached by 2');
  assert(curve[2].diedHere === 1, 'perWaveStats: wave 3 killed session a');
  assert(curve[2].mortalityPct === 50, 'perWaveStats: wave 3 mortality 50%');
  // Median kills on wave 2: a has 1, b has 2, c has 1 → median = 1.
  assert(curve[1].medianKills === 1, `perWaveStats: wave 2 medianKills = 1 (got ${curve[1].medianKills})`);
  // Wave 1 median damage = 10 (a, b cleared at 10 each; c never recorded
  // a wave_end for wave 1, so it's included with 10 too).
  assert(curve[0].medianDamageTaken === 10, `perWaveStats: wave 1 medianDamageTaken = 10 (got ${curve[0].medianDamageTaken})`);
}

// --- perWaveStats integration: real SessionLogger → perWaveStats ---
// Exercises the logger event shape directly (not hand-built events) so a
// schema drift between logger and aggregator is caught here.
{
  resetStorage();
  const l = new SessionLogger({ commit: 'integration' });
  l.startSession();
  l.logWaveStart(1, {});
  l.logGuardKilled('basic', 1);
  l.logGuardKilled('basic', 1);
  l.logWaveEnd(1, { durationMs: 3000, damageTaken: 20, caravansRobbed: 1 });
  l.logFlawless(1, 100);
  l.logWaveStart(2, {});
  l.logGuardKilled('armored', 2);
  l.logDeath(2, 500);
  const finished = l.endSession({ died: true, finalScore: 500, waveReached: 2 });

  const curve = perWaveStats([finished]);
  assert(curve.length === 2, 'integration: 2 wave buckets');
  assert(curve[0].reachedCount === 1 && curve[0].diedHere === 0, 'integration: wave 1 survived');
  assert(curve[0].medianKills === 2, `integration: wave 1 kills=2 (got ${curve[0].medianKills})`);
  assert(curve[0].medianDamageTaken === 20, 'integration: wave 1 damage=20');
  assert(curve[0].flawlessCount === 1, 'integration: flawlessCount tracked');
  assert(curve[1].reachedCount === 1 && curve[1].diedHere === 1, 'integration: wave 2 fatal');
  assert(curve[1].mortalityPct === 100, 'integration: wave 2 mortality 100%');
}

// --- perWaveStats integration: real sim produces a monotone difficulty curve ---
{
  resetStorage();
  // Seeded so the curve is stable across test reruns.
  const sessions = runBatch(() => new GreedyPolicy(), 20, { maxWaves: 8, seed: 101 });
  const curve = perWaveStats(sessions);
  assert(curve.length >= 1, 'perWaveStats(real): at least one wave bucket');
  // Wave 1 should have been reached by all runs.
  assert(curve[0].reachedCount === 20, `perWaveStats(real): wave 1 reachedCount = 20 (got ${curve[0].reachedCount})`);
  // reachedCount is non-increasing as waves advance — once you die you can't
  // come back to play a later wave.
  for (let i = 1; i < curve.length; i++) {
    assert(curve[i].reachedCount <= curve[i - 1].reachedCount,
      `perWaveStats(real): reachedCount monotone (wave ${curve[i].wave})`);
  }
  // At least one wave in the batch records at least one death — otherwise
  // the wave-curve output is empty of information.
  const anyDeaths = curve.some(c => c.diedHere > 0);
  assert(anyDeaths, 'perWaveStats(real): at least one death somewhere in the curve');
}

// --- comboScan: shape + sort order + reproducibility ---
{
  resetStorage();
  // Tiny scan: 3 cards → 3 pairs, 4 sims per pair + 4 baseline = 16 sims.
  // Kept small so the test runs in a few seconds.
  const cards = ['damage', 'maxHp', 'speed'];
  const result = comboScan(() => new GreedyPolicy(), {
    count: 4,
    maxWaves: 4,
    cards,
    seed: 77,
    stackSize: 2,
  });
  assert(Array.isArray(result.pairs), 'comboScan: pairs array');
  assert(result.pairs.length === 3, `comboScan: 3 pairs for 3 cards (got ${result.pairs.length})`);
  assert(result.baseline.n === 4, 'comboScan: baseline n');
  assert(typeof result.baseline.median === 'number', 'comboScan: baseline median');
  assert(result.stackSize === 2, 'comboScan: stackSize echoed');
  assert(result.cardIds.length === 3, 'comboScan: cardIds echoed');

  // Pairs should be sorted descending by delta (median preferred, mean as
  // tiebreak).
  for (let i = 1; i < result.pairs.length; i++) {
    const prev = result.pairs[i - 1];
    const cur = result.pairs[i];
    const ok = prev.delta > cur.delta || (prev.delta === cur.delta && prev.mean >= cur.mean);
    assert(ok, `comboScan: pairs sorted by delta desc (${prev.delta} → ${cur.delta})`);
  }

  // Every pair has the two ids, plus stats fields.
  for (const p of result.pairs) {
    assert(typeof p.a === 'string' && typeof p.b === 'string', 'comboScan: pair ids');
    assert(p.a !== p.b, 'comboScan: pair ids differ');
    assert(typeof p.median === 'number', 'comboScan: pair median');
    assert(typeof p.mean === 'number', 'comboScan: pair mean');
    assert(p.n === 4, 'comboScan: pair n');
    assert(p.delta === p.median - result.baseline.median, 'comboScan: delta = pairMed - baseMed');
  }

  // Same seed → same output (sanity check for reproducibility).
  resetStorage();
  const again = comboScan(() => new GreedyPolicy(), {
    count: 4,
    maxWaves: 4,
    cards,
    seed: 77,
    stackSize: 2,
  });
  for (let i = 0; i < result.pairs.length; i++) {
    assert(result.pairs[i].a === again.pairs[i].a, `comboScan reproducible: pair[${i}].a`);
    assert(result.pairs[i].b === again.pairs[i].b, `comboScan reproducible: pair[${i}].b`);
    assert(result.pairs[i].median === again.pairs[i].median, `comboScan reproducible: pair[${i}].median`);
    assert(result.pairs[i].mean === again.pairs[i].mean, `comboScan reproducible: pair[${i}].mean`);
  }
  assert(result.baseline.median === again.baseline.median, 'comboScan reproducible: baseline median');
}

// --- comboScan: onProgress is called for each pair ---
{
  resetStorage();
  let calls = 0;
  let lastDone = 0;
  let lastTotal = 0;
  const result = comboScan(() => new GreedyPolicy(), {
    count: 2,
    maxWaves: 3,
    cards: ['damage', 'maxHp', 'speed', 'cooldown'], // 6 pairs
    seed: 11,
    stackSize: 1,
    onProgress: (done, total) => { calls++; lastDone = done; lastTotal = total; },
  });
  assert(calls === 6, `comboScan: onProgress called once per pair (got ${calls})`);
  assert(lastDone === 6 && lastTotal === 6, 'comboScan: onProgress final tick is (N, N)');
  assert(result.pairs.length === 6, 'comboScan: 6 pairs for 4 cards');
}

console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
