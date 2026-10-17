/** ហៅ sidecar. គ្រប់ path ទៅតាម `/api` ដែល Vite proxy បញ្ជូនទៅ port 8765. */

export type Health = {
  ok: boolean
  version: string
  ffmpeg: boolean
  device: string
  whisper_model: string
  llm_model: string
  busy: string | null
}

export type Video = {
  name: string
  path: string
  mb: number
}

export type Progress = {
  done: string[]
  cached: string[]
  fresh: string[]
  total: number
  step: string
}

export type JobStatus = {
  id: string
  video: string
  state: 'running' | 'done' | 'failed' | 'cancelled'
  error: string
  seconds: number
  progress: Progress
  log_lines: number
}

/** ជំហានតាមលំដាប់ដូច `server/jobs.py` STEPS. */
export const STEPS = [
  'audio',
  'transcribe',
  'highlights',
  'boundaries',
  'captions',
  'render',
] as const

/** ក្នុង Tauri ទំព័រមិនមកពី Vite ទេ (គ្មាន proxy) ដូច្នេះត្រូវហៅ sidecar ត្រង់.
 *  ក្នុង browser យើងប្រើ `/api` ដែល Vite បញ្ជូនបន្ត. */
export const IN_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const API_BASE = IN_TAURI ? 'http://127.0.0.1:8765' : '/api'

async function send<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const answer = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!answer.ok) {
    // sidecar ផ្ញើ `{"detail": "..."}` ពេលមានបញ្ហា (409 = មាន job រត់រួចហើយ)
    const detail = await answer.json().catch(() => null)
    throw new Error(detail?.detail ?? `${path} -> ${answer.status}`)
  }
  return (await answer.json()) as T
}

export type Dimension = { score: number; letter: string; reason: string }

export type Grades = { hook: Dimension; flow: Dimension; value: Dimension }

export type Clip = {
  index: number
  start: number
  end: number
  duration: number
  title: string
  hook: string
  type: string
  total: number
  letter: string
  grades: Grades | null
  reason: string
  files: Record<string, string>
}

export type JobOptions = {
  video: string
  max_clips?: number
  full?: boolean
  redo?: string
  caption_words?: number
  caption_color?: string
  aspect?: string
  layout?: string
}

/** ជួរមួយក្នុងតារាង `project` របស់ database (server/db.py). */
export type Project = {
  id: number
  name: string
  video: string
  created: number
  clips: number
  jobs: number
  last_state: string | null
}

export const api = {
  health: () => send<Health>('/health'),
  videos: () => send<Video[]>('/videos'),
  projects: () => send<Project[]>('/projects'),
  startJob: (options: JobOptions) => send<JobStatus>('/jobs', 'POST', options),
  cancelJob: (id: string) => send<JobStatus>(`/jobs/${id}`, 'DELETE'),
  // 404 = project នេះមិនទាន់មាន clip (job ទើបចាប់ផ្តើម) -> បញ្ជីទទេ
  clips: (name: string) =>
    send<{ name: string; clips: Clip[] }>(`/projects/${encodeURIComponent(name)}/clips`)
      .then((answer) => answer.clips)
      .catch(() => [] as Clip[]),
}

/** URL របស់ file មួយក្នុង clip — `<video src>` និង `<img src>` ប្រើវាផ្ទាល់. */
export function clipFileUrl(project: string, index: number, kind: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(project)}/clips/${index}/file?kind=${kind}`
}

export function clipThumbUrl(project: string, index: number): string {
  return `${API_BASE}/projects/${encodeURIComponent(project)}/clips/${index}/thumb`
}

/** URL របស់ WebSocket. `location.host` = 5173, ហើយ proxy បញ្ជូនបន្តទៅ 8765. */
export function eventsUrl(jobId: string): string {
  if (IN_TAURI) return `ws://127.0.0.1:8765/jobs/${jobId}/events`
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/jobs/${jobId}/events`
}
