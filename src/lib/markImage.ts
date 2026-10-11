import { padBox, type NormBox } from './geometry'

export const MAX_SEND_DIM = 1024

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Could not load image: ${src}`))
    img.src = src
  })
}

function fitCanvas(w: number, h: number, maxDim: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  return canvas
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  return ctx
}

/** Full image, downscaled for sending, as a JPEG data URL. */
export function plainImageUrl(
  img: HTMLImageElement,
  maxDim: number = MAX_SEND_DIM,
): string {
  const canvas = fitCanvas(img.naturalWidth, img.naturalHeight, maxDim)
  const ctx = get2d(canvas)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.9)
}

/**
 * Full image with the box drawn in red, Set-of-Mark style.
 * Thin red marks are the best-performing visual prompt in the literature.
 */
export function markedImageUrl(
  img: HTMLImageElement,
  box: NormBox,
  maxDim: number = MAX_SEND_DIM,
): string {
  const canvas = fitCanvas(img.naturalWidth, img.naturalHeight, maxDim)
  const ctx = get2d(canvas)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#ff2d2d'
  ctx.lineWidth = Math.max(2, Math.round(canvas.width / 300))
  ctx.strokeRect(
    box.x * canvas.width,
    box.y * canvas.height,
    box.w * canvas.width,
    box.h * canvas.height,
  )
  return canvas.toDataURL('image/jpeg', 0.9)
}

/** Zoomed crop of the padded box region, as a JPEG data URL. */
export function cropImageUrl(
  img: HTMLImageElement,
  box: NormBox,
  maxDim: number = MAX_SEND_DIM,
): string {
  const padded = padBox(box, 0.5)
  const sx = padded.x * img.naturalWidth
  const sy = padded.y * img.naturalHeight
  const sw = padded.w * img.naturalWidth
  const sh = padded.h * img.naturalHeight
  if (sw < 2 || sh < 2) throw new Error('Box is too small to crop')
  const scale = Math.min(1, maxDim / Math.max(sw, sh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale))
  canvas.height = Math.max(1, Math.round(sh * scale))
  const ctx = get2d(canvas)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.9)
}
