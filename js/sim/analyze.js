#!/usr/bin/env node
// CLI analyzer for session logs — reads sim exports or live telemetry
// and prints aggregated balance metrics. Closes the real-log side of
// the sim-vs-real feedback loop: live player data and sim bot data go
// through the same pipeline and can be diffed with --compare.
//
// Usage:
//   node js/sim/analyze.js <path> [--compare <path>] [--top N]
//
// `path` can be any of:
//   - a directory of session JSON files (telemetry server output)
//   - a single raw session file
//   - a sim run.js export  ({main: {sessions: [...]}, compare?})
//   - a browser downloadExport  ({sessions: [...], count, exportedAt})
//
// Metrics printed:
//   - wave reached percentiles (min/p25/p50/p75/p95/max)
//   - card pickrate (top N, % of runs that picked ≥1 of each)
//   - card impact (median wave Δ with vs without) — via cardImpact()
//   - damage taken by source (melee/archer/caravan/thorns-reflect)
//   - death causes (source of the killing blow for died runs)
//   - per-wave mortality curve (same format as run.js)
//
// Compare mode (`--compare B`) prints A's report, B's report, and a
// DIFF block (wave-percentile deltas, pickrate shifts).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { summarizeBatch, cardImpact, perWaveStats } from './simulator.js';

function parseArgs(argv) {
  const opts = { path: null, comparePath: null, topN: 10 };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--compare') opts.comparePath = args[++i];
    else if (a === '--top') opts.topN = parseInt(args[++i], 10);
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else if (a.startsWith('--')) { console.error(`unknown flag: ${a}`); usage(); process.exit(1); }
    else if (!opts.path) opts.path = a;
    else { console.error(`unexpected arg: ${a}`); usage(); process.exit(1); }
  }
  if (!opts.path) { usage(); process.exit(1); }
  return opts;
}

function usage() {
  console.error('usage: node js/sim/analyze.js <path> [--compare <path>] [--top N]');
  console.error('  <path>: directory of session JSONs, or single JSON file');
  console.error('  --compare <path>: second dataset for A/B diff');
  console.error('  --top N: how many rows in pickrate/impact tables (default 10)');
}

// --- Loading / shape detection ---------------------------------------

// Normalize any supported input into a flat array of session objects.
function loadSessions(path) {
  const full = resolve(path);
  const st = statSync(full);
  const out = [];
  if (st.isDirectory()) {
    const files = readdirSync(full).filter(f => extname(f) === '.json').sort();
    for (const f of files) {
      try {
        const parsed = JSON.parse(readFileSync(join(full, f), 'utf8'));
        for (const s of extractSessions(parsed)) out.push(s);
      } catch (e) {
        console.warn(`  skip ${f}: ${e.message}`);
      }
    }
  } else {
    const parsed = JSON.parse(readFileSync(full, 'utf8'));
    for (const s of extractSessions(parsed)) out.push(s);
  }
  return out;
}

// Three supported shapes, probed in order of specificity.
function extractSessions(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  // 1. Raw session (telemetry server writes these, one per file).
  if (parsed.id && Array.isArray(parsed.events) && parsed.summary) return [parsed];
  // 2. Sim run.js export — {main: {sessions: [...]}, compare?}. When
  //    --compare was used, we also take the compare arm so an analyzer
  //    diff can mirror it.
  if (parsed.main && Array.isArray(parsed.main.sessions)) {
    const sessions = [...parsed.main.sessions];
    if (parsed.compare && Array.isArray(parsed.compare.sessions)) {
      sessions.push(...parsed.compare.sessions);
    }
    return sessions;
  }
  // 3. Browser downloadExport — {sessions: [...], count, exportedAt}.
  if (Array.isArray(parsed.sessions)) return parsed.sessions;
  return [];
}

// --- Extra metrics not in simulator.js --------------------------------

// Aggregate every `player_damaged` event by its source field.
// Returns { [source]: { hits, total } }.
function damageBySource(sessions) {
  const acc = {};
  for (const s of sessions) {
    for (const ev of s.events) {
      if (ev.type !== 'player_damaged') continue;
      const src = ev.source || 'unknown';
      if (!acc[src]) acc[src] = { hits: 0, total: 0 };
      acc[src].hits++;
      acc[src].total += ev.amount || 0;
    }
  }
  return acc;
}

// For died runs, walk events in order and remember the last
// player_damaged source before player_died — that's the killing blow.
// Counts by source. Answers "what actually kills players?"
function deathCauses(sessions) {
  const causes = {};
  for (const s of sessions) {
    if (!s.summary.died) continue;
    let killer = 'unknown';
    for (const ev of s.events) {
      if (ev.type === 'player_damaged') killer = ev.source || 'unknown';
      if (ev.type === 'player_died') break;
    }
    causes[killer] = (causes[killer] || 0) + 1;
  }
  return causes;
}

// Simple percentile helper. Uses nearest-rank so p50 matches the
// median(values) semantics used elsewhere in the sim code.
function percentiles(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    min: sorted[0],
    p25: pick(0.25),
    p50: pick(0.5),
    p75: pick(0.75),
    p95: pick(0.95),
    max: sorted[sorted.length - 1],
  };
}

function avg(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Count free and paid card picks per session. `mode` was added to the
// cardsPicked entry shape at some point — older sessions may omit it,
// in which case we treat the pick as 'free' (end-of-wave draft is the
// only free source, so missing mode defaults to the majority case).
function splitPicks(session) {
  const picks = (session.summary && session.summary.cardsPicked) || [];
  let free = 0, paid = 0;
  for (const p of picks) {
    if (p.mode === 'paid') paid++;
    else free++;
  }
  return { free, paid, total: picks.length };
}

// Bucket sessions by paid-pick count. Reveals the "free only" vs
// "paid shop grinder" split that's been dominating live playtests.
function paidCohorts(sessions) {
  const buckets = {
    'paid=0':   sessions.filter(s => splitPicks(s).paid === 0),
    'paid=1-2': sessions.filter(s => { const p = splitPicks(s).paid; return p >= 1 && p <= 2; }),
    'paid=3-5': sessions.filter(s => { const p = splitPicks(s).paid; return p >= 3 && p <= 5; }),
    'paid≥6':   sessions.filter(s => splitPicks(s).paid >= 6),
  };
  return buckets;
}

// --- Rendering helpers ------------------------------------------------

function bar(value, max, width = 20) {
  if (!isFinite(max) || max <= 0) return '·'.repeat(width);
  const filled = Math.round((value / max) * width);
  const clamped = Math.max(0, Math.min(width, filled));
  return '█'.repeat(clamped) + '·'.repeat(width - clamped);
}

function pct(x) { return (x * 100).toFixed(1) + '%'; }
function pad(s, w) { return String(s).padStart(w); }

// --- Single-dataset report -------------------------------------------

function renderReport(label, sessions, topN) {
  console.log(`\n=== ${label} — ${sessions.length} sessions ===`);
  if (!sessions.length) { console.log('  (no sessions)'); return; }

  const batch = summarizeBatch(sessions);
  const waves = sessions.map(s => s.summary.waveReached);
  const pc = percentiles(waves);
  const died = sessions.filter(s => s.summary.died).length;
  const timedOut = sessions.filter(s => s.summary.timedOut).length;
  const abandoned = sessions.length - died - timedOut;
  const avgDurSec = avg(sessions.map(s => (s.summary.durationMs || 0) / 1000));

  const durs = sessions.map(s => (s.summary.durationMs || 0) / 1000);
  const durPC = percentiles(durs);
  const splits = sessions.map(s => splitPicks(s));
  const freeAvg = avg(splits.map(s => s.free));
  const paidAvg = avg(splits.map(s => s.paid));
  const freeMed = median(splits.map(s => s.free));
  const paidMed = median(splits.map(s => s.paid));
  const goldEarned = avg(sessions.map(s => s.summary.goldEarned || 0));
  const goldSpent = avg(sessions.map(s => s.summary.goldSpent || 0));
  const rerollsAvg = avg(sessions.map(s => s.summary.rerolls || 0));

  console.log(`  ended:     died ${died}  timedOut ${timedOut}  abandoned ${abandoned}`);
  console.log(`  wave:      min ${pc.min}  p25 ${pc.p25}  p50 ${pc.p50}  p75 ${pc.p75}  p95 ${pc.p95}  max ${pc.max}`);
  console.log(`  duration:  p25 ${Math.round(durPC.p25)}s  p50 ${Math.round(durPC.p50)}s  p75 ${Math.round(durPC.p75)}s  p95 ${Math.round(durPC.p95)}s  max ${Math.round(durPC.max)}s  (mean ${(avgDurSec / 60).toFixed(1)} min)`);
  console.log(`  cards/run: free median ${freeMed} (mean ${freeAvg.toFixed(1)})  paid median ${paidMed} (mean ${paidAvg.toFixed(1)})`);
  console.log(`  economy:   gold earned avg ${goldEarned.toFixed(0)}  spent avg ${goldSpent.toFixed(0)}  rerolls/run ${rerollsAvg.toFixed(2)}`);
  console.log(`  flawless/run: ${avg(sessions.map(s => s.summary.flawlessWaves || 0)).toFixed(2)}`);

  // --- Paid cohort split — answers "does the paid shop matter?"
  const cohorts = paidCohorts(sessions);
  const cohortRows = Object.entries(cohorts).filter(([, arr]) => arr.length > 0);
  if (cohortRows.length) {
    console.log(`\n  Paid-shop cohort (bucket by # of paid picks per run):`);
    console.log(`    bucket     n   medWave  medDur   medFree  medPaid  medSpent`);
    for (const [label, arr] of cohortRows) {
      const w = median(arr.map(s => s.summary.waveReached));
      const d = median(arr.map(s => (s.summary.durationMs || 0) / 1000));
      const f = median(arr.map(s => splitPicks(s).free));
      const p = median(arr.map(s => splitPicks(s).paid));
      const sp = median(arr.map(s => s.summary.goldSpent || 0));
      console.log(`    ${label.padEnd(9)} ${pad(arr.length, 3)}   ${pad(w, 6)}  ${pad(Math.round(d), 5)}s  ${pad(f, 7)}  ${pad(p, 7)}  ${pad(Math.round(sp), 8)}`);
    }
  }

  // --- Outlier sessions: longest runs by duration (often signal an exploit)
  const longest = [...sessions]
    .sort((a, b) => (b.summary.durationMs || 0) - (a.summary.durationMs || 0))
    .slice(0, 3);
  const medDur = median(durs);
  if (longest.length && longest[0].summary.durationMs / 1000 > medDur * 3) {
    console.log(`\n  Outlier runs (≥3× median duration — possible grind/exploit):`);
    console.log(`    id            wave  dur     free  paid  rr  spent`);
    for (const s of longest) {
      const sp = splitPicks(s);
      const id = (s.id || '?').slice(0, 12);
      const dur = Math.round((s.summary.durationMs || 0) / 1000);
      if (dur <= medDur * 3) break;
      console.log(`    ${id.padEnd(13)} ${pad(s.summary.waveReached, 4)}  ${pad(dur, 5)}s  ${pad(sp.free, 4)}  ${pad(sp.paid, 4)}  ${pad(s.summary.rerolls || 0, 2)}  ${pad(s.summary.goldSpent || 0, 5)}`);
    }
  }

  // --- Card pickrate
  const pickCounts = batch.pickCounts || {};
  const sortedPicks = Object.entries(pickCounts).sort((a, b) => b[1] - a[1]);
  if (sortedPicks.length) {
    const maxPick = sortedPicks[0][1];
    console.log(`\n  Card pickrate (top ${topN}, % of runs with ≥1 pick):`);
    for (const [id, count] of sortedPicks.slice(0, topN)) {
      const runs = sessions.filter(s => s.summary.cardsPicked.some(p => p.id === id)).length;
      const share = runs / sessions.length;
      console.log(`    ${id.padEnd(16)} ${bar(count, maxPick)} ${pad(count, 4)}  (${pct(share)} of runs)`);
    }
  }

  // --- Card impact
  const impact = cardImpact(sessions).filter(c => !c.sparse);
  if (impact.length) {
    console.log(`\n  Card impact (median wave delta, stable splits only):`);
    console.log(`    ${'id'.padEnd(16)}  Δwave    with   without   n(with)   avgStack`);
    for (const c of impact.slice(0, topN)) {
      const sign = c.waveDelta >= 0 ? '+' : '';
      console.log(
        `    ${c.id.padEnd(16)} ` +
        `${(sign + c.waveDelta.toFixed(1)).padStart(6)}  ` +
        `${c.withMedianWave.toFixed(1).padStart(6)}   ` +
        `${c.withoutMedianWave.toFixed(1).padStart(7)}   ` +
        `${pad(c.withCount, 7)}   ` +
        `${c.avgStack.toFixed(2).padStart(8)}`
      );
    }
  }

  // --- Damage by source
  const dmg = damageBySource(sessions);
  const dmgTotal = Object.values(dmg).reduce((a, b) => a + b.total, 0);
  const sortedDmg = Object.entries(dmg).sort((a, b) => b[1].total - a[1].total);
  if (sortedDmg.length) {
    const maxDmg = sortedDmg[0][1].total;
    console.log(`\n  Damage taken by source (total ${Math.round(dmgTotal)}):`);
    for (const [src, d] of sortedDmg) {
      const share = dmgTotal > 0 ? pct(d.total / dmgTotal) : '0.0%';
      const avgHit = d.hits > 0 ? (d.total / d.hits).toFixed(1) : '0.0';
      console.log(`    ${src.padEnd(16)} ${bar(d.total, maxDmg)} ${pad(Math.round(d.total), 6)}  (${share.padStart(6)}, ${pad(d.hits, 5)} hits, ${avgHit.padStart(5)} avg)`);
    }
  }

  // --- Death causes
  const deaths = deathCauses(sessions);
  const totalDeaths = Object.values(deaths).reduce((a, b) => a + b, 0);
  if (totalDeaths) {
    const sortedDeaths = Object.entries(deaths).sort((a, b) => b[1] - a[1]);
    const maxDeath = sortedDeaths[0][1];
    console.log(`\n  Death causes (killing blow source, ${totalDeaths} deaths):`);
    for (const [src, cnt] of sortedDeaths) {
      console.log(`    ${src.padEnd(16)} ${bar(cnt, maxDeath)} ${pad(cnt, 4)}  (${pct(cnt / totalDeaths)})`);
    }
  }

  // --- Wave curve
  const curve = perWaveStats(sessions);
  if (curve.length) {
    console.log(`\n  Wave curve:`);
    console.log(`    wave  reach  died  mort%                         medDur  medDmg`);
    for (const row of curve) {
      const dur = Math.round((row.medianDuration || 0) / 1000);
      const dmgRow = Math.round(row.medianDamageTaken || 0);
      const mort = row.mortalityPct.toFixed(1);
      console.log(
        `    ${pad(row.wave, 4)} ` +
        `${pad(row.reachedCount, 6)} ` +
        `${pad(row.diedHere, 5)} ` +
        `${mort.padStart(5)}  ` +
        `${bar(row.mortalityPct, 20)}  ` +
        `${pad(dur, 6)}  ` +
        `${pad(dmgRow, 6)}`
      );
    }
  }
}

// --- Diff (compare mode) ----------------------------------------------

function renderDiff(aLabel, aSess, bLabel, bSess, topN) {
  const aPC = percentiles(aSess.map(s => s.summary.waveReached));
  const bPC = percentiles(bSess.map(s => s.summary.waveReached));
  const aDied = aSess.filter(s => s.summary.died).length;
  const bDied = bSess.filter(s => s.summary.died).length;
  const aDeathRate = aSess.length ? aDied / aSess.length : 0;
  const bDeathRate = bSess.length ? bDied / bSess.length : 0;

  const d = (x, y) => {
    const diff = y - x;
    return (diff >= 0 ? '+' : '') + diff.toFixed(1);
  };

  console.log(`\n=== DIFF  [A] ${aLabel}  →  [B] ${bLabel} ===`);
  console.log(`  sessions:        ${aSess.length}  →  ${bSess.length}`);
  if (aPC && bPC) {
    console.log(`  wave p25/p50/p75/p95:  A=${aPC.p25}/${aPC.p50}/${aPC.p75}/${aPC.p95}  B=${bPC.p25}/${bPC.p50}/${bPC.p75}/${bPC.p95}`);
    console.log(`  wave median delta:     ${d(aPC.p50, bPC.p50)}`);
    console.log(`  wave p95 delta:        ${d(aPC.p95, bPC.p95)}`);
  }
  console.log(`  death rate:      ${pct(aDeathRate)}  →  ${pct(bDeathRate)}`);

  // Card pickrate shifts — biggest absolute delta first. Rate is
  // "share of runs that picked this card at least once", not total
  // picks (otherwise stacking pushes the share above 100%).
  const perRunRate = (sessions) => {
    const rates = {};
    for (const s of sessions) {
      const seen = new Set();
      for (const p of s.summary.cardsPicked) seen.add(p.id);
      for (const id of seen) rates[id] = (rates[id] || 0) + 1;
    }
    for (const id of Object.keys(rates)) rates[id] /= Math.max(1, sessions.length);
    return rates;
  };
  const aRates = perRunRate(aSess);
  const bRates = perRunRate(bSess);
  const allCards = new Set([...Object.keys(aRates), ...Object.keys(bRates)]);
  const shifts = [];
  for (const id of allCards) {
    const aRate = aRates[id] || 0;
    const bRate = bRates[id] || 0;
    shifts.push({ id, aRate, bRate, delta: bRate - aRate });
  }
  shifts.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  console.log(`\n  Card pickrate shifts (biggest absolute delta):`);
  for (const r of shifts.slice(0, topN)) {
    const sign = r.delta >= 0 ? '+' : '';
    console.log(
      `    ${r.id.padEnd(16)} ` +
      `${pct(r.aRate).padStart(7)}  →  ${pct(r.bRate).padStart(7)}  ` +
      `(${sign}${(r.delta * 100).toFixed(1)}pp)`
    );
  }
}

// --- Main -------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv);
  const aSessions = loadSessions(opts.path);
  if (!aSessions.length) {
    console.error(`No sessions found at ${opts.path}`);
    process.exit(1);
  }
  renderReport(opts.path, aSessions, opts.topN);

  if (opts.comparePath) {
    const bSessions = loadSessions(opts.comparePath);
    if (!bSessions.length) {
      console.error(`No sessions found at ${opts.comparePath}`);
      process.exit(1);
    }
    renderReport(opts.comparePath, bSessions, opts.topN);
    renderDiff(opts.path, aSessions, opts.comparePath, bSessions, opts.topN);
  }
}

main();
