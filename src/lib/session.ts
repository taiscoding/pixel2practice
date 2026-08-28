import { IOU_PASS } from './cases'

export type AttemptRecord = {
  caseId: string
  cue: string
  source: string
  iou: number
  passed: boolean
  at: string
}

export type SessionState = {
  attempts: AttemptRecord[]
  /** Case ids the user has moved past (Next). */
  completedCaseIds: string[]
  /** Resume index in the active case list. */
  index: number
  updatedAt: string
}

const STORAGE_KEY = 'pixel2practice.session.v1'

export function loadSession(): SessionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionState
    if (!Array.isArray(parsed.attempts) || !Array.isArray(parsed.completedCaseIds)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveSession(state: SessionState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota or private mode */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function summarizeAttempts(attempts: AttemptRecord[]) {
  const passes = attempts.filter((a) => a.passed).length
  const avgIou =
    attempts.length > 0
      ? attempts.reduce((s, a) => s + a.iou, 0) / attempts.length
      : 0
  return { passes, total: attempts.length, avgIou }
}

export function recordAttempt(
  session: SessionState,
  item: { id: string; cue: string; source?: string },
  iouScore: number,
): SessionState {
  const passed = iouScore >= IOU_PASS
  const attempt: AttemptRecord = {
    caseId: item.id,
    cue: item.cue,
    source: item.source ?? 'unknown',
    iou: iouScore,
    passed,
    at: new Date().toISOString(),
  }
  return {
    ...session,
    attempts: [...session.attempts, attempt],
    updatedAt: new Date().toISOString(),
  }
}

export function exportAttemptsJson(attempts: AttemptRecord[]): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      passThreshold: IOU_PASS,
      attempts,
      summary: summarizeAttempts(attempts),
    },
    null,
    2,
  )
}

export function downloadAttemptsLog(attempts: AttemptRecord[]): void {
  const blob = new Blob([exportAttemptsJson(attempts)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pixel2practice-session-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function createEmptySession(index = 0): SessionState {
  return {
    attempts: [],
    completedCaseIds: [],
    index,
    updatedAt: new Date().toISOString(),
  }
}
