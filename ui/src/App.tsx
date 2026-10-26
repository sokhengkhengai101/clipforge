import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type Clip, type Env, type ExportResult, type Health, type JobOptions, type Project, type ReframeResult, type Video } from './api'
import { PRESETS, type Preset } from './presets'
import { PACKS, bestFit } from './packs'
import { loadDefaults, saveDefaults, type PackChoice } from './defaults'
import { useJob } from './useJob'
import { useFileDrop } from './useFileDrop'
import { Models } from './components/Models'
import { HomeScreen } from './screens/HomeScreen'
import { AppShell } from './screens/AppShell'
import { loadRecentTools, rememberTool } from './screens/recentTools'
import type { CatalogTab } from './screens/tools'
import { ClipSettingsDialog } from './screens/ClipSettingsDialog'
import { SettingsDialog } from './screens/SettingsDialog'
import { useT } from './i18n'
import { pickVideo } from './screens/pickFile'
import { ProjectCards, ProjectsScreen, type ProjectAction, type Running } from './screens/ProjectsScreen'
import { useRunProgress, type Run, type RunTool } from './useRunProgress'
import { ProcessingScreen } from './screens/ProcessingScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { EditorScreen } from './screens/EditorScreen'
import { Illustration, Source } from './screens/VideoPicker'
import { Dialog } from './kit/Dialog'
import { wholeClips, wholeMedia } from './screens/reviewMedia'
import { reframeThumbUrl } from './api'
import { NO_CHOICES, type ReviewChoices } from './screens/reviewChoices'
import { SubtitlesScreen } from './screens/SubtitlesScreen'
import { ExportDoneScreen } from './screens/ExportDoneScreen'
import { ReframeSetup, type ReframeSettings } from './screens/ReframeSetup'
import { AutoSubtitlesDialog, type SubtitleSettings } from './screens/AutoSubtitlesDialog'
import { SilenceDialog } from './screens/SilenceDialog'
import { ReframeProcessingScreen } from './screens/ReframeProcessingScreen'
import { ReframeResultScreen } from './screens/ReframeResultScreen'
import { styleOptions, type CaptionStyle } from './captionStyle'
import { khmerNumber } from './screens/khmer'
import type { Page as AppPage } from './screens/AppSidebar'
import { TopBar } from './kit/TopBar'

/** ចំណងជើង toast ពេល job ចប់ — តាមឧបករណ៍ដែលចាប់ផ្តើម. */
const DONE_TITLE: Record<RunTool, string> = {
  clips: 'Clips រួចរាល់ហើយ!',
  subtitles: 'Subtitles រួចរាល់ហើយ!',
  reframe: 'Reframe រួចរាល់ហើយ!',
  editor: 'វីដេអូរួចរាល់ហើយ!',
}

export default function App() {
  const t = useT()
  const [health, setHealth] = useState<Health | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [chosen, setChosen] = useState<Video | null>(null)
  const [preset, setPreset] = useState<Preset>(PRESETS[0])
  const [clips, setClips] = useState<Clip[]>([])
  const [error, setError] = useState('')
  // 'home' = Home; 'library' = Projects របស់ខ្ញុំ. ការជ្រើសវីដេអូ + ការកំណត់ = dialog (settingsOpen), មិនមែនទំព័រ.
  // models នៅជារចនាចាស់ រហូតដល់ Settings.html (ជំហាន ៨).
  const [view, setView] = useState<
    // library = ទំព័រ Projects របស់ខ្ញុំ (កាត project); projects = Import (drop zone + Start)
    | 'home' | 'library' | 'job' | 'review' | 'subtitles' | 'exported' | 'reframing' | 'reframed' | 'models'
    | 'whole' // លទ្ធផលវីដេអូទាំងមូល (Auto Subtitles / Auto Reframe) លើទំព័រ Review
    | 'editor' // Edit Video: transcript + preview + timeline
  >('home')
  const [homePage, setHomePage] = useState<'home' | 'tools'>('home')
  // tab របស់ទំព័រ ឧបករណ៍ទាំងអស់ — sidebar ▾ (Clips / Subtitles / កែវីដេអូ) ប្តូរវាដែរ
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('popular')
  const [recentTools, setRecentTools] = useState(loadRecentTools)
  // "ចំនួន Clips" លើ Import: ចាប់ផ្តើមពី preset (Long to Short 5) ហើយអ្នកប្តូរបាន
  // ការកំណត់ដែលអ្នក "រក្សាទុកជាលំនាំដើម" លើ Import (localStorage) — អានតែម្តងពេលបើក app
  const [defaults] = useState(loadDefaults)
  const [savedAt, setSavedAt] = useState<number | null>(defaults.savedAt)
  // dialog "វីដេអូវែង → Clips ខ្លី" (ជំនួសទំព័រ Import): ជ្រើសវីដេអូ + ការកំណត់ + ចាប់ផ្តើម
  const [settingsOpen, setSettingsOpen] = useState(false)
  // dialog Settings (ប៊ូតុងស្តាំខាងលើ) — ខុសពី settingsOpen ដែលជា dialog Long to Short
  const [prefsOpen, setPrefsOpen] = useState(false)
  // Start ក្នុង dialog: ទៅទំព័រដើម ហើយ scroll ទៅ "Projects ថ្មីៗ" **ម្តង** (true = កំពុងរង់ចាំ scroll)
  const [focusRecent, setFocusRecent] = useState(false)
  const recentRef = useRef<HTMLElement>(null)
  // job "វីដេអូវែង → clips" ដែលចាប់ផ្តើមពី dialog: មិនទៅ Processing ទេ — កាតរបស់វាបង្ហាញ % + ETA
  const [run, setRun] = useState<Run | null>(null)
  // សារតូចនៅជ្រុងខាងក្រោម: job ចប់ / បរាជ័យ / ចាប់ផ្តើមមិនបាន
  const [toast, setToast] = useState<{
    kind: 'done' | 'failed' | 'cancelled' | 'error'
    name: string
    text?: string
    tool?: RunTool // subtitles/reframe: មើល = ទំព័រលទ្ធផល Reframe
    folder?: string // full, full_1x1 ...
  } | null>(null)
  const [maxClips, setMaxClips] = useState(defaults.maxClips)
  // អ្វីដែល job ចុងក្រោយបានចាប់ផ្តើមជាមួយ ("៥ clips · Podcast Clips") — screen Processing
  // បង្ហាញវា; យកពេលចាប់ផ្តើម ដូច្នេះការប្តូរ preset ពេល job រត់មិនប្តូរអត្ថបទ
  const [runLabel, setRunLabel] = useState('')
  // Model pack = flag ដែល *គ្រប់* job ប្រើ. 'auto' = BEST FIT តាម VRAM ពិត (/env);
  // មុន /env ឆ្លើយ auto = Standard, ជាអ្វីដែលម៉ាស៊ីននេះរត់ពិត (ដូចលំនាំដើមចាស់).
  const [packChoice, setPackChoice] = useState<PackChoice>(defaults.pack)
  const [env, setEnv] = useState<Env | null>(null)
  const autoPack = env ? bestFit(env.gpu?.vram_mb ?? null) : PACKS[1]
  const pack = packChoice === 'auto' ? autoPack : (PACKS.find((item) => item.id === packChoice) ?? autoPack)
  // style caption (screen Subtitles) — តម្លៃលំនាំដើមរបស់ config.py; app មិនដឹងថា clip ចាស់
  // ត្រូវបាន render ជាមួយ style អ្វីទេ (pipeline មិនកត់ទុកវា)
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(defaults.captionStyle)
  const [subtitleClip, setSubtitleClip] = useState(1)
  // ការជ្រើសលើ Review (checkbox, clip, តម្រៀប, folder) — នៅទីនេះ ដើម្បីរស់ឆ្លងការចេញទៅ
  // Subtitles / Export រួចរាល់; `project` ធ្វើឲ្យ project ផ្សេងចាប់ផ្តើមស្អាត
  const [review, setReview] = useState<{ project: string; choices: ReviewChoices }>({
    project: '',
    choices: NO_CHOICES,
  })
  // ចុច "បង្កើត preview ភ្លាមៗ" លើ Subtitles — job --clean-only រត់ក្រោយ screen ដដែល
  // project ណាដែលបានសុំ preview (`--clean-only`) ចុងក្រោយ — ជា boolean ពីមុន ដូច្នេះក្រោយ job
  // មួយចប់ project ផ្សេងទាំងអស់អាន 'running' ជារៀងរហូត ហើយប៊ូតុង preview មិនមកវិញ
  const [previewFor, setPreviewFor] = useState('')
  // AI Reframe (1F ជំហាន ៧): dialog លើ Home -> job --full -> លទ្ធផល
  const [reframeOpen, setReframeOpen] = useState(false)
  // Auto Subtitles: dialog លើទំព័រនេះ -> job --full ដូច Reframe (វីដេអូទាំងមូល + captions)
  const [subtitlesOpen, setSubtitlesOpen] = useState(false)
  // Edit Video: dialog ជ្រើសវីដេអូ (ជំហាន ១ ដូច Long to Short) មុនបើក editor
  const [editorPick, setEditorPick] = useState(false)
  const [silenceOpen, setSilenceOpen] = useState(false) // កាត "លុបភាពស្ងាត់ & អឺ"
  const [reframeSettings, setReframeSettings] = useState<ReframeSettings | null>(null)
  const [reframePrevious, setReframePrevious] = useState<ReframeResult[]>([])
  const [reframeResult, setReframeResult] = useState<ReframeResult | null>(null)
  // លទ្ធផលវីដេអូទាំងមូលទាំងអស់របស់ project (full, full_16x9 ...) — បើកលើទំព័រ Review ដូច Long to Short
  const [wholeResults, setWholeResults] = useState<ReframeResult[]>([])
  const [wholeChoices, setWholeChoices] = useState<ReviewChoices>(NO_CHOICES)
  const [exportFrom, setExportFrom] = useState<'clips' | 'whole'>('clips')
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
        // VRAM សម្រាប់ AI model "Auto" — មិនរង់ចាំវាទេ (90-140 ms, nvidia-smi)
        api.env().then(setEnv).catch(() => {})
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
  const previewAsked = previewFor !== '' && previewFor === projectName
  const rendered = job.status?.progress.done.includes('render') ?? false
  const state = job.status?.state
  // សួរ clips តែ project ដែលមាន (`/projects/<name>/clips` 404 សម្រាប់វីដេអូដែលមិនធ្លាប់ដំណើរការ ហើយ
  // browser កត់ 404 នោះក្នុង console). project ដែលមិនទាន់មាន = បញ្ជីទទេ — មិនមែន clips របស់ project
  // មុនដែលនៅជាប់ក្នុង state ទេ (វាធ្លាប់បង្ហាញ "មើល N clips" ខុស)
  const known = projects.some((item) => item.name === projectName)
  useEffect(() => {
    if (!projectName) return
    const request = known ? api.clips(projectName) : Promise.resolve([] as Clip[])
    request.then(setClips)
    if (state && state !== 'running') loadProjects()
  }, [projectName, known, rendered, state, loadProjects])

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
    (extra: Record<string, unknown>, label: string, stay = false) => {
      if (!chosen) return
      setRunLabel(label)
      if (!stay) setView('job') // stay: នៅលើទំព័របច្ចុប្បន្ន (កាត Projects ថ្មីៗ បង្ហាញវឌ្ឍនភាព)
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
    setPreviewFor(projectName)
    job.start({ video: chosen.path, ...pack.options, clean_only: true, max_clips: Math.max(1, renderedCount) })
  }, [chosen, pack, job, renderedCount, projectName])

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
    // dialog បង្ហាញលើទំព័រដែលមាន sidebar; ពី Review/Processing ត្រឡប់ទៅទំព័រដើម
    setView((current) => (current === 'home' || current === 'library' || current === 'models' ? current : 'home'))
    setSettingsOpen(true)
  })

  /** sidebar: ទំព័រដើម/ឧបករណ៍ = Home; Projects = វិចិត្រសាល project; Settings = Settings.html
   *  (ទំព័រ Models ចាស់បើកពី Settings → "Models ដែលមានលើកុំព្យូទ័រនេះ"). */
  const navigate = useCallback((page: AppPage) => {
    if (page === 'home' || page === 'tools') {
      setHomePage(page)
      setView('home')
    } else if (page === 'projects') setView('library')
    else setPrefsOpen(true) // Settings = dialog (ប៊ូតុងស្តាំខាងលើ)
  }, [])

  /** ចុចឧបករណ៍ ឬ "Import វីដេអូ" = preset ពិតរបស់វា រួចទៅជ្រើសវីដេអូ. */
  const openTool = useCallback((presetId: string) => {
    setRecentTools(rememberTool(presetId)) // tab "ថ្មីៗ" លើទំព័រ ឧបករណ៍ទាំងអស់
    // Auto Reframe = dialog AI Reframe លើ Home (ReframeSetup.html) មិនមែន Import ទេ
    // Auto Reframe / Auto Subtitles: dialog ជំហាន ១ (ជ្រើសវីដេអូ) ដូច Long to Short
    if (presetId === 'editor') {
      setChosen(null)
      setEditorPick(true)
      return
    }
    if (presetId === 'silence') {
      setChosen(null)
      setSilenceOpen(true)
      return
    }
    if (presetId === 'reframe' || presetId === 'subtitles') {
      setChosen(null)
      if (presetId === 'reframe') setReframeOpen(true)
      else setSubtitlesOpen(true)
      return
    }
    const found = PRESETS.find((item) => item.id === presetId)
    if (found) {
      setPreset(found)
      setMaxClips(found.options.max_clips ?? 5)
    }
    // ឧបករណ៍ = dialog ជំហាន ១ (ជ្រើសវីដេអូ) ជាមួយ preset នោះ — មិនយកវីដេអូចាស់មកទេ
    setChosen(null)
    setSettingsOpen(true)
  }, [])

  /** "Import វីដេអូ" លើ Auto Clip: ផ្ទាំងជ្រើស file របស់ Windows **ភ្លាម** ហើយពេលជ្រើសរួច
   *  dialog ការកំណត់បើកនៅជំហាន ២ (មិនបាច់ឆ្លងជំហាន ១). បោះបង់ = គ្មានអ្វីកើតឡើង.
   *  Browser គ្មានផ្ទាំងជ្រើស path ពេញ -> dialog ជំហាន ១ (ប្រអប់ path + វីដេអូគំរូ). */
  const importVideo = useCallback(async () => {
    const picked = await pickVideo().catch(() => 'browser' as const)
    if (picked === null) return // បោះបង់
    openTool('shorts') // preset Long to Shorts + dialog ជំហាន ១ ...
    if (picked !== 'browser') choosePath(picked) // ... ហើយមានវីដេអូរួច = ជំហាន ២
  }, [openTool, choosePath])

  // reframe ដែលធ្លាប់ធ្វើលើវីដេអូដែលជ្រើស — dialog បង្ហាញវា ("ធ្លាប់ reframe: 9:16 · ថ្ងៃនេះ")
  useEffect(() => {
    if (!reframeOpen || !projectName) return
    let stale = false
    api.reframes(projectName).then((results) => !stale && setReframePrevious(results))
    return () => {
      stale = true
    }
  }, [reframeOpen, projectName])

  /** កាតវឌ្ឍនភាពក្នុង Projects ថ្មីៗ (% + ETA) — ឧបករណ៍ទាំងបីប្រើរួមគ្នា. ប្រវែងវីដេអូមកពី /probe
   *  ក្រោយ Start (មិនទាន់ដឹង = ប៉ាន់ ១០ នាទី). */
  const beginRun = useCallback(
    (tool: RunTool, full: boolean, clipCount: number) => {
      if (!chosen) return
      setToast(null)
      const video = chosen.path
      setRun({
        name: stemOf(chosen.name),
        video,
        startedAt: Date.now(),
        tool,
        plan: {
          seconds: null,
          device: health?.device ?? 'cuda',
          whisperModel: String(pack.options.whisper_model ?? 'medium'),
          llm: String(pack.options.model ?? ''),
          clips: clipCount,
          full,
        },
      })
      api
        .probe(video)
        .then((format) =>
          setRun((current) =>
            current && current.video === video ? { ...current, plan: { ...current.plan, seconds: format.seconds ?? null } } : current,
          ),
        )
        .catch(() => {})
    },
    [chosen, health, pack],
  )

  /** ចាប់ផ្តើម reframe: `--full` + aspect + layout (+ `--no-captions`) — គ្មាន preset / max_clips. */
  const startReframe = useCallback(
    // `extra`: flag បន្ថែមពី Auto Subtitles (style caption, --language)
    (settings: ReframeSettings, extra: Omit<JobOptions, 'video'> = {}, tool: RunTool = 'reframe') => {
      if (!chosen?.path) return
      setReframeSettings(settings)
      setReframeOpen(false)
      setSubtitlesOpen(false)
      setSilenceOpen(false)
      // ដូច Long to Short: នៅលើទំព័រដើម ហើយកាត Projects ថ្មីៗ បង្ហាញ % + ETA (មិនទៅ screen ដំណើរការ)
      beginRun(tool, true, 1)
      navigate('home')
      setFocusRecent(true)
      job.start({
        video: chosen.path,
        ...pack.options,
        full: true,
        aspect: settings.aspect,
        layout: settings.layouts.join(',') || 'center',
        ...(settings.captions ? {} : { no_captions: true }),
        ...extra,
      })
      setTimeout(loadProjects, 500)
    },
    [chosen, pack, job, loadProjects, beginRun, navigate],
  )

  /** លទ្ធផលរបស់ job reframe ចុងក្រោយ: folder មកពី progress (full / full_1x1 ...). */
  const showReframeResult = useCallback(
    // `name`: ពេលបើកពីកាត project, `chosen` ទើបតែប្តូរ ហើយ projectName មិនទាន់ថ្មីទេ
    async (folder?: string, name: string = projectName) => {
      const results = await api.reframes(name)
      const found = results.find((item) => item.folder === folder) ?? results[0]
      if (found) {
        setReframeResult(found)
        setReframeOpen(false)
        setSubtitlesOpen(false)
        // folder ដឹង (job ទើបចប់, toast មើល, chip "ធ្លាប់ reframe") = **តែវីដេអូនោះ** ជាទិដ្ឋភាពធំ
        // (អ្នកអភិវឌ្ឍស្នើ: មិនបង្ហាញក្រឡាជាមួយលទ្ធផលចាស់); បើកពីកាត/ម៉ឺនុយ project = ទាំងអស់
        const shown = folder ? [found] : results
        setWholeResults(shown)
        setWholeChoices({ ...NO_CHOICES, selected: shown.indexOf(found) + 1 })
        setView('whole')
      }
    },
    [projectName],
  )

  /** បើក project តាមអ្វីដែលវាមាន: clips -> Review, reframe តែប៉ុណ្ណោះ -> លទ្ធផល Reframe,
   *  មិនទាន់មានអ្វី -> Import ជាមួយវីដេអូនោះ (ដើម្បីចុច Start). */
  const openProject = useCallback(
    (project: Project) => {
      setChosen(chosenOf(project))
      // កាតដែលកំពុងដំណើរការ: ព័ត៌មានលម្អិត (ជំហាន transcript log) — តែពេលអ្នកចុច
      if (run && project.name === run.name && (job.running || job.starting))
        setView(run.tool === 'clips' ? 'job' : 'reframing')
      else if (project.clips > 0) setView('review')
      else if (project.reframes > 0) void showReframeResult(undefined, project.name)
      else setSettingsOpen(true) // មិនទាន់មានអ្វី -> dialog ជំហាន ២ ជាមួយវីដេអូនោះ
    },
    [showReframeResult, run, job.running, job.starting],
  )

  /** ម៉ឺនុយ "⋯" លើកាត project. "folder" និង "video" គ្រាន់តែបើក Explorer — មិនប៉ះ file ទេ. */
  const projectAction = useCallback(
    (project: Project, action: ProjectAction) => {
      if (action === 'cancel') {
        void job.cancel()
        return
      }
      if (action === 'folder' || action === 'video') {
        api
          .reveal(action === 'folder' ? project.folder : project.video)
          .catch((reason: Error) => setError(reason.message))
        return
      }
      setChosen(chosenOf(project))
      if (action === 'review') setView('review')
      else if (action === 'reframe-result') void showReframeResult(undefined, project.name)
      else if (action === 'new-clips') setSettingsOpen(true)
      else setReframeOpen(true) // dialog Reframe លើទំព័រនេះ ជាមួយវីដេអូនោះជ្រើសរួច
    },
    [showReframeResult, job],
  )

  // screen 1F យក window ទាំងមូល: sidebar, window controls និងតំបន់អូស window ជារបស់វា
  const reframeDialog = reframeOpen && (
    <ReframeSetup
      video={chosen}
      videos={videos}
      device={health?.device ?? ''}
      previous={reframePrevious}
      busy={job.running}
      error=""
      dropOver={dropOver}
      onClear={() => setChosen(null)}
      onChoose={setChosen}
      onChoosePath={choosePath}
      onShowPrevious={(result) => void showReframeResult(result.folder)}
      onStart={startReframe}
      onClose={() => setReframeOpen(false)}
    />
  )

  /** Auto Subtitles -> `--full`: ទំហំដូចវីដេអូ = `--layout center` (frame ទាំងមូល គ្មានកាត់),
   *  aspect ផ្សេង = layout ទាំងអស់ (AI reframe), + style caption + `--language`. */
  /** Edit Video ជំហាន ១: ជ្រើសវីដេអូ (path, ជ្រើសឯកសារ, វីដេអូគំរូ, drop) -> editor ពេញ window. */
  const openEditor = (video: Video) => {
    setChosen(video)
    setEditorPick(false)
    setView('editor')
  }
  const editorDialog = editorPick && (
    <Dialog width={640} onClose={() => setEditorPick(false)} title="Edit Video">
      <p className="-mt-2.5 type-body-lg text-text-3">កែវីដេអូតាម transcript: មើលពាក្យ និង pause, ចុចពាក្យដើម្បីលោតទៅពេលនោះ។</p>
      <Illustration variant="subtitles" video={[...videos].sort((a, b) => b.mb - a.mb)[0] ?? null} />
      <Source
        videos={videos}
        dropOver={dropOver}
        onChoose={openEditor}
        onChoosePath={(path) => openEditor({ name: path.split(/[\\/]/).pop() ?? path, path, mb: 0 })}
      />
    </Dialog>
  )

  // job --transcribe-only របស់វីដេអូដែលជ្រើស (dialog លុបភាពស្ងាត់ បង្ហាញវឌ្ឍនភាពរបស់វា)
  const mineJob = chosen && job.status && job.status.video === chosen.path ? job.status : null
  const silenceDialog = silenceOpen && (
    <SilenceDialog
      video={chosen}
      videos={videos}
      project={projectName}
      job={mineJob}
      busy={(job.running || job.starting) && !mineJob}
      device={health?.device ?? ''}
      dropOver={dropOver}
      onChoose={setChosen}
      onChoosePath={choosePath}
      onClear={() => setChosen(null)}
      onTranscribe={() => chosen && job.start({ video: chosen.path, ...pack.options, transcribe_only: true })}
      onStart={(settings) =>
        startReframe(
          { aspect: settings.aspect, layouts: [], captions: settings.captions, tool: 'លុបភាពស្ងាត់' },
          {
            ...(settings.captions ? styleOptions(captionStyle) : {}),
            cuts: settings.cuts,
            transition: settings.transition,
          },
          'editor',
        )
      }
      onClose={() => setSilenceOpen(false)}
    />
  )

  const subtitlesDialog = subtitlesOpen && (
    <AutoSubtitlesDialog
      video={chosen}
      videos={videos}
      device={health?.device ?? ''}
      savedStyle={captionStyle}
      busy={job.running}
      error=""
      dropOver={dropOver}
      onChoose={setChosen}
      onChoosePath={choosePath}
      onClear={() => setChosen(null)}
      onStart={(settings: SubtitleSettings) =>
        startReframe(
          {
            aspect: settings.aspect,
            layouts: settings.reframe ? ['fill', 'fit', 'split', 'three', 'four', 'screen'] : [],
            captions: !settings.style.off,
            tool: 'Auto Subtitles',
          },
          {
            ...styleOptions(settings.style),
            ...(settings.language === 'auto' ? {} : { language: settings.language }),
          },
          'subtitles',
        )
      }
      onClose={() => setSubtitlesOpen(false)}
    />
  )

  const renameProject = async (project: Project, title: string) => {
    await api.renameProject(project.name, title)
    loadProjects()
  }
  const deleteProject = async (project: Project) => {
    await api.deleteProject(project.name)
    // project ដែលបានជ្រើសត្រូវបានលុប -> កុំឲ្យ Review ចង្អុលទៅ folder ដែលលែងមាន
    if (chosen && stemOf(chosen.name) === project.name) setChosen(null)
    loadProjects()
  }

  // % + ETA ប៉ាន់ស្មាន (eta.ts) របស់ job ដែលចាប់ផ្តើមពី dialog
  const estimate = useRunProgress(run, job.status)
  const runActive = Boolean(run && (job.starting || (job.running && job.status?.video === run.video)))
  const running: Running | null = run && runActive ? { name: run.name, estimate } : null
  // folder/database របស់ project ថ្មីមិនទាន់មានក្នុង /projects ពេល job ទើបចាប់ផ្តើម -> កាតបណ្តោះអាសន្ន
  const listed =
    running && run && !projects.some((item) => item.name === run.name)
      ? [
          {
            id: -1, name: run.name, title: run.name, video: run.video, created: run.startedAt / 1000, clips: 0, jobs: 1,
            last_state: 'running', seconds: run.plan.seconds, bytes: 0, reframes: 0, folder: '',
          } satisfies Project,
          ...projects,
        ]
      : projects

  // job របស់ run ប្តូរពី running -> done/failed/cancelled: បង្ហាញសារ (លំនាំ "ព័ត៌មានពី render មុន")
  const runState = run && job.status?.video === run.video ? job.status.state : null
  const [seenRunState, setSeenRunState] = useState<string | null>(null)
  if (runState !== seenRunState) {
    setSeenRunState(runState)
    if (seenRunState === 'running' && run && runState && runState !== 'running') {
      setToast({
        kind: runState,
        name: run.name,
        text: runState === 'failed' ? job.status?.error : undefined,
        tool: run.tool,
        folder: job.status?.progress.folder,
      })
    }
  }
  // POST /jobs បរាជ័យ (ឧ. 409 មាន job រត់រួច) — គ្មាន status ទេ ដូច្នេះប្រាប់តាមសារ
  const startError = run && !job.status && !job.starting ? job.error : ''
  const [seenStartError, setSeenStartError] = useState('')
  if (startError !== seenStartError) {
    setSeenStartError(startError)
    if (startError && run) setToast({ kind: 'error', name: run.name, text: startError })
  }

  const toastView = toast && (
    <div
      role="status"
      className="fixed right-6 bottom-6 z-40 flex max-w-[420px] items-start gap-3 rounded-card border border-line bg-raised p-4 font-kantumruy text-text shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
    >
      <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${toast.kind === 'done' ? 'bg-ok' : 'bg-warn'}`} />
      <div className="min-w-0 flex-1">
        <p className="type-body font-semibold">
          {toast.kind === 'done'
            ? DONE_TITLE[toast.tool ?? 'clips']
            : toast.kind === 'cancelled'
              ? 'បានបោះបង់'
              : toast.kind === 'failed'
                ? 'បង្កើត clips មិនបាន'
                : 'ចាប់ផ្តើមមិនបាន'}
        </p>
        <p className="truncate type-hint text-text-3">{toast.text || toast.name}</p>
      </div>
      {toast.kind === 'done' && (
        <button
          type="button"
          onClick={() => {
            // Subtitles / Reframe -> ទំព័រលទ្ធផល (folder របស់ job នេះ); Long to Short -> Review
            if (toast.tool && toast.tool !== 'clips') {
              const project = projects.find((item) => item.name === toast.name)
              if (project) setChosen(chosenOf(project))
              void showReframeResult(toast.folder, toast.name)
            } else {
              const project = projects.find((item) => item.name === toast.name)
              if (project) openProject(project)
            }
            setToast(null)
          }}
          className="cursor-pointer rounded-field border-0 bg-gold px-3 py-1.5 type-label font-bold text-on-gold"
        >
          មើល
        </button>
      )}
      <button
        type="button"
        aria-label="បិទ"
        onClick={() => setToast(null)}
        className="cursor-pointer rounded-field border-0 bg-transparent px-1.5 text-text-3 hover:text-text"
      >
        ✕
      </button>
    </div>
  )

  /** ជួរ "Projects ថ្មីៗ" លើទំព័រដើម (រូប OpusClip "Recent projects · View all"). */
  const recentRow = listed.length > 0 && (
    <section
      ref={recentRef}
      // scroll-mt: ទុកកន្លែងខាងលើ ពេល scrollIntoView ដាក់វាចំកំពូលផ្ទៃ scroll
      className="flex scroll-mt-6 flex-col gap-4"
    >
      <div className="flex items-baseline gap-5">
        <h2 className="type-section text-text-2">{t('Projects ថ្មីៗ', 'Recent projects')}</h2>
        <button
          type="button"
          onClick={() => navigate('projects')}
          className="cursor-pointer border-0 bg-transparent p-0 type-body font-semibold text-text hover:text-gold"
        >
          {t('មើលទាំងអស់', 'View all')} ›
        </button>
      </div>
      <ProjectCards
        projects={[...listed].sort((x, y) => y.created - x.created).slice(0, 4)}
        columns={4}
        running={running}
        onOpen={openProject}
        onAction={projectAction}
        onRename={renameProject}
        onDelete={deleteProject}
      />
    </section>
  )

  // ក្រោយ Start: scroll ទៅ Projects ថ្មីៗ ពេលវាលេចលើទំព័រដើម — **តែម្តង** រួចបិទសញ្ញា, ដូច្នេះ
  // ចុច ទំព័រដើម ពេលក្រោយបើកទំព័រពីកំពូលធម្មតា (ពីមុនវា scroll ម្តងទៀតរាល់ពេលប្តូរ view).
  // គ្មានពន្លឺ gold ទៀតទេ (អ្នកអភិវឌ្ឍមិនចង់បាន). effect = ធ្វើក្រោយ DOM មានជួរនោះហើយ.
  useEffect(() => {
    const row = recentRef.current
    if (!focusRecent || !row) return
    row.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // oxlint-disable-next-line react/set-state-in-effect -- សញ្ញាម្តង: បិទវាក្រោយ scroll រួច
    setFocusRecent(false)
  }, [focusRecent, view])

  const prefsDialog = prefsOpen && (
    <SettingsDialog
      health={health}
      env={env}
      pack={pack}
      packChoice={packChoice}
      autoPack={autoPack}
      onPackChoice={setPackChoice}
      maxClips={maxClips}
      onMaxClips={setMaxClips}
      captionStyle={captionStyle}
      onCaptionStyle={setCaptionStyle}
      // ប្តូរនៅ Settings = រក្សាទុកជាលំនាំដើមភ្លាម (មិនមែនតែ project បច្ចុប្បន្នទេ)
      onSaveDefaults={(next) => {
        const at = saveDefaults({
          maxClips: next.maxClips ?? maxClips,
          pack: next.pack ?? packChoice,
          captionStyle: next.captionStyle ?? captionStyle,
        })
        if (at) setSavedAt(at)
      }}
      onOpenModels={() => setView('models')}
      onClose={() => setPrefsOpen(false)}
    />
  )

  const settingsDialog = settingsOpen && (
    <ClipSettingsDialog
      videos={videos}
      chosen={chosen}
      preset={preset}
      pack={pack}
      packChoice={packChoice}
      autoPack={autoPack}
      vramMb={env ? (env.gpu?.vram_mb ?? null) : undefined}
      onPackChoice={setPackChoice}
      captionStyle={captionStyle}
      onCaptionStyle={setCaptionStyle}
      savedAt={savedAt}
      onSaveDefaults={() => {
        const at = saveDefaults({ maxClips, pack: packChoice, captionStyle })
        if (at) setSavedAt(at)
        return at !== null
      }}
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
      // style caption ពី Quick presets ដុតចូល clips ពេល render (flag ដូច Subtitles)
      onStart={() => {
        if (!chosen) return
        setSettingsOpen(false)
        beginRun('clips', false, maxClips)
        // stay = true: មិនទៅ Processing — អ្នកនៅលើទំព័រនេះ ហើយកាតបង្ហាញ % + ETA
        startWith({ max_clips: maxClips, ...styleOptions(captionStyle) }, `${khmerNumber(maxClips)} clips · ${preset.title}`, true)
        // project ថ្មីលេចក្នុង Projects ថ្មីៗ លើទំព័រដើម — នាំអ្នកទៅទីនោះ (ទោះចាប់ផ្តើមពី My projects)
        navigate('home')
        setFocusRecent(true)
      }}
      onReframe={() => {
        setSettingsOpen(false) // dialog តែមួយម្តង: Reframe ជំនួស
        setReframeOpen(true)
      }}
      onShowJob={() => {
        setSettingsOpen(false)
        setView('job')
      }}
      onReview={() => {
        setSettingsOpen(false)
        setView('review')
      }}
      onRetry={() => {
        setError('') // សម្អាតសារចាស់ មុនសួរម្តងទៀត
        void connect()
      }}
      onClose={() => setSettingsOpen(false)} // វីដេអូដែលជ្រើសនៅដដែល
    />
  )

  /** ទំព័រដែល sidebar នាំទៅ: sidebar និងជួរខាងលើនៅនឹង (AppShell) ប្តូរតែមាតិកា.
   *  dialog Reframe នៅគ្រប់ទំព័រទាំងនេះ — "Reframe 9:16" ក្នុង sidebar បើកវាពីទំព័រណាក៏បាន. */
  const shell = (page: AppPage, content: ReactNode) => (
    <div className="flex h-screen bg-bg">
      <AppShell
        page={page}
        onNavigate={navigate}
        onQuick={openTool}
        onSettings={() => setPrefsOpen(true)}
        toolsTab={catalogTab}
        onToolsTab={(tab) => {
          setCatalogTab(tab)
          navigate('tools')
        }}
      >
        {content}
      </AppShell>
      {reframeDialog}
      {subtitlesDialog}
      {editorDialog}
      {silenceDialog}
      {settingsDialog}
      {prefsDialog}
      {toastView}
    </div>
  )

  if (view === 'home' || (view === 'reframing' && !job.status && !job.starting)) {
    return shell(
      homePage,
        <HomeScreen
          page={homePage}
          onNavigate={navigate}
          onTool={openTool}
          onImport={() => void importVideo()}
          recent={recentRow}
          recentTools={recentTools}
          catalogTab={catalogTab}
          onCatalogTab={setCatalogTab}
          onCatalogTool={(tool) => {
            if (tool.opens === 'models') {
              setRecentTools(rememberTool(tool.id))
              setView('models')
            } else if (tool.preset) openTool(tool.preset.id)
          }}
        />,
    )
  }
  if (view === 'reframing' && job.status && reframeSettings) {
    return (
      <div className="flex h-screen bg-bg">
        <ReframeProcessingScreen
          key={job.status.id}
          status={job.status}
          log={job.log}
          error={job.error}
          videoName={chosen?.name ?? ''}
          settings={reframeSettings}
          onCancel={job.cancel}
          onResult={() => void showReframeResult(job.status?.progress.folder)}
          onBack={() => navigate('home')}
          onHome={() => navigate('home')}
        />
      </div>
    )
  }
  if (view === 'editor' && chosen) {
    // job --transcribe-only របស់វីដេអូនេះ (editor បង្ហាញវឌ្ឍនភាព); job ផ្សេង = busy
    const mine = job.status && job.status.video === chosen.path ? job.status : null
    return (
      <div className="flex h-screen bg-bg">
        <EditorScreen
          key={chosen.path}
          project={projectName}
          video={chosen}
          initialStyle={captionStyle}
          job={mine}
          busy={(job.running || job.starting) && !mine}
          onTranscribe={() => job.start({ video: chosen.path, ...pack.options, transcribe_only: true })}
          onExport={(settings, style, cuts, transition, look, motion) =>
            startReframe(
              settings,
              {
                ...styleOptions(style),
                ...(style.off ? { no_captions: true } : {}),
                // គ្មានការកាត់ = render វីដេអូទាំងមូលធម្មតា (folder full*); មានការកាត់ = full_edit*
                ...(cuts.length ? { cuts, transition } : {}),
                look, // Background / Tracker -> --fit-* / --no-tracking (លំនាំដើមមិនផ្ញើ flag)
                motion, // Motion -> --motion-* / --caption-animation
              },
              'editor',
            )
          }
          onBack={() => navigate('home')}
        />
      </div>
    )
  }
  if (view === 'whole' && wholeResults.length > 0) {
    return shell(
      'projects',
      <ReviewScreen
        key={`${projectName}:whole`}
        project={projectName}
        clips={wholeClips(wholeResults)}
        media={wholeMedia(projectName, wholeResults, (result) => {
          setReframeResult(result) // "មើល shots": timeline shot និង layout
          setView('reframed')
        })}
        busy={job.running}
        choices={wholeChoices}
        onChoices={(change) => setWholeChoices((current) => ({ ...current, ...change }))}
        onSubtitles={() => {}} // វីដេអូទាំងមូល: គ្មាន "កែ Subtitles" (ប៊ូតុងជា "មើល shots")
        onExported={(result) => {
          setExportResult(result)
          setExportFrom('whole')
          setView('exported')
        }}
        onMore={() => {}}
        onRate={async () => {}}
        onHome={() => navigate('projects')}
      />,
    )
  }
  if (view === 'reframed' && reframeResult) {
    return (
      <div className="flex h-screen bg-bg">
        <ReframeResultScreen
          key={reframeResult.folder + reframeResult.modified}
          project={projectName}
          videoPath={chosen?.path ?? ''}
          result={reframeResult}
          // ទំព័រ shot បើកពី Review វីដេអូទាំងមូល -> ត្រឡប់ទៅទីនោះ
          onBack={wholeResults.length ? () => setView('whole') : undefined}
          onAgain={() => {
            setView('home')
            setReframeOpen(true)
          }}
          onHome={() => navigate('home')}
        />
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
          onBack={() => setView('library')}
          onHome={() => navigate('home')}
        />
      </div>
    )
  }

  // POST /jobs មិនទាន់ឆ្លើយ: នៅលើ screen ទទេ ជាជាងលោតទៅ Import (ពី Subtitles ឬ Review)
  if ((view === 'job' || view === 'reframing') && job.starting) {
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
          clips={exportFrom === 'whole' ? wholeClips(wholeResults) : clips}
          thumbUrl={
            exportFrom === 'whole'
              ? (index) => reframeThumbUrl(projectName, wholeResults[index - 1]?.folder ?? 'full')
              : undefined
          }
          onReview={() => setView(exportFrom === 'whole' ? 'whole' : 'review')}
          onNewProject={() => {
            setChosen(null) // Project ថ្មី = វីដេអូថ្មី: dialog ជំហាន ១
            setView('home')
            setSettingsOpen(true)
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
    // Review នៅក្នុងផ្ទៃមាតិកា (sidebar នៅដដែល) — Projects របស់ខ្ញុំ ជាទំព័រដែលភ្លឺក្នុង sidebar
    return shell(
      'projects',
        <ReviewScreen
          key={projectName}
          project={projectName}
          clips={clips}
          busy={job.running}
          choices={reviewChoices}
          onChoices={changeReview}
          onExported={(result) => {
            setExportResult(result)
            setExportFrom('clips')
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
          // ♡ / 👎: sidecar រក្សាទុក រួចទាញ clips ម្តងទៀត (rating មកជាមួយ clip នីមួយៗ)
          onRate={async (index, rating) => {
            await api.rateClip(projectName, index, rating)
            setClips(await api.clips(projectName))
          }}
          onHome={() => navigate('projects')}
        />,
    )
  }

  // job ដែលគ្មាន status ឬ review ដែលគ្មាន clip = គ្មានអ្វីត្រូវបង្ហាញ -> Projects របស់ខ្ញុំ
  const nothingToShow =
    view === 'job' || view === 'review' || view === 'subtitles' || view === 'exported' ||
    view === 'reframing' || view === 'reframed'
  if (view === 'library' || nothingToShow) {
    return shell(
      'projects',
      <ProjectsScreen
        projects={listed}
        outputDir={health?.output_dir ?? ''}
        onImport={() => {
          // "Import វីដេអូថ្មី" -> ទំព័រដើម (អ្នកអភិវឌ្ឍចង់បាន): ជ្រើសឧបករណ៍មុន រួចទើបវីដេអូ
          setChosen(null)
          navigate('home')
        }}
        onOpen={openProject}
        onAction={projectAction}
        onRename={renameProject}
        onDelete={deleteProject}
        running={running}
      />,
    )
  }
  // ទំព័រ Models ចាស់ (Figma) — បើកពី Settings ឬកាត AI Models
  return shell(
    'tools',
    <div className="min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <Models pack={pack} onPack={(chosenPack) => setPackChoice(chosenPack.id)} />
    </div>,
  )
}

/** project -> វីដេអូដែលជ្រើស: ឈ្មោះ file ពិត ("Table For Four.mp4") ពី path, មិនមែនឈ្មោះ
 *  project ("Table For Four") ទេ — dialog និង Import បង្ហាញឈ្មោះ file. */
function chosenOf(project: Project): Video {
  const file = project.video.split(/[\\/]/).pop()
  return { name: file || project.name, path: project.video, mb: 0 }
}

/** "podcast.mp4" -> "podcast" — ឈ្មោះ folder ក្នុង output/ ដូច `video.stem` ក្នុង Python. */
function stemOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}
