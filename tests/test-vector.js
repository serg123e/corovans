// Tests for Vec2 and collision utilities

import { Vec2, circlesOverlap, pointInRect, rectOverlap, pointInCircle, clamp, lerp } from '../js/utils.js';

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

function assertApprox(a, b, message, epsilon = 0.001) {
  assert(Math.abs(a - b) < epsilon, `${message} (expected ${b}, got ${a})`);
}

// --- Vec2 tests ---

// Construction
{
  const v = new Vec2(3, 4);
  assert(v.x === 3, 'Vec2 constructor x');
  assert(v.y === 4, 'Vec2 constructor y');
}

// Default values
{
  const v = new Vec2();
  assert(v.x === 0, 'Vec2 default x');
  assert(v.y === 0, 'Vec2 default y');
}

// Copy
{
  const v = new Vec2(1, 2);
  const c = v.copy();
  assert(c.x === 1 && c.y === 2, 'Vec2 copy values');
  c.x = 99;
  assert(v.x === 1, 'Vec2 copy is independent');
}

// Set
{
  const v = new Vec2();
  const ret = v.set(5, 6);
  assert(v.x === 5 && v.y === 6, 'Vec2 set');
  assert(ret === v, 'Vec2 set returns this');
}

// Add
{
  const a = new Vec2(1, 2);
  const b = new Vec2(3, 4);
  const r = a.add(b);
  assert(r.x === 4 && r.y === 6, 'Vec2 add');
  assert(a.x === 1 && a.y === 2, 'Vec2 add does not mutate');
}

// Sub
{
  const a = new Vec2(5, 7);
  const b = new Vec2(2, 3);
  const r = a.sub(b);
  assert(r.x === 3 && r.y === 4, 'Vec2 sub');
}

// Mul
{
  const v = new Vec2(3, 4);
  const r = v.mul(2);
  assert(r.x === 6 && r.y === 8, 'Vec2 mul');
}

// Div
{
  const v = new Vec2(6, 8);
  const r = v.div(2);
  assert(r.x === 3 && r.y === 4, 'Vec2 div');
}

// Dot
{
  const a = new Vec2(1, 0);
  const b = new Vec2(0, 1);
  assert(a.dot(b) === 0, 'Vec2 dot perpendicular');
  assert(a.dot(a) === 1, 'Vec2 dot parallel');
}

// Length
{
  const v = new Vec2(3, 4);
  assertApprox(v.len(), 5, 'Vec2 len 3-4-5');
}

// LenSq
{
  const v = new Vec2(3, 4);
  assert(v.lenSq() === 25, 'Vec2 lenSq');
}

// Normalize
{
  const v = new Vec2(3, 4);
  const n = v.normalize();
  assertApprox(n.len(), 1, 'Vec2 normalize len');
  assertApprox(n.x, 0.6, 'Vec2 normalize x');
  assertApprox(n.y, 0.8, 'Vec2 normalize y');
}

// Normalize zero vector
{
  const v = new Vec2(0, 0);
  const n = v.normalize();
  assert(n.x === 0 && n.y === 0, 'Vec2 normalize zero');
}

// Dist
{
  const a = new Vec2(0, 0);
  const b = new Vec2(3, 4);
  assertApprox(a.dist(b), 5, 'Vec2 dist');
}

// DistSq
{
  const a = new Vec2(0, 0);
  const b = new Vec2(3, 4);
  assertApprox(a.distSq(b), 25, 'Vec2 distSq');
}

// Angle
{
  const v = new Vec2(1, 0);
  assertApprox(v.angle(), 0, 'Vec2 angle right');
  const v2 = new Vec2(0, 1);
  assertApprox(v2.angle(), Math.PI / 2, 'Vec2 angle down');
}

// Rotate
{
  const v = new Vec2(1, 0);
  const r = v.rotate(Math.PI / 2);
  assertApprox(r.x, 0, 'Vec2 rotate x');
  assertApprox(r.y, 1, 'Vec2 rotate y');
}

// Lerp
{
  const a = new Vec2(0, 0);
  const b = new Vec2(10, 20);
  const r = a.lerp(b, 0.5);
  assert(r.x === 5 && r.y === 10, 'Vec2 lerp 0.5');
  const r2 = a.lerp(b, 0);
  assert(r2.x === 0 && r2.y === 0, 'Vec2 lerp 0');
  const r3 = a.lerp(b, 1);
  assert(r3.x === 10 && r3.y === 20, 'Vec2 lerp 1');
}

// ClampLen
{
  const v = new Vec2(30, 40); // len = 50
  const c = v.clampLen(10);
  assertApprox(c.len(), 10, 'Vec2 clampLen reduces');
  const c2 = v.clampLen(100);
  assertApprox(c2.len(), 50, 'Vec2 clampLen no change when under');
}

// Equals
{
  const a = new Vec2(1, 2);
  const b = new Vec2(1, 2);
  assert(a.equals(b), 'Vec2 equals true');
  const c = new Vec2(1, 3);
  assert(!a.equals(c), 'Vec2 equals false');
}

// FromAngle
{
  const v = Vec2.fromAngle(0);
  assertApprox(v.x, 1, 'Vec2 fromAngle(0) x');
  assertApprox(v.y, 0, 'Vec2 fromAngle(0) y');
}

// --- Collision tests ---

// circlesOverlap
{
  assert(circlesOverlap(0, 0, 10, 5, 0, 10), 'circles overlap touching');
  assert(circlesOverlap(0, 0, 10, 0, 0, 5), 'circles overlap concentric');
  assert(!circlesOverlap(0, 0, 5, 20, 0, 5), 'circles no overlap');
}

// pointInRect
{
  assert(pointInRect(5, 5, 0, 0, 10, 10), 'point in rect center');
  assert(pointInRect(0, 0, 0, 0, 10, 10), 'point in rect corner');
  assert(!pointInRect(-1, 5, 0, 0, 10, 10), 'point outside rect left');
  assert(!pointInRect(5, 11, 0, 0, 10, 10), 'point outside rect bottom');
}

// rectOverlap
{
  assert(rectOverlap(0, 0, 10, 10, 5, 5, 10, 10), 'rects overlap');
  assert(!rectOverlap(0, 0, 10, 10, 20, 20, 10, 10), 'rects no overlap');
  assert(rectOverlap(0, 0, 10, 10, 9, 9, 10, 10), 'rects barely overlap');
}

// pointInCircle
{
  assert(pointInCircle(0, 0, 0, 0, 10), 'point in circle center');
  assert(pointInCircle(5, 0, 0, 0, 10), 'point in circle edge');
  assert(!pointInCircle(11, 0, 0, 0, 10), 'point outside circle');
}

// --- Utility function tests ---

// clamp
{
  assert(clamp(5, 0, 10) === 5, 'clamp in range');
  assert(clamp(-5, 0, 10) === 0, 'clamp below');
  assert(clamp(15, 0, 10) === 10, 'clamp above');
}

// lerp
{
  assertApprox(lerp(0, 10, 0.5), 5, 'lerp 0.5');
  assertApprox(lerp(0, 10, 0), 0, 'lerp 0');
  assertApprox(lerp(0, 10, 1), 10, 'lerp 1');
}

// --- Summary ---

console.log(`\nTests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  process.exit(1);
}
