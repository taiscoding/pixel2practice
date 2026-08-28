import assert from 'node:assert/strict'
import test from 'node:test'
import { bestIouMulti, iou, normalizeBox, pointInBox, scoreLocalization } from './geometry.ts'

test('iou identical boxes is 1', () => {
  const a = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }
  assert.ok(Math.abs(iou(a, a) - 1) < 1e-9)
})

test('iou disjoint boxes is 0', () => {
  assert.equal(
    iou({ x: 0, y: 0, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }),
    0,
  )
})

test('iou half-shift classic is 1/3', () => {
  const a = { x: 0, y: 0, w: 2, h: 2 }
  const b = { x: 1, y: 0, w: 2, h: 2 }
  assert.ok(Math.abs(iou(a, b) - 1 / 3) < 1e-9)
})

test('iou matches RadGame-style pass at 0.25 for partial overlap', () => {
  const truth = { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }
  const guess = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }
  const score = iou(guess, truth)
  // inter = 0.3*0.3=0.09; union=0.16+0.16-0.09=0.23; ≈0.391
  assert.ok(score > 0.25)
  assert.ok(Math.abs(score - 0.09 / 0.23) < 1e-9)
})

test('normalizeBox orders corners', () => {
  const box = normalizeBox({ x: 0.5, y: 0.6 }, { x: 0.1, y: 0.2 })
  assert.equal(box.x, 0.1)
  assert.equal(box.y, 0.2)
  assert.ok(Math.abs(box.w - 0.4) < 1e-9)
  assert.ok(Math.abs(box.h - 0.4) < 1e-9)
})

test('bestIouMulti uses best guess-truth pair', () => {
  const truths = [
    { x: 0.6, y: 0.1, w: 0.2, h: 0.4 },
    { x: 0.1, y: 0.5, w: 0.15, h: 0.2 },
  ]
  const good = { x: 0.62, y: 0.12, w: 0.18, h: 0.38 }
  const stray = { x: 0, y: 0, w: 0.05, h: 0.05 }
  assert.ok(bestIouMulti([stray, good], truths) > 0.5)
  assert.equal(bestIouMulti([], truths), 0)
})

test('scoreLocalization requires every teaching region', () => {
  const truths = [
    { x: 0.6, y: 0.1, w: 0.2, h: 0.4 },
    { x: 0.1, y: 0.5, w: 0.15, h: 0.2 },
  ]
  const oneHit = { x: 0.62, y: 0.12, w: 0.18, h: 0.38 }
  const partial = scoreLocalization([oneHit], truths, 0.25)
  assert.equal(partial.passed, false)
  assert.equal(partial.matched, 1)
  assert.equal(partial.total, 2)

  const second = { x: 0.11, y: 0.52, w: 0.13, h: 0.16 }
  const full = scoreLocalization([oneHit, second], truths, 0.25)
  assert.equal(full.passed, true)
  assert.equal(full.matched, 2)
  assert.ok(full.minIou >= 0.25)
})

test('pointInBox inclusive edges', () => {
  const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }
  assert.equal(pointInBox(0.2, 0.2, box), true)
  assert.equal(pointInBox(0.4, 0.4, box), true)
  assert.equal(pointInBox(0.41, 0.3, box), false)
})
