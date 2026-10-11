import test from 'node:test'
import assert from 'node:assert/strict'
import { padBox } from './geometry.ts'
import type { NormBox } from './geometry.ts'

function approxEqual(a: NormBox, b: NormBox): boolean {
  return (
    Math.abs(a.x - b.x) < 1e-9 &&
    Math.abs(a.y - b.y) < 1e-9 &&
    Math.abs(a.w - b.w) < 1e-9 &&
    Math.abs(a.h - b.h) < 1e-9
  )
}

test('padBox expands symmetrically', () => {
  const out = padBox({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 0.5)
  assert.ok(approxEqual(out, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 }))
})

test('padBox clamps to the image edges', () => {
  const out = padBox({ x: 0.0, y: 0.0, w: 0.2, h: 0.2 }, 1)
  assert.ok(approxEqual(out, { x: 0, y: 0, w: 0.4, h: 0.4 }))
})

test('padBox with zero pad returns the same box', () => {
  const box = { x: 0.25, y: 0.35, w: 0.1, h: 0.15 }
  assert.ok(approxEqual(padBox(box, 0), box))
})
