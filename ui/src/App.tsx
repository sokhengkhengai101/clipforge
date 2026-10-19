import { useCallback, useEffect, useState } from 'react'
import { api, type Clip, type ExportResult, type Health, type Project, type Video } from './api'
import { PRESETS, type Preset } from './presets'
import { PACKS, type Pack } from './packs'
import { useJob } from './useJob'
import { useFileDrop } from './useFileDrop'
import { Models } from './components/Models'
import { Sidebar, type Page } from './components/Sidebar'
import { HomeScreen } from './screens/HomeScreen'
import { ImportScreen } from './screens/ImportScreen'
import { ProcessingScreen } from './screens/ProcessingScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { NO_CHOICES, type ReviewChoices } from './screens/reviewChoices'
import { SubtitlesScreen } from './screens/SubtitlesScreen'
import { ExportDoneScreen } from './screens/ExportDoneScreen'
import { DEFAULT_STYLE, styleOptions, type CaptionStyle } from './captionStyle'
import { khmerNumber } from './screens/khmer'
import type { Page as AppPage } from './screens/AppSidebar'
import { TitleBar } from './components/TitleBar'
import { TopBar } from './kit/TopBar'

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [chosen, setChosen] = useState<Video | null>(null)
  const [preset, setPreset] = useState<Preset>(PRESETS[0])
  const [clips, setClips] = useState<Clip[]>([])
  const [error, setError] = useState('')
  // 'home' = Home (1F, Home.html); 'projects' = Import (Main.html): drop, ការកំណត់, Start.
  // models នៅជារចនាចាស់ រហូតដល់ Settings.html (ជំហាន ៨).
  const [view, setView] = useState<'home' | 'projects' | 'job' | 'review' | 'subtitles' | 'exported' | 'models'>('home')
  const [homePage, setHomePage] = useState<'home' | 'tools'>('home')
  // "ចំនួន Clips" លើ Import: ចាប់ផ្តើមពី preset (Podcast 5, Long Video 10) ហើយអ្នកប្តូរបាន
  const [maxClips, setMaxClips] = useState(5)
  // អ្វីដែល job ចុងក្រោយបានចាប់ផ្តើមជាមួយ ("៥ clips · Podcast Clips") — screen Processing
  // បង្ហាញវា; យកពេលចាប់ផ្តើម ដូច្នេះការប្តូរ preset ពេល job រត់មិនប្តូរអត្ថបទ
  const [runLabel, setRunLabel] = useState('')
  // Model pack = flag ដែល *គ្រប់* job ប្រើ. លំនាំដើម Standard, ព្រោះវាជាអ្វី
  // ដែលម៉ាស៊ីននេះរត់ពិត; ទំព័រ Models បង្ហាញ BEST FIT តាម VRAM ពិត.
  const [pack, setPack] = useState<Pack>(PACKS[1])
  // style caption (screen Subtitles) — តម្លៃលំនាំដើមរបស់ config.py; app មិនដឹងថា clip ចាស់
  // ត្រូវបាន render ជាមួយ style អ្វីទេ (pipeline មិនកត់ទុកវា)
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(DEFAULT_STYLE)
  const [subtitleClip, setSubtitleClip] = useState(1)
  // ការជ្រើសលើ Review (checkbox, clip, តម្រៀប, folder) — នៅទីនេះ ដើម្បីរស់ឆ្លងការចេញទៅ
  // Subtitles / Export រួចរាល់; `project` ធ្វើឲ្យ project ផ្សេងចាប់ផ្តើមស្អាត
  const [review, setReview] = useState<{ project: string; choices: ReviewChoices }>({
    project: '',
    choices: NO_CHOICES,
  })
  // ចុច "បង្កើត preview ភ្លាមៗ" លើ Subtitles — job --clean-only រត់ក្រោយ screen ដដែល
  const [previewAsked, setPreviewAsked] = useState(false)
  // export ចុងក្រោយ — screen Export រួចរាល់ បង្ហាញវា
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const job = useJob()

  const loadProjects = useCallback(() => {
    api
      .projects()
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [])

  /** App desktop បើក sidecar ខ្លួនឯង ហើយ uvicorn ត្រូវការ ២-៣ វិនាទី —
   *  ការសួរតែម្តងបរាជ័យ ("Failed to fetch") ហើយទំព័រនៅទទេរហូត។
   *  ដូច្នេះយើងសួរម្តងទៀតរហូតដល់វាឆ្លើយ.
   *  សួររៀងរាល់ 250 ms (មិនមែន 1 s): sidecar ឆ្លើយនៅ ~2.8 s ក្រោយបើក app ហើយ 1 s
   *  ធ្វើឲ្យ UI រង់ចាំរហូតដល់ 1 s បន្ថែមឥតប្រយោជន៍. រង់ចាំសរុប 30 s ដដែល — លើកដំបូង
   *  ក្រោយបើកកុំព្យូទ័រ Python import ចំណាយ ~16 s (វាស់). */
  const connect = useCallback(async () => {
    const pauseMs = 250
    for (let attempt = 0; attempt < 30_000 / pauseMs; attempt++) {
      try {
        const [h, v] = await Promise.all([api.health(), api.videos()])
        setHealth(h)
        setVideos(v)
        loadProjects()
        return
      } catch {
        const waited = Math.floor((attempt * pauseMs) / 1000)
        setError(waited < 2 ? 'starting the engine...' : `waiting for the sidecar (${waited}s)`)
        await new Promise((done) => setTimeout(done, pauseMs))
      }
    }
    setError('The sidecar is not answering on 127.0.0.1:8765. Press Retry.')
  }, [loadProjects])

  useEffect(() => {
    // connect() ជា async ហើយ setState ទាំងអស់របស់វាកើតក្រោយ `await` ទីមួយ — lint
    // មើលមិនឃើញ `await` ទេ. setState មុន await (setError('')) ត្រូវផ្លាស់ទៅប៊ូតុង Retry.
    // oxlint-disable-next-line react/set-state-in-effect
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

  // useCallback: Review ដាក់វាក្នុង deps របស់ effect ដែលទាញ folder លំនាំដើម
  const changeReview = useCallback(
    (change: Partial<ReviewChoices>) =>
      setReview((current) => ({
        project: projectName,
        choices: { ...(current.project === projectName ? current.choices : NO_CHOICES), ...change },
      })),
    [projectName],
  )

  const startWith = useCallback(
    (extra: Record<string, unknown>, label: string) => {
      if (!chosen) return
      setRunLabel(label)
      setView('job')
      job.start({ video: chosen.path, ...pack.options, ...preset.options, ...extra })
      setTimeout(loadProjects, 500)
    },
    [chosen, preset, pack, job, loadProjects],
  )

  /** ប្តូរ style caption រួច render ជាថ្មី — មិន transcribe ឡើងវិញទេ.
   *  `max_clips` = ចំនួនដែល render រួច: បើមិនដូច្នោះ preset (Podcast = 5) កាត់ project ដែលមាន
   *  ១០ clips មកនៅ ៥ (ឃើញក្នុង args ពិត: `--max-clips 5` លើ re-render). */
  const renderedCount = clips.filter((clip) => clip.files.mp4).length
  const rerender = useCallback(
    () =>
      startWith(
        { redo: 'render', max_clips: Math.max(1, renderedCount), ...styleOptions(captionStyle) },
        captionStyle.off ? 'render ម្តងទៀត · គ្មាន captions' : 'render ម្តងទៀត · style subtitles ថ្មី',
      ),
    [startWith, captionStyle, renderedCount],
  )

  /** preview គ្មាន caption (`--clean-only`): មិនទៅ screen Processing ទេ — វាខ្លី ហើយ
   *  Subtitles បង្ហាញស្ថានភាពខ្លួនឯង; clip ដែលមាន caption មិនត្រូវបានប៉ះ. */
  const makePreview = useCallback(() => {
    if (!chosen?.path) return
    setPreviewAsked(true)
    job.start({ video: chosen.path, ...pack.options, clean_only: true, max_clips: Math.max(1, renderedCount) })
  }, [chosen, pack, job, renderedCount])

  /** path ដែលវាយដោយដៃ — វីដេអូក្រៅ samples/. */
  const choosePath = useCallback((path: string) => {
    const name = path.split(/[\\/]/).pop() ?? path
    setChosen({ name, path, mb: 0 })
    setError('')
  }, [])

  /** Drop វីដេអូលើ window ពី **ទំព័រណាក៏បាន** — ជ្រើសវា រួចទៅ Import ដែលប៊ូតុង
   *  ចាប់ផ្តើមនៅ. វាធ្លាប់ដំណើរការតែលើ Home ចាស់ (listener នៅក្នុង drop zone)
   *  ហើយ drop លើ Review ឬ Models ត្រូវបោះចោលដោយគ្មានសញ្ញាអ្វីទាំងអស់. */
  const dropOver = useFileDrop((path) => {
    choosePath(path)
    setView('projects')
  })

  /** sidebar ថ្មី: ទំព័រដើម/ឧបករណ៍ = Home; Projects = Import (drop zone + Projects ថ្មីៗ);
   *  Settings = ទំព័រ Models (រហូតដល់ Settings.html ត្រូវសង់). */
  const navigate = useCallback((page: AppPage) => {
    if (page === 'home' || page === 'tools') {
      setHomePage(page)
      setView('home')
    } else setView(page === 'projects' ? 'projects' : 'models')
  }, [])

  /** ចុចឧបករណ៍ ឬ "Import វីដេអូ" = preset ពិតរបស់វា រួចទៅជ្រើសវីដេអូ. */
  const openTool = useCallback((presetId: string) => {
    const found = PRESETS.find((item) => item.id === presetId)
    if (found) {
      setPreset(found)
      setMaxClips(found.options.max_clips ?? 5)
    }
    setView('projects')
  }, [])

  const openProject = useCallback((project: Project) => {
    setChosen({ name: project.name, path: project.video, mb: 0 })
    if (project.clips > 0) setView('review')
  }, [])

  const title = chosen ? `ClipForge Studio — ${chosen.name}` : 'ClipForge Studio'

  // screen 1F យក window ទាំងមូល: sidebar, window controls និងតំបន់អូស window ជារបស់វា
  if (view === 'home') {
    return (
      <div className="flex h-screen bg-bg">
        <HomeScreen page={homePage} onNavigate={navigate} onTool={openTool} />
      </div>
    )
  }
  if (view === 'job' && job.status) {
    return (
      <div className="flex h-screen bg-bg">
        <ProcessingScreen
          key={job.status.id}
          status={job.status}
          log={job.log}
          error={job.error}
          projectName={projectName}
          videoName={chosen?.name ?? ''}
          runLabel={runLabel}
          device={health?.device ?? ''}
          onCancel={job.cancel}
          onReview={() => setView('review')}
          onBack={() => setView('projects')}
          onHome={() => navigate('home')}
        />
      </div>
    )
  }

  // POST /jobs មិនទាន់ឆ្លើយ: នៅលើ screen ទទេ ជាជាងលោតទៅ Import (ពី Subtitles ឬ Review)
  if (view === 'job' && job.starting) {
    return (
      <div className="flex h-screen flex-col bg-bg">
        <TopBar crumb={projectName} onHome={() => navigate('home')} />
        <p className="m-auto font-kantumruy type-body text-text-3">កំពុងចាប់ផ្តើម job...</p>
      </div>
    )
  }

  // clips.json មាន clip ក្រោយ --max-clips ដែលមិនទាន់ render — Review បង្ហាញតែ clip ដែលមាន .mp4
  const hasRendered = clips.some((clip) => clip.files.mp4)
  if (view === 'exported' && exportResult) {
    return (
      <div className="flex h-screen bg-bg">
        <ExportDoneScreen
          key={exportResult.destination + exportResult.files.length}
          project={projectName}
          result={exportResult}
          clips={clips}
          onReview={() => setView('review')}
          onNewProject={() => {
            setChosen(null) // Project ថ្មី = វីដេអូថ្មី: drop zone ទទេ
            setView('projects')
          }}
          onHome={() => navigate('home')}
        />
      </div>
    )
  }

  const reviewChoices = review.project === projectName ? review.choices : NO_CHOICES

  const subtitled = clips.find((clip) => clip.index === subtitleClip && clip.files.mp4)
  if (view === 'subtitles' && subtitled) {
    return (
      <div className="flex h-screen bg-bg">
        <SubtitlesScreen
          key={`${projectName}/${subtitled.index}`}
          project={projectName}
          clip={subtitled}
          clipCount={renderedCount}
          style={captionStyle}
          onStyle={setCaptionStyle}
          busy={job.running}
          preview={
            subtitled.files.clean && !(previewAsked && (job.starting || job.running))
              ? 'ready'
              : !chosen?.path
                ? 'none' // project ពី CLI: មិនដឹង path វីដេអូដើម
                : previewAsked && (job.starting || job.running || job.status?.state === 'done')
                  ? 'running' // done តែ clips មិនទាន់ទាញឡើងវិញ = នៅរង់ចាំ
                  : previewAsked && job.status && job.status.state !== 'running'
                    ? 'failed'
                    : 'idle'
          }
          previewVersion={previewAsked && job.status?.state === 'done' ? job.status.id : ''}
          onMakePreview={makePreview}
          onSave={rerender}
          onBack={() => setView('review')}
          onHome={() => navigate('home')}
        />
      </div>
    )
  }

  if ((view === 'review' || view === 'subtitles') && hasRendered) {
    return (
      <div className="flex h-screen bg-bg">
        <ReviewScreen
          key={projectName}
          project={projectName}
          clips={clips}
          busy={job.running}
          choices={reviewChoices}
          onChoices={changeReview}
          onExported={(result) => {
            setExportResult(result)
            setView('exported')
          }}
          onSubtitles={(index) => {
            setSubtitleClip(index)
            setView('subtitles')
          }}
          onMore={(count) => {
            setMaxClips(count)
            startWith({ max_clips: count }, `${khmerNumber(count)} clips · ${preset.title}`)
          }}
          onHome={() => navigate('home')}
        />
      </div>
    )
  }

  // job ដែលគ្មាន status ឬ review ដែលគ្មាន clip = គ្មានអ្វីត្រូវបង្ហាញ -> ត្រឡប់ទៅ Import
  const showImport =
    view === 'projects' || view === 'job' || view === 'review' || view === 'subtitles' || view === 'exported'
  if (showImport) {
    return (
      <div className="flex h-screen bg-bg">
        <ImportScreen
          videos={videos}
          projects={projects}
          chosen={chosen}
          preset={preset}
          pack={pack}
          health={health}
          error={error || job.error}
          connected={health !== null}
          busy={job.running}
          clips={clips.filter((clip) => clip.files.mp4).length}
          dropOver={dropOver}
          maxClips={maxClips}
          onMaxClips={setMaxClips}
          onChoose={setChosen}
          onChoosePath={choosePath}
          onClear={() => setChosen(null)}
          onStart={() => startWith({ max_clips: maxClips }, `${khmerNumber(maxClips)} clips · ${preset.title}`)}
          onShowJob={() => setView('job')}
          onOpenProject={openProject}
          onReview={() => setView('review')}
          onRetry={() => {
            setError('') // សម្អាតសារចាស់ មុនសួរម្តងទៀត
            void connect()
          }}
          onHome={() => navigate('home')}
        />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-bg-app">
      <TitleBar title={title} />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          device={health?.device ?? '...'}
          ffmpeg={health?.ffmpeg ?? false}
          onNewProject={() => setView('projects')}
          onHome={() => navigate('home')}
          page="models"
          onPage={(page: Page) => setView(page === 'models' ? 'models' : 'projects')}
        />

        <Models pack={pack} onPack={setPack} />
      </div>
    </div>
  )
}

/** "podcast.mp4" -> "podcast" — ឈ្មោះ folder ក្នុង output/ ដូច `video.stem` ក្នុង Python. */
function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
