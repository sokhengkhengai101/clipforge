import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, DEFAULT_LOOK, DEFAULT_MOTION, sourceFrameUrl, sourceUrl, type EditorItem, type EditorWords, type JobStatus, type Look, type Motion, type MotionCues, type Video, type VideoFormat, type WholeCue } from '../api'
import { motionAt, motionTransform } from '../motionPreview'
import type { CaptionStyle } from '../captionStyle'
import { SubtitlesIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { TopBar } from '../kit/TopBar'
import { AccountButton } from './AccountButton'
import { useNum, useT } from '../i18n'
import { AspectGlyph, MenuButton, MenuItem } from './Menu'
import { TransformBox } from './TransformBox'
import { PanelResizer } from './PanelResizer'
import { CropDialog } from './CropDialog'
import { LayoutMenu } from './LayoutMenu'
import { ALL_LAYOUTS, layoutFlags, type LayoutChoice, type LayoutId } from './layoutChoice'
import { coverTransform, initialTransform } from '../transformBox'
import { EditorTimeline } from './EditorTimeline'
import { CleanupPanel } from './CleanupPanel'
import { ExtendDialog } from './ExtendDialog'
import { BackgroundMenu, FitBackdrop, TrackerMenu } from './LookMenus'
import { SubjectTrackDialog } from './SubjectTrackDialog'
import { MotionPanel, TransitionPanel } from './MotionPanel'
import { CaptionPanel } from './CaptionPanel'
import { captionTextStyle, emScaleOf, lineMotion, underLayers, useCaptionFonts, useMotionClock, wordColour, wordMotion } from '../captionLook'
import { pathAt, trackAt } from '../subjectPath'
import { displayPosition, isCut, keepPartAt, partOfPosition, removedSeconds, snapToWords, transcriptOrder, type Cut } from '../cutList'
import {
  asParts,
  canLink,
  clipsOrWhole,
  clipsToSave,
  continues,
  cutRanges,
  holes,
  insertCopy,
  isEdited,
  joinNumber,
  linkClips,
  moveClip,
  restoreRange,
  splitClip,
  edgeLimit,
  trimClip,
  type Clip,
} from '../clipList'
import type { ReframeSettings } from './ReframeSetup'
import { ASPECTS, nearestAspect, RATIO, type Aspect } from './aspects'

// ពាក្យក្នុងមួយផ្នែកនៃ transcript — ផ្នែកដែលពាក្យសកម្មមិនប្តូរ មិនគូរឡើងវិញ (វីដេអូ 35 នាទី = 7000 ពាក្យ)
const CHUNK = 80


/** index នៃធាតុដែលកំពុងនិយាយ — binary search (ធាតុតម្រៀបតាមពេល). -1 = គ្មាន. */
function activeIndex(items: EditorItem[], time: number): number {
  let low = 0
  let high = items.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const item = items[middle]
    if (time < item.start) high = middle - 1
    else if (time >= item.end) low = middle + 1
    else return middle
  }
  return -1
}

/** Screen "Edit Video" — រចនាតាម editor របស់ OpusClip (អ្នកអភិវឌ្ឍ 2026-10-25), ផ្នែកទី ២:
 *
 *  ពិត: transcript ពីពាក្យនីមួយៗ (`/projects/{name}/words`) ជាមួយស្លាក pause ពិត, ចុចពាក្យ = វីដេអូលោត,
 *  ពាក្យកំពុងនិយាយ gold, ស្វែងរក; preview វីដេអូដើម (`/source`, អានតែប៉ុណ្ណោះ) ក្នុងប្រអប់ aspect
 *  ជាមួយ caption ប្រហាក់ប្រហែល; Aspect / Layout / Captions; Export = `--full` (render ពិត).
 *  ជំហាន ២ (cut list): ចុចពាក្យ = ជ្រើស (Shift = ច្រើន), Delete = លុប, ចុចពាក្យដែលលុប = ស្តារ,
 *  undo/redo, Speech cleanup, preview រំលងការកាត់ និង zoom punch-in, Export ជាមួយ cuts.
 *  + Extend a clip = ExtendDialog: ស្តារផ្នែកដែលកាត់ (ចេញពី cut list) ឬចម្លងវាជា insert ទៅដើម / playhead / ចុង.
 *  មិនទាន់មាន ទើបបិទ: AI enhance, Brand template, B-roll (Phase 3).
 *  គ្មាន Upgrade / credits — app នេះមិនរាប់អ្វីទេ. */
export function EditorScreen({
  project,
  video,
  initialStyle,
  initialAspect,
  initialPanel,
  job,
  busy,
  onTranscribe,
  onExport,
  onBack,
}: {
  project: string
  video: Video
  initialStyle: CaptionStyle
  initialAspect?: Aspect // ជ្រើសពីម៉ឺនុយទំហំលើ Review
  initialPanel?: 'motion' // Auto zoom លើ Review
  job: JobStatus | null // job --transcribe-only របស់វីដេអូនេះ (null = គ្មាន)
  busy: boolean // job ផ្សេងកំពុងរត់ (GPU តែមួយ)
  onTranscribe: () => void
  onExport: (
    settings: ReframeSettings,
    style: CaptionStyle,
    clips: Clip[] | null, // null = គ្មានការកែ (render វីដេអូទាំងមូល)
    transition: 'punch' | 'hard',
    look: Look,
    motion: Motion,
  ) => void
  onBack: () => void
}) {
  const t = useT()
  const num = useNum()
  // ---- ពាក្យ: សួរម្តង, ហើយម្តងទៀតពេល job transcribe ចប់ ----
  const [words, setWords] = useState<EditorWords | null>(null)
  const jobDone = job?.state === 'done'
  useEffect(() => {
    let stale = false
    api
      .words(project)
      .then((answer) => !stale && setWords(answer))
      .catch(() => !stale && setWords({ name: project, ready: false, items: [] }))
    return () => {
      stale = true
    }
  }, [project, jobDone])

  // មិនទាន់មាន transcript -> transcribe ដោយខ្លួនឯង ម្តងក្នុងមួយការបើក (មិនមែនពេល job ផ្សេងរត់)
  // ref (មិនមែន state): ការចាប់ផ្តើម job ជា side effect — ធ្វើក្នុង effect មិនមែនពេល render
  const asked = useRef(false)
  const needsTranscript = words !== null && !words.ready
  // job ចាស់ដែលចប់ហើយមិនរារាំងទេ: project ដែលបានលុបហើយបើកម្តងទៀត គ្មាន transcript និង waveform រហូត
  const jobRunning = job?.state === 'running'
  useEffect(() => {
    if (!needsTranscript || asked.current || busy || jobRunning) return
    asked.current = true
    onTranscribe()
  }, [needsTranscript, busy, jobRunning, onTranscribe])

  // ---- ទំហំវីដេអូពិត (aspect "ដូចវីដេអូ") ----
  const [format, setFormat] = useState<VideoFormat | null>(null)
  useEffect(() => {
    let stale = false
    api.probe(video.path).then((answer) => !stale && setFormat(answer)).catch(() => {})
    return () => {
      stale = true
    }
  }, [video.path])
  const sourceRatio = format?.width && format?.height ? format.width / format.height : 16 / 9
  const own = nearestAspect(sourceRatio)

  const [aspectChoice, setAspectChoice] = useState<Aspect | null>(initialAspect ?? null)
  const aspect = aspectChoice ?? own
  const [layout, setLayout] = useState<LayoutChoice>('auto')
  // Global layout settings: layout ដែល AI អាចប្រើពេល Auto
  const [allowed, setAllowed] = useState<LayoutId[]>(ALL_LAYOUTS)
  const [cropOpen, setCropOpen] = useState(false)
  const [style, setStyle] = useState<CaptionStyle>(initialStyle)
  // ផ្ទាំងខាងស្តាំ: Captions ឬ Speech cleanup (មួយម្តង)
  const [panel, setPanel] = useState<'captions' | 'cleanup' | 'motion' | 'transition' | null>(initialPanel ?? null)
  const [transitionAt, setTransitionAt] = useState(0) // clip ដែលចាប់ផ្តើមនៅកន្លែងភ្ជាប់ដែលបានចុច
  const [search, setSearch] = useState('')
  // Speech cleanup បិទពេលចុចខាងក្រៅវា. លើកលែង: ប៊ូតុង Speech cleanup (`data-cleanup-toggle`) និងជួរឧបករណ៍
  // ខាងស្តាំ — ប៊ូតុងទាំងនោះបិទ/បើកដោយខ្លួនឯង; បើមិនលើកលែង ចុចម្តងនឹងបិទ រួចបើកវិញភ្លាម — និង dialog.
  const cleanupAside = useRef<HTMLElement>(null)
  const toolsNav = useRef<HTMLElement>(null)
  useEffect(() => {
    if (panel !== 'cleanup') return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target || cleanupAside.current?.contains(target) || toolsNav.current?.contains(target)) return
      if (target.closest('[role="dialog"], [data-cleanup-toggle]')) return
      setPanel(null)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [panel])

  // ---- player ----
  const player = useRef<HTMLVideoElement>(null)
  // ទទឹង preview (px) — ជ្រុងមូល និង blur គិតជា px នៃ output រួចបង្រួមតាមនេះ
  const stage = useRef<HTMLDivElement>(null)
  const motionBox = useRef<HTMLDivElement>(null)
  const [stageWidth, setStageWidth] = useState(0)
  useEffect(() => {
    const node = stage.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const [time, setTime] = useState(0)
  const [length, setLength] = useState(0)
  const [playing, setPlaying] = useState(false)
  // clip ដែល playhead នៅ (លំដាប់ចេញ): ពេលដើមមួយអាចនៅពីរ clip, ដូច្នេះ `time` តែមួយមិនគ្រប់គ្រាន់. -1 = រកតាមពេល.
  // ref: loop ចាក់ (rAF) អានវាដោយមិន restart; state: ម៉ោង និង zoom punch-in
  const [outPart, setOutPart] = useState(-1)
  const outRef = useRef(-1)
  const markPart = (clip: number) => {
    outRef.current = clip
    setOutPart(clip)
  }
  const seek = (seconds: number, clip = -1) => {
    markPart(clip)
    scrubbing.current = false
    if (player.current) player.current.currentTime = seconds
    setTime(seconds)
  }
  // Scrub (អូស ruler): តែវីដេអូ seek — គ្មាន setTime ពេលអូស (timeline បង្ហាញម៉ោងខ្លួនឯង), ដូច្នេះ editor មិន
  // render transcript ទាំងមូលរាល់ចលនាទេ (វីដេអូ 35 នាទី: 90 ចលនា 23.7 s -> 2.4 s). seek រាល់ចលនា: browser
  // រៀបចំវាខ្លួនឯងល្អជាងជួរ "មួយម្តង" (វាស់: Rhino 11-31 frames ធៀប 2-4). លែង = seek() ធម្មតា
  const scrubbing = useRef(false)
  const scrubTo = (seconds: number) => {
    scrubbing.current = true
    if (player.current) player.current.currentTime = seconds
  }

  const items = useMemo(() => words?.items ?? [], [words])
  const active = activeIndex(items, time)

  // ---- cut list (ជំហាន ២): undo = បញ្ជីចាស់ៗ, redo = បញ្ជីដែល undo ----
  // saved = បញ្ជី clip ដែលរក្សាទុក ([] = វីដេអូទាំងមូល); undo / redo រក្សាបញ្ជីនេះ
  const duration = length || words?.duration || 0
  const [saved, setSaved] = useState<Clip[]>([])
  const clips = useMemo(() => clipsOrWhole(saved, duration), [saved, duration])
  const cuts = useMemo(() => holes(clips, duration), [clips, duration]) // ចន្លោះដែលកាត់ (ពាក្យឆូត, ប្រវែងកាត់)
  const [past, setPast] = useState<Clip[][]>([])
  const [future, setFuture] = useState<Clip[][]>([])
  const [transition, setTransition] = useState<'punch' | 'hard'>('punch')
  const [cutsLoaded, setCutsLoaded] = useState(false)

  // ---- autosave: cuts / look / motion ទៅ project.json, ជាមួយស្ថានភាពនៅ top bar ----
  // `lastSaved` = JSON ដែល sidecar មានរួចហើយ (ពេល load ឬ save ជោគជ័យ) — ដូចគ្នា = មិនផ្ញើទេ,
  // ដូច្នេះការបើក editor មិនសរសេរ project.json ទៀត. បរាជ័យ = មិនប្តូរ lastSaved -> retry ផ្ញើម្តងទៀត.
  const lastSaved = useRef<Partial<Record<SaveKey, string>>>({})
  // ច្បាប់ចម្លងជា state សម្រាប់ render: ពេលតម្លៃបច្ចុប្បន្នខុសពីនេះ = មានការកែមិនទាន់រក្សាទុក (រួមទាំង 0.6 s debounce)
  const [savedBodies, setSavedBodies] = useState<Partial<Record<SaveKey, string>>>({})
  const remember = (key: SaveKey, body: string) => {
    lastSaved.current[key] = body
    setSavedBodies((all) => ({ ...all, [key]: body }))
  }
  const [saves, setSaves] = useState<Record<SaveKey, SaveState>>({ cuts: 'idle', look: 'idle', motion: 'idle' })
  const [saveErrors, setSaveErrors] = useState<Partial<Record<SaveKey, string>>>({})
  const [retry, setRetry] = useState(0) // ចុច "សាកម្តងទៀត" = effect រត់ម្តងទៀត
  const saveIfChanged = (key: SaveKey, body: string, send: () => Promise<unknown>) => {
    if (body === lastSaved.current[key]) return
    setSaves((all) => ({ ...all, [key]: 'saving' }))
    send()
      .then(() => {
        remember(key, body)
        setSaves((all) => ({ ...all, [key]: 'saved' }))
        setSaveErrors((all) => ({ ...all, [key]: undefined }))
      })
      .catch((error: Error) => {
        setSaves((all) => ({ ...all, [key]: 'error' }))
        setSaveErrors((all) => ({ ...all, [key]: error.message || t('sidecar មិនឆ្លើយ', 'the sidecar did not answer') }))
      })
  }
  // ref ទៅ function ថ្មីបំផុត — effects ខាងក្រោមមិនចាំបាច់ដាក់វាក្នុង deps (វាប្តូររាល់ render)
  const save = useRef(saveIfChanged)
  useEffect(() => {
    save.current = saveIfChanged
  })

  useEffect(() => {
    let stale = false
    api
      .timeline(project)
      .then((answer) => {
        if (stale) return
        // លំដាប់ key ដូច body ពេល save ({clips, transition}) — JSON ត្រូវដូចបេះបិទទើបមិនផ្ញើ
        const transition: 'punch' | 'hard' = answer.transition === 'hard' ? 'hard' : 'punch'
        remember('cuts', JSON.stringify({ clips: answer.clips, transition }))
        setSaved(answer.clips)
        setTransition(transition)
        setCutsLoaded(true)
      })
      .catch(() => !stale && setCutsLoaded(true))
    return () => {
      stale = true
    }
  }, [project])
  // រក្សាទុកក្នុង project.json (0.6 s ក្រោយការប្តូរចុងក្រោយ) — បើកម្តងទៀត ការលុបនៅដដែល
  useEffect(() => {
    if (!cutsLoaded) return
    const body = { clips: saved, transition }
    const timer = window.setTimeout(() => save.current('cuts', JSON.stringify(body), () => api.saveTimeline(project, body)), 600)
    return () => window.clearTimeout(timer)
  }, [saved, transition, cutsLoaded, project, retry])
  const change = (next: Clip[]) => {
    markPart(-1) // លេខ clip ប្តូរ
    setPast((list) => [...list, saved].slice(-100))
    setFuture([])
    setSaved(clipsToSave(next, duration))
  }
  const undo = () => {
    if (!past.length) return
    setFuture((list) => [saved, ...list])
    markPart(-1)
    setSaved(past[past.length - 1])
    setPast((list) => list.slice(0, -1))
    setBlockSel(null)
  }
  const redo = () => {
    if (!future.length) return
    setPast((list) => [...list, saved])
    markPart(-1)
    setSaved(future[0])
    setFuture((list) => list.slice(1))
    setBlockSel(null)
  }

  // ---- Background / Tracker (look): រក្សាទុកក្នុង project.json ដូច cuts ----
  const [look, setLook] = useState<Look>(DEFAULT_LOOK)
  const [lookLoaded, setLookLoaded] = useState(false)
  useEffect(() => {
    let stale = false
    api
      .look(project)
      .then((answer) => {
        if (stale) return
        const loaded = lookOf(answer)
        remember('look', JSON.stringify(loaded))
        setLook(loaded)
        setLookLoaded(true)
      })
      .catch(() => !stale && setLookLoaded(true))
    return () => {
      stale = true
    }
  }, [project])
  useEffect(() => {
    if (!lookLoaded) return
    const timer = window.setTimeout(() => {
      save.current('look', JSON.stringify(look), () =>
        api
          .saveLook(project, look)
          // រូបត្រូវចម្លងចូល output/<name>/ — យក path ច្បាប់ចម្លងមកវិញ (រក្សាទុកលើកក្រោយមិនចម្លងទៀត)
          .then((saved) => saved.image !== look.image && setLook((current) => ({ ...current, image: saved.image }))),
      )
    }, 600)
    return () => window.clearTimeout(timer)
  }, [look, lookLoaded, project, retry])
  const changeLook = (patch: Partial<Look>) => setLook((current) => ({ ...current, ...patch }))
  // Transform video: ប្រអប់ដែលជ្រើស (handles + toolbar) — look.transform != null = Custom
  // ទទឹង transcript ដែលអ្នកប្រើអូស (px), រក្សាទុកសម្រាប់លើកក្រោយ; null = ទំហំដើម
  const editorRow = useRef<HTMLDivElement>(null)
  const transcriptPanel = useRef<HTMLElement>(null)
  const previewPanel = useRef<HTMLElement>(null)
  const [transcriptWidth, setTranscriptWidth] = useState<number | null>(loadTranscriptWidth)
  const [boxSelected, setBoxSelected] = useState(true) // ជ្រើសតាំងពីបើក editor (ដូច OpusClip)
  // element ពីលើ preview ដែល TransformBox ដាក់ handles (callback ref = state ដើម្បី render ឡើងវិញ)
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null)
  const [trackOpen, setTrackOpen] = useState(false) // dialog Manual subject tracking
  const [extendOpen, setExtendOpen] = useState(false) // dialog + Extend a clip

  // ---- cue ពិតនៃវីដេអូទាំងមូល (captions.py): បន្ទាត់ និងពាក្យសំខាន់ដូច render ----
  const [wholeCues, setWholeCues] = useState<WholeCue[]>([])
  const cuesReady = words?.ready ?? false
  useEffect(() => {
    if (!cuesReady) return
    let stale = false
    api
      .wholeCues(project, style.words, style.lines)
      .then((answer) => !stale && setWholeCues(answer.cues))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [project, cuesReady, style.words, style.lines])

  // ---- Filter (រូប funnel): អ្វីដែល transcript បង្ហាញ — មិនប្តូរការកាត់ទេ ----
  const [view, setView] = useState({ pauses: true, fillers: false, hideCut: true })
  // ពាក្យ filler (um, uh, "you know" ...) ពី /cleanup — ច្បាប់ដដែលនឹង Speech cleanup; ទាញតែពេលបើក
  const [fillerSpans, setFillerSpans] = useState<[number, number][]>([])
  useEffect(() => {
    if (!view.fillers || !cuesReady) return
    let stale = false
    api
      .cleanup(project, 10, true) // pause 10 s = ស្ទើរគ្មាន pause; យកតែ filler
      .then((answer) => {
        if (stale) return
        setFillerSpans(answer.suggestions.filter((item) => item.reason === 'filler').map((item): [number, number] => [item.start, item.end]))
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [view.fillers, cuesReady, project])
  // មួយតួក្នុងមួយធាតុ: 'f' = filler — ដូច flags / keywordMarks (memo របស់ Chunk ប្រៀបធៀបខ្សែ)
  const fillerMarks = useMemo(() => {
    if (!view.fillers || !fillerSpans.length) return ''
    return items
      .map((item) => {
        const mid = (item.start + item.end) / 2
        return 'word' in item && fillerSpans.some(([a, b]) => mid >= a && mid <= b) ? 'f' : '-'
      })
      .join('')
  }, [items, fillerSpans, view.fillers])

  // ---- ⬇ ទាញយក transcript (TXT / SRT) ទៅ folder Export ----
  const [savedFile, setSavedFile] = useState<{ path: string; error?: string } | null>(null)
  const downloadTranscript = (format: 'txt' | 'srt') => {
    setSavedFile(null)
    api
      .exportTranscript(project, { format, clips: isEdited(clips, duration) ? clips : [] })
      .then((answer) => setSavedFile({ path: answer.path }))
      .catch((error: Error) => setSavedFile({ path: '', error: error.message }))
  }

  // ---- AI keywords highlighter ក្នុង transcript: ពាក្យដែល render នឹងបំលេច, ពណ៌ទី ១ / ២ ឆ្លាស់តាម cue ----
  // មួយតួក្នុងមួយធាតុ ('1' / '2' / '-'), ដូច flags: Chunk ទទួល slice ជាខ្សែ ដូច្នេះ memo នៅតែដំណើរការ.
  // ផ្គូផ្គងដោយ**ចំណុចកណ្តាល**ពាក្យ ព្រោះ word_intervals ពង្រីកពេលពាក្យក្នុង cue (start មិនដូចបេះបិទ).
  const keywordMarks = useMemo(() => {
    if (!style.keywords || !wholeCues.length) return ''
    const spans: [number, number, string][] = [] // [start, end, '1'|'2'] តាមលំដាប់ពេល
    wholeCues.forEach((cue, index) => {
      for (const word of cue.lines.flat()) if (word.keyword) spans.push([word.start, word.end, index % 2 ? '2' : '1'])
    })
    return items
      .map((item) => {
        if (!('word' in item) || !spans.length) return '-'
        const mid = (item.start + item.end) / 2
        // binary search: span ចុងក្រោយដែល start <= mid
        let low = 0
        let high = spans.length - 1
        while (low < high) {
          const middle = (low + high + 1) >> 1
          if (spans[middle][0] <= mid) low = middle
          else high = middle - 1
        }
        const [start, end, mark] = spans[low]
        return start <= mid && mid < end ? mark : '-'
      })
      .join('')
  }, [items, wholeCues, style.keywords])

  // ---- Motion: រក្សាទុកក្នុង project.json ដូច look; preview ត្រូវការពេលពាក្យសំខាន់ + សំឡេងខ្លាំង ----
  const [motion, setMotion] = useState<Motion>(DEFAULT_MOTION)
  const [motionLoaded, setMotionLoaded] = useState(false)
  useEffect(() => {
    let stale = false
    api
      .motion(project)
      .then((answer) => {
        if (stale) return
        const { zoom, zoom_amount, keywords, shake, animation } = { ...DEFAULT_MOTION, ...answer }
        remember('motion', JSON.stringify({ zoom, zoom_amount, keywords, shake, animation }))
        setMotion({ zoom, zoom_amount, keywords, shake, animation })
        // Animation នៅ Captions › Effects ឥឡូវ: motion ចាស់ដែលមាន animation ប្រគល់វាឲ្យ style ម្តង
        if (animation !== 'pop') setStyle((current) => (current.animation === 'pop' ? { ...current, animation } : current))
        setMotionLoaded(true)
      })
      .catch(() => !stale && setMotionLoaded(true))
    return () => {
      stale = true
    }
  }, [project])
  useEffect(() => {
    if (!motionLoaded) return
    // animation មកពី caption style (Captions › Effects) — project.json មិនទុកតម្លៃចាស់ទេ
    const body = { ...motion, animation: style.animation }
    const timer = window.setTimeout(() => save.current('motion', JSON.stringify(body), () => api.saveMotion(project, body)), 600)
    return () => window.clearTimeout(timer)
  }, [motion, motionLoaded, project, style.animation, retry])
  const [motionCues, setMotionCues] = useState<MotionCues | null>(null)
  const wordsReady = words?.ready ?? false
  useEffect(() => {
    if (!wordsReady) return
    let stale = false
    api
      .motionCues(project)
      .then((answer) => !stale && setMotionCues(answer))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [project, wordsReady])

  // scene របស់វីដេអូដើម — "បិទ tracking សម្រាប់ scene នេះ" យក scene នៅ playhead
  const [scenes, setScenes] = useState<[number, number][]>([])
  useEffect(() => {
    let stale = false
    api
      .scenes(video.path)
      .then((answer) => !stale && setScenes(answer.scenes))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [video.path])

  const parts = useMemo(() => asParts(clips), [clips])
  const edited = isEdited(clips, duration)
  // transcript ជារបស់ timeline: ពាក្យតាមលំដាប់ប្លុក, ពាក្យដែលកាត់បាត់ (Filter បង្ហាញវាវិញ). `display` = index ក្នុង items
  const display = useMemo(
    () => (edited && duration > 0 ? transcriptOrder(items, parts, !view.hideCut) : items.map((_, index) => index)),
    [edited, duration, items, parts, view.hideCut],
  )
  const chunks = useMemo(() => {
    const out: { items: EditorItem[]; indices: number[] }[] = []
    for (let at = 0; at < display.length; at += CHUNK) {
      const indices = display.slice(at, at + CHUNK)
      out.push({ indices, items: indices.map((index) => items[index]) })
    }
    return out
  }, [display, items])
  const needle = search.trim().toLowerCase()
  // index នៃពាក្យដែលត្រូវនឹងការស្វែងរក (តាមលំដាប់ក្នុង transcript; ពាក្យដែលកាត់មិនរាប់ពេលវាលាក់)
  const hitList = useMemo(() => {
    if (!needle) return []
    return display.filter((index) => {
      const item = items[index]
      return 'word' in item && item.word.toLowerCase().includes(needle)
    })
  }, [display, items, needle])
  const hits = hitList.length
  // លទ្ធផលបច្ចុប្បន្ន (Enter / ↓ = បន្ទាប់, Shift+Enter / ↑ = មុន). ភ្ជាប់ជាមួយ needle: ពាក្យស្វែងរកថ្មី = ចាប់ពីដើម
  const [hitCursor, setHitCursor] = useState({ needle: '', at: -1 })
  const hitAt = hitCursor.needle === needle && hitCursor.at < hits ? hitCursor.at : -1
  const currentHit = hitAt >= 0 ? hitList[hitAt] : -1
  // ការជ្រើស: [index ដំបូង, index ចុងក្រោយ] ក្នុង items (Shift+ចុច ពង្រីក)
  const [selection, setSelection] = useState<[number, number] | null>(null)
  // ពាក្យដែលជ្រើស = ពីណាដល់ណាក្នុង **transcript** (លំដាប់ timeline), មិនមែនតាមពេលទេ: ជ្រើសឆ្លងប្លុកមិនប៉ះពាក្យក្នុងប្លុកផ្សេង
  const picked = useMemo(() => {
    if (!selection) return null
    const a = display.indexOf(selection[0])
    const b = display.indexOf(selection[1])
    if (a < 0 || b < 0) return null
    return display.slice(Math.min(a, b), Math.max(a, b) + 1)
  }, [selection, display])
  const onItem = (index: number, shift: boolean, position: number) => {
    const item = items[index]
    if (isCut(cuts, item.start, item.end)) {
      // ចុចលើអ្វីដែលបានលុប = ស្តារវាវិញ
      change(restoreRange(clips, [item.start, item.end], duration))
      setSelection(null)
      return
    }
    setSelection(shift && selection ? [selection[0], index] : [index, index])
    seek(item.start, partOfPosition(items, display, parts, position)) // ច្បាប់ដែលចុច មិនមែនច្បាប់ទីមួយជានិច្ច
  }
  const deleteSelection = () => {
    if (!picked) return
    change(cutRanges(clips, picked.map((index): Cut => [items[index].start, items[index].end])))
    setSelection(null)
    setBlockSel(null)
  }

  // ---- timeline: Split / ជ្រើសផ្នែក / លុប-ស្តារ / Trim ----
  const spoken = useMemo(() => items.filter((item) => 'word' in item), [items])
  // clip ដែលជ្រើសលើ timeline: [ទីមួយ, ចុងក្រោយ] តាមលំដាប់ក្នុងបញ្ជី (ចុច = មួយ; ចតុកោណអូស = ច្រើន)
  const [blockSel, setBlockSel] = useState<[number, number] | null>(null)
  const selected = blockSel && blockSel[1] < clips.length ? blockSel : null
  const linkable = selected !== null && canLink(clips, selected)
  // Link: clip ដែលបន្តពីគ្នាក្នុងការជ្រើសក្លាយជាមួយ (undo មួយជំហាន)
  const linkParts = () => {
    if (!selected || !linkable) return
    change(linkClips(clips, selected))
    setBlockSel([selected[0], selected[0]])
  }
  // Snap (ប៊ូតុងមេដែកលើ timeline): បើក = Split / trim ‖ / handles ក្នុង Extend ជាប់គែមពាក្យ (snapToWords),
  // បិទ = ចំណុចពិត. Alt ធ្វើផ្ទុយពី Snap សម្រាប់សកម្មភាពមួយ. ចងចាំលើកុំព្យូទ័រនេះ.
  const [snap, setSnap] = useState<boolean>(loadSnap)
  const snapped = (at: number, alt: boolean) => (snap !== alt ? snapToWords(at, spoken) : at)
  // Speaker: កម្រិតសំឡេង preview 0-100 ប៉ុណ្ណោះ — វីដេអូដែល Export មិនប្តូរទេ. មិនមែន state: ផ្ទាំង 🔊
  // កំណត់ video.volume ផ្ទាល់ (អូស slider មិន render editor ទាំងមូល); ចងចាំលើកុំព្យូទ័រនេះ
  const [initialVolume] = useState(loadVolume)
  const setVolume = (volume: number) => {
    applyVolume(player.current, volume)
    saveVolume(volume)
  }
  useEffect(() => applyVolume(player.current, initialVolume), [initialVolume])
  // Split នៅ playhead (Snap = ចេញពីកណ្តាលពាក្យ; Alt = ផ្ទុយ)
  const splitAt = (alt: boolean) => splitClip(clips, snapped(time, alt), outPart)
  const splitHere = (alt: boolean) => {
    const done = duration ? splitAt(alt) : null
    if (!done) return
    change(done.clips)
    setBlockSel([done.index + 1, done.index + 1])
  }
  // លុប clip ដែលជ្រើស — វីដេអូត្រូវមានអ្វីមួយនៅសល់
  const deletable = selected !== null && selected[1] - selected[0] + 1 < clips.length
  const togglePart = () => {
    if (!selected || !deletable) return
    change(clips.filter((_, index) => index < selected[0] || index > selected[1]))
    setBlockSel(null)
  }

  // keyboard: Space = ចាក់/ផ្អាក, Delete/Backspace លុប (ពាក្យដែលជ្រើស, បើគ្មាន = ផ្នែក timeline),
  // S = Split (Alt+S = ចំណុចពិត), Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo, Escape ដកការជ្រើស
  const togglePlay = () => {
    const node = player.current
    if (!node) return
    // ចប់វីដេអូដែល Export ហើយ ចុច Play = ពីដើមវិញ (ប្លុកទីមួយ មិនមែនវិនាទីទី 0)
    if (node.paused && edited && parts.length && parts[parts.length - 1].end - node.currentTime < 0.1) seek(parts[0].start)
    if (node.paused) void node.play()
    else node.pause()
  }
  const keys = useRef({ deleteSelection, undo, redo, splitHere, togglePart, togglePlay, hasWords: false })
  useEffect(() => {
    keys.current = { deleteSelection, undo, redo, splitHere, togglePart, togglePlay, hasWords: picked !== null }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!editorOwnsKey(event)) return
      const ctrl = event.ctrlKey || event.metaKey
      if (event.code === 'Space' && !ctrl && !event.altKey) {
        // ប៊ូតុងពិត (<button>) យក Space ទៅចុចខ្លួនឯង — កុំឲ្យវាចុច ហើយចាក់វីដេអូផងក្នុងពេលតែមួយ
        if (event.target instanceof HTMLButtonElement) return
        event.preventDefault() // កុំឲ្យទំព័ររំកិល
        keys.current.togglePlay()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (keys.current.hasWords) keys.current.deleteSelection()
        else keys.current.togglePart()
      } else if (!ctrl && event.code === 'KeyS') {
        // event.code (មិនមែន key): Alt+S នៅលើ keyboard ខ្លះផ្តល់តួអក្សរផ្សេង ឬ layout ខ្មែរ
        event.preventDefault()
        keys.current.splitHere(event.altKey)
      } else if (ctrl && (event.key === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault()
        keys.current.redo()
      } else if (ctrl && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        keys.current.undo()
      } else if (event.key === 'Escape') {
        setSelection(null)
        setBlockSel(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // preview: ចាក់តាម parts របស់វីដេអូដែល Export (ដូច pipeline `cuts.sequence`) — រំលងការកាត់ ហើយលោតទៅ
  // ផ្នែកដែលបន្ថែម នៅពេល `at` របស់វា, រួចត្រឡប់មកវិញ. រាល់ frame (rAF), មិនមែន timeupdate (~4 ដង/វិនាទី).
  // បើក project ដែលបានប្តូរលំដាប់: ចាប់ផ្តើមពីប្លុកទីមួយលើ timeline (ម្តងប៉ុណ្ណោះ)
  const placedAtStart = useRef(false)
  useEffect(() => {
    if (placedAtStart.current || !cutsLoaded || !length) return
    placedAtStart.current = true
    if (!edited || !parts.length || !player.current || player.current.currentTime > 0.05) return
    player.current.currentTime = parts[0].start // onTimeUpdate ធ្វើឲ្យ `time` តាម
  }, [cutsLoaded, length, edited, parts])
  useEffect(() => {
    if (!playing || !edited) return
    let frame = 0
    let current = -1
    // ពេល seek ទៅ part ថ្មី currentTime ជារឿយៗមិនទាន់ arrive ក្នុង frame បន្ទាប់ (async) ⇒ reset
    // condition ច្រើនជានេះ fire ឡើងវិញ ហើយ loop ចាប់ផ្ដើម seek ជ្រែក. `seekTarget` ស្ទប់វា
    // រហូតដល់ currentTime ជិត target (≤ 0.5 s) ហើយ reset condition ផ្ញើ current ត្រឡប់ part ចាស់.
    let seekTarget = -1
    const tick = () => {
      const node = player.current
      if (node && parts.length) {
        const at = node.currentTime
        // ចាំ seek ចូលដល់: currentTime ដាច់ឆ្ងាយពី target = browser នៅតែ seek
        if (seekTarget >= 0) {
          if (Math.abs(at - seekTarget) > 0.5) {
            frame = requestAnimationFrame(tick)
            return
          }
          seekTarget = -1
        }
        if (outRef.current !== current) current = outRef.current // អ្នកប្រើលោតទៅ clip ផ្សេង
        const here = parts[current]
        if (!here || at < here.start - 0.3 || at > here.end + 0.3) {
          // ចាប់ផ្តើមចាក់ ឬអ្នកប្រើលោត: ពីដើមវីដេអូ hook ចាក់មុន; ផ្សេងពីនេះ = ផ្នែករក្សានៅទីនោះ
          current = keepPartAt(parts, at)
          markPart(current)
          if (current < 0) node.pause()
          else if (at < parts[current].start) {
            seekTarget = parts[current].start
            node.currentTime = seekTarget
          }
        } else if (at >= here.end - 0.04) {
          current += 1
          if (current >= parts.length) {
            node.pause()
            current = -1
          } else if (Math.abs(parts[current].start - here.end) > 0.002) {
            // clip បន្តពីមុនតាមពេល (Split) = ចាក់បន្ត, គ្មាន seek
            seekTarget = parts[current].start
            node.currentTime = seekTarget
          }
          markPart(current)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, parts, edited])


  // Motion preview: ពេលចាក់ គណនារាល់ frame (rAF) ហើយសរសេរ transform ផ្ទាល់ (មិនមែន state — 60 ដង/វិនាទី
  // នឹង render React ទាំងមូល); ពេលផ្អាក/រំកិល គណនាម្តងតាម `time`
  useEffect(() => {
    const box = motionBox.current
    if (!box) return
    const apply = (at: number) => {
      const frame = motionAt(at, motion, scenes, motionCues)
      box.style.transform = frame.z === 1 && frame.dx === 0 && frame.dy === 0 ? '' : motionTransform(frame)
    }
    if (!playing) {
      apply(time)
      return
    }
    let handle = 0
    const tick = () => {
      apply(player.current?.currentTime ?? 0)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [motion, scenes, motionCues, playing, time])
  const removed = removedSeconds(cuts, duration)
  // zoom punch-in ក្នុង preview: part លេខសេសតាមលំដាប់ចេញ = 110% (ដូច render `cut_filter`)
  const shownPart = parts[outPart] && time >= parts[outPart].start && time <= parts[outPart].end ? outPart : keepPartAt(parts, time)
  const punched = transition === 'punch' && edited && shownPart >= 0 && joinNumber(clips, shownPart) % 2 === 1
  // ពាក្យដែលកំពុងនិយាយ = តែច្បាប់នៅក្នុង part ដែលកំពុងចាក់ (ពាក្យក្នុង HOOK លេចពីរដងក្នុង transcript)
  const activePos = useMemo(() => displayPosition(items, display, parts, active, shownPart), [items, display, parts, active, shownPart])

  // ពាក្យសកម្មនៅក្នុងទិដ្ឋភាព — ពេលចាក់ និងពេលផ្អាកដែរ (ឧ. ចុចលើ timeline ឬ ⏭ = transcript រំកិលទៅពាក្យនោះ).
  // block nearest = មិនលោតបើវាឃើញរួច; ពាក្យសកម្មមិនប្តូរ = មិនរំកិល ទោះអ្នកប្រើកំពុងអានកន្លែងផ្សេង
  const transcriptBox = useRef<HTMLDivElement>(null)
  const showItem = (index: number) =>
    transcriptBox.current?.querySelector(`[data-at="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  useEffect(() => {
    if (activePos < 0) return
    // ស្វែងរកធាតុ ~25 ខាងមុខ (≈4 បន្ទាត់) ហើយ scroll ទៅ block:'end'
    // ដូចនេះ ពាក្យដែលកំពុងនិយាយតែងតែមាន 4 បន្ទាត់បន្ថែមក្រោម
    const lookEl = transcriptBox.current?.querySelector(`[data-pos="${activePos + 25}"]`)
    if (lookEl) {
      lookEl.scrollIntoView({ block: 'end' })
    } else {
      transcriptBox.current?.querySelector(`[data-pos="${activePos}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [activePos])

  // ← / → ក្នុង transcript: ជ្រើសពាក្យមុន / បន្ទាប់ (Shift = ពង្រីកការជ្រើស), វីដេអូលោតទៅពាក្យនោះ.
  // រំលងធាតុដែលមិនបង្ហាញ (pause ពេលបិទ, ពាក្យដែលលុបពេល "លាក់ពាក្យដែលលុប").
  const stepAt = useRef(-1) // ទីតាំងក្នុង `display` (ពាក្យក្នុង HOOK លេចពីរដង: indexOf នឹងត្រឡប់ទៅកន្លែងទីមួយជានិច្ច)
  const stepSelection = (delta: 1 | -1, extend: boolean) => {
    if (!display.length) return
    const current = selection ? selection[1] : active
    const from = current >= 0 ? (display[stepAt.current] === current ? stepAt.current : display.indexOf(current)) : -1
    // គ្មានការជ្រើស: ចុចដំបូងជ្រើសពាក្យដែលកំពុងនិយាយ (ឬពាក្យដំបូង / ចុងក្រោយ)
    let next = selection ? from + delta : from >= 0 ? from : delta > 0 ? 0 : display.length - 1
    while (next >= 0 && next < display.length && 'pause' in items[display[next]] && !view.pauses) next += delta
    if (next < 0 || next >= display.length) return
    stepAt.current = next
    const index = display[next]
    setSelection(extend && selection ? [selection[0], index] : [index, index])
    seek(items[index].start, partOfPosition(items, display, parts, next))
    transcriptBox.current?.querySelector(`[data-pos="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  // លទ្ធផលស្វែងរកបន្ទាប់ / មុន (វិលជុំ)
  const stepHit = (delta: 1 | -1) => {
    if (!hits) return
    const at = hitAt < 0 ? (delta > 0 ? 0 : hits - 1) : (hitAt + delta + hits) % hits
    setHitCursor({ needle, at })
    seek(items[hitList[at]].start)
    showItem(hitList[at])
  }

  const reframe = aspect !== own
  const scene = scenes.find(([start, end]) => time >= start && time < end) ?? null

  // ---- preview Fit: ផ្ទៃខាងក្រោយ + spacing + ជ្រុងមូល (ទំហំគណនាដូច render.fit_foreground_size) ----
  const custom = look.transform !== null
  const fitPreview = layout === 'fit' && reframe && !custom
  // Manual subject tracking ក្នុង preview: crop កណ្តាលរំកិលតាមផ្លូវ (object-position ដូច x របស់ render)
  const subject = reframe && !fitPreview && !custom ? trackAt(look.subjects, time) : null
  const followX = (() => {
    if (!subject || !format?.width || !format.height || sourceRatio <= RATIO[aspect]) return null
    const cropWidth = format.height * RATIO[aspect]
    const [cx] = pathAt(subject, time)
    const left = Math.min(Math.max(0, cx - cropWidth / 2), format.width - cropWidth)
    return (left / (format.width - cropWidth)) * 100
  })()
  const outWidth = aspect === '16:9' ? 1920 : 1080
  const previewScale = stageWidth / outWidth
  const room = 1 - (2 * look.spacing) / 100
  const wide = sourceRatio >= RATIO[aspect] // វីដេអូធាត់ជាងផ្ទាំង = ទទឹងកំណត់
  const fitStyle = {
    width: `${(wide ? room : (room * sourceRatio) / RATIO[aspect]) * 100}%`,
    height: `${(wide ? (room * RATIO[aspect]) / sourceRatio : room) * 100}%`,
    left: '50%',
    top: '50%',
    borderRadius: look.radius * previewScale,
    transform: `translate(-50%, -50%)${punched ? ' scale(1.1)' : ''}`,
  }
  // មានការកែមិនទាន់រក្សាទុក: JSON បច្ចុប្បន្នខុសពីអ្វីដែល sidecar មាន (តែ key ដែល load រួច)
  const differs = (key: SaveKey, body: unknown) => savedBodies[key] !== undefined && JSON.stringify(body) !== savedBodies[key]
  const unsaved =
    differs('cuts', { clips: saved, transition }) || differs('look', look) || differs('motion', { ...motion, animation: style.animation })
  const exportSettings: ReframeSettings = {
    aspect,
    // ទំហំដូចវីដេអូ = frame ទាំងមូល (center គ្មានកាត់); aspect ផ្សេង = AI reframe តាម layout ដែលជ្រើស
    layouts: reframe ? layoutFlags(layout, allowed) : [],
    captions: !style.off,
    tool: 'Edit Video',
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      <TopBar crumb={`${video.name} · Edit Video`} onHome={onBack}>
        <span className="flex items-center gap-1">
          <SaveStatus
            pending={unsaved}
            states={Object.values(saves)}
            errors={Object.values(saveErrors).filter((message): message is string => Boolean(message))}
            onRetry={() => setRetry((count) => count + 1)}
          />
          <ControlButton label="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}>↶</ControlButton>
          <ControlButton label="Redo (Ctrl+Y)" disabled={!future.length} onClick={redo}>↷</ControlButton>
          {/* CC: បិទ/បើក captions ភ្លាមៗ (ដូច preset "គ្មាន captions") — style ផ្សេងៗនៅដដែល */}
          <button
            type="button"
            aria-pressed={!style.off}
            aria-label={style.off ? 'Captions: OFF' : 'Captions: ON'}
            title={style.off ? t('Captions បិទ — ចុចដើម្បីបើក', 'Captions off — click to turn on') : t('Captions បើក — ចុចដើម្បីបិទ (Export គ្មាន captions)', 'Captions on — click to turn off (export without captions)')}
            onClick={() => setStyle((current) => ({ ...current, off: !current.off }))}
            className={`ml-1 inline-flex h-7 min-w-9 cursor-pointer items-center justify-center rounded-[6px] border-2 px-1 text-[11px] font-extrabold ${
              style.off ? 'border-text-4 bg-transparent text-text-4 line-through' : 'border-text bg-text text-bg'
            } ${focusRing}`}
          >
            CC
          </button>
        </span>
        <button
          type="button"
          disabled={!words?.ready || busy}
          onClick={() => onExport(exportSettings, style, edited ? clips : null, transition, look, { ...motion, animation: style.animation })}
          title={busy ? t('មាន job កំពុងរត់', 'A job is running') : !words?.ready ? t('រង់ចាំ transcript', 'Waiting for the transcript') : `${t('វីដេអូទាំងមូល', 'Whole video')} · ${aspect}${cuts.length ? ` · ${t('កាត់', 'cuts')} ${num(cuts.length)}` : ''}`}
          className={`min-h-10 cursor-pointer rounded-button border-0 bg-white px-5 type-body font-bold text-bg disabled:cursor-default disabled:opacity-40 ${focusRing}`}
        >
          Export
        </button>
        <AccountButton />
      </TopBar>

      <div ref={editorRow} className="flex min-h-0 flex-1">
        {/* ---- transcript (ខាងឆ្វេង) — ទទឹងប្តូរបានដោយ PanelResizer; null = ទំហំដើម.
            `shrink` + min-w: ពេលផ្ទាំងខាងស្តាំបើកលើអេក្រង់តូច transcript បង្រួមខ្លួន មិនមែន preview ទេ
            (វាស់ 1100x700 + Captions: preview ធ្លាប់នៅសល់ 122x11 px) ---- */}
        <section
          ref={transcriptPanel}
          aria-label="Transcript"
          className={`flex min-w-[280px] shrink flex-col ${transcriptWidth === null ? 'w-[46%] max-w-[640px]' : ''}`}
          style={transcriptWidth === null ? undefined : { width: transcriptWidth }}
        >
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-4 pb-3">
            <button
              type="button"
              aria-pressed={panel === 'cleanup'}
              data-cleanup-toggle
              disabled={!words?.ready}
              onClick={() => setPanel((value) => (value === 'cleanup' ? null : 'cleanup'))}
              title={t('ស្នើ pause វែង និងពាក្យ "អឺ" ដើម្បីលុប', 'Suggest long pauses and filler words to remove')}
              className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-button border-0 px-3.5 type-label font-semibold disabled:cursor-default disabled:opacity-40 ${
                panel === 'cleanup' ? 'bg-gold-tint text-gold' : 'bg-field text-text hover:bg-raised-2'
              } ${focusRing}`}
            >
              ✎ Speech cleanup
            </button>
            {picked && (
              <button
                type="button"
                onClick={deleteSelection}
                className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-button border-0 bg-danger/20 px-3 type-label font-semibold text-danger hover:bg-danger/30 ${focusRing}`}
              >
                🗑 {t('លុប', 'Delete')} ({num(picked.length)})
              </button>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              <MenuButton label="Filter" icon={<span aria-hidden="true">⏷</span>} menuLabel="Filter transcript" width={260}>
                {() => (
                  <>
                    <MenuItem checked={view.pauses} onClick={() => setView((v) => ({ ...v, pauses: !v.pauses }))}>
                      {t('បង្ហាញ pause (0.46s)', 'Show pauses (0.46s)')}
                    </MenuItem>
                    <MenuItem checked={view.fillers} onClick={() => setView((v) => ({ ...v, fillers: !v.fillers }))}>
                      {t('បំលេចពាក្យ filler (um, you know)', 'Mark filler words (um, you know)')}
                    </MenuItem>
                    <MenuItem checked={view.hideCut} onClick={() => setView((v) => ({ ...v, hideCut: !v.hideCut }))}>
                      {t('លាក់ពាក្យដែលលុប', 'Hide deleted words')}
                    </MenuItem>
                  </>
                )}
              </MenuButton>
              <MenuButton label="Transcript" icon={<span aria-hidden="true">⬇</span>} menuLabel={t('ទាញយក transcript', 'Download transcript')} width={300}>
                {(close) => (
                  <>
                    <MenuItem
                      checked={false}
                      disabled={!words?.ready}
                      onClick={() => {
                        close()
                        downloadTranscript('txt')
                      }}
                    >
                      {t('TXT — អត្ថបទ', 'TXT — plain text')}
                    </MenuItem>
                    <MenuItem
                      checked={false}
                      disabled={!words?.ready}
                      onClick={() => {
                        close()
                        downloadTranscript('srt')
                      }}
                    >
                      SRT — subtitles
                    </MenuItem>
                    <p className="m-0 px-3 pt-1 pb-2 type-hint text-text-4">
                      {t(
                        'ដូចវីដេអូដែល Export: ពាក្យដែលលុបត្រូវដក ហើយពេលក្នុង SRT តាមវីដេអូដែលកាត់. រក្សាទុកក្នុង folder Export.',
                        'As the exported video: deleted words are left out and SRT times follow the cut video. Saved in the Export folder.',
                      )}
                    </p>
                  </>
                )}
              </MenuButton>
            </span>
            <label className="flex min-h-10 items-center gap-2 rounded-button bg-field px-3 text-text-3">
              🔍
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  // Enter / ↓ = លទ្ធផលបន្ទាប់, Shift+Enter / ↑ = មុន
                  const delta = event.key === 'ArrowDown' || (event.key === 'Enter' && !event.shiftKey) ? 1 : event.key === 'ArrowUp' || event.key === 'Enter' ? -1 : 0
                  if (!delta) return
                  event.preventDefault()
                  stepHit(delta)
                }}
                placeholder={t('ស្វែងរកពាក្យ', 'Search words')}
                aria-label={t('ស្វែងរកពាក្យ', 'Search words')}
                className="w-36 border-0 bg-transparent type-label text-text outline-none placeholder:text-text-4"
              />
              {needle && (
                <span className="flex items-center gap-0.5">
                  <span className="type-hint tabular-nums" aria-live="polite">
                    {hitAt >= 0 ? `${num(hitAt + 1)}/${num(hits)}` : num(hits)}
                  </span>
                  <SearchStep label={t('លទ្ធផលមុន (Shift+Enter)', 'Previous match (Shift+Enter)')} disabled={!hits} onClick={() => stepHit(-1)}>
                    ˄
                  </SearchStep>
                  <SearchStep label={t('លទ្ធផលបន្ទាប់ (Enter)', 'Next match (Enter)')} disabled={!hits} onClick={() => stepHit(1)}>
                    ˅
                  </SearchStep>
                </span>
              )}
            </label>
          </div>
          {savedFile && (
            <p role="status" className="m-0 flex shrink-0 items-center gap-2 px-5 pb-2 type-hint">
              {savedFile.error ? (
                <span className="text-danger">{savedFile.error}</span>
              ) : (
                <>
                  <span className="min-w-0 truncate text-ok" title={savedFile.path}>
                    ✓ {savedFile.path}
                  </span>
                  <button
                    type="button"
                    onClick={() => void api.reveal(savedFile.path).catch(() => {})}
                    className={`shrink-0 cursor-pointer rounded-field border-0 bg-transparent px-1.5 text-text-3 underline hover:text-text ${focusRing}`}
                  >
                    {t('បើក folder', 'Open folder')}
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label={t('បិទ', 'Close')}
                onClick={() => setSavedFile(null)}
                className={`ml-auto shrink-0 cursor-pointer rounded-field border-0 bg-transparent px-1.5 text-text-4 hover:text-text ${focusRing}`}
              >
                ✕
              </button>
            </p>
          )}
          {/* Tab ឈប់នៅទីនេះម្តង (មិនមែនរាល់ pause ទេ); ← / → ជ្រើសពាក្យ — ព្រឹត្តិការណ៍មកពីពាក្យដែលចុចក៏បាន */}
          <div
            ref={transcriptBox}
            tabIndex={0}
            aria-label={t('Transcript — ← / → ជ្រើសពាក្យ, Shift = ច្រើន', 'Transcript — ← / → select words, Shift = more')}
            onKeyDown={(event) => {
              if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.ctrlKey || event.altKey || event.metaKey) return
              event.preventDefault()
              stepSelection(event.key === 'ArrowRight' ? 1 : -1, event.shiftKey)
            }}
            className={`min-h-0 flex-1 overflow-y-auto px-5 pb-6 ${focusRing}`}
          >
            {!words ? (
              <p className="type-body text-text-4">…</p>
            ) : !words.ready ? (
              <TranscribeState job={job} busy={busy} onRetry={onTranscribe} />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      player.current?.pause()
                      setExtendOpen(true)
                    }}
                    title={t('បន្ថែមផ្នែកដែលបានកាត់ ត្រឡប់ចូលវីដេអូវិញ (ពី transcript)', 'Add a cut section back into the video (from the transcript)')}
                    className={`inline-flex min-h-8 cursor-pointer items-center rounded-field border border-line bg-transparent px-2.5 type-hint text-text-2 hover:bg-field hover:text-text ${focusRing}`}
                  >
                    + Extend a clip
                  </button>
                  <span className="type-hint text-text-4">
                    {t(
                      'ចុចពាក្យ ឬ ← → = ជ្រើស · Shift = ច្រើន · Delete = លុប · ចុចពាក្យដែលលុប = ស្តារ · Space = ចាក់',
                      'Click a word or ← → = select · Shift = more · Delete = remove · click a removed word = restore · Space = play',
                    )}
                  </span>
                  {cuts.length > 0 && (
                    <span className="ml-auto flex items-center gap-2 type-hint">
                      <span className="text-danger">{t('កាត់', 'Cuts')} {num(cuts.length)} · {removed.toFixed(1)} s</span>
                      <button
                        type="button"
                        onClick={() => change(cuts.reduce((list, hole) => restoreRange(list, hole, duration), clips))}
                        className={`cursor-pointer rounded-field border-0 bg-transparent px-1.5 text-text-3 underline hover:text-text ${focusRing}`}
                      >
                        {t('ស្តារទាំងអស់', 'Restore all')}
                      </button>
                    </span>
                  )}
                </div>
                <p className="m-0 text-[17px] leading-[2.1]">
                  {chunks.map((chunk, at) => {
                    const first = at * CHUNK
                    const local = activePos >= first && activePos < first + CHUNK ? activePos - first : -1
                    // ខ្សែអក្សរមួយតួក្នុងមួយធាតុ: c = លុប, s = ជ្រើស, . = ធម្មតា — memo ប្រៀបធៀបខ្សែនេះ
                    const flags = chunk.items
                      .map((item, at) =>
                        isCut(cuts, item.start, item.end)
                          ? 'c'
                          : picked?.includes(chunk.indices[at])
                            ? 's'
                            : '.',
                      )
                      .join('')
                    return (
                      <Chunk
                        key={first}
                        items={chunk.items}
                        indices={chunk.indices}
                        first={first}
                        active={local}
                        flags={flags}
                        marks={chunk.indices.map((index) => keywordMarks[index] ?? '-').join('')}
                        colours={style.keywordColors}
                        fills={chunk.indices.map((index) => fillerMarks[index] ?? '-').join('')}
                        showPauses={view.pauses}
                        hideCut={view.hideCut}
                        needle={needle}
                        current={chunk.indices.indexOf(currentHit)}
                        onItem={onItem}
                      />
                    )
                  })}
                </p>
              </>
            )}
          </div>
        </section>

        <PanelResizer
          widthOf={() => transcriptPanel.current?.getBoundingClientRect().width ?? TRANSCRIPT_MIN}
          onLive={(width) => {
            if (transcriptPanel.current) transcriptPanel.current.style.width = `${width}px`
          }}
          min={TRANSCRIPT_MIN}
          maxOf={() => {
            // preview ត្រូវនៅសល់ទទឹងតិចបំផុតរបស់វា (min-width ពិតពី CSS) ក្រៅពីផ្ទាំងខាងស្តាំ (Captions / Motion ...)
            const row = editorRow.current
            if (!row) return TRANSCRIPT_MIN
            const asides = [...row.querySelectorAll(':scope > aside, :scope > nav, :scope > div > nav')].reduce((sum, el) => sum + el.getBoundingClientRect().width, 0)
            const previewMin = previewPanel.current ? parseFloat(getComputedStyle(previewPanel.current).minWidth) || 360 : 360
            return row.getBoundingClientRect().width - previewMin - asides
          }}
          onChange={(width) => {
            setTranscriptWidth(width)
            saveTranscriptWidth(width)
          }}
          onReset={() => {
            if (transcriptPanel.current) transcriptPanel.current.style.width = ''
            setTranscriptWidth(null)
            saveTranscriptWidth(null)
          }}
          label={t('ពង្រីក / បង្រួម transcript (ចុចពីរដង = ទំហំដើម)', 'Resize the transcript (double-click = default)')}
        />

        {/* ---- preview (កណ្តាល) ---- */}
        {/* ទទឹងតិចបំផុតរបស់ preview (PREVIEW_MIN_CSS) — flex បង្រួម transcript ជំនួសវិញពេលផ្ទាំងខាងស្តាំបើក */}
        <section ref={previewPanel} aria-label="Preview" className="flex flex-1 flex-col" style={{ minWidth: PREVIEW_MIN_CSS }}>
          <div className="flex shrink-0 flex-wrap items-center gap-4 px-5 pt-3">
            <MenuButton label={aspect} icon={<AspectGlyph aspect={aspect} />} menuLabel={t('ទំហំ (aspect ratio)', 'Aspect ratio')}>
              {(close) =>
                ASPECTS.map((item) => (
                  <MenuItem key={item} checked={item === aspect} onClick={() => (setAspectChoice(item), close())}>
                    <AspectGlyph aspect={item} /> {item}
                    {item === own && <span className="ml-1 text-[12px] font-normal text-text-4">{t('ដូចវីដេអូ', 'same as video')}</span>}
                  </MenuItem>
                ))
              }
            </MenuButton>
            <LayoutMenu
              choice={layout}
              allowed={allowed}
              custom={custom}
              onChoice={(next) => {
                setLayout(next)
                changeLook({ transform: null }) // AI layout វិញ
                setBoxSelected(false)
              }}
              onAllowed={setAllowed}
              onCustom={() => {
                if (!custom) changeLook({ transform: initialTransform(sourceRatio, RATIO[aspect]) })
                setBoxSelected(true)
              }}
            />
            <BackgroundMenu look={look} onChange={changeLook} />
            <TrackerMenu look={look} scene={scene} onChange={changeLook} onManual={() => (player.current?.pause(), setTrackOpen(true))} />
          </div>
          <p className="shrink-0 px-5 pt-1 type-hint text-text-4">
            {custom
              ? `Export: ${aspect} ${t(`Transform ដោយដៃ ពីលើ background ${look.background} · ចុចលើវីដេអូ = ប្រអប់ (អូស / ជ្រុង / Crop)`, `hand-placed Transform over a ${look.background} background · click the video = box (drag / corners / Crop)`)}`
              : fitPreview
              ? `Export: ${aspect} Fit · ${t('preview បង្ហាញ Background — ពេល render, AI ប្រើ Fit តែលើ shot ស្ងៀម (slide), shot ផ្សេង = crop កណ្តាល', 'the preview shows the background — when rendering, the AI uses Fit only on still shots (slides), other shots = centre crop')}`
              : reframe
              ? `Export: AI reframe ${t('ទៅ', 'to')} ${aspect} (${exportSettings.layouts.join(', ')}) · ${t('preview ជាការកាត់កណ្តាល', 'the preview is a centre crop')}`
              : `Export: ${t('ទំហំដើម — frame ទាំងមូល + subtitles', 'original size — whole frame + subtitles')}`}
          </p>

          {/* `container-type: size` + cqw / cqh: ផ្ទៃ preview = ចតុកោណធំបំផុតនៃ aspect ដែលសមក្នុងប្រអប់នេះ
              ទាំងទទឹង និងកម្ពស់. មុននេះ 16:9 = width 100% + max-h-full: ពេល timeline ខ្ពស់ កម្ពស់ត្រូវកាត់ តែទទឹង
              នៅ 100% -> ផ្ទៃធាត់ជាង 16:9 ហើយ object-cover កាត់វីដេអូ (អ្នកអភិវឌ្ឍ 2026-10-29) */}
          <div className="flex min-h-0 flex-1 items-center justify-center p-5 [container-type:size]">
            <div
              ref={stage}
              className="relative"
              style={{
                width: `min(100cqw, calc(100cqh * ${RATIO[aspect]}))`,
                height: `min(100cqh, calc(100cqw / ${RATIO[aspect]}))`,
              }}
            >
              {/* ផ្ទៃ preview: overflow-hidden កាត់តែវីដេអូ — handles របស់ Transform នៅក្នុង overlay ខាងក្រោម
                  (មិនកាត់) ព្រោះជ្រុងនៅគែមអេក្រង់ត្រូវបានកាត់ពាក់កណ្តាល ហើយមេម៉ៅចុចមិនត្រូវ (វាស់) */}
              <div data-stage className="absolute inset-0 overflow-hidden rounded-[10px] bg-black">
              {/* Motion preview រំកិលប្រអប់នេះ (backdrop + video) — caption នៅក្រៅ ដូច render */}
              <div ref={motionBox} className="absolute inset-0">
              {(fitPreview || custom) && <FitBackdrop look={look} player={player} scale={previewScale} />}
              <TransformBox
                transform={look.transform}
                sourceRatio={sourceRatio}
                stageRatio={RATIO[aspect]}
                stage={stage}
                radius={look.radius * previewScale}
                selected={boxSelected}
                onSelect={setBoxSelected}
                overlay={overlay}
                startFrom={fitPreview ? initialTransform(sourceRatio, RATIO[aspect]) : coverTransform(sourceRatio, RATIO[aspect])}
                onChange={(transform) => changeLook({ transform })}
                onCrop={() => {
                  player.current?.pause()
                  setCropOpen(true)
                }}
              >
              <video
                ref={player}
                src={sourceUrl(video.path)}
                preload="metadata"
                onTimeUpdate={(event) => !scrubbing.current && setTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                style={
                  custom
                    ? undefined
                    : fitPreview
                      ? fitStyle
                      : { ...(punched ? { transform: 'scale(1.1)' } : {}), ...(followX !== null ? { objectPosition: `${followX}% 50%` } : {}) }
                }
                className={custom ? 'size-full object-fill' : fitPreview ? 'absolute object-cover' : 'size-full object-cover'}
              />
              </TransformBox>
              </div>
              <LiveCaption cues={wholeCues} time={time} style={style} scale={previewScale} aspect={aspect} playing={playing} />
              </div>
              {/* overlay ធំជាងផ្ទៃ 12 px (handles នៅគែមឃើញពេញ) ហើយ overflow-hidden: ប្រអប់ធំជាងផ្ទៃ
                  មិនអាចគ្រប toolbar 16:9 / Layout ទៀត (វាស់: ប្រអប់ scale 1.1 លើ 16:9 គ្រប Layout) */}
              <div className="pointer-events-none absolute -inset-3 z-[5] overflow-hidden">
                <div ref={setOverlay} className="absolute inset-3" />
              </div>
            </div>
          </div>

          {/* ⏮ ▶ ⏭ + ពេល នៅក្នុង toolbar របស់ timeline ឥឡូវ (រូប OpusClip) */}
        </section>

        {/* ---- Captions (ផ្ទាំង) + toolbar ខាងស្តាំ ---- */}
        {panel === 'motion' && (
          <aside aria-label="Motion" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line p-4">
            <MotionPanel
              motion={motion}
              onChange={(patch) => setMotion((current) => ({ ...current, ...patch }))}
              transition={transition}
              onTransition={setTransition}
              joinCount={joinNumber(clips, clips.length - 1)}
            />
          </aside>
        )}
        {panel === 'transition' && (
          <aside aria-label="Transition" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line p-4">
            <TransitionPanel
              transition={transition}
              onTransition={setTransition}
              joinCount={joinNumber(clips, clips.length - 1)}
              continuous={continues(clips, transitionAt)}
              onClose={() => setPanel(null)}
            />
          </aside>
        )}
        {panel === 'cleanup' && (
          <aside ref={cleanupAside} aria-label="Speech cleanup" className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-line p-4">
            <CleanupPanel
              project={project}
              onSeek={seek}
              onApply={(found) => {
                change(cutRanges(clips, found.map((item): Cut => [item.start, item.end])))
                setPanel(null)
              }}
            />
          </aside>
        )}
        {panel === 'captions' && (
          <aside aria-label="Captions" className="flex w-[340px] shrink-0 flex-col border-l border-line">
            <CaptionPanel
              style={style}
              onStyle={setStyle}
              footer={<p className="m-0 shrink-0 border-t border-line px-5 py-3 type-hint text-text-4">{t('Style នេះដុតចូលវីដេអូពេល Export', 'This style is burned into the video on Export')}</p>}
            />
          </aside>
        )}
        <nav ref={toolsNav} aria-label={t('ឧបករណ៍', 'Tools')} className="flex min-h-0 w-[92px] shrink-0 flex-col items-center gap-2 overflow-y-auto border-l border-line py-4">
          <ToolButton label="Captions" on={panel === 'captions'} onClick={() => setPanel((value) => (value === 'captions' ? null : 'captions'))}>
            <SubtitlesIcon size={20} weight={1.75} />
          </ToolButton>
          <ToolButton label="Motion" on={panel === 'motion'} onClick={() => setPanel((value) => (value === 'motion' ? null : 'motion'))}>
            <MotionIcon />
          </ToolButton>
          <ToolButton
            label="Transitions"
            on={panel === 'transition'}
            onClick={() => {
              setTransitionAt(0) // មិនមែនចុចពីកន្លែងភ្ជាប់ណាមួយ: គ្មានការព្រមានអំពីកន្លែងចាស់
              setPanel((value) => (value === 'transition' ? null : 'transition'))
            }}
          >
            <PanelIcon d="M3 4.500v11L10 10 3 4.500ZM17 4.500v11L10 10l7-5.500Z" />
          </ToolButton>
          {/* មិនទាន់មាន pipeline នៅពីក្រោយ: គូរបិទ + ហេតុផល មិនមែនប៊ូតុងដែលចុចហើយគ្មានអ្វីកើតឡើង */}
          <ToolButton label="AI enhance" note="Phase 3"><PanelIcon d="M9 3l1.6 4.4L15 9l-4.4 1.6L9 15l-1.6-4.4L3 9l4.4-1.6L9 3ZM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" /></ToolButton>
          <ToolButton label="Brand template" note="Phase 3"><PanelIcon d="M3 4.5A1.5 1.5 0 0 1 4.5 3h3A1.5 1.5 0 0 1 9 4.5v11a2.5 2.5 0 0 1-5 0L3 4.5ZM9 7l2.6-2.6a1.5 1.5 0 0 1 2.1 0l1.9 1.9a1.5 1.5 0 0 1 0 2.1L9 15M6.5 15.5h.01" /></ToolButton>
          <ToolButton label="B-roll" note="Phase 3"><PanelIcon d="M7 3.5h7A2.5 2.5 0 0 1 16.5 6v7M6 6h6.5A2.5 2.5 0 0 1 15 8.500V14a2.500 2.500 0 0 1-2.500 2.500H6A2.500 2.500 0 0 1 3.500 14V8.500A2.500 2.500 0 0 1 6 6ZM8 9v5h2a1.250 1.250 0 0 0 0-2.500H8h1.700a1.250 1.250 0 0 0 0-2.500H8Z" /></ToolButton>
          <ToolButton label="Text" note={t('មិនទាន់មាន', 'Not built yet')}><PanelIcon d="M4 5.500V3.500h12v2M10 3.500v13M7.500 16.500h5" /></ToolButton>
          <ToolButton label="Graphics" note={t('មិនទាន់មាន', 'Not built yet')}><PanelIcon d="M3 7.500a4 4 0 0 1 4-4h6a4 4 0 0 1 0 8H7a4 4 0 0 1-4-4ZM6 11.500a4 4 0 1 0 8 0M7 3.500a3 3 0 0 0 6 8" /></ToolButton>
          <ToolButton label="Audio" note={t('មិនទាន់មាន', 'Not built yet')}><PanelIcon d="M8 15V5l8-1.500V13M8 15a2.500 2.500 0 1 1-5 0 2.500 2.500 0 0 1 5 0ZM16 13a2.500 2.500 0 1 1-5 0 2.500 2.500 0 0 1 5 0Z" /></ToolButton>
          <ToolButton label="Voiceover hook" note={t('មិនទាន់មាន', 'Not built yet')}><PanelIcon d="M5.500 3h9A2.500 2.500 0 0 1 17 5.500v6a2.500 2.500 0 0 1-2.500 2.500H12l-2 2.500L8 14H5.500A2.500 2.500 0 0 1 3 11.500v-6A2.500 2.500 0 0 1 5.500 3ZM7 7v3M10 6v5M13 7v3" /></ToolButton>
        </nav>
      </div>

      {/* timeline ពេញទទឹង ដូចរូប OpusClip (ផ្នែកទី ៣) */}
      {cropOpen && (
        <CropDialog
          frameUrl={sourceFrameUrl(video.path, time)}
          sourceRatio={sourceRatio}
          initial={(look.transform ?? coverTransform(sourceRatio, RATIO[aspect])).crop}
          onEnableLayouts={() => {
            // បើក layout អ្នកនិយាយច្រើន + ត្រឡប់ទៅ Auto (AI ជ្រើស split / three / four តាម shot)
            setAllowed(ALL_LAYOUTS.filter((id) => allowed.includes(id) || ['split', 'three', 'four'].includes(id)))
            setLayout('auto')
            changeLook({ transform: null })
            setCropOpen(false)
          }}
          onApply={(crop) => {
            // ប្រអប់នៅលើអេក្រង់រក្សាកណ្តាល និងទទឹង; crop ថ្មីប្តូរតែផ្នែកដែលឃើញ
            const base = look.transform ?? coverTransform(sourceRatio, RATIO[aspect])
            changeLook({ transform: { ...base, crop } })
            setCropOpen(false)
          }}
          onClose={() => setCropOpen(false)}
        />
      )}
      {extendOpen && (
        <ExtendDialog
          items={items}
          duration={duration}
          cuts={cuts}
          videoPath={video.path}
          initialTime={time}
          snapTo={(at, alt) => snapped(at, alt)}
          onAdd={(range, at) => {
            // at = null: ស្តារ (ចេញពី cut list); ផ្សេងពីនេះ = ចម្លងជា insert. change() = undo មួយជំហាន
            change(at === null ? restoreRange(clips, range, duration) : insertCopy(clips, range, at, duration))
            setExtendOpen(false)
            seek(range[0])
          }}
          onClose={() => setExtendOpen(false)}
        />
      )}
      {trackOpen && (
        <SubjectTrackDialog
          project={project}
          video={video}
          scenes={scenes}
          initialTime={time}
          look={look}
          onLook={(next) => setLook(lookOf(next))}
          onClose={() => setTrackOpen(false)}
        />
      )}
      <EditorTimeline
        project={project}
        videoPath={video.path}
        duration={duration}
        clips={clips}
        playingPart={outPart}
        selected={selected}
        onSelect={setBlockSel}
        linkable={linkable}
        onLink={linkParts}
        canSplit={Boolean(duration && splitAt(false))}
        onSplit={splitHere}
        deletable={deletable}
        onTogglePart={togglePart}
        snap={snap}
        onSnap={() => {
          setSnap(!snap)
          saveSnap(!snap)
        }}
        initialVolume={initialVolume}
        onVolume={setVolume}
        onMoveBlock={(from, gap) => {
          const moved = moveClip(clips, from, gap)
          change(moved.clips)
          setBlockSel([moved.index, moved.index])
        }}
        onTrimBlock={(index, side, at, alt) => {
          // Snap មិនអាចធ្វើឲ្យប្លុកខ្លីជាង 0.5 s ឬហួសដែនអូសចេញ: បើដូច្នោះ ប្រើពេលពិតដែលអូសដល់
          const near = snapped(at, alt)
          const left = side === 'start' ? clips[index][1] - near : near - clips[index][0]
          const limit = edgeLimit(clips, index, side, duration)
          const inLimit = side === 'start' ? near >= limit : near <= limit
          const edge = left >= 0.5 && inLimit ? near : at
          change(trimClip(clips, index, side, edge))
          seek(edge, index)
          setBlockSel([index, index])
        }}
        onAddTransition={(index) => {
          seek(clips[index][0], index)
          setTransitionAt(index)
          setPanel('transition')
        }}
        noTrack={look.tracking ? look.no_track : []}
        subjects={look.subjects.map((item): [number, number] => [item.start, item.end])}
        time={time}
        playing={playing}
        audioReady={Boolean(words?.ready)}
        onSeek={seek}
        onScrub={scrubTo}
        onTogglePlay={() => (playing ? player.current?.pause() : void player.current?.play())}
      />
    </div>
  )
}

/** shortcut របស់ editor (Space, Delete, S, Ctrl+Z ...) ដើរតែពេល focus មិននៅកន្លែងដែលប្រើគ្រាប់ចុចនោះផ្ទាល់:
 *  ប្រអប់សរសេរ, select, ឬក្នុង menu / dialog (ឧ. Backspace លើ select ក្នុង Captions មិនត្រូវលុបផ្នែក
 *  timeline ទេ). ពាក្យក្នុង transcript (`role="button"`) នៅតែយក shortcut — Delete ក្រោយចុចពាក្យ = លុបវា. */
function editorOwnsKey(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return true
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false
  if (target.isContentEditable) return false
  // timeline (`role="slider"`) មិនស្ថិតក្នុងបញ្ជីនេះទេ: ចុចផ្នែកលើ timeline រួច Delete = លុបផ្នែកនោះ
  return !target.closest('[role="dialog"], [role="menu"], [role="listbox"]')
}

/** អ្វីដែល editor រក្សាទុកដោយខ្លួនឯងក្នុង project.json, និងស្ថានភាពនៃការរក្សាទុកនីមួយៗ. */
type SaveKey = 'cuts' | 'look' | 'motion'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** "កំពុងរក្សាទុក… / ✓ បានរក្សាទុក / ⚠ រក្សាទុកមិនបាន" នៅ top bar. idle (មិនទាន់ប្តូរអ្វី) = គ្មានអក្សរ.
 *  ទទឹងថេរ ដើម្បីកុំឲ្យ Undo / CC / Export រំកិលពេលអក្សរប្តូរ. */
function SaveStatus({
  pending,
  states,
  errors,
  onRetry,
}: {
  pending: boolean // មានការកែដែល sidecar មិនទាន់មាន (កំពុងរង់ចាំ debounce 0.6 s ឬកំពុងផ្ញើ)
  states: SaveState[]
  errors: string[]
  onRetry: () => void
}) {
  const t = useT()
  const failed = states.includes('error')
  const busy = pending || states.includes('saving')
  const saved = states.includes('saved')
  return (
    <span role="status" className="inline-flex w-[150px] justify-end whitespace-nowrap type-hint">
      {failed ? (
        <button
          type="button"
          onClick={onRetry}
          title={`${errors.join(' · ')} — ${t('ចុចដើម្បីសាកម្តងទៀត', 'click to try again')}`}
          className={`cursor-pointer rounded-field border-0 bg-transparent px-1.5 text-danger underline ${focusRing}`}
        >
          ⚠ {t('រក្សាទុកមិនបាន', 'Not saved')}
        </button>
      ) : busy ? (
        <span className="text-text-4">{t('កំពុងរក្សាទុក…', 'Saving…')}</span>
      ) : saved ? (
        <span className="text-text-3" title={t('ការកែរក្សាទុកក្នុង project.json — បើកម្តងទៀតនៅដដែល', 'Edits are saved in project.json — they are there next time')}>
          ✓ {t('បានរក្សាទុក', 'Saved')}
        </span>
      ) : null}
    </span>
  )
}

/** ជំហានមួយក្នុង undo/redo: ការកាត់ និងចំណុច split ជាមួយគ្នា. */


/* កម្រិតសំឡេង preview (0-100) ក្នុង localStorage, លំនាំដើម 100; 0 = muted */
const VOLUME_KEY = 'kcs.previewVolume'
function loadVolume(): number {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY) ?? 100)
    return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 100
  } catch {
    return 100
  }
}
function saveVolume(volume: number) {
  try {
    if (volume === 100) localStorage.removeItem(VOLUME_KEY)
    else localStorage.setItem(VOLUME_KEY, String(volume))
  } catch {
    // គ្មាន storage = កម្រិតនៅតែប្រើបានក្នុងពេលនេះ
  }
}
function applyVolume(node: HTMLVideoElement | null, volume: number) {
  if (!node) return
  node.volume = volume / 100
  node.muted = volume === 0
}

/* Snap បើក/បិទ ក្នុង localStorage (try/catch: private window អាចបិទ storage). លំនាំដើម = បើក */
const SNAP_KEY = 'kcs.timelineSnap'
function loadSnap(): boolean {
  try {
    return localStorage.getItem(SNAP_KEY) !== '0'
  } catch {
    return true
  }
}
function saveSnap(on: boolean) {
  try {
    if (on) localStorage.removeItem(SNAP_KEY)
    else localStorage.setItem(SNAP_KEY, '0')
  } catch {
    // គ្មាន storage = ការកំណត់នៅតែប្រើបានក្នុងពេលនេះ
  }
}

/** ផ្នែកមួយនៃ transcript — `memo`: គូរឡើងវិញតែពេលពាក្យសកម្មចូល/ចេញពីផ្នែកនេះ ឬការស្វែងរកប្តូរ. */
const Chunk = memo(function Chunk({
  items,
  indices,
  first,
  active,
  flags,
  marks,
  colours,
  fills,
  showPauses,
  hideCut,
  needle,
  current,
  onItem,
}: {
  items: EditorItem[]
  indices: number[] // index ក្នុង items ទាំងមូល របស់ធាតុនីមួយៗ (លំដាប់តាម timeline)
  first: number // ទីតាំងក្នុង `display` របស់ធាតុទីមួយ (ពាក្យក្នុង HOOK មាន data-at ដូចគ្នា តែ data-pos ផ្សេង)
  active: number // index ក្នុងផ្នែកនេះ, -1 = គ្មាន
  flags: string // មួយតួក្នុងមួយធាតុ: c = លុប, s = ជ្រើស
  marks: string // មួយតួក្នុងមួយធាតុ: 1 / 2 = ពាក្យសំខាន់ (ពណ៌ទី ១ / ២), - ឬទទេ = ធម្មតា
  colours: [string, string] // ពណ៌ពាក្យសំខាន់ពីរ (Captions › Font)
  fills: string // មួយតួក្នុងមួយធាតុ: f = ពាក្យ filler (Filter)
  showPauses: boolean // Filter: បង្ហាញស្លាក pause
  hideCut: boolean // Filter: លាក់ពាក្យ និង pause ដែលលុប
  needle: string
  current: number // លទ្ធផលស្វែងរកបច្ចុប្បន្នក្នុងផ្នែកនេះ (index ក្នុងផ្នែក), -1 = គ្មាន
  onItem: (index: number, shift: boolean, position: number) => void
}) {
  const t = useT()
  return (
    <>
      {items.map((item, at) => {
        const here = at === active
        const gone = flags[at] === 'c'
        const chosen = flags[at] === 's'
        if (gone && hideCut) return null
        if ('pause' in item) {
          if (!showPauses) return null
          // ស្លាក pause ពិត (គម្លាតរវាងពាក្យពីរ) ដូច "0.46s" ក្នុងរូប
          return (
            <button
              key={at}
              type="button"
              tabIndex={-1} // Tab ឈប់លើ transcript ម្តង, ← → ដើរតាមពាក្យ និង pause
              data-at={indices[at]}
              data-pos={first + at}
              onClick={(event) => onItem(indices[at], event.shiftKey, first + at)}
              title={gone ? t('បានលុប — ចុចដើម្បីស្តារ', 'Removed — click to restore') : t(`ស្ងាត់ ${item.pause.toFixed(2)} វិនាទី`, `Silence ${item.pause.toFixed(2)} s`)}
              className={`mx-1 inline-block cursor-pointer rounded-[6px] border-0 px-1.5 align-middle text-[13px] leading-[1.6] tabular-nums ${
                gone
                  ? 'bg-danger/15 text-danger line-through'
                  : chosen
                    ? 'bg-info/40 text-text'
                    : here
                      ? 'bg-gold text-on-gold'
                      : 'bg-raised-2 text-text-3 hover:bg-raised-3'
              }`}
            >
              {item.pause.toFixed(2)}s
            </button>
          )
        }
        const hit = needle && item.word.toLowerCase().includes(needle)
        // ពាក្យសំខាន់: ពណ៌របស់វា លុះត្រាតែពាក្យនោះមិនត្រូវលុប / ជ្រើស / កំពុងនិយាយ / ស្វែងរក (ពណ៌ទាំងនោះសំខាន់ជាង)
        const filler = fills[at] === 'f' && !gone && !chosen && !here && !hit
        const mark = marks[at]
        const keyword = (mark === '1' || mark === '2') && !gone && !chosen && !here && !hit ? colours[Number(mark) - 1] : undefined
        return (
          <span key={at}>
            {' '}
            <span
              role="button"
              tabIndex={-1}
              data-at={indices[at]}
              data-pos={first + at}
              data-keyword={keyword ? mark : undefined}
              onClick={(event) => onItem(indices[at], event.shiftKey, first + at)}
              title={gone ? t('បានលុប — ចុចដើម្បីស្តារ', 'Removed — click to restore') : keyword ? t('ពាក្យសំខាន់ (AI keywords highlighter)', 'Keyword (AI keywords highlighter)') : undefined}
              // ពណ៌តែប៉ុណ្ណោះ: fontWeight ធ្វើឲ្យពាក្យធំជាង -> បន្ទាត់រុំខុសគ្នា -> transcript ញាក់ពេលបើក/បិទ
              style={keyword ? { color: keyword } : undefined}
              className={`cursor-pointer rounded-[4px] px-0.5 ${
                gone
                  ? 'text-text-4 line-through decoration-danger'
                  : chosen
                    ? 'bg-info/40 text-text'
                    : here
                      ? 'bg-gold text-on-gold'
                      : hit
                        ? at === current
                          ? 'bg-gold-tint text-gold outline-2 outline-gold outline-solid' // លទ្ធផលបច្ចុប្បន្ន (Enter / ˄ ˅)
                          : 'bg-gold-tint text-gold'
                        : filler
                          ? 'underline decoration-warn decoration-wavy decoration-2 underline-offset-4 hover:bg-field'
                          : 'hover:bg-field'
              }`}
            >
              {item.word}
            </span>
          </span>
        )
      })}
    </>
  )
})

/** caption ប្រហាក់ប្រហែលលើ preview: ពាក្យ `style.words` ដែលមានពាក្យសកម្ម (ពណ៌ style).
 *  render ពិតបំបែក cue ដោយ captions.py (pause, ពាក្យភ្ជាប់) ដូច្នេះការបំបែកអាចខុសបន្តិច. */
/** ទំហំ output និងទំហំ font របស់ ASS តាម aspect — ដូច `config.apply_aspect`:
 *  min(110 x ទទឹង/1080, 30% នៃកម្ពស់ ÷ (3 x 1.1)). 9:16 = 110, 16:9 / 1:1 = 98. */
const OUTPUT: Record<string, [number, number]> = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] }
function assFontSize(aspect: string, sizePercent: number): number {
  const [width, height] = OUTPUT[aspect] ?? OUTPUT['9:16']
  return Math.floor(Math.min(110 * (width / 1080), (height * 0.3) / (3 * 1.1))) * (sizePercent / 100)
}

/** Caption ប្រហាក់ប្រហែលលើ preview របស់ Edit Video — cue ពិតពី `/projects/{name}/cues` (បន្ទាត់,
 *  ពាក្យសំខាន់) គូរដោយ font / ពណ៌ / stroke / shadow / animation របស់ style ដូច render. */
function LiveCaption({
  cues,
  time,
  style,
  scale,
  aspect,
  playing,
}: {
  cues: WholeCue[]
  time: number
  style: CaptionStyle
  scale: number // px preview ក្នុង 1 px output
  aspect: string
  playing: boolean
}) {
  const fonts = useCaptionFonts()
  const index = cues.findIndex((cue) => time >= cue.start && time < cue.end)
  const cue = cues[index]
  const clock = useMotionClock(cue?.start ?? null, time, playing)
  if (style.off || !scale || !cue) return null
  const assPx = assFontSize(aspect, style.size) * scale
  const fontPx = assPx * emScaleOf(style.font, fonts)
  const top = style.position === 'top' ? '14%' : style.position === 'middle' ? '50%' : '78%'
  const text = captionTextStyle(style, fontPx, scale)
  const [width, height] = OUTPUT[aspect] ?? OUTPUT['9:16']
  const motion = lineMotion(style, {
    cueStart: cue.start,
    cueSeconds: cue.end - cue.start,
    clock,
    scale,
    width,
    height,
  })
  const layers = underLayers(style, { scale, width, assPx, fontPx })
  const words = cue.lines.flat()
  const active = words.find((word) => time >= word.start && time < word.end)
  const shown = (text: string) => (style.uppercase ? text.toUpperCase() : text)
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-2 m-0 text-center leading-[1.1]"
      style={{ top, transform: 'translateY(-50%)', ...text }}
    >
      {/* layer 0 របស់ render (backdrop, ពណ៌ glitch): ច្បាប់ចម្លងនៃបន្ទាត់នៅពីក្រោយ; អក្សរពិតខាងក្រោម
          ជា `relative` ដើម្បីឲ្យវាគូរពីលើ (element absolute គូរពីលើ element ធម្មតា) */}
      {layers.map((layer) => (
        <div key={layer.key} className="absolute inset-0" style={{ transform: `translateX(${layer.dx}px)`, ...layer.text }}>
          {cue.lines.map((line, at) => (
            <div key={at} className="whitespace-nowrap">
              <span key={clock.key} className={`inline-block ${motion.className}`} style={{ ...motion.style, ...layer.line }}>
                {line.map((word) => shown(word.text)).join(' ')}
              </span>
            </div>
          ))}
        </div>
      ))}
      {cue.lines.map((line, at) => (
        <div key={at} className="relative whitespace-nowrap">
          {/* key = cue: cue ថ្មី = ចលនាចាប់ផ្តើមម្តងទៀត (ដូច event ថ្មីក្នុង .ass); មួយបន្ទាត់ម្តង ដូច render */}
          <span key={clock.key} className={`inline-block ${motion.className}`} style={motion.style}>
            {line.map((word, w) => {
              const spoken = word === active
              const fx = wordMotion(style, {
                spoken,
                wordStart: word.start,
                clock,
                someoneSpeaking: !!active,
                future: !!active && word.start > active.start,
                activeScale: 1.1,
                scale,
                assPx,
                fontPx: text.fontSize as number,
              })
              return (
                <span key={w}>
                  {w > 0 && ' '}
                  <span
                    className={`inline-block ${fx.className}`}
                    style={{ color: wordColour(style, spoken, !!word.keyword, index), ...fx.style }}
                  >
                    {shown(word.text)}
                  </span>
                </span>
              )
            })}
          </span>
        </div>
      ))}
    </div>
  )
}

/** ពេលគ្មាន transcript: transcribe ដោយខ្លួនឯង (`--transcribe-only`) និងបង្ហាញវឌ្ឍនភាពពិត. */
function MotionIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />
      <path d="M2.5 7V2.5H7M13 2.5h4.5V7M17.5 13v4.5H13M7 17.5H2.5V13" />
    </svg>
  )
}

function PanelIcon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** look ពី sidecar ដោយគ្មាន field ផ្សេង (ឧ. `name`) — ដូច្នេះ PUT ផ្ញើតែ look ប៉ុណ្ណោះ. */
function lookOf(answer: Partial<Look>): Look {
  const { background, blur, color, image, radius, spacing, tracking, no_track, subjects, transform } = { ...DEFAULT_LOOK, ...answer }
  return { background, blur, color, image, radius, spacing, tracking, no_track, subjects, transform }
}

export function TranscribeState({ job, busy, onRetry }: { job: JobStatus | null; busy: boolean; onRetry: () => void }) {
  const t = useT()
  const num = useNum()
  const fraction = job?.progress.fraction?.transcribe ?? 0
  if (job?.state === 'failed')
    return (
      <div className="flex flex-col items-start gap-3 py-10">
        <p className="type-body text-danger">{t('Transcribe មិនបាន', 'Transcribe failed')}: {job.error || t('មើល log', 'see the log')}</p>
        <button type="button" onClick={onRetry} className={`cursor-pointer rounded-button border-0 bg-field px-4 py-2 type-label text-text ${focusRing}`}>
          {t('សាកម្តងទៀត', 'Try again')}
        </button>
      </div>
    )
  return (
    <div className="flex flex-col gap-3 py-10">
      <p className="type-body-lg font-semibold">
        {busy && !job ? t('រង់ចាំ job ផ្សេងចប់ (GPU តែមួយ)…', 'Waiting for another job to finish (one GPU)…') : t('កំពុង transcribe វីដេអូនេះ…', 'Transcribing this video…')}
      </p>
      <p className="type-hint text-text-3">{t('លើកដំបូងតែប៉ុណ្ណោះ — transcript ត្រូវបានរក្សាទុកសម្រាប់លើកក្រោយ (Whisper លើកុំព្យូទ័រនេះ)', 'First time only — the transcript is kept for next time (Whisper on this computer)')}</p>
      <div className="h-2 overflow-hidden rounded-full bg-raised-2" role="progressbar" aria-valuenow={Math.round(fraction * 100)}>
        <div className="h-full bg-ok transition-[width]" style={{ width: `${Math.max(3, fraction * 100)}%` }} />
      </div>
      {fraction > 0 && <span className="type-hint tabular-nums text-text-3">{num(Math.round(fraction * 100))}%</span>}
    </div>
  )
}

/** ˄ / ˅ ក្បែរចំនួនលទ្ធផលស្វែងរក. */
function SearchStep({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-6 cursor-pointer items-center justify-center rounded-field border-0 bg-transparent text-[13px] text-text-3 hover:bg-raised-2 hover:text-text disabled:cursor-default disabled:opacity-30 ${focusRing}`}
    >
      {children}
    </button>
  )
}

function ControlButton({
  label,
  onClick,
  disabled = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-[15px] text-text hover:bg-field disabled:cursor-default disabled:opacity-30 ${focusRing}`}
    >
      {children}
    </button>
  )
}

function ToolButton({
  label,
  note,
  on = false,
  onClick,
  children,
}: {
  label: string
  note?: string // មិនទាន់មាន = បិទ + ហេតុផល
  on?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={onClick ? on : undefined}
      disabled={!onClick}
      onClick={onClick}
      title={note ? `${label} — ${note}` : label}
      className={`flex w-[78px] shrink-0 cursor-pointer flex-col items-center gap-1 rounded-button border-0 px-1 py-2.5 text-[12px] font-semibold disabled:cursor-default disabled:opacity-40 ${
        on ? 'bg-gold-tint text-gold' : 'bg-transparent text-text-2 hover:bg-field'
      } ${focusRing}`}
    >
      <span className="text-[19px] leading-none">{children}</span>
      {label}
    </button>
  )
}

/* ទទឹង transcript ក្នុង localStorage (ក្នុង try/catch: private window អាចបិទ storage) */
const TRANSCRIPT_MIN = 280
// preview យ៉ាងហោចណាស់ 40% នៃជួរ (% = នៃ editorRow), តែមិនច្រើនជាងកន្លែងដែលនៅសល់ពេល nav 92 + ផ្ទាំង 340
// + resizer 8 + transcript 280 = 720 px បើក — ហើយមិនតិចជាង 360 px ទេ.
// 1100: 380 · 1280: 512 · 1440: 576 (ពេលមានផ្ទាំងខាងស្តាំ)
const PREVIEW_MIN_CSS = 'max(360px, min(40%, 100% - 720px))'
const WIDTH_KEY = 'kcs.transcriptWidth'
function loadTranscriptWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) && value >= TRANSCRIPT_MIN ? value : null
  } catch {
    return null
  }
}
function saveTranscriptWidth(width: number | null) {
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEY)
    else localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // គ្មាន storage = ទទឹងនៅតែប្រើបានក្នុងពេលនេះ
  }
}
