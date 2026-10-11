/**
 * Pointed reading: run a vision model twice on a case, once open over the
 * whole film and once pointed at the clinician's marked region, then compare.
 * Bring your own key; it never leaves the browser except to the provider.
 */

export type Finding = {
  location: string
  description: string
  /** 0 to 1 */
  confidence: number
}

export type ReadResult = {
  findings: Finding[]
}

export const DEFAULT_MODEL = 'gpt-4o'
const KEY_STORAGE = 'pixel2practice.reader.key'
const MODEL_STORAGE = 'pixel2practice.reader.model'

export const OPEN_PROMPT = [
  'You are a radiology reader looking at a chest radiograph.',
  'Describe any abnormalities you see. Be specific about location and appearance.',
  'Return JSON only, in this shape:',
  '{"findings": [{"location": "...", "description": "...", "confidence": 0.0 to 1.0}]}.',
  'If you see nothing abnormal, return {"findings": []}.',
].join(' ')

export const POINTED_PROMPT = [
  'You are a radiology reader. A clinician looked at this chest radiograph,',
  'felt something looked off, and marked the region with a red box.',
  'The first image is the full radiograph with the marked region.',
  'The second image is a zoomed crop of the marked region.',
  'Focus your analysis on the marked region: describe what you see there,',
  'how confident you are, and what else it could be.',
  'Return JSON only, in this shape:',
  '{"findings": [{"location": "...", "description": "...", "confidence": 0.0 to 1.0}]}.',
  'If the marked region looks normal to you, say so in the description with',
  'low confidence rather than inventing a finding.',
].join(' ')

export function getReaderKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setReaderKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key)
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    /* quota or private mode */
  }
}

export function getReaderModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE) ?? DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}

export function setReaderModel(model: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE, model)
  } catch {
    /* quota or private mode */
  }
}

export class ReaderError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ReaderError'
    this.status = status
  }
}

function coerceFindings(raw: unknown): Finding[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as { findings?: unknown }).findings
  if (!Array.isArray(list)) return []
  return list
    .slice(0, 12)
    .map((item) => {
      const r = (item ?? {}) as Record<string, unknown>
      const confidence =
        typeof r.confidence === 'number'
          ? Math.min(1, Math.max(0, r.confidence))
          : 0
      return {
        location: typeof r.location === 'string' ? r.location : '',
        description: typeof r.description === 'string' ? r.description : '',
        confidence,
      }
    })
    .filter((f) => f.description.length > 0)
}

export type ReaderOpts = {
  key: string
  model: string
}

/** Run one read: prompt plus images against the provider. */
export async function readImages(
  images: string[],
  prompt: string,
  opts: ReaderOpts,
): Promise<ReadResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90000)
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.key}`,
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              ...images.map((url) => ({
                type: 'image_url',
                image_url: { url },
              })),
            ],
          },
        ],
      }),
    })
    if (!res.ok) {
      if (res.status === 401) {
        throw new ReaderError(
          'The API key was rejected. Check the key in reader settings.',
          401,
        )
      }
      if (res.status === 429) {
        throw new ReaderError(
          'Rate limited. Wait a moment and try again.',
          429,
        )
      }
      throw new ReaderError(
        `Reader request failed (HTTP ${res.status}).`,
        res.status,
      )
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    let parsed: unknown = null
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new ReaderError('The reader returned text that was not JSON.')
    }
    return { findings: coerceFindings(parsed) }
  } catch (err) {
    if (err instanceof ReaderError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ReaderError('The reader timed out. Try again.')
    }
    throw new ReaderError(
      'Could not reach the reader. Check your connection and try again.',
    )
  } finally {
    clearTimeout(timer)
  }
}
