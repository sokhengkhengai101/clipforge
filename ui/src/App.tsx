import { useCallback, useEffect, useState } from 'react'
import { api, type Clip, type Health, type Video } from './api'
import { useJob } from './useJob'
import { Badge } from './components/Badge'
import { Processing } from './components/Processing'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import plus from './assets/figma/plus.svg'

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [chosen, setChosen] = useState<Video | null>(null)
  const [maxClips, setMaxClips] = useState(5)
  const [clips, setClips] = useState<Clip[]>([])
  const [error, setError] = useState('')
  const [showJob, setShowJob] = useState(false)
  const job = useJob()

  useEffect(() => {
    Promise.all([api.health(), api.videos()])
      .then(([h, v]) => {
        setHealth(h)
        setVideos(v)
        if (v.length > 0) setChosen(v[0])
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  // clip មានតែក្រោយជំហាន render — សួរមុននោះគ្រាន់តែទទួល 404
  const projectName = chosen ? stemOf(chosen.name) : ''
  const rendered = job.status?.progress.done.includes('render') ?? false
  useEffect(() => {
    if (!projectName || !rendered) {
      setClips([])
      return
    }
    api.clips(projectName).then(setClips)
  }, [projectName, rendered, job.status?.state])

  const start = useCallback(() => {
    if (!chosen) return
    setShowJob(true)
    job.start({ video: chosen.path, max_clips: maxClips })
  }, [chosen, maxClips, job])

  const title = chosen ? `ClipForge Studio — ${chosen.name}` : 'ClipForge Studio'

  return (
    <div className="flex h-screen flex-col bg-bg-app">
      <TitleBar title={title} />
      <div className="flex min-h-0 flex-1">
        <Sidebar device={health?.device ?? '...'} ffmpeg={health?.ffmpeg ?? false} />

        {showJob && job.status ? (
          <Processing
            status={job.status}
            log={job.log}
            clips={clips}
            videoName={chosen?.name ?? ''}
            error={job.error}
            onCancel={job.cancel}
            onBack={() => setShowJob(false)}
          />
        ) : (
          <Home
            videos={videos}
            chosen={chosen}
            onChoose={setChosen}
            maxClips={maxClips}
            onMaxClips={setMaxClips}
            onStart={start}
            health={health}
            error={error || job.error}
            busy={job.running}
          />
        )}
      </div>
    </div>
  )
}

function Home({
  videos,
  chosen,
  onChoose,
  maxClips,
  onMaxClips,
  onStart,
  health,
  error,
  busy,
}: {
  videos: Video[]
  chosen: Video | null
  onChoose: (video: Video) => void
  maxClips: number
  onMaxClips: (count: number) => void
  onStart: () => void
  health: Health | null
  error: string
  busy: boolean
}) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-5 overflow-auto px-8 py-6">
      <header className="flex w-full items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-title text-text-primary">Projects</p>
          <p className="text-caption text-text-secondary">
            {health
              ? `${health.device} · whisper ${health.whisper_model} · ${health.llm_model}`
              : 'connecting to sidecar...'}
          </p>
        </div>
        <label className="flex items-center gap-2 text-caption text-text-secondary">
          clips
          <input
            type="number"
            min={1}
            max={10}
            value={maxClips}
            onChange={(e) => onMaxClips(Number(e.target.value))}
            className="w-16 rounded-sm border border-border-default bg-bg-card px-2 py-1.5 text-body text-text-primary"
          />
        </label>
        <button
          onClick={onStart}
          disabled={!chosen || busy}
          className="flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent disabled:opacity-40"
        >
          <img src={plus} alt="" width={16} height={16} />
          {busy ? 'Running...' : 'Start'}
        </button>
      </header>

      {error && <p className="text-caption text-red-400">{error}</p>}

      <section className="flex w-full flex-col gap-2.5 rounded-lg border border-border-default bg-bg-panel px-5 py-4">
        <div className="flex items-center gap-2">
          <p className="text-heading text-text-primary">Videos in samples/</p>
          <div className="flex-1" />
          <Badge label={String(videos.length)} />
        </div>
        {videos.map((video) => (
          <button
            key={video.path}
            onClick={() => onChoose(video)}
            className={`flex w-full items-center gap-3 rounded-md border p-2.5 text-left ${
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
      </section>
    </div>
  )
}

/** "podcast.mp4" -> "podcast" — ឈ្មោះ folder ក្នុង output/ ដូច `video.stem` ក្នុង Python. */
function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
