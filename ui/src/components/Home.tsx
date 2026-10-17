import { useEffect, useRef, useState } from 'react'
import { clipThumbUrl, IN_TAURI, type Health, type Project, type Video } from '../api'
import { PRESETS, type Preset } from '../presets'
import { Badge } from './Badge'
import plus from '../assets/figma/plus.svg'
import search from '../assets/figma/search.svg'
import upload from '../assets/figma/upload.svg'
import browse from '../assets/figma/browse.svg'
import importFolder from '../assets/figma/import-folder.svg'
import playCard from '../assets/figma/play-card.svg'

/** Screen "02 · Home / Projects" (Figma node 8:238).
 *  Preset ជា flag ពិតលើ engine តែមួយ; card ដែលជា Phase ក្រោយបង្ហាញតែមិនចុចបាន.
 *  "Recent projects" មកពីតារាង `project` ក្នុង database មិនមែនបញ្ជីសន្មត. */
export function Home({
  videos,
  projects,
  chosen,
  preset,
  health,
  error,
  busy,
  clips,
  onChoose,
  onChoosePath,
  onPreset,
  onStart,
  onOpenProject,
  onReview,
  onRetry,
  connected,
  dropOver,
  dropped,
}: {
  videos: Video[]
  projects: Project[]
  chosen: Video | null
  preset: Preset
  health: Health | null
  error: string
  busy: boolean
  clips: number
  onChoose: (video: Video) => void
  onChoosePath: (path: string) => void
  onPreset: (preset: Preset) => void
  onStart: () => void
  onOpenProject: (project: Project) => void
  onReview: () => void
  onRetry: () => void
  connected: boolean
  dropOver: boolean // file កំពុងអូសលើ window (Tauri)
  dropped: string // path ចុងក្រោយដែលទម្លាក់ (App ជាអ្នកស្តាប់)
}) {
  const [query, setQuery] = useState('')
  const pathInput = useRef<HTMLInputElement>(null)
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase())

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-display text-text-primary">Projects</p>
          <p className="text-body text-text-secondary">
            Turn long videos into short clips — 100% on your computer.
          </p>
        </div>
        <div className="flex h-[38px] w-[260px] items-center gap-2 rounded-sm border border-border-default bg-bg-card px-3">
          <img src={search} alt="" width={16} height={16} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="w-full bg-transparent text-body text-text-primary outline-none placeholder:text-text-secondary"
          />
        </div>
        <button
          onClick={() => pathInput.current?.focus()}
          className="flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent"
        >
          <img src={plus} alt="" width={16} height={16} />
          New project
        </button>
      </header>

      {error && (
        <div className="flex items-center gap-3 rounded-md border border-border-default bg-bg-card px-4 py-2.5">
          <span className={`text-caption ${connected ? 'text-red-400' : 'text-text-secondary'}`}>
            {error}
          </span>
          {!connected && (
            <button
              onClick={onRetry}
              className="rounded-sm border border-border-default px-3 py-1.5 text-caption text-text-primary hover:bg-bg-hover"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <DropZone
        pathInput={pathInput}
        videos={videos}
        onChoose={onChoose}
        onChoosePath={onChoosePath}
        dropOver={dropOver}
        dropped={dropped}
      />

      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <p className="text-heading text-text-primary">Start with a workflow preset</p>
          <p className="text-caption text-text-secondary">
            {PRESETS.filter((p) => p.ready).length} of {PRESETS.length} run today · one engine,
            different flags
          </p>
        </div>
        <div className="grid grid-cols-5 gap-4">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              disabled={!item.ready}
              onClick={() => onPreset(item)}
              title={item.ready ? flagsOf(item) : 'Not built yet'}
              className={`flex flex-col gap-3 rounded-md border p-4 text-left ${
                item.id === preset.id
                  ? 'border-accent bg-accent-soft'
                  : 'border-border-default bg-bg-card'
              } ${item.ready ? 'hover:border-accent' : 'opacity-50'}`}
            >
              <div className="flex w-full items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-sm bg-accent-soft">
                  <img src={item.icon} alt="" width={20} height={20} />
                </span>
                <Badge label={item.badge} tone={item.ready ? 'success' : 'muted'} />
              </div>
              <span className="text-heading text-text-primary">{item.title}</span>
              <span className="text-caption text-text-secondary">{item.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-3">
          <p className="text-heading text-text-primary">Videos in samples/</p>
          <Badge label={String(videos.length)} />
          <div className="flex-1" />
          {chosen && (
            <>
              <p className="text-caption text-text-secondary">
                {preset.title} · {flagsOf(preset) || 'defaults'}
              </p>
              {clips > 0 && (
                <button
                  onClick={onReview}
                  className="rounded-sm border border-border-default bg-bg-card px-4 py-2.5 text-body-strong text-text-primary"
                >
                  Review {clips} clips
                </button>
              )}
              <button
                onClick={onStart}
                disabled={busy}
                className="rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent disabled:opacity-40"
              >
                {busy ? 'Running...' : `Start ${chosen.name.slice(0, 18)}`}
              </button>
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {videos.filter((video) => matches(video.name)).map((video) => (
            <button
              key={video.path}
              onClick={() => onChoose(video)}
              className={`flex items-center gap-3 rounded-md border p-2.5 text-left ${
                chosen?.path === video.path
                  ? 'border-accent bg-accent-soft'
                  : 'border-border-default bg-bg-card hover:bg-bg-hover'
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-body-strong text-text-primary">
                {video.name}
              </span>
              <span className="shrink-0 text-caption text-text-secondary">{video.mb} MB</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center gap-3">
          <p className="text-heading text-text-primary">Recent projects</p>
          <Badge label={String(projects.length)} />
          <div className="flex-1" />
          <p className="text-caption text-text-secondary">
            {health ? `${health.device} · ${health.llm_model}` : ''}
          </p>
        </div>
        {projects.length === 0 && (
          <p className="font-khmer text-body text-text-secondary">
            មិនទាន់មាន project ទេ — ចុច Start លើវីដេអូមួយ ហើយវាលេចនៅទីនេះ។
          </p>
        )}
        <div className="grid grid-cols-4 gap-4">
          {projects.filter((project) => matches(project.name)).map((project) => (
            <button
              key={project.id}
              onClick={() => onOpenProject(project)}
              className="flex flex-col gap-2.5 rounded-md border border-border-default bg-bg-card px-2.5 pt-2.5 pb-3 text-left hover:border-accent"
            >
              <ProjectThumb project={project} />
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-body-strong text-text-primary">
                  {project.name}
                </span>
                <StateBadge project={project} />
              </span>
              <span className="text-caption text-text-secondary">
                {project.clips} clips · {project.jobs > 0 ? `${project.jobs} runs` : 'from disk'}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function DropZone({
  pathInput,
  videos,
  onChoose,
  onChoosePath,
  dropOver,
  dropped,
}: {
  pathInput: React.RefObject<HTMLInputElement | null>
  videos: Video[]
  onChoose: (video: Video) => void
  onChoosePath: (path: string) => void
  dropOver: boolean
  dropped: string
}) {
  const [over, setOver] = useState(false)
  const [note, setNote] = useState('')
  const [typed, setTyped] = useState('')
  // ក្នុង app desktop `App` ស្តាប់ drop (គ្រប់ទំព័រ) ហើយប្រាប់យើងតាម `dropped`
  useEffect(() => {
    if (!dropped) return
    setTyped(dropped)
    setNote(`Picked ${dropped}`)
  }, [dropped])

  // Browser មិនឲ្យដឹង path ពេញរបស់ file ដែលអូសចូលទេ (សុវត្ថិភាព) — យើងបានតែ
  // ឈ្មោះ. បើឈ្មោះនោះមានក្នុង samples/ យើងជ្រើសវា បើអត់ សុំ path ពេញ.
  const drop = (event: React.DragEvent) => {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    const match = videos.find((video) => video.name === file.name)
    if (match) {
      onChoose(match)
      setNote(`Picked ${file.name} from samples/`)
      return
    }
    setTyped(file.name)
    setNote(
      `${file.name} is not in samples/. A browser cannot read the full path — paste it below, ` +
        `or copy the file into samples/. The desktop build (Phase 1D) can take the drop directly.`,
    )
    pathInput.current?.focus()
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`flex flex-col items-center justify-center gap-2.5 rounded-lg border-[1.5px] border-dashed py-7 ${
        over || dropOver ? 'border-accent bg-accent-soft' : 'border-accent bg-bg-panel'
      }`}
    >
      <span className="flex size-13 items-center justify-center rounded-full bg-accent-soft">
        <img src={upload} alt="" width={24} height={24} />
      </span>
      <p className="text-title text-text-primary">Drop a video or podcast here</p>
      <p className="text-caption text-text-secondary">
        MP4 · MOV · MKV · MP3 · WAV — whatever FFmpeg can read
      </p>
      <p className="font-khmer text-body text-text-secondary">
        {IN_TAURI
          ? 'អូស file ចូលទីនេះ — app desktop អានpath ពេញបាន'
          : 'ឬ បិទភ្ជាប់ path ពេញរបស់ file ខាងក្រោម'}
      </p>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 rounded-sm border border-border-default bg-bg-card px-4 py-2.5">
          <img src={browse} alt="" width={16} height={16} />
          <input
            ref={pathInput}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed.trim()) onChoosePath(typed.trim())
            }}
            placeholder="D:\videos\podcast.mp4"
            className="w-80 bg-transparent text-body text-text-primary outline-none placeholder:text-text-secondary"
          />
        </div>
        <button
          onClick={() => typed.trim() && onChoosePath(typed.trim())}
          className="rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent"
        >
          Use this file
        </button>
        <span
          title="Batch is Phase 3"
          className="flex items-center gap-2 rounded-sm px-4 py-2.5 text-body-strong text-text-secondary opacity-50"
        >
          <img src={importFolder} alt="" width={16} height={16} />
          Import folder (batch)
        </span>
      </div>
      {note && <p className="max-w-2xl text-center text-caption text-text-secondary">{note}</p>}
    </div>
  )
}

function ProjectThumb({ project }: { project: Project }) {
  const [failed, setFailed] = useState(false)
  if (project.clips === 0 || failed)
    return (
      <span className="flex h-[140px] w-full items-center justify-center rounded-sm bg-gradient-to-r from-[#4d388c] to-[#14171f]">
        <span className="flex size-9 items-center justify-center rounded-full bg-black/45">
          <img src={playCard} alt="" width={16} height={16} />
        </span>
      </span>
    )
  return (
    <img
      src={clipThumbUrl(project.name, 1)}
      alt=""
      onError={() => setFailed(true)}
      className="h-[140px] w-full rounded-sm bg-bg-hover object-cover"
    />
  )
}

function StateBadge({ project }: { project: Project }) {
  if (project.last_state === 'running') return <Badge label="PROCESSING" tone="warning" />
  if (project.last_state === 'failed') return <Badge label="FAILED" tone="warning" />
  if (project.last_state === 'interrupted') return <Badge label="STOPPED" tone="muted" />
  if (project.clips > 0) return <Badge label="READY" tone="success" />
  return <Badge label="DRAFT" tone="muted" />
}

/** បង្ហាញ flag ដែល preset នេះបន្ថែម — ដូច្នេះអ្នកដឹងថាវាធ្វើអ្វីពិត. */
function flagsOf(preset: Preset): string {
  return Object.entries(preset.options)
    .map(([key, value]) => `--${key.replace(/_/g, '-')} ${value}`)
    .join(' ')
}
