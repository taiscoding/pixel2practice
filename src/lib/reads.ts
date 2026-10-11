import type { NormBox } from './geometry'
import type { ReadResult } from './reader'

/** One pointed-read pair: the clinician's box plus both model reads. */
export type ReadRecord = {
  caseId: string
  box: NormBox
  model: string
  open: ReadResult
  pointed: ReadResult
  at: string
}

const STORAGE_KEY = 'pixel2practice.reads.v1'

export function loadReads(): ReadRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ReadRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveReads(reads: ReadRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reads))
  } catch {
    /* quota or private mode */
  }
}

export function clearReads(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function recordRead(
  reads: ReadRecord[],
  record: Omit<ReadRecord, 'at'>,
): ReadRecord[] {
  return [...reads, { ...record, at: new Date().toISOString() }]
}

export function exportReadsJson(reads: ReadRecord[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      reads,
      summary: {
        total: reads.length,
        openFindings: reads.reduce((s, r) => s + r.open.findings.length, 0),
        pointedFindings: reads.reduce(
          (s, r) => s + r.pointed.findings.length,
          0,
        ),
      },
    },
    null,
    2,
  )
}

export function downloadReadsLog(reads: ReadRecord[]): void {
  const blob = new Blob([exportReadsJson(reads)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pixel2practice-reads-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
