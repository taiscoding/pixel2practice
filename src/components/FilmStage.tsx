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
  truth?: NormBox
  showTruth: boolean
  showGuess?: boolean
  guess: NormBox | null
  onGuess: (box: NormBox) => void
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
  truth,
  showTruth,
  showGuess = true,
  guess,
  onGuess,
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
      onGuess(box)
    },
    [minBox, onGuess, toNorm],
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

  const paint = draft ?? (showGuess ? guess : null)

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
          <p className="film-touch-hint">Drag a box on the finding.</p>
        ) : null}
        {paint ? (
          <div
            className="box box--guess"
            style={{
              left: `${paint.x * 100}%`,
              top: `${paint.y * 100}%`,
              width: `${paint.w * 100}%`,
              height: `${paint.h * 100}%`,
            }}
          />
        ) : null}
        {showTruth && truth ? (
          <div
            className="box box--truth"
            style={{
              left: `${truth.x * 100}%`,
              top: `${truth.y * 100}%`,
              width: `${truth.w * 100}%`,
              height: `${truth.h * 100}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  )
}
