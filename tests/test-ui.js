// Tests for UI class - shop logic, upgrades, and purchasing

import { UI, UPGRADES } from '../js/ui.js';
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
  assert(Object.keys(ui.upgradeCounts).length === UPGRADES.length, 'UI: tracks all upgrade types');
  for (const upg of UPGRADES) {
    assert(ui.upgradeCounts[upg.id] === 0, `UI: ${upg.id} starts at 0 purchases`);
  }
}

// --- UI reset ---
{
  const ui = new UI();
  ui.upgradeCounts['damage'] = 3;
  ui.upgradeCounts['maxHp'] = 2;
  ui.reset();
  assert(ui.upgradeCounts['damage'] === 0, 'UI reset: damage count resets to 0');
  assert(ui.upgradeCounts['maxHp'] === 0, 'UI reset: maxHp count resets to 0');
}

// --- Upgrade cost calculation ---
{
  const ui = new UI();
  const dmgUpgrade = UPGRADES.find(u => u.id === 'damage');

  // First purchase: base cost
  const cost0 = ui.getUpgradeCost(dmgUpgrade);
  assert(cost0 === dmgUpgrade.baseCost, 'getUpgradeCost: first purchase is base cost');

  // After one purchase: base * scale
  ui.upgradeCounts['damage'] = 1;
  const cost1 = ui.getUpgradeCost(dmgUpgrade);
  assert(cost1 === Math.floor(dmgUpgrade.baseCost * dmgUpgrade.costScale),
    'getUpgradeCost: second purchase is base * scale');

  // After two purchases: base * scale^2
  ui.upgradeCounts['damage'] = 2;
  const cost2 = ui.getUpgradeCost(dmgUpgrade);
  assert(cost2 === Math.floor(dmgUpgrade.baseCost * Math.pow(dmgUpgrade.costScale, 2)),
    'getUpgradeCost: third purchase is base * scale^2');
}

// --- Cost increases each upgrade type ---
{
  const ui = new UI();
  for (const upg of UPGRADES) {
    const costBefore = ui.getUpgradeCost(upg);
    ui.upgradeCounts[upg.id] = 1;
    const costAfter = ui.getUpgradeCost(upg);
    assert(costAfter > costBefore, `getUpgradeCost: ${upg.id} cost increases after purchase`);
  }
}

// --- tryPurchase: successful purchase ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 100;
  const origDamage = player.damage;

  const result = ui.tryPurchase(0, player); // damage upgrade
  const dmgUpgrade = UPGRADES[0];
  assert(result === true, 'tryPurchase: returns true on success');
  assert(player.damage === origDamage + dmgUpgrade.amount, 'tryPurchase: applies damage upgrade');
  assert(player.gold === 100 - dmgUpgrade.baseCost, 'tryPurchase: deducts gold');
  assert(ui.upgradeCounts[dmgUpgrade.id] === 1, 'tryPurchase: increments purchase count');
}

// --- tryPurchase: insufficient gold ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 1; // not enough for any upgrade
  const origDamage = player.damage;

  const result = ui.tryPurchase(0, player);
  assert(result === false, 'tryPurchase: returns false when insufficient gold');
  assert(player.damage === origDamage, 'tryPurchase: does not apply upgrade on failure');
  assert(player.gold === 1, 'tryPurchase: does not deduct gold on failure');
}

// --- tryPurchase: invalid index ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 1000;

  assert(ui.tryPurchase(-1, player) === false, 'tryPurchase: returns false for negative index');
  assert(ui.tryPurchase(99, player) === false, 'tryPurchase: returns false for out-of-range index');
}

// --- tryPurchase: maxHp upgrade also heals ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 200;
  const hpUpgrade = UPGRADES.findIndex(u => u.id === 'maxHp');
  const origHp = player.hp;
  const origMaxHp = player.maxHp;

  ui.tryPurchase(hpUpgrade, player);
  const hpAmount = UPGRADES[hpUpgrade].amount;
  assert(player.maxHp === origMaxHp + hpAmount, 'tryPurchase: maxHp upgrade increases max HP');
  assert(player.hp === origHp + hpAmount, 'tryPurchase: maxHp upgrade also heals');
}

// --- tryPurchase: speed upgrade ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 200;
  const speedIdx = UPGRADES.findIndex(u => u.id === 'speed');
  const origSpeed = player.speed;

  ui.tryPurchase(speedIdx, player);
  assert(player.speed === origSpeed + UPGRADES[speedIdx].amount, 'tryPurchase: speed upgrade applies');
}

// --- tryPurchase: attack range upgrade ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 200;
  const rangeIdx = UPGRADES.findIndex(u => u.id === 'attackRange');
  const origRange = player.attackRange;

  ui.tryPurchase(rangeIdx, player);
  assert(player.attackRange === origRange + UPGRADES[rangeIdx].amount, 'tryPurchase: attack range upgrade applies');
}

// --- Multiple purchases increase cost ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 10000;

  const firstCost = UPGRADES[0].baseCost;
  ui.tryPurchase(0, player);
  const goldAfterFirst = player.gold;
  assert(goldAfterFirst === 10000 - firstCost, 'Multiple purchases: first costs base amount');

  const secondCost = ui.getUpgradeCost(UPGRADES[0]);
  assert(secondCost > firstCost, 'Multiple purchases: second costs more than first');

  ui.tryPurchase(0, player);
  assert(player.gold === goldAfterFirst - secondCost, 'Multiple purchases: second deducts higher cost');
}

// --- handleShopClick: no buttons returns -1 ---
{
  const ui = new UI();
  const result = ui.handleShopClick(100, 100);
  assert(result === -1, 'handleShopClick: returns -1 when no buttons defined');
}

// --- handleShopClick: detects button click ---
{
  const ui = new UI();
  ui._shopButtons = [
    { x: 50, y: 50, w: 200, h: 60 },
    { x: 50, y: 120, w: 200, h: 60 },
  ];

  assert(ui.handleShopClick(100, 70) === 0, 'handleShopClick: detects click on first button');
  assert(ui.handleShopClick(100, 140) === 1, 'handleShopClick: detects click on second button');
  assert(ui.handleShopClick(10, 10) === -1, 'handleShopClick: returns -1 for miss');
}

// --- isNextWaveClicked ---
{
  const ui = new UI();
  ui._nextWaveButton = { x: 200, y: 400, w: 200, h: 45 };

  assert(ui.isNextWaveClicked(300, 420) === true, 'isNextWaveClicked: detects click on button');
  assert(ui.isNextWaveClicked(10, 10) === false, 'isNextWaveClicked: returns false for miss');
}

{
  const ui = new UI();
  assert(ui.isNextWaveClicked(300, 420) === false, 'isNextWaveClicked: returns false when no button');
}

// --- UPGRADES structure ---
{
  assert(UPGRADES.length === 4, 'UPGRADES: has 4 upgrade types');
  const ids = UPGRADES.map(u => u.id);
  assert(ids.includes('damage'), 'UPGRADES: includes damage');
  assert(ids.includes('maxHp'), 'UPGRADES: includes maxHp');
  assert(ids.includes('speed'), 'UPGRADES: includes speed');
  assert(ids.includes('attackRange'), 'UPGRADES: includes attackRange');

  for (const upg of UPGRADES) {
    assert(upg.baseCost > 0, `UPGRADES: ${upg.id} has positive base cost`);
    assert(upg.costScale > 1, `UPGRADES: ${upg.id} has cost scale > 1`);
    assert(upg.amount > 0, `UPGRADES: ${upg.id} has positive amount`);
    assert(typeof upg.label === 'string' && upg.label.length > 0, `UPGRADES: ${upg.id} has label`);
    assert(typeof upg.desc === 'string' && upg.desc.length > 0, `UPGRADES: ${upg.id} has description`);
    assert(typeof upg.stat === 'string', `UPGRADES: ${upg.id} has stat field`);
  }
}

// --- All upgrade stats map to actual player properties ---
{
  const player = new Player(100, 100);
  for (const upg of UPGRADES) {
    assert(upg.stat in player, `UPGRADES: ${upg.id} stat '${upg.stat}' exists on Player`);
  }
}

// --- Buying all upgrades once ---
{
  const ui = new UI();
  const player = new Player(100, 100);
  player.gold = 10000;

  for (let i = 0; i < UPGRADES.length; i++) {
    const result = ui.tryPurchase(i, player);
    assert(result === true, `Buying all: purchase ${UPGRADES[i].id} succeeds`);
  }

  assert(player.damage === CONST.PLAYER_BASE_DAMAGE + UPGRADES.find(u => u.id === 'damage').amount,
    'Buying all: damage upgraded');
  assert(player.maxHp === CONST.PLAYER_MAX_HP + UPGRADES.find(u => u.id === 'maxHp').amount,
    'Buying all: maxHp upgraded');
  assert(player.speed === CONST.PLAYER_SPEED + UPGRADES.find(u => u.id === 'speed').amount,
    'Buying all: speed upgraded');
  assert(player.attackRange === CONST.PLAYER_ATTACK_RANGE + UPGRADES.find(u => u.id === 'attackRange').amount,
    'Buying all: attackRange upgraded');
}

console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
