// Tests for Input touch/mouse/keyboard handling.
// Uses a minimal fake DOM so Input can be instantiated in Node.

global.window = global.window || {
  addEventListener() {},
  removeEventListener() {},
};
global.performance = global.performance || { now: () => Date.now() };

function makeCanvas() {
  const listeners = {};
  return {
    width: 800,
    height: 600,
    listeners,
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
    },
    addEventListener(ev, fn) { listeners[ev] = fn; },
    removeEventListener(ev) { delete listeners[ev]; },
  };
}

function fakeTouchEvent(id, clientX, clientY) {
  return {
    changedTouches: [{ identifier: id, clientX, clientY }],
    preventDefault() {},
  };
}

const { Input } = await import('../js/input.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${msg}`); }
}
function assertApprox(a, b, msg, eps = 0.001) {
  assert(Math.abs(a - b) < eps, `${msg} (expected ${b}, got ${a})`);
}

// --- Touch drag produces movement toward touch point ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(400, 300);

  canvas.listeners.touchstart(fakeTouchEvent(1, 500, 300));
  assert(input.touch.active, 'Touch becomes active on touchstart');

  const move = input.getMovement();
  assertApprox(move.x, 1, 'Movement x points right when touch is right of player');
  assertApprox(move.y, 0, 'Movement y is zero when touch is level with player');
}

// --- Touch drag diagonal ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(100, 100);

  canvas.listeners.touchstart(fakeTouchEvent(1, 200, 200));
  const move = input.getMovement();
  const expected = Math.sqrt(0.5);
  assertApprox(move.x, expected, 'Diagonal touch normalizes x');
  assertApprox(move.y, expected, 'Diagonal touch normalizes y');
}

// --- Touch within dead zone = no movement ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(400, 300);

  canvas.listeners.touchstart(fakeTouchEvent(1, 405, 302));
  const move = input.getMovement();
  assert(move.x === 0 && move.y === 0, 'Dead zone suppresses tiny touch drift');
}

// --- Short tap triggers attack (via mouse.clicked) ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(0, 0);

  canvas.listeners.touchstart(fakeTouchEvent(7, 100, 100));
  // Immediate release within the tap window
  canvas.listeners.touchend(fakeTouchEvent(7, 100, 100));
  assert(input.wantsAttack(), 'Quick tap registers as attack');
  assert(!input.touch.active, 'Touch inactive after release');

  input.endFrame();
  assert(!input.wantsAttack(), 'Attack flag cleared after endFrame');
}

// --- Long hold does NOT trigger attack ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(0, 0);

  canvas.listeners.touchstart(fakeTouchEvent(2, 50, 50));
  // Simulate holding for longer than the tap window
  const realNow = performance.now;
  performance.now = () => realNow.call(performance) + 500;
  canvas.listeners.touchend(fakeTouchEvent(2, 50, 50));
  performance.now = realNow;
  assert(!input.wantsAttack(), 'Long hold does not attack');
}

// --- Drag beyond move threshold does NOT trigger attack ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(0, 0);

  canvas.listeners.touchstart(fakeTouchEvent(3, 100, 100));
  canvas.listeners.touchmove(fakeTouchEvent(3, 200, 100));
  canvas.listeners.touchend(fakeTouchEvent(3, 200, 100));
  assert(!input.wantsAttack(), 'Dragging past threshold is not an attack');
}

// --- Multi-touch: second finger ignored ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(0, 0);

  canvas.listeners.touchstart(fakeTouchEvent(10, 100, 100));
  canvas.listeners.touchstart(fakeTouchEvent(11, 500, 500));
  assert(input.touch.x === 100 && input.touch.y === 100, 'Second touch ignored while first is active');
}

// --- Holding LMB walks toward cursor ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(400, 300);
  input.mouse.x = 500;
  input.mouse.y = 300;

  canvas.listeners.mousedown({ button: 0, preventDefault() {} });
  const move = input.getMovement();
  assertApprox(move.x, 1, 'Held LMB moves player right toward cursor');
  assertApprox(move.y, 0, 'Held LMB keeps y at zero when aligned');
}

// --- Holding RMB walks toward cursor but does NOT attack ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(100, 100);
  input.mouse.x = 100;
  input.mouse.y = 200;

  canvas.listeners.mousedown({ button: 2, preventDefault() {} });
  const move = input.getMovement();
  assertApprox(move.x, 0, 'Held RMB moves along y only');
  assertApprox(move.y, 1, 'Held RMB moves player down toward cursor');
  assert(!input.wantsAttack(), 'Right mouse button does not trigger attack');

  canvas.listeners.mouseup({ button: 2, preventDefault() {} });
  const stopped = input.getMovement();
  assert(stopped.x === 0 && stopped.y === 0, 'Releasing RMB stops movement');
}

// --- Mouse hold within dead zone = no movement ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(400, 300);
  input.mouse.x = 405;
  input.mouse.y = 302;

  canvas.listeners.mousedown({ button: 0, preventDefault() {} });
  const move = input.getMovement();
  assert(move.x === 0 && move.y === 0, 'Dead zone suppresses tiny mouse hold drift');
}

// --- Keyboard still overrides touch when both provide input ---
{
  const canvas = makeCanvas();
  const input = new Input(canvas);
  input.setPlayerScreen(400, 300);

  canvas.listeners.touchstart(fakeTouchEvent(1, 500, 300));
  // Simulate pressing W
  global.window.dispatchEvent = null; // not used
  input.keys['KeyW'] = true;
  const move = input.getMovement();
  assertApprox(move.x, 0, 'Keyboard overrides touch x');
  assertApprox(move.y, -1, 'Keyboard overrides touch y');
}

console.log(`\nInput tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
