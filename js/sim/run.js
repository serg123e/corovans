// CLI runner for the headless simulator.
//
// Basic usage:
//   node js/sim/run.js [--policy <name>] [--count <N>] [--max-waves <N>]
//                      [--prefer <ids>] [--avoid <ids>]
//                      [--compare <spec>]
//                      [--out <file>] [--quiet] [--top <N>]
//
// Policies:
//   greedy         — hunts nearest threat, picks first card
//   random-cards   — same movement, random card each offer
//   runner         — ignores guards, rushes caravans
//   preference     — greedy + ranked card whitelist (use with --prefer)
//
// Preference spec:
//   --prefer thorns,lifesteal,dashCooldown
//     Uses the `preference` policy and picks from the list in order.
//   --avoid glassCannon,wideArc
//     Passes an avoid list to the preference policy. Combines with --prefer.
//
// A/B comparison:
//   --compare "alt=preference --prefer thorns"
//     Runs the main --policy once, runs the alt spec once, prints the
//     delta (waveReached, score, survival, cards).
//
// Output:
//   Default — human-readable summary + card impact table.
//   --out file — writes full sessions + summary to JSON (same schema as
//     the live-game session export).

import { readFileSync, writeFileSync } from 'node:fs';
import { runBatch, summarizeBatch, perWaveStats } from './simulator.js';
import { POLICIES } from './policies.js';

function parseArgs(argv) {
  const opts = {
    policy: 'greedy',
    count: 20,
    maxWaves: 30,
    out: null,
    quiet: false,
    topN: 10,
    prefer: null,
    avoid: null,
    compare: null,
    startCards: null,
    seed: null,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--policy': opts.policy = args[++i]; break;
      case '--count': opts.count = parseInt(args[++i], 10); break;
      case '--max-waves': opts.maxWaves = parseInt(args[++i], 10); break;
      case '--out': opts.out = args[++i]; break;
      case '--quiet': opts.quiet = true; break;
      case '--top': opts.topN = parseInt(args[++i], 10); break;
      case '--prefer': opts.prefer = args[++i].split(',').map(s => s.trim()).filter(Boolean); break;
      case '--avoid': opts.avoid = args[++i].split(',').map(s => s.trim()).filter(Boolean); break;
      case '--compare': opts.compare = args[++i]; break;
      case '--start-cards': opts.startCards = args[++i].split(',').map(s => s.trim()).filter(Boolean); break;
      case '--seed': opts.seed = parseInt(args[++i], 10); break;
      case '-h':
      case '--help':
        console.log('Usage: node js/sim/run.js [--policy name] [--count N] [--max-waves N]');
        console.log('                           [--prefer ids] [--avoid ids] [--compare spec]');
        console.log('                           [--seed N] [--out file] [--quiet] [--top N]');
        console.log('Policies: ' + Object.keys(POLICIES).join(', '));
        console.log('Examples:');
        console.log('  # Force thorns-heavy builds');
        console.log('  node js/sim/run.js --policy preference --prefer thorns,lifesteal --count 200');
        console.log('  # A/B: thorns-first vs thorns-banned');
        console.log('  node js/sim/run.js --policy preference --prefer thorns --count 200 \\');
        console.log('                    --compare "preference --avoid thorns"');
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(1);
    }
  }
  if (opts.prefer || opts.avoid) {
    // Implicit policy switch so --prefer alone is convenient.
    if (opts.policy === 'greedy') opts.policy = 'preference';
  }
  if (!POLICIES[opts.policy]) {
    console.error(`Unknown policy "${opts.policy}". Available: ${Object.keys(POLICIES).join(', ')}`);
    process.exit(1);
  }
  if (!Number.isFinite(opts.count) || opts.count < 1) {
    console.error(`Invalid --count: must be a positive integer`);
    process.exit(1);
  }
  return opts;
}

// Parse a spec string like "preference --prefer thorns --avoid foo --start-cards damage,speed"
// into a config object. Supports the same --policy/--prefer/--avoid/--start-cards flags
// run.js itself parses from argv.
// Start cards in the alt spec are independent from the main run — that's
// the whole point of --compare (test "main with bake" vs "alt without bake").
function parseSpec(spec) {
  const tokens = spec.trim().split(/\s+/);
  const cfg = { policy: tokens[0] || 'greedy', prefer: null, avoid: null, startCards: [] };
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === '--prefer') {
      cfg.prefer = tokens[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (tokens[i] === '--avoid') {
      cfg.avoid = tokens[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (tokens[i] === '--start-cards') {
      cfg.startCards = tokens[++i].split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  if ((cfg.prefer || cfg.avoid) && cfg.policy === 'greedy') cfg.policy = 'preference';
  if (!POLICIES[cfg.policy]) {
    throw new Error(`Unknown policy in spec "${spec}"`);
  }
  return cfg;
}

function buildFactory(cfg) {
  return () => POLICIES[cfg.policy]({ prefer: cfg.prefer || [], avoid: cfg.avoid || [] });
}

function loadCommit() {
  try {
    const data = JSON.parse(readFileSync(new URL('../../version.json', import.meta.url), 'utf8'));
    return data.commit || 'sim';
  } catch (e) {
    return 'sim';
  }
}

function describeConfig(cfg, startCards) {
  const parts = [cfg.policy];
  if (cfg.prefer && cfg.prefer.length) parts.push(`prefer=${cfg.prefer.join(',')}`);
  if (cfg.avoid && cfg.avoid.length) parts.push(`avoid=${cfg.avoid.join(',')}`);
  if (startCards && startCards.length) parts.push(`start=${startCards.join(',')}`);
  return parts.join(' ');
}

function bar(n, max, width = 20) {
  if (!max) return ' '.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((n / max) * width)));
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

function printSummary(label, config, summary, elapsedMs, topN, startCards) {
  console.log(`\n=== ${label} — ${describeConfig(config, startCards)} × ${summary.count} (${elapsedMs}ms) ===`);
  console.log(`Deaths:         ${summary.deaths}/${summary.count}  (survival ${(summary.survivalRate * 100).toFixed(0)}%)`);
  console.log(`Wave reached:   min ${summary.waveReached.min}  median ${summary.waveReached.median}  mean ${summary.waveReached.mean.toFixed(1)}  max ${summary.waveReached.max}`);
  console.log(`Final score:    min ${summary.score.min}  median ${summary.score.median}  mean ${summary.score.mean.toFixed(0)}  max ${summary.score.max}`);
  console.log(`Avg kills/run:  ${summary.guardsKilled.toFixed(1)}  (thorns: ${(summary.thornsKillsAvg || 0).toFixed(1)}, melee: ${(summary.meleeKillsAvg || 0).toFixed(1)})`);
  console.log(`Avg caravans:   ${summary.caravansRobbed.toFixed(1)}`);
  console.log(`Avg dmg taken:  ${summary.damageTaken.toFixed(0)}`);
  console.log(`Avg dmg reflected: ${(summary.damageReflectedAvg || 0).toFixed(0)}`);

  const sortedPicks = Object.entries(summary.pickCounts).sort((a, b) => b[1] - a[1]);
  if (sortedPicks.length > 0) {
    console.log(`\nCards picked (top ${Math.min(topN, sortedPicks.length)}):`);
    const maxCount = sortedPicks[0][1];
    for (const [id, count] of sortedPicks.slice(0, topN)) {
      console.log(`  ${id.padEnd(16)} ${bar(count, maxCount)} ${count}`);
    }
  }

  // Per-card impact — filter out sparse splits (<5 in either cohort).
  const impact = (summary.cardImpact || []).filter(c => !c.sparse);
  if (impact.length > 0) {
    console.log(`\nCard impact (median wave delta, with vs without, stable splits only):`);
    console.log(`  ${'id'.padEnd(16)} ${'Δwave'.padStart(6)}  ${'with'.padStart(6)}  ${'without'.padStart(8)}  ${'n(with)'.padStart(8)}  ${'avgStack'.padStart(9)}`);
    const shown = impact.slice(0, topN);
    for (const c of shown) {
      const delta = c.waveDelta;
      const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(1);
      console.log(
        `  ${c.id.padEnd(16)} ${deltaStr.padStart(6)}  ${c.withMedianWave.toFixed(1).padStart(6)}  ${c.withoutMedianWave.toFixed(1).padStart(8)}  ${String(c.withCount).padStart(8)}  ${c.avgStack.toFixed(2).padStart(9)}`
      );
    }
  } else {
    console.log(`\n(no stable card-impact splits — need larger --count)`);
  }
}

// ASCII wave-mortality chart. Bars are scaled against the largest
// mortalityPct in the curve so small absolute numbers still show contrast.
// Caller passes the curve from perWaveStats(sessions).
function printWaveCurve(curve) {
  if (!curve || curve.length === 0) {
    console.log(`\n(no wave data)`);
    return;
  }
  const maxMortality = Math.max(1, ...curve.map(c => c.mortalityPct));
  console.log(`\nWave curve (mortality % = died in wave / reached wave):`);
  console.log(
    `  ${'wave'.padStart(4)}  ${'reach'.padStart(5)}  ${'died'.padStart(5)}  ${'mort%'.padStart(5)}  ${''.padEnd(20)}  ${'medKill'.padStart(7)}  ${'medDmg'.padStart(6)}  ${'flaw'.padStart(4)}`
  );
  for (const w of curve) {
    const m = w.mortalityPct.toFixed(0);
    console.log(
      `  ${String(w.wave).padStart(4)}  ${String(w.reachedCount).padStart(5)}  ${String(w.diedHere).padStart(5)}  ${m.padStart(5)}  ${bar(w.mortalityPct, maxMortality)}  ${w.medianKills.toFixed(0).padStart(7)}  ${w.medianDamageTaken.toFixed(0).padStart(6)}  ${String(w.flawlessCount).padStart(4)}`
    );
  }
}

function printComparison(labelA, summaryA, labelB, summaryB) {
  const diff = (a, b) => {
    const d = a - b;
    return (d >= 0 ? '+' : '') + d.toFixed(1);
  };
  console.log(`\n=== DELTA: ${labelA} − ${labelB} ===`);
  console.log(`Δ median wave:    ${diff(summaryA.waveReached.median, summaryB.waveReached.median)}`);
  console.log(`Δ mean wave:      ${diff(summaryA.waveReached.mean, summaryB.waveReached.mean)}`);
  console.log(`Δ median score:   ${diff(summaryA.score.median, summaryB.score.median)}`);
  console.log(`Δ mean score:     ${diff(summaryA.score.mean, summaryB.score.mean)}`);
  console.log(`Δ survival rate:  ${diff(summaryA.survivalRate * 100, summaryB.survivalRate * 100)}%`);
  console.log(`Δ avg dmg taken:  ${diff(summaryA.damageTaken, summaryB.damageTaken)}`);
}

function runOne(cfg, count, maxWaves, commit, startCards, seed) {
  const factory = buildFactory(cfg);
  const t0 = Date.now();
  const sessions = runBatch(factory, count, {
    maxWaves,
    commit,
    startCards: startCards || [],
    seed,
  });
  const elapsedMs = Date.now() - t0;
  const summary = summarizeBatch(sessions);
  const waveCurve = perWaveStats(sessions);
  return { sessions, summary, waveCurve, elapsedMs, config: cfg };
}

function main() {
  const opts = parseArgs(process.argv);
  const commit = loadCommit();

  const mainCfg = {
    policy: opts.policy,
    prefer: opts.prefer,
    avoid: opts.avoid,
  };

  const mainRun = runOne(mainCfg, opts.count, opts.maxWaves, commit, opts.startCards, opts.seed);
  if (!opts.quiet) {
    printSummary('MAIN', mainRun.config, mainRun.summary, mainRun.elapsedMs, opts.topN, opts.startCards);
    printWaveCurve(mainRun.waveCurve);
  }

  let altRun = null;
  if (opts.compare) {
    let altCfg;
    try {
      altCfg = parseSpec(opts.compare);
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
    altRun = runOne(altCfg, opts.count, opts.maxWaves, commit, altCfg.startCards, opts.seed);
    if (!opts.quiet) {
      printSummary('COMPARE', altRun.config, altRun.summary, altRun.elapsedMs, opts.topN, altCfg.startCards);
      printWaveCurve(altRun.waveCurve);
      printComparison(
        describeConfig(mainRun.config, opts.startCards), mainRun.summary,
        describeConfig(altRun.config, altCfg.startCards), altRun.summary
      );
    }
  }

  if (opts.out) {
    const payload = {
      exportedAt: new Date().toISOString(),
      commit,
      main: {
        config: mainRun.config,
        summary: mainRun.summary,
        waveCurve: mainRun.waveCurve,
        sessions: mainRun.sessions,
      },
      compare: altRun ? {
        config: altRun.config,
        summary: altRun.summary,
        waveCurve: altRun.waveCurve,
        sessions: altRun.sessions,
      } : null,
    };
    writeFileSync(opts.out, JSON.stringify(payload, null, 2));
    if (!opts.quiet) console.log(`\nWrote sessions → ${opts.out}`);
  }
}

main();
