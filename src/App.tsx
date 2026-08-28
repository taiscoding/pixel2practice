import { useEffect, useMemo, useState } from 'react'
import { FilmStage } from './components/FilmStage'
import {
  DEMO_CASES,
  IOU_PASS,
  isCaseItem,
  type CaseItem,
} from './lib/cases'
import { iou, type NormBox } from './lib/geometry'
import {
  clearSession,
  createEmptySession,
  downloadAttemptsLog,
  loadSession,
  recordAttempt,
  saveSession,
  summarizeAttempts,
  type SessionState,
} from './lib/session'
import './App.css'

type Phase = 'locate' | 'scored'

export default function App() {
  const [cases, setCases] = useState<CaseItem[]>(DEMO_CASES)
  const [sourceLabel, setSourceLabel] = useState('demo')
  const [session, setSession] = useState<SessionState>(() =>
    loadSession() ?? createEmptySession(),
  )
  const [index, setIndex] = useState(() => loadSession()?.index ?? 0)
  const [guess, setGuess] = useState<NormBox | null>(null)
  const [phase, setPhase] = useState<Phase>('locate')
  const [showGuess, setShowGuess] = useState(true)
  const [showTruth, setShowTruth] = useState(true)

  useEffect(() => {
    saveSession({ ...session, index })
  }, [session, index])

  useEffect(() => {
    let cancelled = false
    fetch('/drills.json')
      .then(async (res) => {
        if (!res.ok) return null
        return res.json()
      })
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return
        const loaded = data.filter(isCaseItem)
        if (loaded.length === 0) return
        setCases(loaded)
        setSourceLabel(loaded[0]?.source ?? 'dataset')
        const saved = loadSession()
        setSession(saved ?? createEmptySession())
        setIndex(saved?.index ?? 0)
        setGuess(null)
        setPhase('locate')
        setShowGuess(true)
        setShowTruth(true)
      })
      .catch(() => {
        /* keep demo */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const item = cases[index] ?? DEMO_CASES[0]
  const score = useMemo(
    () => (guess ? iou(guess, item.truth) : 0),
    [guess, item.truth],
  )
  const passed = score >= IOU_PASS
  const stats = summarizeAttempts(session.attempts)
  const completedCount = session.completedCaseIds.length

  const submit = (box: NormBox) => {
    if (phase !== 'locate') return
    const iouScore = iou(box, item.truth)
    setGuess(box)
    setPhase('scored')
    setShowGuess(true)
    setShowTruth(true)
    setSession((s) => recordAttempt(s, item, iouScore))
  }

  const retry = () => {
    setGuess(null)
    setPhase('locate')
    setShowGuess(true)
    setShowTruth(true)
  }

  const next = () => {
    setSession((s) => ({
      ...s,
      completedCaseIds: s.completedCaseIds.includes(item.id)
        ? s.completedCaseIds
        : [...s.completedCaseIds, item.id],
    }))
    setGuess(null)
    setPhase('locate')
    setShowGuess(true)
    setShowTruth(true)
    setIndex((i) => (i + 1) % cases.length)
  }

  const resetBox = () => {
    if (phase !== 'locate') return
    setGuess(null)
  }

  const resetSession = () => {
    clearSession()
    setSession(createEmptySession())
    setIndex(0)
    setGuess(null)
    setPhase('locate')
    setShowGuess(true)
    setShowTruth(true)
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <p className="wordmark">pixel2practice</p>
          <p className="tag">Find what the finding names.</p>
        </div>
        <p className="scoreline">
          {stats.passes}/{stats.total} pass
          {stats.total === 1 ? '' : 'es'} · avg IoU {stats.avgIou.toFixed(2)} ·{' '}
          {completedCount}/{cases.length} done · {sourceLabel}
        </p>
      </header>

      <main className="stage">
        <aside className="cue-panel">
          <p className="kicker">{item.modality}</p>
          <h1 className="cue">{item.cue}</h1>
          <p className="hint">
            {phase === 'locate'
              ? 'Drag a box over the region this sentence describes.'
              : passed
                ? 'Hit. Toggle overlays to compare, then go to the next case.'
                : 'Miss. Toggle overlays, then try again or move on.'}
          </p>

          {phase === 'scored' ? (
            <div className="result" data-pass={passed}>
              <p className="result-label">{passed ? 'Pass' : 'Miss'}</p>
              <p className="result-meta">
                IoU {score.toFixed(2)} · pass at {IOU_PASS.toFixed(2)}
              </p>
            </div>
          ) : null}

          {phase === 'scored' ? (
            <div className="overlays" role="group" aria-label="Overlay visibility">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showGuess}
                  onChange={(e) => setShowGuess(e.target.checked)}
                />
                <span className="swatch swatch--guess" aria-hidden />
                Your box
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showTruth}
                  onChange={(e) => setShowTruth(e.target.checked)}
                />
                <span className="swatch swatch--truth" aria-hidden />
                Teaching target
              </label>
            </div>
          ) : null}

          <div className="actions">
            {phase === 'locate' ? (
              <button type="button" className="btn ghost" onClick={resetBox}>
                Clear box
              </button>
            ) : (
              <>
                {!passed ? (
                  <button type="button" className="btn ghost" onClick={retry}>
                    Try again
                  </button>
                ) : null}
                <button type="button" className="btn primary" onClick={next}>
                  Next case
                </button>
              </>
            )}
          </div>

          {stats.total > 0 ? (
            <div className="session-tools">
              <button
                type="button"
                className="btn ghost btn--compact"
                onClick={() => downloadAttemptsLog(session.attempts)}
              >
                Export session log
              </button>
              <button
                type="button"
                className="btn ghost btn--compact"
                onClick={resetSession}
              >
                Reset session
              </button>
            </div>
          ) : null}

          <p className="attr">{item.attribution}</p>
        </aside>

        <FilmStage
          src={item.image}
          alt={`Chest radiograph for case ${item.id}`}
          enabled={phase === 'locate'}
          truth={item.truth}
          showTruth={phase === 'scored' && showTruth}
          showGuess={phase === 'locate' || showGuess}
          guess={guess}
          onGuess={submit}
        />
      </main>

      <footer className="foot">
        <p>
          Self-eval mode: progress saves in this browser. Export the log when you
          want a record for later review.
        </p>
      </footer>
    </div>
  )
}
