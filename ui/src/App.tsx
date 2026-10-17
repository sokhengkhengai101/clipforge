import { useEffect, useRef, useState } from 'react'
import { api, STEPS, type Health, type JobStatus, type Video } from './api'
import { useJob } from './useJob'

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [chosen, setChosen] = useState<string>('')
  const [maxClips, setMaxClips] = useState(5)
  const [error, setError] = useState('')
  const job = useJob()

  useEffect(() => {
    Promise.all([api.health(), api.videos()])
      .then(([h, v]) => {
        setHealth(h)
        setVideos(v)
        if (v.length > 0) setChosen(v[0].path)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-white">ClipForge Studio</h1>
        <Status health={health} error={error} />
      </header>

      <section className="mb-5 rounded-xl bg-panel p-5">
        <h2 className="mb-3 text-sm font-medium tracking-wide text-slate-400 uppercase">
          Videos in samples/
        </h2>
        <ul className="mb-4 max-h-64 space-y-2 overflow-y-auto">
          {videos.map((video) => (
            <li key={video.path}>
              <button
                onClick={() => setChosen(video.path)}
                className={`flex w-full items-center justify-between rounded-lg px-4 py-3 text-left ${
                  chosen === video.path
                    ? 'bg-accent/20 ring-1 ring-accent'
                    : 'bg-card hover:bg-card/70'
                }`}
              >
                <span className="truncate text-slate-100">{video.name}</span>
                <span className="ml-4 shrink-0 text-sm text-slate-500">{video.mb} MB</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-400">
            clips
            <input
              type="number"
              min={1}
              max={10}
              value={maxClips}
              onChange={(e) => setMaxClips(Number(e.target.value))}
              className="ml-2 w-16 rounded bg-card px-2 py-1 text-slate-100"
            />
          </label>
          <button
            disabled={!chosen || job.running}
            onClick={() => job.start({ video: chosen, max_clips: maxClips })}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-40"
          >
            {job.running ? 'Running...' : 'Start'}
          </button>
          {job.running && (
            <button
              onClick={job.cancel}
              className="rounded-lg bg-card px-4 py-2 text-slate-300 hover:text-white"
            >
              Cancel
            </button>
          )}
          {job.error && <span className="text-sm text-red-400">{job.error}</span>}
        </div>
      </section>

      {job.status && <JobPanel status={job.status} log={job.log} />}
    </main>
  )
}

function JobPanel({ status, log }: { status: JobStatus; log: string[] }) {
  const bottom = useRef<HTMLDivElement>(null)
  // រំកិល log ទៅបន្ទាត់ចុងក្រោយរាល់ពេលមានបន្ទាត់ថ្មី
  useEffect(() => bottom.current?.scrollIntoView(), [log.length])

  const done = new Set(status.progress.done)
  const cached = new Set(status.progress.cached)

  return (
    <section className="rounded-xl bg-panel p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium tracking-wide text-slate-400 uppercase">
          Job {status.id}
        </h2>
        <span className="text-sm text-slate-400">
          <StateBadge state={status.state} /> · {status.seconds.toFixed(0)}s
        </span>
      </div>

      <ol className="mb-4 grid grid-cols-6 gap-2">
        {STEPS.map((step) => (
          <li
            key={step}
            title={cached.has(step) ? 'cached ពីការរត់មុន' : step}
            className={`rounded-md px-2 py-2 text-center text-xs ${
              cached.has(step)
                ? 'bg-card text-slate-500'
                : done.has(step)
                  ? 'bg-accent/30 text-white'
                  : 'bg-card text-slate-600'
            }`}
          >
            {step}
            {cached.has(step) && <span className="block text-[10px]">cached</span>}
          </li>
        ))}
      </ol>

      {status.error && <p className="mb-3 text-sm text-red-400">{status.error}</p>}

      <div className="h-48 overflow-y-auto rounded-lg bg-app p-3 font-mono text-xs text-slate-400">
        {log.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
        <div ref={bottom} />
      </div>
    </section>
  )
}

function StateBadge({ state }: { state: JobStatus['state'] }) {
  const colour = {
    running: 'text-keyword',
    done: 'text-emerald-400',
    failed: 'text-red-400',
    cancelled: 'text-slate-500',
  }[state]
  return <span className={colour}>{state}</span>
}

function Status({ health, error }: { health: Health | null; error: string }) {
  if (error) return <span className="text-sm text-red-400">sidecar: {error}</span>
  if (!health) return <span className="text-sm text-slate-500">connecting...</span>
  return (
    <span className="text-sm text-slate-400">
      sidecar <span className="text-accent">v{health.version}</span>
      {health.ffmpeg ? ' · ffmpeg ok' : ' · no ffmpeg'}
    </span>
  )
}
