/** ហៅ sidecar. គ្រប់ path ទៅតាម `/api` ដែល Vite proxy បញ្ជូនទៅ port 8765. */
import type { Transform } from './transformBox'
import type { CaptionAnimation } from './captionStyle'

export type Health = {
  ok: boolean
  version: string
  ffmpeg: boolean
  device: string
  whisper_model: string
  llm_model: string
  busy: string | null
  output_dir: string // កន្លែងដែល pipeline សរសេរ (output/)
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
  skipped?: string[] // --full: highlights និង boundaries មិនរត់
  planned?: boolean // clip_XX_layout.json ថ្មី = វិភាគ shot និងមុខរួច (AI Reframe)
  folder?: string // clips / full / full_1x1 ...
  fraction?: Record<string, number> // ចំណែកពិតក្នុងជំហាន 0..1 (transcribe, highlights, render)
}

export type JobStatus = {
  id: string
  video: string
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
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
  aspects?: Record<string, Record<string, string>> // ទំហំក្រៅពី 9:16 ដែល render រួច
  rating?: 'like' | 'dislike' | null // ♡ / 👎 លើ Review (project.json)
}

export type JobOptions = {
  video: string
  queue?: boolean // មាន job កំពុងរត់: ចូលជួរ (រត់បន្ទាប់ពីវាចប់) ជំនួសឲ្យ 409
  max_clips?: number
  full?: boolean
  redo?: string
  caption_words?: number
  caption_color?: string
  caption_size?: number // % (screen Subtitles)
  caption_outline?: number
  caption_case?: 'upper' | 'original'
  caption_position?: 'auto' | 'top' | 'middle' | 'bottom'
  no_captions?: boolean
  clean_only?: boolean // render តែ clip_XX_clean.mp4 (preview)
  aspect?: string
  only_clip?: number       // render តែ clip នេះ (ប៊ូតុងទំហំលើ Review)
  timeframe?: string       // "start,end" ឬ "all": ចន្លោះដែល AI រក clip (ជាមួយ full: ចន្លោះដែល render)
  layout?: string
  model?: string            // Ollama model (model pack)
  whisper_model?: string    // small / medium / large-v3 (model pack)
  language?: string         // auto / en / fr ... (Auto Subtitles)
  transcribe_only?: boolean // Edit Video: audio + transcribe ប៉ុណ្ណោះ
  cuts?: [number, number][] // Silence dialog: ចន្លោះដែលត្រូវកាត់
  timeline?: [number, number][] // Edit Video: បញ្ជី clip [in, out] តាមលំដាប់ចេញ
  inserts?: { start: number; end: number; at: number }[] // + Extend a clip: ផ្នែកដែលចម្លងទៅដាក់នៅ `at`
  order?: [number, number][] // ប្លុកតាមលំដាប់ដែលអូសលើ timeline
  transition?: 'punch' | 'hard'
  look?: Look // Edit Video: Background / Tracker (sidecar បម្លែងជា --fit-* / --no-tracking)
  motion?: Motion // Edit Video: ផ្ទាំង Motion (sidecar បម្លែងជា --motion-* / --caption-animation)
}

/** ផ្ទាំង Motion — ដូច `manage.clean_motion` (Python). */
export type Motion = {
  zoom: 'off' | 'in' | 'out'
  zoom_amount: number // % ក្នុងមួយ scene
  keywords: number // % zoom លើពាក្យសំខាន់ (0 = បិទ)
  shake: 'off' | 'loud' | 'all'
  animation: CaptionAnimation // Captions › Effects (21 ឈ្មោះ)
}
export const DEFAULT_MOTION: Motion = { zoom: 'off', zoom_amount: 8, keywords: 0, shake: 'off', animation: 'pop' }
export type MotionCues = { ready: boolean; keywords: number[]; loud: [number, number][] }

/** menu Background / Tracker របស់ Edit Video — ដូច `manage.clean_look` (Python). */
export type Look = {
  background: 'blur' | 'color' | 'image'
  blur: number // 0-100 (33 = លំនាំដើម)
  color: string // #RRGGBB
  image: string | null // path រូប (ក្រោយរក្សាទុក = ច្បាប់ចម្លងក្នុង output/<name>/)
  radius: number // px នៃ output
  spacing: number // % (0-20)
  tracking: boolean
  no_track: [number, number][] // scene ដែលបិទ tracking (វិនាទីក្នុងវីដេអូដើម)
  subjects: SubjectTrack[] // Manual subject tracking: ផ្លូវមួយក្នុងមួយ scene
  transform: Transform | null // Transform video ដោយដៃ (null = AI layout) — `manage.clean_transform`
}
/** ផ្លូវប្រធានបទក្នុង scene មួយ (`subject_track.Track`): ពេលជាវិនាទី, ប្រអប់ជា pixel នៃវីដេអូដើម. */
export type SubjectTrack = {
  start: number
  end: number
  box: [number, number, number, number] // x, y, w, h នៅពេលចុច
  label: string // ប្រភេទពី YOLOX ឬ "area"
  points: [number, number, number][] // [ពេល, cx, cy]
  good_from: number
  good_until: number
}
export type PickAnswer = {
  size: [number, number]
  subject: [number, number, number, number] | null
  label: string
  area: [number, number, number, number]
}
export type TrackAnswer = { track: SubjectTrack; scene: [number, number]; size: [number, number]; tracker: string; seconds: number; look: Look }
export const DEFAULT_LOOK: Look = {
  background: 'blur',
  blur: 33,
  color: '#000000',
  image: null,
  radius: 0,
  spacing: 0,
  tracking: true,
  no_track: [],
  subjects: [],
  transform: null,
}

/** ---- Env (screen 01 · AI models) ---- */

export type OllamaModel = { name: string; gb: number }

export type OnnxModel = {
  label: string
  name: string
  present: boolean
  mb: number
  fix: string
}

export type Env = {
  device: string
  whisper_model: string
  compute_type: string
  gpu: { name: string; vram_mb: number } | null
  ram_mb: number | null
  disk_free_mb: number | null
  ffmpeg: boolean
  ollama: { reachable: boolean; host: string; models: OllamaModel[] }
  whisper_cache: string[]
  onnx: OnnxModel[]
  anthropic_key: boolean
  anthropic_model: string
}

/** ---- Transcript ផ្ទាល់ (screen Processing) ---- */

export type TranscriptPreview = {
  name: string
  duration: number | null // វិនាទីរបស់វីដេអូដើម (transcript.json)
  device: string | null // cuda / cpu ដែល Whisper ប្រើពិត
  segments: { start: number; end: number; text: string }[]
  candidates: { start: number; end: number; title: string }[] // clip ដែល AI ពិចារណា
}

/** ---- Cue សម្រាប់ preview ផ្ទាល់ (screen Subtitles) — ពី captions.py ពិត ---- */

export type PreviewWord = { text: string; start: number; end: number; keyword?: boolean } // វិនាទីពីដើម clip
/** font ពី GET /fonts — em_scale = unitsPerEm / (winAscent + winDescent) សម្រាប់ទំហំ preview */
export type CaptionFont = { family: string; weight: string; face: string; em_scale: number; italic_face: boolean }
/** cue នៃវីដេអូទាំងមូល (Edit Video) — បន្ទាត់ជាបញ្ជីពាក្យ */
export type WholeCue = { start: number; end: number; lines: PreviewWord[][] }
export type PreviewCue = {
  start: number
  end: number
  lines: { y: number; words: PreviewWord[] }[] // y = កណ្តាលបន្ទាត់ ជា px លើ height
}
export type PreviewCues = {
  width: number // 1080
  height: number // 1920
  font_size: number // px លើ height (ក្រោយ --caption-size)
  active_scale: number // 1.1 = Pop
  safe_top: number
  safe_bottom: number
  layout_known: boolean // false = clip ចាស់: មិនដឹងថា shot ណាជា split
  cues: PreviewCue[]
}

/** ---- AI Reframe (`--full`: វីដេអូទាំងមូលជាបញ្ឈរ) ---- */

export type ReframeShot = { start: number; end: number; kind: string }

export type ReframeResult = {
  folder: string // full / full_1x1 / full_4x5 / full_16x9
  aspect: string
  files: Record<string, string> // mp4 / srt / vtt
  bytes: number
  modified: number // epoch វិនាទី
  captions: boolean
  seconds: number | null
  shots: ReframeShot[] // ទទេ = reframe ចាស់ មុន layout.json
  allowed: string[] | null // layout ដែល --layout អនុញ្ញាត; null = មិនដឹង (reframe ចាស់)
  edited?: boolean // Edit Video: វីដេអូដែលកាត់ (folder full_edit*)
  layout_seconds: Record<string, number>
  shots_per_minute: number | null
  layout_switches_per_minute: number | null
}

/** ---- Edit Video ---- */

export type EditorItem = { word: string; start: number; end: number } | { pause: number; start: number; end: number }

export type EditorWords = {
  name: string
  ready: boolean // false = គ្មាន transcript (editor ចាប់ផ្តើម --transcribe-only)
  language?: string
  duration?: number
  items: EditorItem[]
}

export type CutsAnswer = {
  name: string
  cuts: [number, number][]
  transition: 'punch' | 'hard'
  splits?: number[]
  inserts?: { start: number; end: number; at: number }[] // sidecar ចាស់គ្មាន field នេះ
  order?: [number, number][] // ដូចគ្នា
}

export type TimelineAnswer = { name: string; clips: [number, number][]; transition: 'punch' | 'hard' }

export type CleanupSuggestion = { start: number; end: number; reason: 'pause' | 'filler'; text: string }

export type CleanupAnswer = {
  name: string
  ready: boolean
  suggestions: CleanupSuggestion[]
  seconds: number
  pauses: number
  fillers: number
}

/** ---- Export (screen 05) ---- */

export type ExportFile = {
  kind: string
  source: string
  name: string
  bytes: number
  mb: number
}

export type ExportClip = { index: number; title: string; files: ExportFile[] }

/** អ្វីដែល ffprobe អានពី clip ទីមួយ — `null` បើ ffprobe មិនឆ្លើយ. */
export type VideoFormat = {
  width: number | null
  height: number | null
  fps: number | null
  codec: string | null
  kbps: number | null
  seconds: number | null // រយៈពេល (format=duration)
}

export type ExportPreview = {
  name: string
  destination: string
  format: VideoFormat | null
  clips: ExportClip[]
  bytes: number
  mb: number
}

export type ExportResult = {
  destination: string
  files: (ExportFile & { index: number; path: string })[]
  skipped: (ExportFile & { index: number; reason: string })[]
  bytes: number
  mb: number
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
  seconds: number | null // រយៈពេលវីដេអូដើម (transcript.json); null = មិនទាន់ transcribe
  bytes: number // ទំហំ folder ក្នុង output/
  reframes: number // ចំនួន reframe (folder full*) ដែលចប់
  folder: string // path ពេញនៃ output/<name> (សម្រាប់ បើក folder); '' បើមិនមាន
  title: string // ឈ្មោះបង្ហាញ (ប្តូរឈ្មោះ); = name បើមិនធ្លាប់ប្តូរ
}

export const api = {
  health: () => send<Health>('/health'),
  videos: () => send<Video[]>('/videos'),
  env: () => send<Env>('/env'),
  /** លទ្ធផល AI Reframe របស់ project (ថ្មីបំផុតមុន) — បញ្ជីទទេ បើមិនទាន់ធ្លាប់. */
  reframes: (name: string) =>
    send<{ name: string; results: ReframeResult[] }>(`/projects/${encodeURIComponent(name)}/reframe`)
      .then((answer) => answer.results)
      .catch(() => [] as ReframeResult[]),
  /** ចម្លងវីដេអូ reframe (+ .srt) ទៅ folder export — មិនសរសេរជាន់លើ. */
  exportReframe: (name: string, folder: string, body: { destination?: string; kinds: string[] }) =>
    send<ExportResult>(`/projects/${encodeURIComponent(name)}/reframe/${folder}/export`, 'POST', body),
  // Edit Video: ពាក្យ + pause (ready=false = មិនទាន់ transcribe) និង waveform
  words: (name: string) => send<EditorWords>(`/projects/${encodeURIComponent(name)}/words`),
  // cut list ដែល editor រក្សាទុក (project.json) និង Speech cleanup (pause + filler ដែលស្នើ)
  // បញ្ជី clip របស់ Edit Video ([] = វីដេអូទាំងមូល)
  timeline: (name: string) => send<TimelineAnswer>(`/projects/${encodeURIComponent(name)}/timeline`),
  saveTimeline: (name: string, body: { clips: [number, number][]; transition: string }) =>
    send<TimelineAnswer>(`/projects/${encodeURIComponent(name)}/timeline`, 'PUT', body),
  cuts: (name: string) => send<CutsAnswer>(`/projects/${encodeURIComponent(name)}/cuts`),
  saveCuts: (
    name: string,
    body: { cuts: [number, number][]; transition: string; splits?: number[]; inserts?: { start: number; end: number; at: number }[]; order?: [number, number][] },
  ) =>
    send<CutsAnswer>(`/projects/${encodeURIComponent(name)}/cuts`, 'PUT', body),
  cleanup: (name: string, pause: number, fillers: boolean) =>
    send<CleanupAnswer>(`/projects/${encodeURIComponent(name)}/cleanup?pause=${pause}&fillers=${fillers}`),
  look: (name: string) => send<Look>(`/projects/${encodeURIComponent(name)}/look`),
  motion: (name: string) => send<Motion>(`/projects/${encodeURIComponent(name)}/motion`),
  saveMotion: (name: string, motion: Motion) => send<Motion>(`/projects/${encodeURIComponent(name)}/motion`, 'PUT', motion),
  // ពេលពាក្យសំខាន់ + សំឡេងខ្លាំង (ពី Python ដដែលនឹង render) — preview Motion
  motionCues: (name: string) => send<MotionCues>(`/projects/${encodeURIComponent(name)}/motion/cues`),
  saveLook: (name: string, look: Look) => send<Look>(`/projects/${encodeURIComponent(name)}/look`, 'PUT', look),
  // Manual subject tracking: ចុច -> ប្រអប់ subject + area; Apply -> ផ្លូវ (CPU ~4 s ក្នុង scene 12 s)
  pick: (name: string, body: { video: string; time: number; x: number; y: number }) =>
    send<PickAnswer>(`/projects/${encodeURIComponent(name)}/pick`, 'POST', body),
  track: (name: string, body: { video: string; time: number; x: number; y: number; mode: 'subject' | 'area' }) =>
    send<TrackAnswer>(`/projects/${encodeURIComponent(name)}/track`, 'POST', body),
  resetTrack: (name: string, start: number, end: number) =>
    send<Look>(`/projects/${encodeURIComponent(name)}/track?start=${start}&end=${end}`, 'DELETE'),
  // shot របស់វីដេអូដើម (menu Tracker "បិទ scene នេះ")
  scenes: (path: string) => send<{ scenes: [number, number][] }>(`/scenes?path=${encodeURIComponent(path)}`),
  waveform: (name: string) => send<{ name: string; peaks: number[] }>(`/projects/${encodeURIComponent(name)}/waveform`),
  /** ទំហំ និងរយៈពេលរបស់វីដេអូដែលជ្រើសលើ Import (ffprobe). */
  probe: (path: string) => send<VideoFormat>(`/probe?path=${encodeURIComponent(path)}`),
  projects: () => send<Project[]>('/projects'),
  // ឈ្មោះបង្ហាញប៉ុណ្ណោះ — folder មិនផ្លាស់ទី (server/manage.py)
  renameProject: (name: string, title: string) =>
    send<{ name: string; title: string }>(`/projects/${encodeURIComponent(name)}`, 'PATCH', { title }),
  // folder output ទៅ Recycle Bin; វីដេអូដើមមិនប៉ះ
  deleteProject: (name: string) =>
    send<{ name: string; recycled: boolean }>(`/projects/${encodeURIComponent(name)}`, 'DELETE'),
  startJob: (options: JobOptions) => send<JobStatus>('/jobs', 'POST', options),
  cancelJob: (id: string) => send<JobStatus>(`/jobs/${id}`, 'DELETE'),
  // ស្ថានភាព job ម្តង — ពេល WebSocket ដាច់ (useJob សួរវាមុនភ្ជាប់ម្តងទៀត)
  job: (id: string) => send<JobStatus>(`/jobs/${id}`),
  // 404 = project នេះមិនទាន់មាន clip (job ទើបចាប់ផ្តើម) -> បញ្ជីទទេ
  clips: (name: string) =>
    send<{ name: string; clips: Clip[] }>(`/projects/${encodeURIComponent(name)}/clips`)
      .then((answer) => answer.clips)
      .catch(() => [] as Clip[]),

  /** transcript + clip ដែល AI ពិចារណា — 200 ជានិច្ច (បញ្ជីទទេមុន file មាន). */
  transcript: (name: string) =>
    send<TranscriptPreview>(`/projects/${encodeURIComponent(name)}/transcript`),

  /** cue ដូចដែល render នឹងគូរ ជាមួយ words/size/position — គ្មាន render. */
  cues: (name: string, index: number, style: { words: number; size: number; position: string; lines: number }) =>
    send<PreviewCues>(
      `/projects/${encodeURIComponent(name)}/clips/${index}/cues?words=${style.words}&size=${style.size}&position=${style.position}&lines=${style.lines}`,
    ),
  // ផ្ទាំង Captions › Font: តែ font ដែលដំឡើងរួច
  fonts: () => send<{ fonts: CaptionFont[]; default: string }>('/fonts'),
  // cue នៃវីដេអូទាំងមូល ដូច render (preview របស់ Edit Video)
  wholeCues: (name: string, words: number, lines: number) =>
    send<{ ready: boolean; cues: WholeCue[] }>(`/projects/${encodeURIComponent(name)}/cues?words=${words}&lines=${lines}`),

  /** អ្វីដែល export *នឹង* សរសេរ — មិនប៉ះ disk ទេ. */
  exportPreview: (name: string, kinds: string[]) =>
    send<ExportPreview>(
      `/projects/${encodeURIComponent(name)}/export?kinds=${kinds.join(',')}`,
    ),

  exportClips: (
    name: string,
    body: { destination?: string; clips?: number[]; kinds: string[]; aspect?: string },
  ) => send<ExportResult>(`/projects/${encodeURIComponent(name)}/export`, 'POST', body),

  /** បើក folder ក្នុង File Explorer. */
  reveal: (path: string) => send<{ ok: boolean }>('/reveal', 'POST', { path }),
  // ⬇ transcript ក្នុង Edit Video -> folder Export (មិនសរសេរពីលើ); ពាក្យក្នុង cuts ត្រូវដក
  exportTranscript: (
    name: string,
    body: { format: 'txt' | 'srt'; clips: [number, number][] },
  ) =>
    send<{ name: string; path: string; bytes: number; format: string }>(
      `/projects/${encodeURIComponent(name)}/transcript/export`,
      'POST',
      body,
    ),
  // ♡ / 👎 — null = លុប; រក្សាទុកក្នុង output/<name>/project.json
  // ប៊ូតុង Duplicate លើ Review: ចម្លង clip + ទំហំទាំងអស់ (គ្មាន render)
  duplicateClip: (name: string, index: number) =>
    send<{ index: number }>(`/projects/${encodeURIComponent(name)}/clips/${index}/duplicate`, 'POST'),
  rateClip: (name: string, index: number, rating: 'like' | 'dislike' | null) =>
    send<{ index: number; rating: string | null }>(`/projects/${encodeURIComponent(name)}/clips/${index}/rating`, 'PUT', { rating }),
}

/** URL របស់ file មួយក្នុង clip — `<video src>` និង `<img src>` ប្រើវាផ្ទាល់. */
export function clipFileUrl(project: string, index: number, kind: string, aspect?: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(project)}/clips/${index}/file?kind=${kind}${aspect ? `&aspect=${encodeURIComponent(aspect)}` : ''}`
}

/** file របស់លទ្ធផល reframe: `<folder>/clip_01.<kind>` ដែល folder = full, full_1x1 ... */
export function reframeFileUrl(project: string, folder: string, kind: 'mp4' | 'srt' | 'vtt'): string {
  return `${API_BASE}/projects/${encodeURIComponent(project)}/reframe/${folder}/file?kind=${kind}`
}

/** វីដេអូដើម (អានតែប៉ុណ្ណោះ) — preview ក្នុង Edit Video. */
export function sourceUrl(path: string): string {
  return `${API_BASE}/source?path=${encodeURIComponent(path)}`
}

/** រូប jpg/png/webp លើកុំព្យូទ័រ (អានតែប៉ុណ្ណោះ) — preview background. */
export function imageUrl(path: string): string {
  return `${API_BASE}/image?path=${encodeURIComponent(path)}`
}

/** រូបតូចនៃលទ្ធផលវីដេអូទាំងមូល (Review បង្ហាញវាជាកាត). */
export function reframeThumbUrl(project: string, folder: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(project)}/reframe/${folder}/thumb`
}

/** frame ពិតពីវីដេអូដើម (JPEG) នៅវិនាទី `at` — preview របស់ AI Reframe. */
export function sourceFrameUrl(path: string, at: number): string {
  return `${API_BASE}/probe/frame?path=${encodeURIComponent(path)}&at=${at.toFixed(1)}`
}

export function clipThumbUrl(project: string, index: number, aspect?: string): string {
  return `${API_BASE}/projects/${encodeURIComponent(project)}/clips/${index}/thumb${aspect ? `?aspect=${encodeURIComponent(aspect)}` : ''}`
}

/** URL របស់ WebSocket. `location.host` = 5173, ហើយ proxy បញ្ជូនបន្តទៅ 8765. */
export function eventsUrl(jobId: string): string {
  if (IN_TAURI) return `ws://127.0.0.1:8765/jobs/${jobId}/events`
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/jobs/${jobId}/events`
}
