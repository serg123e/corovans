// Tests for UI class - draft card system, card pool, and picks

import { UI, CARDS, DraftMode } from '../js/ui.js';
import { Player } from '../js/player.js';
import { CONST } from '../js/utils.js';

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

// --- UI initialization ---
{
  const ui = new UI();
  assert(ui !== null, 'UI: creates successfully');
  assert(Array.isArray(ui.draftOffer) && ui.draftOffer.length === 0, 'UI: draftOffer starts empty');
  assert(ui.rerollCount === 0, 'UI: rerollCount starts at 0');
}

// --- UI reset ---
{
  const ui = new UI();
  ui.cardCounts['damage'] = 3;
  ui.rerollCount = 5;
  ui.draftOffer = [CARDS[0]];
  ui._paidPicksThisWave = 1;
  ui.reset();
  assert(Object.keys(ui.cardCounts).length === 0, 'UI reset: cardCounts cleared');
  assert(ui.rerollCount === 0, 'UI reset: rerollCount zeroed');
  assert(ui.draftOffer.length === 0, 'UI reset: draftOffer cleared');
  assert(ui._paidPicksThisWave === 0, 'UI reset: _paidPicksThisWave zeroed');
}

// --- beginFreeDraft draws 5 distinct cards ---
{
  const ui = new UI();
  ui.beginFreeDraft();
  assert(ui.draftOffer.length === 5, 'beginFreeDraft: draws 5 cards');
  assert(ui.draftMode === DraftMode.FREE, 'beginFreeDraft: mode is FREE');
  const ids = ui.draftOffer.map(c => c.id);
  const unique = new Set(ids);
  assert(unique.size === 5, 'beginFreeDraft: cards are distinct');
  for (const card of ui.draftOffer) {
    assert(typeof card.apply === 'function', `beginFreeDraft: ${card.id} has apply function`);
  }
}

// --- beginPaidDraft: sets PAID mode and draws 5 cards on first call ---
{
  const ui = new UI();
  ui.beginPaidDraft(1);
  assert(ui.draftMode === DraftMode.PAID, 'beginPaidDraft: mode is PAID');
  assert(ui.draftOffer.length === 5, 'beginPaidDraft: draws 5 cards');
}

// --- beginPaidDraft persists offer across calls within the same wave ---
{
  const ui = new UI();
  ui.beginPaidDraft(3);
  const firstIds = ui.draftOffer.map(c => c.id).join(',');
  ui.beginPaidDraft(3);
  const secondIds = ui.draftOffer.map(c => c.id).join(',');
  assert(firstIds === secondIds, 'beginPaidDraft: same wave keeps offer');
}

// --- beginPaidDraft refreshes on new wave ---
{
  const ui = new UI();
  ui.beginPaidDraft(1);
  ui.onWaveStart();
  ui.beginPaidDraft(2);
  // Offer length should still be 5; we can't assert exact difference
  // because random rolls may coincide, but onWaveStart() should have
  // invalidated the cache so a re-roll happened.
  assert(ui.draftOffer.length === 5, 'beginPaidDraft: 5 cards on new wave');
  assert(ui._paidOfferWave === 2, 'beginPaidDraft: tracked wave updated');
}

// --- pickCard (free mode) applies effect, deducts gold, clears offer ---
{
  const ui = new UI();
  ui.draftMode = DraftMode.FREE;
  const player = new Player(100, 100);
  player.gold = 100;
  const damageCard = CARDS.find(c => c.id === 'damage');
  ui.draftOffer = [damageCard];
  const origDamage = player.damage;
  const cost = ui.getCardCost(damageCard);

  const result = ui.pickCard(0, player);
  assert(result === true, 'pickCard(free): returns true on success');
  assert(player.damage === origDamage + 5, 'pickCard(free): damage card applied');
  assert(player.gold === 100 - cost, 'pickCard(free): gold deducted');
  assert(ui.draftOffer.length === 0, 'pickCard(free): offer cleared after pick');
  assert(ui.cardCounts['damage'] === 1, 'pickCard(free): increments cardCounts');
}

// --- pickCard (free mode) refuses when player lacks gold ---
{
  const ui = new UI();
  ui.draftMode = DraftMode.FREE;
  const player = new Player(100, 100);
  player.gold = 0;
  const card = CARDS.find(c => c.id === 'damage');
  ui.draftOffer = [card];
  const ok = ui.pickCard(0, player);
  assert(ok === false, 'pickCard(free): fails without gold');
}

// --- pickCard (paid mode) deducts gold and consumes the per-wave allowance ---
{
  const ui = new UI();
  ui.draftMode = DraftMode.PAID;
  const player = new Player(100, 100);
  player.gold = 100;
  const a = CARDS.find(c => c.id === 'damage');
  const b = CARDS.find(c => c.id === 'speed');
  ui.draftOffer = [a, b];
  const cost = ui.getCardCost(a);

  const ok = ui.pickCard(0, player);
  assert(ok === true, 'pickCard(paid): succeeds with gold');
  assert(player.gold === 100 - cost, 'pickCard(paid): gold deducted');
  assert(ui.draftOffer.length === 0, 'pickCard(paid): offer cleared on pick (1-per-wave limit)');
  assert(ui.paidPickLimitReached(), 'pickCard(paid): limit flag set after pick');
}

// --- pickCard (paid mode) refuses a second pick in the same wave ---
{
  const ui = new UI();
  ui.draftMode = DraftMode.PAID;
  const player = new Player(100, 100);
  player.gold = 1000;
  const damage = CARDS.find(c => c.id === 'damage');
  const speed = CARDS.find(c => c.id === 'speed');

  ui.draftOffer = [damage];
  assert(ui.pickCard(0, player) === true, 'first paid pick succeeds');
  const goldAfterFirst = player.gold;
  const dmgAfterFirst = player.damage;

  // Even if the caller restores an offer (e.g. via a rogue reroll code path),
  // pickCard must refuse the second purchase until the wave rolls over.
  ui.draftOffer = [speed];
  const second = ui.pickCard(0, player);
  assert(second === false, 'second paid pick blocked in same wave');
  assert(player.gold === goldAfterFirst, 'second paid pick: no gold deducted');
  assert(player.damage === dmgAfterFirst, 'second paid pick: no effect applied');
}

// --- onWaveStart refreshes the paid allowance ---
{
  const ui = new UI();
  ui.draftMode = DraftMode.PAID;
  const player = new Player(100, 100);
  player.gold = 1000;
  ui.draftOffer = [CARDS.find(c => c.id === 'damage')];
  ui.pickCard(0, player);
  assert(ui.paidPickLimitReached(), 'limit reached after 1 pick');
  ui.onWaveStart();
  assert(!ui.paidPickLimitReached(), 'onWaveStart: allowance refreshed');

  // Second buy is now allowed in the fresh wave.
  ui.beginPaidDraft(2);
  assert(ui.draftOffer.length === 5, 'beginPaidDraft after wave start: fresh offer rolled');
  const ok = ui.pickCard(0, player);
  assert(ok === true, 'pickCard(paid) succeeds on new wave');
}

// --- beginPaidDraft returns an empty offer when allowance is already spent ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 1000;
  ui.beginPaidDraft(1);
  ui.pickCard(0, player);
  // Re-entering the shop in the same wave: no new offer should roll.
  ui.beginPaidDraft(1);
  assert(ui.draftOffer.length === 0, 'beginPaidDraft: empty offer when limit already reached');
  assert(ui.paidPickLimitReached(), 'beginPaidDraft: limit still flagged');
}

// --- tryReroll refuses after paid-pick limit is reached ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 1000;
  ui.beginPaidDraft(1);
  const goldBefore = player.gold;
  assert(ui.tryReroll(player) === true, 'tryReroll: works before any pick');
  assert(player.gold < goldBefore, 'tryReroll: deducted gold');

  ui.pickCard(0, player);
  assert(ui.paidPickLimitReached(), 'tryReroll setup: limit reached');

  const goldAfterPick = player.gold;
  assert(ui.tryReroll(player) === false, 'tryReroll: blocked after paid limit');
  assert(player.gold === goldAfterPick, 'tryReroll: no gold deducted when blocked');
}

// --- pickCard (paid mode) refuses when player lacks gold ---
{
  const ui = new UI();
  ui.draftMode = DraftMode.PAID;
  const player = new Player(100, 100);
  player.gold = 0;
  const card = CARDS.find(c => c.id === 'glassCannon'); // rare = most expensive
  ui.draftOffer = [card];
  const origDamage = player.damage;

  const ok = ui.pickCard(0, player);
  assert(ok === false, 'pickCard(paid): fails without gold');
  assert(player.damage === origDamage, 'pickCard(paid): no effect applied on fail');
  assert(player.gold === 0, 'pickCard(paid): no gold deducted on fail');
  assert(ui.draftOffer.length === 1, 'pickCard(paid): offer untouched on fail');
}

// --- getCardCost returns the right price per rarity (no stacks owned) ---
{
  const ui = new UI();
  const common = CARDS.find(c => c.rarity === 'common');
  const uncommon = CARDS.find(c => c.rarity === 'uncommon');
  const rare = CARDS.find(c => c.rarity === 'rare');
  assert(ui.getCardCost(common) === 15, 'getCardCost: common = 15');
  assert(ui.getCardCost(uncommon) === 40, 'getCardCost: uncommon = 40');
  assert(ui.getCardCost(rare) === 80, 'getCardCost: rare = 80');
}

// --- getCardCost scales with owned stacks (1x, 2x, 3x, 4x...) ---
{
  const ui = new UI();
  const card = CARDS.find(c => c.id === 'damage');
  assert(ui.getCardCost(card) === 15, 'getCardCost: 0 stacks = base');
  ui.cardCounts[card.id] = 1;
  assert(ui.getCardCost(card) === 30, 'getCardCost: 1 stack = base × 2');
  ui.cardCounts[card.id] = 2;
  assert(ui.getCardCost(card) === 45, 'getCardCost: 2 stacks = base × 3');
  ui.cardCounts[card.id] = 3;
  assert(ui.getCardCost(card) === 60, 'getCardCost: 3 stacks = base × 4');
}

// --- stack diminishing returns on additive cards ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'damage');
  const base = player.damage;
  ui.draftOffer = [card]; ui.pickCard(0, player);
  assert(player.damage === base + 5, 'DR: 1st damage = +5 (full)');
  ui.draftOffer = [card]; ui.pickCard(0, player);
  assert(player.damage === base + 5 + 3, 'DR: 2nd damage = +3 (60%)');
  ui.draftOffer = [card]; ui.pickCard(0, player);
  assert(Math.abs(player.damage - (base + 5 + 3 + 1.5)) < 0.0001, 'DR: 3rd damage = +1.5 (30%)');
}

// --- stack diminishing returns on regen (late-ration smooth) ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'regen');
  const base = player.regenPerSec;
  ui.draftOffer = [card]; ui.pickCard(0, player);
  ui.draftOffer = [card]; ui.pickCard(0, player);
  ui.draftOffer = [card]; ui.pickCard(0, player);
  assert(Math.abs(player.regenPerSec - (base + 1 + 0.6 + 0.3)) < 0.0001,
    'DR: regen stacks to base + 1 + 0.6 + 0.3');
}

// --- pickCard invalid index ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  ui.draftOffer = [CARDS[0]];
  assert(ui.pickCard(-1, player) === false, 'pickCard: false for negative index');
  assert(ui.pickCard(99, player) === false, 'pickCard: false for out-of-range');
}

// --- maxHp card heals ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const hpCard = CARDS.find(c => c.id === 'maxHp');
  ui.draftOffer = [hpCard];
  const origHp = player.hp;
  const origMax = player.maxHp;
  ui.pickCard(0, player);
  assert(player.maxHp === origMax + 25, 'maxHp card: maxHp increased');
  assert(player.hp === origHp + 25, 'maxHp card: hp healed by same amount');
}

// --- speed card ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'speed');
  ui.draftOffer = [card];
  const origSpeed = player.speed;
  const origCd = player.attackCooldown;
  ui.pickCard(0, player);
  assert(player.speed === origSpeed + 15, 'speed card: +15 speed');
  assert(Math.abs(player.attackCooldown - origCd * 0.94) < 0.0001, 'speed card: −6% attack cooldown');
}

// --- attackRange card ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'attackRange');
  ui.draftOffer = [card];
  const orig = player.attackRange;
  ui.pickCard(0, player);
  assert(player.attackRange === orig + 2, 'attackRange card: +2');
}

// --- cooldown card ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'cooldown');
  ui.draftOffer = [card];
  const orig = player.attackCooldown;
  ui.pickCard(0, player);
  assert(player.attackCooldown < orig, 'cooldown card: reduces cooldown');
  assert(player.attackCooldown >= 0.12, 'cooldown card: floored at 0.12');
}

// --- lifesteal card ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'lifesteal');
  ui.draftOffer = [card];
  assert(player.lifestealPct === 0, 'lifesteal: starts at 0');
  ui.pickCard(0, player);
  assert(Math.abs(player.lifestealPct - 0.07) < 0.0001, 'lifesteal: +7%');
}

// --- thorns card ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'thorns');
  ui.draftOffer = [card];
  ui.pickCard(0, player);
  assert(Math.abs(player.thornsPct - 0.25) < 0.0001, 'thorns: +25%');
}

// --- magnet card ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'magnet');
  ui.draftOffer = [card];
  assert(player.magnetRangeMul === 1, 'magnet: starts at 1');
  ui.pickCard(0, player);
  assert(Math.abs(player.magnetRangeMul - 1.5) < 0.0001, 'magnet: 1.5x');
}

// --- regen card ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'regen');
  ui.draftOffer = [card];
  const orig = player.regenPerSec;
  ui.pickCard(0, player);
  assert(player.regenPerSec === orig + 1, 'regen: +1 per sec');
}

// --- dashCooldown card ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'dashCooldown');
  assert(!!card, 'dashCooldown card: exists in pool');
  ui.draftOffer = [card];
  const orig = player.dashCooldownMax;
  const origIframe = player.iframeBonus;
  ui.pickCard(0, player);
  assert(player.dashCooldownMax < orig, 'dashCooldown card: reduces cooldown');
  assert(Math.abs(player.dashCooldownMax - orig * 0.75) < 0.0001, 'dashCooldown card: -25%');
  assert(Math.abs(player.iframeBonus - (origIframe + 0.05)) < 0.0001, 'dashCooldown card: +0.05s iframe');
}

// --- glassCannon card ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'glassCannon');
  ui.draftOffer = [card];
  const origDmg = player.damage;
  const origMax = player.maxHp;
  ui.pickCard(0, player);
  assert(player.damage === origDmg + 8, 'glassCannon: +8 damage');
  assert(player.maxHp === origMax - 15, 'glassCannon: -15 maxHp');
}

// --- wideArc card is unstackable ---
{
  const ui = new UI();
  ui.draftMode = DraftMode.FREE;
  const player = new Player(100, 100);
  player.gold = 9999;
  const card = CARDS.find(c => c.id === 'wideArc');
  ui.draftOffer = [card];
  assert(player.fullArcAttack === false, 'wideArc: starts disabled');
  ui.pickCard(0, player);
  assert(player.fullArcAttack === true, 'wideArc: enables full arc');
  // Next draft shouldn't include wideArc since it was taken and is unstackable
  for (let i = 0; i < 10; i++) {
    ui.beginFreeDraft();
    const hasWideArc = ui.draftOffer.some(c => c.id === 'wideArc');
    assert(!hasWideArc, 'wideArc: excluded from future drafts once taken');
  }
}

// --- reroll consumes gold ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 100;
  ui.beginFreeDraft();
  const cost = ui.getRerollCost();
  assert(cost > 0, 'reroll: cost is positive');
  const ok = ui.tryReroll(player);
  assert(ok === true, 'reroll: succeeds with gold');
  assert(player.gold === 100 - cost, 'reroll: gold deducted');
  assert(ui.rerollCount === 1, 'reroll: count increments');
  assert(ui.getRerollCost() > cost, 'reroll: cost grows after each reroll');
}

// --- reroll without gold fails ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 0;
  ui.beginFreeDraft();
  const ok = ui.tryReroll(player);
  assert(ok === false, 'reroll: fails without gold');
  assert(player.gold === 0, 'reroll: no gold deducted on fail');
}

// --- handleDraftClick hit detection ---
{
  const ui = new UI();
  ui._cardButtons = [
    { x: 50, y: 50, w: 200, h: 260 },
    { x: 270, y: 50, w: 200, h: 260 },
  ];
  assert(ui.handleDraftClick(100, 100) === 0, 'handleDraftClick: first card');
  assert(ui.handleDraftClick(300, 100) === 1, 'handleDraftClick: second card');
  assert(ui.handleDraftClick(10, 10) === -1, 'handleDraftClick: miss');
}

// --- isRerollClicked / isSkipClicked ---
{
  const ui = new UI();
  ui._rerollButton = { x: 100, y: 400, w: 180, h: 40 };
  ui._skipButton = { x: 300, y: 400, w: 180, h: 40 };
  assert(ui.isRerollClicked(150, 420) === true, 'isRerollClicked: hit');
  assert(ui.isRerollClicked(350, 420) === false, 'isRerollClicked: miss');
  assert(ui.isSkipClicked(350, 420) === true, 'isSkipClicked: hit');
  assert(ui.isSkipClicked(10, 10) === false, 'isSkipClicked: miss');
}

// --- CARDS pool structure ---
{
  assert(CARDS.length >= 8, 'CARDS: pool has at least 8 cards');
  for (const card of CARDS) {
    assert(typeof card.id === 'string', `CARDS: ${card.id} has id`);
    assert(typeof card.label === 'string' && card.label.length > 0, `CARDS: ${card.id} has label`);
    assert(typeof card.desc === 'string' && card.desc.length > 0, `CARDS: ${card.id} has desc`);
    assert(typeof card.apply === 'function', `CARDS: ${card.id} has apply function`);
    assert(typeof card.rarity === 'string', `CARDS: ${card.id} has rarity`);
    assert(typeof card.stackable === 'boolean', `CARDS: ${card.id} has stackable flag`);
  }
}

// --- Player has new modifier fields ---
{
  const player = new Player(100, 100);
  assert(player.lifestealPct === 0, 'Player: lifestealPct default 0');
  assert(player.thornsPct === 0, 'Player: thornsPct default 0');
  assert(player.magnetRangeMul === 1, 'Player: magnetRangeMul default 1');
  assert(player.fullArcAttack === false, 'Player: fullArcAttack default false');
  assert(player.regenPerSec === CONST.PLAYER_HP_REGEN_PER_SEC, 'Player: regenPerSec default');
}

console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
