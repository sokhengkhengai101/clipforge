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

async function send<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const answer = await fetch(`/api${path}`, {
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
  reason: string
  files: Record<string, string>
}

export type JobOptions = {
  video: string
  max_clips?: number
  full?: boolean
  redo?: string
}

export const api = {
  health: () => send<Health>('/health'),
  videos: () => send<Video[]>('/videos'),
  startJob: (options: JobOptions) => send<JobStatus>('/jobs', 'POST', options),
  cancelJob: (id: string) => send<JobStatus>(`/jobs/${id}`, 'DELETE'),
  // 404 = project នេះមិនទាន់មាន clip (job ទើបចាប់ផ្តើម) -> បញ្ជីទទេ
  clips: (name: string) =>
    send<{ name: string; clips: Clip[] }>(`/projects/${encodeURIComponent(name)}/clips`)
      .then((answer) => answer.clips)
      .catch(() => [] as Clip[]),
}

/** URL របស់ WebSocket. `location.host` = 5173, ហើយ proxy បញ្ជូនបន្តទៅ 8765. */
export function eventsUrl(jobId: string): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/jobs/${jobId}/events`
}
