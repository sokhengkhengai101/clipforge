import { useCallback, useEffect, useState } from 'react'
import { api, type Clip, type Health, type Project, type Video } from './api'
import { PRESETS, type Preset } from './presets'
import { PACKS, type Pack } from './packs'
import { useJob } from './useJob'
import { useFileDrop } from './useFileDrop'
import { Home } from './components/Home'
import { Processing } from './components/Processing'
import { Review } from './components/Review'
import { Models } from './components/Models'
import { Sidebar, type Page } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [chosen, setChosen] = useState<Video | null>(null)
  const [preset, setPreset] = useState<Preset>(PRESETS[0])
  const [clips, setClips] = useState<Clip[]>([])
  const [error, setError] = useState('')
  const [view, setView] = useState<'home' | 'job' | 'review' | 'models'>('home')
  // Model pack = flag ដែល *គ្រប់* job ប្រើ. លំនាំដើម Standard, ព្រោះវាជាអ្វី
  // ដែលម៉ាស៊ីននេះរត់ពិត; ទំព័រ Models បង្ហាញ BEST FIT តាម VRAM ពិត.
  const [pack, setPack] = useState<Pack>(PACKS[1])
  const [captionWords, setCaptionWords] = useState(5)
  const [captionColor, setCaptionColor] = useState('#FFD23F')
  const job = useJob()

  const loadProjects = useCallback(() => {
    api
      .projects()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [])

  /** App desktop បើក sidecar ខ្លួនឯង ហើយ uvicorn ត្រូវការ ២-៣ វិនាទី —
   *  ការសួរតែម្តងបរាជ័យ ("Failed to fetch") ហើយទំព័រនៅទទេរហូត។
   *  ដូច្នេះយើងសួរម្តងទៀតរហូតដល់វាឆ្លើយ. */
  const connect = useCallback(async () => {
    setError('')
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const [h, v] = await Promise.all([api.health(), api.videos()])
        setHealth(h)
        setVideos(v)
        setChosen((current) => current ?? v[0] ?? null)
        loadProjects()
        return
      } catch {
        setError(attempt < 2 ? 'starting the engine...' : `waiting for the sidecar (${attempt}s)`)
        await new Promise((done) => setTimeout(done, 1000))
      }
    }
    setError('The sidecar is not answering on 127.0.0.1:8765. Press Retry.')
  }, [loadProjects])

  useEffect(() => {
    void connect()
  }, [connect])

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
      job.start({ video: chosen.path, ...pack.options, ...preset.options, ...extra })
      setTimeout(loadProjects, 500)
    },
    [chosen, preset, pack, job, loadProjects],
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

  /** Drop វីដេអូលើ window ពី **ទំព័រណាក៏បាន** — ជ្រើសវា រួចត្រឡប់ទៅ Home
   *  ដែលប៊ូតុង Start នៅ. វាធ្លាប់ដំណើរការតែលើ Home (listener នៅក្នុង drop zone)
   *  ហើយ drop លើ Review ឬ Models ត្រូវបោះចោលដោយគ្មានសញ្ញាអ្វីទាំងអស់. */
  const [dropped, setDropped] = useState('')
  const dropOver = useFileDrop((path) => {
    choosePath(path)
    setDropped(path)
    setView('home')
  })

  const openProject = useCallback((project: Project) => {
    setChosen({ name: project.name, path: project.video, mb: 0 })
    if (project.clips > 0) setView('review')
  }, [])

  const title = chosen ? `ClipForge Studio — ${chosen.name}` : 'ClipForge Studio'

  return (
    <div className="flex h-screen flex-col bg-bg-app">
      <TitleBar title={title} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          device={health?.device ?? '...'}
          ffmpeg={health?.ffmpeg ?? false}
          onNewProject={() => setView('home')}
          page={view === 'models' ? 'models' : 'projects'}
          onPage={(page: Page) => setView(page === 'models' ? 'models' : 'home')}
        />

        {view === 'models' ? (
          <Models pack={pack} onPack={setPack} />
        ) : view === 'job' && job.status ? (
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
            onRetry={connect}
            connected={health !== null}
            dropOver={dropOver}
            dropped={dropped}
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
