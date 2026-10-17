import { useCallback, useEffect, useState } from 'react'
import { api, type Clip, type Health, type Project, type Video } from './api'
import { PRESETS, type Preset } from './presets'
import { useJob } from './useJob'
import { Home } from './components/Home'
import { Processing } from './components/Processing'
import { Review } from './components/Review'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [chosen, setChosen] = useState<Video | null>(null)
  const [preset, setPreset] = useState<Preset>(PRESETS[0])
  const [clips, setClips] = useState<Clip[]>([])
  const [error, setError] = useState('')
  const [view, setView] = useState<'home' | 'job' | 'review'>('home')
  const [captionWords, setCaptionWords] = useState(5)
  const [captionColor, setCaptionColor] = useState('#FFD23F')
  const job = useJob()

  const loadProjects = useCallback(() => {
    api
      .projects()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    Promise.all([api.health(), api.videos()])
      .then(([h, v]) => {
        setHealth(h)
        setVideos(v)
        if (v.length > 0) setChosen(v[0])
      })
      .catch((e: Error) => setError(e.message))
    loadProjects()
  }, [loadProjects])

  // clip របស់ project ដែលជ្រើស — ទាញឡើងវិញពេល job ដល់ render ឬចប់
  const projectName = chosen ? stemOf(chosen.name) : ''
  const rendered = job.status?.progress.done.includes('render') ?? false
  const state = job.status?.state
  useEffect(() => {
    if (!projectName) return
    api.clips(projectName).then(setClips)
    if (state && state !== 'running') loadProjects()
  }, [projectName, rendered, state, loadProjects])

  const startWith = useCallback(
    (extra: Record<string, unknown>) => {
      if (!chosen) return
      setView('job')
      job.start({ video: chosen.path, ...preset.options, ...extra })
      setTimeout(loadProjects, 500)
    },
    [chosen, preset, job, loadProjects],
  )

  /** ប្តូរ style caption រួច render ជាថ្មី — មិន transcribe ឡើងវិញទេ. */
  const rerender = useCallback(
    () => startWith({ redo: 'render', caption_words: captionWords, caption_color: captionColor }),
    [startWith, captionWords, captionColor],
  )

  /** path ដែលវាយដោយដៃ — វីដេអូក្រៅ samples/. */
  const choosePath = useCallback((path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path
    setChosen({ name, path, mb: 0 })
    setError('')
  }, [])

  const openProject = useCallback((project: Project) => {
    setChosen({ name: project.name, path: project.video, mb: 0 })
    if (project.clips > 0) setView('review')
  }, [])

  const title = chosen ? `ClipForge Studio — ${chosen.name}` : 'ClipForge Studio'

  return (
    <div className="flex h-screen flex-col bg-bg-app">
      <TitleBar title={title} />
      <div className="flex min-h-0 flex-1">
        <Sidebar device={health?.device ?? '...'} ffmpeg={health?.ffmpeg ?? false} />

        {view === 'job' && job.status ? (
          <Processing
            status={job.status}
            log={job.log}
            clips={clips}
            videoName={chosen?.name ?? ''}
            error={job.error}
            onCancel={job.cancel}
            onReview={() => setView('review')}
            onBack={() => setView('home')}
          />
        ) : view === 'review' && clips.length > 0 ? (
          <Review
            project={projectName}
            clips={clips}
            captionWords={captionWords}
            captionColor={captionColor}
            onCaptionWords={setCaptionWords}
            onCaptionColor={setCaptionColor}
            onRerender={rerender}
            busy={job.running}
          />
        ) : (
          <Home
            videos={videos}
            projects={projects}
            chosen={chosen}
            preset={preset}
            health={health}
            error={error || job.error}
            busy={job.running}
            clips={clips.length}
            onChoose={setChosen}
            onChoosePath={choosePath}
            onPreset={setPreset}
            onStart={() => startWith({})}
            onOpenProject={openProject}
            onReview={() => setView('review')}
          />
        )}
      </div>
    </div>
  )
}

/** "podcast.mp4" -> "podcast" — ឈ្មោះ folder ក្នុង output/ ដូច `video.stem` ក្នុង Python. */
function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
