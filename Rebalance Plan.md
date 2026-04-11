# План ребалансирования по итогам симуляций

*Источник данных — коммит 795c035, SmartPolicy + combo matrix. Все цифры воспроизводятся командами из раздела «План валидации».*

---

## Данные, на которых план построен

### Single-card impact (`smart × 300 runs`, baseline median 11)

| Rank | Card | Δwave |
|---|---|---|
| 1 | `regen` | +3 — +4 |
| 2 | `lifesteal` | +2 — +4 |
| 3 | `speed` | +1 — +4 |
| 4 | `maxHp`, `magnet`, `wideArc` | +2 — +3 |
| — | `damage`, `attackRange`, `cooldown` | +1 — +2 |
| — | `thorns`, `dashCooldown` | +1 — +2 |
| — | `glassCannon` | +2 (!!) |

### Combo scan (stack 3+3, 66 пар, baseline median 10)

- **5/15 топ-пар содержат `attackRange`**, **5/15 — `lifesteal`**, **4/15 — `regen`** — три доминирующие оси
- Топ-1..5 все дают Δwave **+10** (удваивают baseline): `attackRange+regen`, `magnet+regen`, `lifesteal+magnet`, `attackRange+lifesteal`, `attackRange+glassCannon`
- Трапы (Δ=0): `maxHp+speed`, `magnet+dashCooldown`, `speed+dashCooldown`, `speed+wideArc`, `cooldown+thorns`

### Wave curve (smart policy)

- Стена сложности на **волне 6** с mortality 10% — не boss-волна, явный спайк.
- Волны 7–9 держат 5–6% — то есть смягчение wave 6 не должно сместить стену дальше.

---

## Priority 1: Нерф трёх доминирующих осей

Цель — свести потолок стек-синергий с +10 до ~+5 wave, не убивая карты как выбор.

### 1.1 `regen`: `+2 HP/s` → `+1 HP/s` за стак

**Файл.** `js/ui.js:120`
**Патч.** `p.regenPerSec += 2;` → `p.regenPerSec += 1;`
**Обоснование.** Один стак сейчас удваивает базовую регенерацию 2/s, три — квадруплят до 8/s, что перекрывает damage armored-стража (12 dmg × cooldown 0.8s ≈ 15 dps). Половина rate оставит карту сильной для лонграна, но лишит статуса auto-pick.

### 1.2 `attackRange`: `+4` → `+2` за стак

**Файл.** `js/ui.js:74`
**Патч.** `p.attackRange += 4;` → `p.attackRange += 2;`
**Обоснование.** Три стака сейчас дают 40 range vs базовые 28 (+43%) — это умножается на цепочки `findAttackTargets` и позволяет бить несколько целей на один свинг. Снижение до +2 сохранит «reach build» как направление, но уберёт из доминантных пар.

### 1.3 `lifesteal`: `+10%` → `+7%` за стак

**Файл.** `js/ui.js:93`
**Патч.** `p.lifestealPct += 0.10;` → `p.lifestealPct += 0.07;`
**Обоснование.** 30% лайфстил при damage=15 → 4.5 HP/hit — self-sustain перекрывает урон от любых melee-обменов. 7% × 3 = 21% — всё ещё сильно, но требует поддержки от `damage`/`cooldown`.

### Валидация патча 1.x

Прогнать `--combo-scan --count 20 --seed 42` после правок. Ожидание:
- Топ-1 пара должна упасть с **+10 до +5..+7**.
- `attackRange` / `regen` / `lifesteal` должны появляться в **≤3 парах топ-15** вместо 5.
- Smart median wave baseline: **11 → 9-10** (небольшая просадка допустима).

---

## Priority 2: Буф двух трапов

Цель — вытащить `dashCooldown` и `speed` из хвоста, сделав их реальным выбором.

### 2.1 `speed`: `+20` → `+15`, + `−6%` attack cooldown за стак

**Файл.** `js/ui.js:65`
**Патч.**
```js
apply: (p) => {
  p.speed += 15;
  p.attackCooldown = Math.max(0.12, p.attackCooldown * 0.94);
},
```
**Обоснование.** Сейчас чистая мобильность не конвертируется в survival — AI всё равно кайтит когда нужно. Маленький attack speed делает карту дуальной и даёт пикнуть её в damage-билде.

### 2.2 `dashCooldown`: добавить +0.05s к iframe duration

**Файл.** `js/ui.js:129` + `js/player.js:221`
**Патч.** Карта сейчас только уменьшает cooldown дэша. Добавить в `apply` поле `p.iframeBonus += 0.05`, в `startDash` использовать `CONST.PLAYER_DASH_IFRAME_DURATION + p.iframeBonus`.
**Обоснование.** Лишние дэши не используются smart-policy потому что iframe-окно остаётся тем же. Расширенный iframe превращает карту в defensive tool, а не «меньше таймер».

**Альтернатива 2.1+2.2.** Оставить существующие карты как есть, добавить новую rare-карту `combatMobility` (speed + cooldown + iframe). Требует более тяжёлой правки UI и pool'а.

### Валидация патча 2.x

- `speed` single-card Δwave: **+1..+4 → +2..+4** стабильнее.
- `speed+dashCooldown` из трап-хвоста в середину таблицы (Δwave ≥ +3).
- `dashCooldown` single-card impact: вырастет с +1..+2 до +2..+3.

---

## Priority 3: Сгладить спайк на волне 6

Mortality 10% на non-boss волне — самая явная проблема кривой. Гипотеза: резкий скачок плотности archer / armored стражей.

### 3.1 Проверить состав волны 6 в `spawnWave()`

**Файл.** `js/caravan.js` — функция `spawnWave`.
**Шаги.**
1. Залогировать реальный composition волны 6 через `--seed 42 --policy smart --max-waves 6 --out w6.json` и прочитать `wave_start` событие.
2. Варианты правок (выбрать один по факту замера):
   - Отложить появление archer до волны 7.
   - Снизить archer damage с 6 до 5 (`CONST.ARCHER_GUARD_DAMAGE` в `js/utils.js:192`).
   - Убрать один archer из wave 6 composition.

### 3.2 Shop heal — «дыхание между волнами»

**Файл.** `js/ui.js` — метод `beginFreeDraft`.
**Патч.** В начало метода добавить `if (player) player.heal(Math.floor(player.maxHp * 0.2));`.
**Обоснование.** 20% HP как breath-between-waves смягчит кумулятивный урон без нерфа боя. Важно: heal до открытия карт, чтобы `regen` / `lifesteal` не конкурировали с этим источником.

### Валидация патча 3.x

- Mortality на wave 6: **10% → ≤5%**.
- Mortality на wave 7-9: остаётся 5-6% (не хотим просто сдвинуть стену).
- Smart median wave: **+0.5..+1**.

---

## Не трогаем

- **`glassCannon`.** Несмотря на +2 single-card impact и появление в топ-паре, это rare-карта и высокорисковый выбор. Данные показывают что она работает как задумано — ставится в сильные sustain-билды.
- **`thorns`.** На грани трапа (появляется только в паре с `regen`), но у неё есть своя ниша. Сначала проверить не вылезет ли она после нерфов `regen` / `lifesteal`.
- **`damage`, `maxHp`, `cooldown`.** Все в зоне +1..+2 single-card impact — сбалансированы.
- **`wideArc`.** Unstackable rare, разовое решение, Δwave +2..+3 — в норме.

---

## План валидации

После каждой правки (или пакета 1-3 вместе) прогнать два бенчмарка:

```bash
# 1. Базовая проверка что smart baseline не деградировал
node js/sim/run.js --policy smart --count 300 --max-waves 30 --seed 42

# 2. Проверка что доминирующие пары перестали доминировать
node js/sim/run.js --policy smart --combo-scan --count 20 --max-waves 20 --seed 42 --out combo-after.json
```

Сохранять `combo-after.json` в каждой итерации, чтобы можно было diff-ить между собой.

---

## Порядок работы

1. **Патч 1.1 + 1.2 + 1.3 разом** — один коммит с тремя константами. Прогнать валидацию.
2. Если топ-1 Δwave всё ещё > 7 — второй раунд нерфа (например, `regen +1 → +0.5` или диминишинг на стаки).
3. **Патч 3.1 + 3.2** — минимальное изменение спавна + shop heal. Измерить кривую.
4. **Патч 2.1 + 2.2** — буфы последним этапом, требуют более осторожных правок кода.

---

## Критерий «ребаланс закрыт»

- Топ-1 combo Δwave: **≤ +6**.
- В топ-15 combo-пар **не более 3** карт с повторением.
- Wave curve: ни одна волна с mortality **> 8%** (кроме boss-волн 5 / 10 / 15).
- Все 12 карт имеют single-card Δwave в диапазоне **[+1, +3]** (никаких трапов и auto-picks).
