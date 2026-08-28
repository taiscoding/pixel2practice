import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  clamp01,
  normalizeBox,
  type NormBox,
} from '../lib/geometry'

type Props = {
  src: string
  alt: string
  enabled: boolean
  truths: NormBox[]
  showTruth: boolean
  showGuesses?: boolean
  guesses: NormBox[]
  onAddBox: (box: NormBox) => void
}

type Point = { x: number; y: number }

const MIN_BOX = 0.02
const MIN_BOX_TOUCH = 0.035

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(pointer: coarse)').matches
      : false,
  )

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const onChange = () => setCoarse(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return coarse
}

export function FilmStage({
  src,
  alt,
  enabled,
  truths,
  showTruth,
  showGuesses = true,
  guesses,
  onAddBox,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<Point | null>(null)
  const [draft, setDraft] = useState<NormBox | null>(null)
  const coarse = useCoarsePointer()
  const minBox = coarse ? MIN_BOX_TOUCH : MIN_BOX

  const toNorm = useCallback((clientX: number, clientY: number): Point | null => {
    const el = wrapRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return {
      x: clamp01((clientX - r.left) / r.width),
      y: clamp01((clientY - r.top) / r.height),
    }
  }, [])

  const finishDrag = useCallback(
    (clientX: number, clientY: number) => {
      const start = dragStartRef.current
      dragStartRef.current = null
      if (!start) {
        setDraft(null)
        return
      }
      const p = toNorm(clientX, clientY)
      if (!p) {
        setDraft(null)
        return
      }
      const box = normalizeBox(start, p)
      setDraft(null)
      if (box.w < minBox || box.h < minBox) return
      onAddBox(box)
    },
    [minBox, onAddBox, toNorm],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    const p = toNorm(e.clientX, e.clientY)
    if (!p) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStartRef.current = p
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !dragStartRef.current) return
    e.preventDefault()
    const p = toNorm(e.clientX, e.clientY)
    if (!p) return
    setDraft(normalizeBox(dragStartRef.current, p))
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || !dragStartRef.current) return
    e.preventDefault()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    finishDrag(e.clientX, e.clientY)
  }

  return (
    <div className="film-shell">
      <div
        ref={wrapRef}
        className={`film${enabled ? ' film--live' : ''}${coarse ? ' film--touch' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
          dragStartRef.current = null
          setDraft(null)
        }}
      >
        <img src={src} alt={alt} draggable={false} />
        {enabled && coarse ? (
          <p className="film-touch-hint">
            Drag boxes on every region the sentence names.
          </p>
        ) : null}
        {showGuesses
          ? guesses.map((box, i) => (
              <div
                key={`guess-${i}`}
                className="box box--guess"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                }}
              />
            ))
          : null}
        {draft ? (
          <div
            className="box box--guess box--draft"
            style={{
              left: `${draft.x * 100}%`,
              top: `${draft.y * 100}%`,
              width: `${draft.w * 100}%`,
              height: `${draft.h * 100}%`,
            }}
          />
        ) : null}
        {showTruth
          ? truths.map((box, i) => (
              <div
                key={`truth-${i}`}
                className="box box--truth"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                }}
              />
            ))
          : null}
      </div>
    </div>
  )
}
