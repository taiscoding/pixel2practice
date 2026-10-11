import { useEffect, useMemo, useState } from 'react'
import { FilmStage } from './FilmStage'
import { teachingTargets, type CaseItem } from '../lib/cases'
import { bestIouForTarget, type NormBox } from '../lib/geometry'
import {
  cropImageUrl,
  loadImage,
  markedImageUrl,
  plainImageUrl,
} from '../lib/markImage'
import {
  OPEN_PROMPT,
  POINTED_PROMPT,
  PROVIDERS,
  PROVIDER_IDS,
  ReaderError,
  getCustomEndpoint,
  getProvider,
  getReaderKey,
  getReaderModel,
  readImages,
  setCustomEndpoint,
  setProvider,
  setReaderKey,
  setReaderModel,
  type ProviderId,
  type ReadResult,
} from '../lib/reader'
import {
  clearReads,
  downloadReadsLog,
  loadReads,
  recordRead,
  saveReads,
  type ReadRecord,
} from '../lib/reads'

type Props = {
  item: CaseItem
  onNext: () => void
}

type Phase = 'point' | 'reading' | 'read'

function ReadPanel({
  title,
  result,
  pointed,
}: {
  title: string
  result: ReadResult
  pointed?: boolean
}) {
  return (
    <div className={pointed ? 'read-panel read-panel--pointed' : 'read-panel'}>
      <h3>{title}</h3>
      {result.findings.length === 0 ? (
        <p className="hint">No findings reported.</p>
      ) : (
        result.findings.map((f, i) => (
          <div className="finding" key={i}>
            <p>{f.description}</p>
            <p className="finding-meta">
              {f.location ? (
                <span className="finding-loc">{f.location}</span>
              ) : null}
              <span className="finding-conf">
                confidence {f.confidence.toFixed(2)}
              </span>
            </p>
          </div>
        ))
      )}
    </div>
  )
}

export function PointMode({ item, onNext }: Props) {
  const [box, setBox] = useState<NormBox | null>(null)
  const [phase, setPhase] = useState<Phase>('point')
  const [open, setOpen] = useState<ReadResult | null>(null)
  const [pointed, setPointed] = useState<ReadResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProviderState] = useState<ProviderId>(() => getProvider())
  const [key, setKey] = useState(() => getReaderKey(getProvider()))
  const [model, setModel] = useState(() => getReaderModel())
  const [endpoint, setEndpoint] = useState(() => getCustomEndpoint())
  const [showTruth, setShowTruth] = useState(false)
  const [reads, setReads] = useState<ReadRecord[]>(() => loadReads())

  const targets = useMemo(() => teachingTargets(item), [item])

  useEffect(() => {
    saveReads(reads)
  }, [reads])

  const truthIou = useMemo(() => {
    if (!box) return 0
    return Math.max(...targets.map((t) => bestIouForTarget([box], t)))
  }, [box, targets])

  const switchProvider = (next: ProviderId) => {
    setProviderState(next)
    setProvider(next)
    setKey(getReaderKey(next))
  }

  const askReader = async () => {
    if (!box || phase !== 'point') return
    const readerKey = key.trim()
    if (!readerKey) {
      setError(
        `Add your ${PROVIDERS[provider].label} API key in the settings below. The key stays in this browser.`,
      )
      return
    }
    const readerModel = model.trim() || PROVIDERS[provider].defaultModel
    setPhase('reading')
    setError(null)
    try {
      const img = await loadImage(item.image)
      const full = plainImageUrl(img)
      const marked = markedImageUrl(img, box)
      const crop = cropImageUrl(img, box)
      const [openRes, pointedRes] = await Promise.all([
        readImages([full], OPEN_PROMPT, {
          provider,
          key: readerKey,
          model: readerModel,
          endpoint,
        }),
        readImages([marked, crop], POINTED_PROMPT, {
          provider,
          key: readerKey,
          model: readerModel,
          endpoint,
        }),
      ])
      setOpen(openRes)
      setPointed(pointedRes)
      setPhase('read')
      setReads((prev) =>
        recordRead(prev, {
          caseId: item.id,
          box,
          provider,
          model: readerModel,
          open: openRes,
          pointed: pointedRes,
        }),
      )
    } catch (err) {
      setError(
        err instanceof ReaderError
          ? err.message
          : 'Something went wrong running the reader.',
      )
      setPhase('point')
    }
  }

  const clearBox = () => {
    if (phase !== 'point') return
    setBox(null)
  }

  const drawAgain = () => {
    setBox(null)
    setOpen(null)
    setPointed(null)
    setError(null)
    setPhase('point')
  }

  const resetReads = () => {
    clearReads()
    setReads([])
  }

  return (
    <>
      <aside className="cue-panel">
        <p className="kicker">Point · no cue</p>
        <h1 className="cue">Trust your eye.</h1>
        <p className="hint">
          {phase === 'reading'
            ? 'Reading the film twice: once open, once pointed at your box.'
            : phase === 'read'
              ? 'Two reads of the same film. Compare what the pointer changed.'
              : box
                ? 'Box placed. Ask the reader, or clear it and point again.'
                : 'Draw one box where something looks off, then ask the reader.'}
        </p>

        {box ? (
          <p className="box-count">
            1 box drawn
            {showTruth
              ? ` · IoU ${truthIou.toFixed(2)} vs teaching target`
              : ''}
          </p>
        ) : null}

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        {phase === 'read' && open && pointed ? (
          <div className="reads">
            <p className="compare-line">
              Open read: {open.findings.length} finding
              {open.findings.length === 1 ? '' : 's'} · Pointed read:{' '}
              {pointed.findings.length} finding
              {pointed.findings.length === 1 ? '' : 's'} on your box
            </p>
            <ReadPanel title="Open read · whole film" result={open} />
            <ReadPanel title="Pointed read · your box" result={pointed} pointed />
          </div>
        ) : null}

        {phase === 'read' ? (
          <label className="toggle">
            <input
              type="checkbox"
              checked={showTruth}
              onChange={(e) => setShowTruth(e.target.checked)}
            />
            <span className="swatch swatch--truth" aria-hidden />
            Teaching target
          </label>
        ) : null}

        <div className="actions">
          {phase === 'point' ? (
            <>
              <button
                type="button"
                className="btn primary"
                disabled={!box}
                onClick={askReader}
              >
                Ask the reader
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={!box}
                onClick={clearBox}
              >
                Clear box
              </button>
            </>
          ) : phase === 'read' ? (
            <>
              <button type="button" className="btn primary" onClick={onNext}>
                Next case
              </button>
              <button type="button" className="btn ghost" onClick={drawAgain}>
                Point again
              </button>
            </>
          ) : null}
        </div>

        <details className="settings">
          <summary>Reader settings</summary>
          <div className="fields">
            <div className="field">
              <label htmlFor="reader-provider">Provider</label>
              <select
                id="reader-provider"
                value={provider}
                onChange={(e) =>
                  switchProvider(e.target.value as ProviderId)
                }
              >
                {PROVIDER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {PROVIDERS[id].label} — {PROVIDERS[id].blurb}
                  </option>
                ))}
              </select>
            </div>
            {provider === 'custom' ? (
              <div className="field">
                <label htmlFor="reader-endpoint">Endpoint URL</label>
                <input
                  id="reader-endpoint"
                  value={endpoint}
                  autoComplete="off"
                  placeholder="https://.../chat/completions"
                  onChange={(e) => {
                    setEndpoint(e.target.value)
                    setCustomEndpoint(e.target.value)
                  }}
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="reader-key">
                {PROVIDERS[provider].label} API key
              </label>
              <input
                id="reader-key"
                type="password"
                value={key}
                autoComplete="off"
                placeholder="paste key"
                onChange={(e) => {
                  setKey(e.target.value)
                  setReaderKey(provider, e.target.value)
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="reader-model">Model</label>
              <input
                id="reader-model"
                value={model}
                autoComplete="off"
                placeholder={PROVIDERS[provider].defaultModel}
                onChange={(e) => {
                  setModel(e.target.value)
                  setReaderModel(e.target.value)
                }}
              />
            </div>
            <p className="hint">
              {provider === 'custom' ? (
                <>
                  Free routes: Ollama on this machine (endpoint{' '}
                  http://localhost:11434/v1/chat/completions, pull a vision
                  model, serve with OLLAMA_ORIGINS set to this page's
                  origin), or Gemini's free tier (endpoint{' '}
                  https://generativelanguage.googleapis.com/v1beta/openai/chat/completions,
                  key from AI Studio). OpenRouter also lists free :free
                  models.
                </>
              ) : (
                <>
                  Get a key at{' '}
                  <a
                    href={PROVIDERS[provider].keyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {PROVIDERS[provider].keyUrl}
                  </a>
                  . Anthropic's own API blocks browser calls, so use
                  OpenRouter to reach Claude.{' '}
                </>
              )}
              The key stays in this browser. Demo only: the reader is a
              general vision model, not a medical device. Do not use on real
              patients.
            </p>
          </div>
        </details>

        {reads.length > 0 ? (
          <div className="session-tools">
            <button
              type="button"
              className="btn ghost btn--compact"
              onClick={() => downloadReadsLog(reads)}
            >
              Export reads log
            </button>
            <button
              type="button"
              className="btn ghost btn--compact"
              onClick={resetReads}
            >
              Clear reads
            </button>
          </div>
        ) : null}

        <p className="attr">{item.attribution}</p>
      </aside>

      <FilmStage
        src={item.image}
        alt={`Chest radiograph for case ${item.id}`}
        enabled={phase === 'point'}
        truths={showTruth ? targets : []}
        showTruth={showTruth}
        guesses={box ? [box] : []}
        onAddBox={(b) => {
          if (phase === 'point') setBox(b)
        }}
      />
    </>
  )
}
