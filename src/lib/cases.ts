import type { NormBox } from './geometry'

export type CaseItem = {
  id: string
  modality: string
  image: string
  /** Finding sentence shown as the cue. */
  cue: string
  /** Primary teaching target (often the union of truths). */
  truth: NormBox
  /** Optional per-region boxes from the source dataset. */
  truths?: NormBox[]
  attribution: string
  source?: string
}

/**
 * Demo fallback only. Prefer public/drills.json from scripts/build-drills.py
 * after you obtain PadChest-GR or VinDr.
 */
export const DEMO_CASES: CaseItem[] = [
  {
    id: 'lobar-rml',
    modality: 'CXR',
    image: '/cases/lobar-pneumonia.jpg',
    cue: 'There is consolidation in the right middle lobe with silhouette of the right heart border.',
    truth: { x: 0.1, y: 0.4, w: 0.32, h: 0.38 },
    attribution:
      'Mikael Häggström, M.D. (CC0) — Wikimedia Commons: X-ray of lobar pneumonia',
    source: 'demo',
  },
  {
    id: 'left-ptx',
    modality: 'CXR',
    image: '/cases/left-pneumothorax.jpg',
    cue: 'There is a left-sided pneumothorax with a visible visceral pleural line and absent peripheral lung markings.',
    truth: { x: 0.58, y: 0.1, w: 0.28, h: 0.42 },
    attribution:
      'Mynameisderek (public domain) — Wikimedia Commons: Expiration-left-side-pneumo (on-image arrow removed)',
    source: 'demo',
  },
  {
    id: 'rul-opacity',
    modality: 'CXR',
    image: '/cases/pneumonia-ap.jpg',
    cue: 'There is increased opacity in the right upper lobe.',
    truth: { x: 0.14, y: 0.1, w: 0.28, h: 0.3 },
    attribution:
      'CDC Public Health Image Library (U.S. government work, public domain)',
    source: 'demo',
  },
]

/** @deprecated use DEMO_CASES */
export const CASES = DEMO_CASES

/** Pass threshold aligned with RadGame Localize (IoU > 0.25). */
export const IOU_PASS = 0.25

export function isCaseItem(value: unknown): value is CaseItem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const truth = v.truth as Record<string, unknown> | undefined
  return (
    typeof v.id === 'string' &&
    typeof v.image === 'string' &&
    typeof v.cue === 'string' &&
    !!truth &&
    typeof truth.x === 'number' &&
    typeof truth.y === 'number' &&
    typeof truth.w === 'number' &&
    typeof truth.h === 'number'
  )
}
