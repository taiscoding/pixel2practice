export type NormBox = {
  x: number
  y: number
  w: number
  h: number
}

export function normalizeBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
): NormBox {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(a.x - b.x)
  const h = Math.abs(a.y - b.y)
  return { x, y, w, h }
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export function iou(a: NormBox, b: NormBox): number {
  const ax2 = a.x + a.w
  const ay2 = a.y + a.h
  const bx2 = b.x + b.w
  const by2 = b.y + b.h

  const ix1 = Math.max(a.x, b.x)
  const iy1 = Math.max(a.y, b.y)
  const ix2 = Math.min(ax2, bx2)
  const iy2 = Math.min(ay2, by2)

  const iw = Math.max(0, ix2 - ix1)
  const ih = Math.max(0, iy2 - iy1)
  const inter = iw * ih
  if (inter <= 0) return 0

  const union = a.w * a.h + b.w * b.h - inter
  if (union <= 0) return 0
  return inter / union
}

export function pointInBox(px: number, py: number, box: NormBox): boolean {
  return (
    px >= box.x &&
    px <= box.x + box.w &&
    py >= box.y &&
    py <= box.y + box.h
  )
}
