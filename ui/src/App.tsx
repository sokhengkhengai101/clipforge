import { useEffect, useState } from 'react'
import { api, type Health, type Video } from './api'

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [error, setError] = useState('')

  // `useEffect` រត់ម្តងពេល component ចាប់ផ្តើម — នេះជាកន្លែងហៅ API.
  useEffect(() => {
    Promise.all([api.health(), api.videos()])
      .then(([h, v]) => {
        setHealth(h)
        setVideos(v)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-white">ClipForge Studio</h1>
        <Status health={health} error={error} />
      </header>

      <section className="rounded-xl bg-panel p-5">
        <h2 className="mb-3 text-sm font-medium tracking-wide text-slate-400 uppercase">
          Videos in samples/
        </h2>
        {videos.length === 0 && !error && <p className="text-slate-500">...</p>}
        <ul className="space-y-2">
          {videos.map((video) => (
            <li
              key={video.path}
              className="flex items-center justify-between rounded-lg bg-card px-4 py-3"
            >
              <span className="truncate text-slate-100">{video.name}</span>
              <span className="ml-4 shrink-0 text-sm text-slate-500">{video.mb} MB</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

function Status({ health, error }: { health: Health | null; error: string }) {
  if (error) return <span className="text-sm text-red-400">sidecar: {error}</span>
  if (!health) return <span className="text-sm text-slate-500">connecting...</span>
  return (
    <span className="text-sm text-slate-400">
      sidecar <span className="text-accent">v{health.version}</span>
      {health.ffmpeg ? ' · ffmpeg ok' : ' · no ffmpeg'}
      {health.busy ? ` · busy ${health.busy}` : ''}
    </span>
  )
}
