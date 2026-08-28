import { useEffect, useMemo, useState } from 'react'
import { FilmStage } from './components/FilmStage'
import {
  DEMO_CASES,
  IOU_PASS,
  isCaseItem,
  teachingTargets,
  type CaseItem,
} from './lib/cases'
import { bestIouMulti, type NormBox } from './lib/geometry'
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
  const [guesses, setGuesses] = useState<NormBox[]>([])
  const [phase, setPhase] = useState<Phase>('locate')
  const [showGuesses, setShowGuesses] = useState(true)
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
        setGuesses([])
        setPhase('locate')
        setShowGuesses(true)
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
  const targets = useMemo(() => teachingTargets(item), [item])
  const score = useMemo(
    () => (guesses.length > 0 ? bestIouMulti(guesses, targets) : 0),
    [guesses, targets],
  )
  const passed = score >= IOU_PASS
  const stats = summarizeAttempts(session.attempts)
  const completedCount = session.completedCaseIds.length
  const targetCount = targets.length

  const addBox = (box: NormBox) => {
    if (phase !== 'locate') return
    setGuesses((prev) => [...prev, box])
  }

  const scoreAttempt = () => {
    if (phase !== 'locate' || guesses.length === 0) return
    const iouScore = bestIouMulti(guesses, targets)
    setPhase('scored')
    setShowGuesses(true)
    setShowTruth(true)
    setSession((s) => recordAttempt(s, item, iouScore))
  }

  const retry = () => {
    setGuesses([])
    setPhase('locate')
    setShowGuesses(true)
    setShowTruth(true)
  }

  const next = () => {
    setSession((s) => ({
      ...s,
      completedCaseIds: s.completedCaseIds.includes(item.id)
        ? s.completedCaseIds
        : [...s.completedCaseIds, item.id],
    }))
    setGuesses([])
    setPhase('locate')
    setShowGuesses(true)
    setShowTruth(true)
    setIndex((i) => (i + 1) % cases.length)
  }

  const undoBox = () => {
    if (phase !== 'locate') return
    setGuesses((prev) => prev.slice(0, -1))
  }

  const clearBoxes = () => {
    if (phase !== 'locate') return
    setGuesses([])
  }

  const resetSession = () => {
    clearSession()
    setSession(createEmptySession())
    setIndex(0)
    setGuesses([])
    setPhase('locate')
    setShowGuesses(true)
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
              ? targetCount > 1
                ? `Drag ${targetCount} boxes if the sentence names multiple regions, then score.`
                : 'Drag one or more boxes over the region this sentence describes, then score.'
              : passed
                ? 'Hit. Toggle overlays to compare, then go to the next case.'
                : 'Miss. Toggle overlays, then try again or move on.'}
          </p>

          {phase === 'locate' && guesses.length > 0 ? (
            <p className="box-count">
              {guesses.length} box{guesses.length === 1 ? '' : 'es'} drawn
            </p>
          ) : null}

          {phase === 'scored' ? (
            <div className="result" data-pass={passed}>
              <p className="result-label">{passed ? 'Pass' : 'Miss'}</p>
              <p className="result-meta">
                Best IoU {score.toFixed(2)} · pass at {IOU_PASS.toFixed(2)}
                {targetCount > 1 ? ` · ${targetCount} teaching regions` : ''}
              </p>
            </div>
          ) : null}

          {phase === 'scored' ? (
            <div className="overlays" role="group" aria-label="Overlay visibility">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showGuesses}
                  onChange={(e) => setShowGuesses(e.target.checked)}
                />
                <span className="swatch swatch--guess" aria-hidden />
                Your boxes
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showTruth}
                  onChange={(e) => setShowTruth(e.target.checked)}
                />
                <span className="swatch swatch--truth" aria-hidden />
                Teaching targets
              </label>
            </div>
          ) : null}

          <div className="actions">
            {phase === 'locate' ? (
              <>
                <button
                  type="button"
                  className="btn primary"
                  disabled={guesses.length === 0}
                  onClick={scoreAttempt}
                >
                  Score
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={guesses.length === 0}
                  onClick={undoBox}
                >
                  Undo last
                </button>
                <button type="button" className="btn ghost" onClick={clearBoxes}>
                  Clear all
                </button>
              </>
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
          truths={targets}
          showTruth={phase === 'scored' && showTruth}
          showGuesses={phase === 'locate' || showGuesses}
          guesses={guesses}
          onAddBox={addBox}
        />
      </main>

      <footer className="foot">
        <p>
          Self-eval mode: progress saves in this browser. Score uses your best
          box against any teaching region. Export the log when you want a record
          for later review.
        </p>
      </footer>
    </div>
  )
}
