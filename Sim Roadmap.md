# План развития симуляционного фреймворка

*План следующих улучшений `js/sim/`. Не implementation spec — это список направлений с целью, подходом и критерием успеха для каждого, чтобы можно было измерить «сделано».*

---

## 0. Общая цель фреймворка

Симулятор существует, чтобы **быстрее и честнее находить проблемы баланса**, чем ручное тестирование. Конкретные вопросы, на которые он должен уметь отвечать:

1. **Какие карты OP / trap?** — группировать забеги по наличию карты X, сравнивать медианную волну.
2. **Где «стена сложности»?** — на какой волне игроки массово умирают и почему.
3. **Какие пары карт синергируют?** — combo-эффекты (damage+lifesteal) важнее одиночных.
4. **Помогает ли конкретное изменение?** — sanity-check балансных правок перед коммитом: прогнать baseline policy до и после, сравнить.
5. **Насколько AI похож на человека?** — сравнить агрегаты sim-забегов с реальными сессиями из `korovany.sessions`.

Каждое улучшение ниже должно приближать хотя бы один из этих пунктов.

---

## 1. Smarter baseline policy — ✓ done

**Intent.** Текущий `GreedyPolicy` стабильно умирает на волне 4 (median=4, mean=4.3) — практически вся информация о late-game балансе теряется, потому что AI туда не доходит. Вся наша аналитика эффективно работает только для волн 1-5. Нужен baseline, который доживает до 10+ волн при разумной карточной удаче.

**What landed (SmartPolicy в `js/sim/policies.js`).**
- **Arrow dodge.** Сканирует `view.projectiles`, берёт только те, что летят на игрока (dot > 0.7) и попадут раньше 0.45с — шаг перпендикулярно + dash если готов. Если в melee-досягаемости уже стоит цель, параллельно свингуем, чтобы одиночный лучник не обнулял DPS.
- **Swarm retreat.** Двухтриггерное отступление: `HP < 30%`, ИЛИ `HP < 50% и ≥ 2 стражей в 90px`. Второе условие — главный выигрыш, оно вытаскивает нас до того, как кластер добьёт. Направление побега — взвешенный (1/dist) центроид всех стражей в aggroRange, чтобы не убегать в другого.
- **Threat-weighted targeting.** Score = `damage * typeWeight * 100 / max(40, dist)`, typeWeight: archer 2.5, armored 1.5, basic 1. Distance floor 40 гарантирует что melee в упор побеждает дальнего лучника.
- **Strafe-attack.** В полосе HP 30-70% против basic/armored — перпендикулярный шаг + attack, игрок может двигаться и бить на одном кадре, так что торговля дешевле.
- **Card prefer.** `lifesteal, regen, maxHp, damage, thorns, dashCooldown, attackRange` — сначала sustain, потом offense.

**Results (на коммите этой правки).**
- `--policy smart --count 300 --max-waves 30`: median wave **11**, mean **11.6**, max **27**, deaths 105/300 (35%). ✓
- `--policy greedy --count 300 --max-waves 20`: median **4**, mean **4.2** — не регрессировал. ✓
- Card impact: ≥ 6 карт с `|Δwave| ≥ 2.0` и `n(with) ≥ 50` (speed +4, lifesteal +4, magnet +3, maxHp +3, wideArc +3, glassCannon +2). ✓
- Wall сместилась с волны 4 (24% mortality на greedy) на волну 6 (10% mortality на smart), curve стала гораздо более гладкой — видно плавный спуск вместо скалы.

**Known caveat.** `survival rate ≥ 25%` из исходного критерия не достигнут — 0% survivors на maxWaves=30 не потому что AI умирает, а потому что `maxSteps = 60*60*20` отсекает runs после ~20 минут игрового времени. На maxWaves=20 получаем survival ~6%. Если критерий важен — увеличить maxSteps или сделать его флагом CLI; это отдельная задача, не блок SmartPolicy.

---

## 2. Seeded RNG — ✓ done (47af009)

**Intent.** Сейчас каждый прогон использует `Math.random()` глобально, и если симулятор показывает странный результат (например, один забег до волны 26 в thorns×3), воспроизвести его нельзя. Нужна детерминированная reproducibility: `--seed 42` всегда даёт те же события.

**Approach.**
- Добавить `js/rng.js` с LCG/xorshift PRNG. Экспортирует функцию `makeRng(seed)` → объект с `next()`, `range(a, b)`, `choice(arr)`.
- Monkey-patch не делать — вместо этого:
  - Расширить `World`, `Caravan.spawnGuards`, `spawnWave`, `spawnLoot`, `ui.drawCards`, `Projectile`, `Particle*` (но particles в симе не используются) — принимать опциональный `rng` параметр.
  - Где сейчас `Math.random()` используется деструктивно — либо пробросить rng, либо заменить на `Math.random()` по умолчанию и `rng.next()` при передаче rng.
- Simulator принимает `options.seed`, строит rng, пробрасывает во все места с Math.random через `options.rng` параметр.
- CLI: `--seed N`. Для батчей разные seed-ы: `seed + runId`.

**Success criteria.**
- Тест: `new Simulator(policy, { seed: 42 }).run()` вызванный два раза возвращает сессии с идентичным `summary.waveReached`, `summary.finalScore`, `summary.guardsKilled`, `summary.cardsPicked` (без сравнения timestamp-ов).
- CLI: `node js/sim/run.js --seed 42 --count 3 --quiet --out a.json && node js/sim/run.js --seed 42 --count 3 --quiet --out b.json` — `diff a.json b.json` показывает различия только в `startedAt`/`endedAt`/`exportedAt`.
- Репродукция багов возможна: «прогони `--seed 1337 --policy greedy --max-waves 20`, игрок застревает на волне 3» — я могу повторить локально до коммита.

**Блокеры.** Частицы и аудио используют `Math.random()` — в симе они не исполняются, но для полноты стоит пометить, что полный RNG-контроль нужен только для sim-путей.

---

## 3. Per-wave breakdown метрики — ✓ done (47af009)

**Intent.** Сейчас summary агрегирует по всему забегу: «median wave 4, damage taken 180». Но это **суммы** и теряют форму кривой: где именно начинается death spike? Нужно видеть «выживаемость по волнам» чтобы ответить на вопрос «где стена сложности».

**Approach.**
- SessionLogger уже пишет `wave_end` события с `damageTaken`, `caravansRobbed`, `durationMs`. Достаточно.
- В `simulator.js` добавить функцию `perWaveStats(sessions)` которая возвращает таблицу по номеру волны:
  ```
  waveStats[N] = {
    reachedCount,        // сколько сессий добралось до начала этой волны
    diedHere,            // сколько умерло ВНУТРИ этой волны
    mortalityPct,        // diedHere / reachedCount
    medianDuration,      // ms на прохождение
    medianDamageTaken,
    medianKills,
    flawlessCount,
  }
  ```
- Вывод в CLI: секция «Wave curve» — ASCII bar chart mortality по волнам.
- Дополнительно: `--wave-detail` флаг для JSON-вывода этих метрик (сейчас и так выводится `sessions[].events`, но per-wave aggregates удобнее).

**Success criteria.**
- Прогон baseline на 300 забегов даёт per-wave таблицу с явным «горбом»: мы видим конкретную волну, где mortality делает скачок (например 5% → 40%).
- Это число совпадает с интуицией из GDD («волна 4 — стена для greedy») или переопределяет её.
- После балансной правки (например `GUARD_BASE_DAMAGE: 8 → 6`) та же команда показывает, как сдвинулся горб.

---

## 4. Combo matrix — ✓ done

**What landed.** `comboScan()` в `js/sim/simulator.js` + флаги `--combo-scan`, `--combo-stack`, `--combo-cards`, `--combo-top` в run.js. Для каждой пары `(a, b)` запускает `count` сессий с pre-baked `[a×stack, b×stack]`, сравнивает median wave с baseline-батчем без стартовых карт. Seed-stride `+(pairIdx+1)*10_000` даёт полную воспроизводимость.

**Results (`--policy smart --combo-scan --count 20 --max-waves 20 --seed 42`).**
- Baseline median 10 wave.
- Top-5 (Δwave = +10 все): `attackRange+regen`, `magnet+regen`, `lifesteal+magnet`, `attackRange+lifesteal`, `attackRange+glassCannon`.
- `attackRange` появляется в 5/15 топ-пар, `lifesteal` в 5/15, `regen` в 4/15 — доминирующие оси.
- Bottom traps (`Δwave = 0`): `maxHp+speed`, `magnet+dashCooldown`, `speed+dashCooldown`, `speed+wideArc`, `cooldown+thorns`.

**Success criteria.**
- ✓ Top-1 Δwave ≥ 3: получили +10.
- ✓ Pairs отсортированы по дельте; JSON-экспорт работает.
- ✓ Повторный запуск после правки покажет сдвиг (reproducible via seed).
- ✗ `<2min` бюджет: 259s на `count=20`. Smart-политика дороже чем ожидалось (~120ms/sim). Выход: либо греди с `--max-waves 15` для быстрых итераций, либо `count=10` для быстрого превью.
- ✗ `damage+lifesteal` в top-3: оказалось ложной гипотезой — данные показали, что `attackRange` и `regen` — реальные OP-оси. Это именно то, зачем существует combo-scan.

---

## 5. Live data ingestion / единый анализатор

**Intent.** Sim и live-игра пишут в одинаковом формате (специально), но нет инструмента чтобы их сравнить. Вопрос «играет ли smart-AI как я?» сейчас нельзя ответить. Также: после каждой игровой сессии хорошо бы иметь автопроверку «где я умираю vs где умирает AI».

**Approach.**
- `js/sim/analyze.js` — CLI-утилита, читает N JSON-файлов (смесь sim-экспортов и live-экспортов из меню), парсит, агрегирует отдельно по source:
  ```
  node js/sim/analyze.js live-sessions.json sim-greedy.json sim-smart.json
  ```
- Вывод: таблица `source × (waveReached, survivalRate, topCards, damageTaken)`.
- Bonus: определение source автоматически — `session.meta.sim === true` → sim, иначе live.
- Дополнительно: группировка по `commit` внутри каждого source — регрессионный сигнал по билдам.

**Success criteria.**
- Утилита читает и сим-файлы и live-файлы без дополнительной конфигурации.
- Вывод чётко разделяет agent vs human в одной таблице.
- На вопрос «отличается ли твоя игра от greedy-AI» есть численный ответ за одну команду.

---

## 6. Меньшие quality-of-life улучшения

Не отдельные фазы, можно делать попутно:

- **`--runs-per-second` мониторинг** в CLI для батчей > 1000.
- **`--progress`** шкала для долгих прогонов.
- **`--no-card-impact`** чтобы убрать шумную секцию когда она не нужна.
- **`--json-summary`** — печать только summary как JSON (для pipe в jq).
- **Экспорт в CSV** — карточки, волны — удобно для Google Sheets / pandas.

---

## Приоритизация

Порядок основан на «что анблочит что»:

1. **#2 Seeded RNG** — ✓ done.
2. **#3 Per-wave breakdown** — ✓ done.
3. **#1 Smarter baseline** — ✓ done. SmartPolicy достигает median 11, анблочит #4.
4. **#4 Combo matrix** — next up. Теперь есть policy, на которой пары карт могут разойтись.
5. **#5 Live ingestion** — nice-to-have, делать по запросу когда накопятся реальные логи.

---

## Open questions

1. **Delay-aware policies?** — сейчас greedy принимает решение каждый тик (60 раз/сек). Можно добавить «интервал мышления» (например, 5 тиков) — будет ближе к реакции человека. Нужно ли?
2. **Seed ownership.** Если #2 делаем, какой компонент владеет RNG — Simulator, Policy, отдельный объект в opts? Влияет на тестируемость.
3. **Сколько забегов достаточно для доверия?** Сейчас 300 — адекватно для `|Δwave| ≥ 1`, но для `Δwave ≥ 0.5` шум слишком большой. Нужен ли формальный confidence interval в cardImpact?
4. **Как делать sanity check после балансных правок?** — хорошо бы git hook: `post-commit` прогоняет baseline и падает если median wave упал больше чем на 1. Слишком агрессивно? TBD.
