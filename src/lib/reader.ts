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

export type ProviderId = 'gemini' | 'openai' | 'openrouter' | 'custom'

export type ProviderInfo = {
  label: string
  endpoint: string
  defaultModel: string
  keyUrl: string
  blurb: string
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: {
    label: 'Gemini',
    endpoint:
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    blurb: 'Free tier. Strong vision. Works from the browser.',
  },
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    keyUrl: 'https://platform.openai.com/api-keys',
    blurb: 'Direct. Works from the browser.',
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'anthropic/claude-sonnet-4',
    keyUrl: 'https://openrouter.ai/keys',
    blurb: 'One key, many models including Claude. Works from the browser.',
  },
  custom: {
    label: 'Custom',
    endpoint: '',
    defaultModel: '',
    keyUrl: '',
    blurb: 'Any other OpenAI-compatible endpoint. Ollama, proxies, other keys.',
  },
}

export const PROVIDER_IDS: ProviderId[] = [
  'gemini',
  'openai',
  'openrouter',
  'custom',
]

const PROVIDER_STORAGE = 'pixel2practice.reader.provider'
const MODEL_STORAGE = 'pixel2practice.reader.model'
const ENDPOINT_STORAGE = 'pixel2practice.reader.endpoint'
const LEGACY_KEY_STORAGE = 'pixel2practice.reader.key'
const keyStorage = (provider: ProviderId) =>
  `pixel2practice.reader.key.${provider}`

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

export function getProvider(): ProviderId {
  try {
    const v = localStorage.getItem(PROVIDER_STORAGE)
    if (v === 'openai' || v === 'openrouter' || v === 'custom') return v
    return 'gemini'
  } catch {
    return 'gemini'
  }
}

export function setProvider(provider: ProviderId): void {
  try {
    localStorage.setItem(PROVIDER_STORAGE, provider)
  } catch {
    /* quota or private mode */
  }
}

export function getReaderKey(provider: ProviderId): string {
  try {
    const key = localStorage.getItem(keyStorage(provider))
    if (key) return key
    if (provider === 'openai') {
      return localStorage.getItem(LEGACY_KEY_STORAGE) ?? ''
    }
    return ''
  } catch {
    return ''
  }
}

export function setReaderKey(provider: ProviderId, key: string): void {
  try {
    if (key) localStorage.setItem(keyStorage(provider), key)
    else localStorage.removeItem(keyStorage(provider))
  } catch {
    /* quota or private mode */
  }
}

export function getReaderModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function getCustomEndpoint(): string {
  try {
    return localStorage.getItem(ENDPOINT_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setCustomEndpoint(endpoint: string): void {
  try {
    if (endpoint) localStorage.setItem(ENDPOINT_STORAGE, endpoint)
    else localStorage.removeItem(ENDPOINT_STORAGE)
  } catch {
    /* quota or private mode */
  }
}

export function setReaderModel(model: string): void {
  try {
    if (model) localStorage.setItem(MODEL_STORAGE, model)
    else localStorage.removeItem(MODEL_STORAGE)
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
  provider: ProviderId
  key: string
  model: string
  /** Required when provider is 'custom'. */
  endpoint?: string
}

/**
 * Run one read: prompt plus images against the provider.
 * Note: Anthropic's own API blocks browser calls (no CORS), so a direct
 * Anthropic key will not work here. OpenRouter is the way to reach Claude
 * from the browser.
 */
export async function readImages(
  images: string[],
  prompt: string,
  opts: ReaderOpts,
): Promise<ReadResult> {
  const info = PROVIDERS[opts.provider]
  const endpoint =
    opts.provider === 'custom' ? (opts.endpoint ?? '').trim() : info.endpoint
  if (!endpoint) {
    throw new ReaderError(
      'Set the endpoint URL in reader settings first.',
    )
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90000)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.key}`,
    }
    if (opts.provider === 'openrouter') {
      headers['HTTP-Referer'] = window.location.origin
      headers['X-Title'] = 'pixel2practice'
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers,
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
          `The ${info.label} key was rejected. Check the key in reader settings.`,
          401,
        )
      }
      if (res.status === 429) {
        throw new ReaderError(
          'Rate limited. Wait a moment and try again.',
          429,
        )
      }
      const body = await res.text().catch(() => '')
      const detail = body.slice(0, 300).replace(/\s+/g, ' ').trim()
      throw new ReaderError(
        detail
          ? `Reader request failed (HTTP ${res.status}): ${detail}`
          : `Reader request failed (HTTP ${res.status}).`,
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
