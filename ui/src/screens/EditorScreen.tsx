import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, DEFAULT_LOOK, DEFAULT_MOTION, sourceUrl, type EditorItem, type EditorWords, type JobStatus, type Look, type Motion, type MotionCues, type Video, type VideoFormat, type WholeCue } from '../api'
import { motionAt, motionTransform } from '../motionPreview'
import type { CaptionStyle } from '../captionStyle'
import { PlayMark, SubtitlesIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { TopBar } from '../kit/TopBar'
import { AccountButton } from './AccountButton'
import { khmerNumber } from './khmer'
import { AspectGlyph, MenuButton, MenuItem } from './Menu'
import { EditorTimeline } from './EditorTimeline'
import { CleanupPanel } from './CleanupPanel'
import { BackgroundMenu, FitBackdrop, TrackerMenu } from './LookMenus'
import { SubjectTrackDialog } from './SubjectTrackDialog'
import { MotionPanel } from './MotionPanel'
import { CaptionPanel } from './CaptionPanel'
import { captionTextStyle, emScaleOf, lineMotion, underLayers, useCaptionFonts, useMotionClock, wordColour, wordMotion } from '../captionLook'
import { pathAt, trackAt } from '../subjectPath'
import {
  add,
  addSplit,
  cutAt,
  isCut,
  isPartCut,
  normalize,
  partAt,
  partIndex,
  removedSeconds,
  snapToWords,
  subtract,
  trimTo,
  type Cut,
} from '../cutList'
import type { ReframeSettings } from './ReframeSetup'
import { ASPECTS, nearestAspect, RATIO, type Aspect } from './aspects'

type LayoutChoice = 'auto' | 'fill' | 'fit' | 'split' | 'screen'

// `--layout` ពិតរបស់ជម្រើសនីមួយៗ (center ជាជម្រើសចុងក្រោយជានិច្ច)
const LAYOUTS: { value: LayoutChoice; label: string; flags: string[] }[] = [
  { value: 'auto', label: 'Auto', flags: ['fill', 'fit', 'split', 'three', 'four', 'screen'] },
  { value: 'fill', label: 'Fill', flags: ['fill'] },
  { value: 'fit', label: 'Fit', flags: ['fit'] },
  { value: 'split', label: 'Split', flags: ['split'] },
  { value: 'screen', label: 'Screen + webcam', flags: ['screen', 'fill'] },
]
// ពាក្យក្នុងមួយផ្នែកនៃ transcript — ផ្នែកដែលពាក្យសកម្មមិនប្តូរ មិនគូរឡើងវិញ (វីដេអូ 35 នាទី = 7000 ពាក្យ)
const CHUNK = 80


/** `[0:00.00]` ដូចរូប OpusClip: នាទី:វិនាទី.ភាគរយ. */
function stamp(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, '0')}:${(safe - minutes * 60).toFixed(2).padStart(5, '0')}`
}

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
 *  មិនទាន់មាន ទើបបិទ: Extend a clip, AI enhance, Brand template, B-roll (Phase 3).
 *  គ្មាន Upgrade / credits — app នេះមិនរាប់អ្វីទេ. */
export function EditorScreen({
  project,
  video,
  initialStyle,
  job,
  busy,
  onTranscribe,
  onExport,
  onBack,
}: {
  project: string
  video: Video
  initialStyle: CaptionStyle
  job: JobStatus | null // job --transcribe-only របស់វីដេអូនេះ (null = គ្មាន)
  busy: boolean // job ផ្សេងកំពុងរត់ (GPU តែមួយ)
  onTranscribe: () => void
  onExport: (settings: ReframeSettings, style: CaptionStyle, cuts: Cut[], transition: 'punch' | 'hard', look: Look, motion: Motion) => void
  onBack: () => void
}) {
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
  useEffect(() => {
    if (!needsTranscript || asked.current || busy || job) return
    asked.current = true
    onTranscribe()
  }, [needsTranscript, busy, job, onTranscribe])

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

  const [aspectChoice, setAspectChoice] = useState<Aspect | null>(null)
  const aspect = aspectChoice ?? own
  const [layout, setLayout] = useState<LayoutChoice>('auto')
  const [style, setStyle] = useState<CaptionStyle>(initialStyle)
  // ផ្ទាំងខាងស្តាំ: Captions ឬ Speech cleanup (មួយម្តង)
  const [panel, setPanel] = useState<'captions' | 'cleanup' | 'motion' | null>(null)
  const [search, setSearch] = useState('')

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
  const seek = (seconds: number) => {
    if (player.current) player.current.currentTime = seconds
    setTime(seconds)
  }

  const items = useMemo(() => words?.items ?? [], [words])
  const active = activeIndex(items, time)
  const chunks = useMemo(() => {
    const out: EditorItem[][] = []
    for (let at = 0; at < items.length; at += CHUNK) out.push(items.slice(at, at + CHUNK))
    return out
  }, [items])
  const needle = search.trim().toLowerCase()
  const hits = useMemo(
    () => (needle ? items.filter((item) => 'word' in item && item.word.toLowerCase().includes(needle)).length : 0),
    [items, needle],
  )

  // ---- cut list (ជំហាន ២): undo = បញ្ជីចាស់ៗ, redo = បញ្ជីដែល undo ----
  // splits = ចំណុច Split លើ timeline (ចែកជាផ្នែកដើម្បីជ្រើសលុប). undo/redo រក្សាទាំងពីរជាមួយគ្នា.
  const [cuts, setCuts] = useState<Cut[]>([])
  const [splits, setSplits] = useState<number[]>([])
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const [transition, setTransition] = useState<'punch' | 'hard'>('punch')
  const [cutsLoaded, setCutsLoaded] = useState(false)
  useEffect(() => {
    let stale = false
    api
      .cuts(project)
      .then((answer) => {
        if (stale) return
        setCuts(normalize(answer.cuts))
        setSplits(answer.splits ?? [])
        setTransition(answer.transition === 'hard' ? 'hard' : 'punch')
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
    const timer = window.setTimeout(() => void api.saveCuts(project, { cuts, transition, splits }).catch(() => {}), 600)
    return () => window.clearTimeout(timer)
  }, [cuts, splits, transition, cutsLoaded, project])
  const change = (next: Cut[], nextSplits: number[] = splits) => {
    setPast((list) => [...list, { cuts, splits }].slice(-100))
    setFuture([])
    setCuts(next)
    setSplits(nextSplits)
  }
  const restore = (snapshot: Snapshot) => {
    setCuts(snapshot.cuts)
    setSplits(snapshot.splits)
  }
  const undo = () => {
    if (!past.length) return
    setFuture((list) => [{ cuts, splits }, ...list])
    restore(past[past.length - 1])
    setPast((list) => list.slice(0, -1))
  }
  const redo = () => {
    if (!future.length) return
    setPast((list) => [...list, { cuts, splits }])
    restore(future[0])
    setFuture((list) => list.slice(1))
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
        setLook(lookOf(answer))
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
      api
        .saveLook(project, look)
        // រូបត្រូវចម្លងចូល output/<name>/ — យក path ច្បាប់ចម្លងមកវិញ (រក្សាទុកលើកក្រោយមិនចម្លងទៀត)
        .then((saved) => saved.image !== look.image && setLook((current) => ({ ...current, image: saved.image })))
        .catch(() => {})
    }, 600)
    return () => window.clearTimeout(timer)
  }, [look, lookLoaded, project])
  const changeLook = (patch: Partial<Look>) => setLook((current) => ({ ...current, ...patch }))
  const [trackOpen, setTrackOpen] = useState(false) // dialog Manual subject tracking

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
  const [view, setView] = useState({ pauses: true, fillers: false, hideCut: false })
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
      .exportTranscript(project, { format, cuts })
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
    const saved = { ...motion, animation: style.animation }
    const timer = window.setTimeout(() => void api.saveMotion(project, saved).catch(() => {}), 600)
    return () => window.clearTimeout(timer)
  }, [motion, motionLoaded, project, style.animation])
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

  // ការជ្រើស: [index ដំបូង, index ចុងក្រោយ] ក្នុង items (Shift+ចុច ពង្រីក)
  const [selection, setSelection] = useState<[number, number] | null>(null)
  const picked = selection ? ([Math.min(...selection), Math.max(...selection)] as const) : null
  const onItem = (index: number, shift: boolean) => {
    const item = items[index]
    if (isCut(cuts, item.start, item.end)) {
      // ចុចលើអ្វីដែលបានលុប = ស្តារវាវិញ
      change(subtract(cuts, [item.start, item.end]))
      setSelection(null)
      return
    }
    setSelection(shift && selection ? [selection[0], index] : [index, index])
    seek(item.start)
  }
  const deleteSelection = () => {
    if (!picked) return
    change(add(cuts, [items[picked[0]].start, items[picked[1]].end]))
    setSelection(null)
  }

  // ---- timeline: Split / ជ្រើសផ្នែក / លុប-ស្តារ / Trim ----
  const duration = length || words?.duration || 0
  const spoken = useMemo(() => items.filter((item) => 'word' in item), [items])
  // ផ្នែកដែលជ្រើស = ផ្នែកដែលមានពេលនេះ (ចែកដោយ splits) — គណនាឡើងវិញពេល split ប្តូរ
  const [partTime, setPartTime] = useState<number | null>(null)
  const part = partTime !== null && splits.length ? partAt(splits, duration, partTime) : null
  const partCut = part ? isPartCut(cuts, part) : false
  // Split នៅ playhead; Alt = ចំណុចពិត, ធម្មតា = ចេញពីកណ្តាលពាក្យ (snapToWords)
  const splitHere = (exact: boolean) => {
    if (!duration) return
    const at = exact ? time : snapToWords(time, spoken)
    const next = addSplit(splits, duration, at)
    if (next !== splits) {
      change(cuts, next)
      setPartTime(at)
    }
  }
  // ផ្នែកដែលជ្រើស: លុប (បន្ថែមទៅ cuts) ឬស្តារ បើលុបរួចហើយ
  const togglePart = () => {
    if (!part) return
    change(partCut ? subtract(cuts, part) : add(cuts, part))
  }
  const trim = (side: 'start' | 'end', at: number, exact: boolean) =>
    change(trimTo(cuts, duration, side, exact ? at : snapToWords(at, spoken)))

  // keyboard: Delete/Backspace លុប (ពាក្យដែលជ្រើស, បើគ្មាន = ផ្នែក timeline), S = Split (Alt+S = ចំណុចពិត),
  // Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo, Escape ដកការជ្រើស
  const keys = useRef({ deleteSelection, undo, redo, splitHere, togglePart, hasWords: false })
  useEffect(() => {
    keys.current = { deleteSelection, undo, redo, splitHere, togglePart, hasWords: picked !== null }
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      const ctrl = event.ctrlKey || event.metaKey
      if (event.key === 'Delete' || event.key === 'Backspace') {
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
        setPartTime(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // preview: ពេលចាក់ រំលងការកាត់ (រាល់ frame, មិនមែន timeupdate ដែលមកតែ ~4 ដង/វិនាទី)
  useEffect(() => {
    if (!playing || !cuts.length) return
    let frame = 0
    const tick = () => {
      const node = player.current
      const inside = node ? cutAt(cuts, node.currentTime) : null
      if (node && inside) node.currentTime = Math.min(inside[1] + 0.001, node.duration || inside[1])
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, cuts])


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
  // zoom punch-in ក្នុង preview: ផ្នែករក្សាលេខសេស = 110% (ដូច render)
  const punched = transition === 'punch' && cuts.length > 0 && partIndex(cuts, time) % 2 === 1

  // ពាក្យសកម្មនៅក្នុងទិដ្ឋភាព ពេលវីដេអូចាក់ (block nearest = មិនលោតបើវាឃើញរួច)
  const transcriptBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!playing || active < 0) return
    transcriptBox.current?.querySelector(`[data-at="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, playing])

  const reframe = aspect !== own
  const scene = scenes.find(([start, end]) => time >= start && time < end) ?? null

  // ---- preview Fit: ផ្ទៃខាងក្រោយ + spacing + ជ្រុងមូល (ទំហំគណនាដូច render.fit_foreground_size) ----
  const fitPreview = layout === 'fit' && reframe
  // Manual subject tracking ក្នុង preview: crop កណ្តាលរំកិលតាមផ្លូវ (object-position ដូច x របស់ render)
  const subject = reframe && !fitPreview ? trackAt(look.subjects, time) : null
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
  const exportSettings: ReframeSettings = {
    aspect,
    // ទំហំដូចវីដេអូ = frame ទាំងមូល (center គ្មានកាត់); aspect ផ្សេង = AI reframe តាម layout ដែលជ្រើស
    layouts: reframe ? (LAYOUTS.find((item) => item.value === layout)?.flags ?? []) : [],
    captions: !style.off,
    tool: 'Edit Video',
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      <TopBar crumb={`${video.name} · Edit Video`} onHome={onBack}>
        <span className="flex items-center gap-1">
          <ControlButton label="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}>↶</ControlButton>
          <ControlButton label="Redo (Ctrl+Y)" disabled={!future.length} onClick={redo}>↷</ControlButton>
          {/* CC: បិទ/បើក captions ភ្លាមៗ (ដូច preset "គ្មាន captions") — style ផ្សេងៗនៅដដែល */}
          <button
            type="button"
            aria-pressed={!style.off}
            aria-label={style.off ? 'Captions: OFF' : 'Captions: ON'}
            title={style.off ? 'Captions បិទ — ចុចដើម្បីបើក' : 'Captions បើក — ចុចដើម្បីបិទ (Export គ្មាន captions)'}
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
          onClick={() => onExport(exportSettings, style, cuts, transition, look, { ...motion, animation: style.animation })}
          title={busy ? 'មាន job កំពុងរត់' : !words?.ready ? 'រង់ចាំ transcript' : `--full · ${aspect}${cuts.length ? ` · កាត់ ${cuts.length}` : ''}`}
          className={`min-h-10 cursor-pointer rounded-button border-0 bg-white px-5 type-body font-bold text-bg disabled:cursor-default disabled:opacity-40 ${focusRing}`}
        >
          Export
        </button>
        <AccountButton />
      </TopBar>

      <div className="flex min-h-0 flex-1">
        {/* ---- transcript (ខាងឆ្វេង) ---- */}
        <section aria-label="Transcript" className="flex w-[46%] max-w-[640px] min-w-[360px] flex-col border-r border-line">
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-5 pt-4 pb-3">
            <button
              type="button"
              aria-pressed={panel === 'cleanup'}
              disabled={!words?.ready}
              onClick={() => setPanel((value) => (value === 'cleanup' ? null : 'cleanup'))}
              title={'ស្នើ pause វែង និងពាក្យ "អឺ" ដើម្បីលុប'}
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
                🗑 លុប ({khmerNumber(picked[1] - picked[0] + 1)}) · Delete
              </button>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              <MenuButton label="Filter" icon={<span aria-hidden="true">⏷</span>} menuLabel="Filter transcript" width={260}>
                {() => (
                  <>
                    <MenuItem checked={view.pauses} onClick={() => setView((v) => ({ ...v, pauses: !v.pauses }))}>
                      បង្ហាញ pause (0.46s)
                    </MenuItem>
                    <MenuItem checked={view.fillers} onClick={() => setView((v) => ({ ...v, fillers: !v.fillers }))}>
                      បំលេចពាក្យ filler (um, you know)
                    </MenuItem>
                    <MenuItem checked={view.hideCut} onClick={() => setView((v) => ({ ...v, hideCut: !v.hideCut }))}>
                      លាក់ពាក្យដែលលុប
                    </MenuItem>
                  </>
                )}
              </MenuButton>
              <MenuButton label="Transcript" icon={<span aria-hidden="true">⬇</span>} menuLabel="ទាញយក transcript" width={300}>
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
                      TXT — អត្ថបទ
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
                      ដូចវីដេអូដែល Export: ពាក្យដែលលុបត្រូវដក ហើយពេលក្នុង SRT តាមវីដេអូដែលកាត់. រក្សាទុកក្នុង folder Export.
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
                placeholder="ស្វែងរកពាក្យ"
                aria-label="ស្វែងរកពាក្យ"
                className="w-36 border-0 bg-transparent type-label text-text outline-none placeholder:text-text-4"
              />
              {needle && <span className="type-hint tabular-nums">{khmerNumber(hits)}</span>}
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
                    បើក folder
                  </button>
                </>
              )}
              <button
                type="button"
                aria-label="បិទ"
                onClick={() => setSavedFile(null)}
                className={`ml-auto shrink-0 cursor-pointer rounded-field border-0 bg-transparent px-1.5 text-text-4 hover:text-text ${focusRing}`}
              >
                ✕
              </button>
            </p>
          )}
          <div ref={transcriptBox} className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            {!words ? (
              <p className="type-body text-text-4">…</p>
            ) : !words.ready ? (
              <TranscribeState job={job} busy={busy} onRetry={onTranscribe} />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled
                    title="បន្ថែមវីដេអូមុន/ក្រោយ — Phase 3"
                    className="inline-flex min-h-8 items-center rounded-field border border-line bg-transparent px-2.5 type-hint text-text-4"
                  >
                    + Extend a clip
                  </button>
                  <span className="type-hint text-text-4">ចុចពាក្យ = ជ្រើស · Shift+ចុច = ច្រើន · Delete = លុប · ចុចពាក្យដែលលុប = ស្តារ</span>
                  {cuts.length > 0 && (
                    <span className="ml-auto flex items-center gap-2 type-hint">
                      <span className="text-danger">កាត់ {khmerNumber(cuts.length)} · {removed.toFixed(1)} s</span>
                      <button
                        type="button"
                        onClick={() => change([])}
                        className={`cursor-pointer rounded-field border-0 bg-transparent px-1.5 text-text-3 underline hover:text-text ${focusRing}`}
                      >
                        ស្តារទាំងអស់
                      </button>
                    </span>
                  )}
                </div>
                <p className="m-0 text-[17px] leading-[2.1]">
                  {chunks.map((chunk, at) => {
                    const first = at * CHUNK
                    const local = active >= first && active < first + CHUNK ? active - first : -1
                    // ខ្សែអក្សរមួយតួក្នុងមួយធាតុ: c = លុប, s = ជ្រើស, . = ធម្មតា — memo ប្រៀបធៀបខ្សែនេះ
                    const flags = chunk
                      .map((item, at) =>
                        isCut(cuts, item.start, item.end)
                          ? 'c'
                          : picked && first + at >= picked[0] && first + at <= picked[1]
                            ? 's'
                            : '.',
                      )
                      .join('')
                    return (
                      <Chunk
                        key={first}
                        items={chunk}
                        first={first}
                        active={local}
                        flags={flags}
                        marks={keywordMarks.slice(first, first + CHUNK)}
                        colours={style.keywordColors}
                        fills={fillerMarks.slice(first, first + CHUNK)}
                        showPauses={view.pauses}
                        hideCut={view.hideCut}
                        needle={needle}
                        onItem={onItem}
                      />
                    )
                  })}
                </p>
              </>
            )}
          </div>
        </section>

        {/* ---- preview (កណ្តាល) ---- */}
        <section aria-label="Preview" className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-4 px-5 pt-3">
            <MenuButton label={aspect} icon={<AspectGlyph aspect={aspect} />} menuLabel="ទំហំ (aspect ratio)">
              {(close) =>
                ASPECTS.map((item) => (
                  <MenuItem key={item} checked={item === aspect} onClick={() => (setAspectChoice(item), close())}>
                    <AspectGlyph aspect={item} /> {item}
                    {item === own && <span className="ml-1 text-[12px] font-normal text-text-4">ដូចវីដេអូ</span>}
                  </MenuItem>
                ))
              }
            </MenuButton>
            <MenuButton label={`Layout: ${LAYOUTS.find((item) => item.value === layout)?.label}`} menuLabel="Layout">
              {(close) =>
                LAYOUTS.map((item) => (
                  <MenuItem key={item.value} checked={item.value === layout} onClick={() => (setLayout(item.value), close())}>
                    {item.label}
                  </MenuItem>
                ))
              }
            </MenuButton>
            <BackgroundMenu look={look} onChange={changeLook} />
            <TrackerMenu look={look} scene={scene} onChange={changeLook} onManual={() => (player.current?.pause(), setTrackOpen(true))} />
          </div>
          <p className="shrink-0 px-5 pt-1 type-hint text-text-4">
            {fitPreview
              ? `Export: ${aspect} Fit · preview បង្ហាញ Background — ពេល render, AI ប្រើ Fit តែលើ shot ស្ងៀម (slide), shot ផ្សេង = crop កណ្តាល`
              : reframe
              ? `Export: AI reframe ទៅ ${aspect} (${exportSettings.layouts.join(', ')}) · preview ជាការកាត់កណ្តាល`
              : 'Export: ទំហំដើម — frame ទាំងមូល + subtitles'}
          </p>

          <div className="flex min-h-0 flex-1 items-center justify-center p-5">
            <div
              ref={stage}
              className="relative max-h-full max-w-full overflow-hidden rounded-[10px] bg-black"
              style={{ aspectRatio: RATIO[aspect], height: aspect === '16:9' ? 'auto' : '100%', width: aspect === '16:9' ? '100%' : 'auto' }}
            >
              {/* Motion preview រំកិលប្រអប់នេះ (backdrop + video) — caption នៅក្រៅ ដូច render */}
              <div ref={motionBox} className="absolute inset-0">
              {fitPreview && <FitBackdrop look={look} player={player} scale={previewScale} />}
              <video
                ref={player}
                src={sourceUrl(video.path)}
                preload="metadata"
                onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                style={fitPreview ? fitStyle : { ...(punched ? { transform: 'scale(1.1)' } : {}), ...(followX !== null ? { objectPosition: `${followX}% 50%` } : {}) }}
                className={fitPreview ? 'absolute object-cover' : 'size-full object-cover'}
              />
              </div>
              <LiveCaption cues={wholeCues} time={time} style={style} scale={previewScale} aspect={aspect} playing={playing} />
            </div>
          </div>

          {/* ---- ⏮ ▶ ⏭ + ពេល ---- */}
          <div className="flex shrink-0 items-center justify-center gap-5 border-t border-line px-5 py-2.5">
            <ControlButton label="ថយក្រោយ 5 វិនាទី" onClick={() => seek(Math.max(0, time - 5))}>⏮</ControlButton>
            <ControlButton
              label={playing ? 'Pause' : 'Play'}
              onClick={() => (playing ? player.current?.pause() : void player.current?.play())}
            >
              {playing ? '❚❚' : <PlayMark size={16} />}
            </ControlButton>
            <ControlButton label="ទៅមុខ 5 វិនាទី" onClick={() => seek(Math.min(length, time + 5))}>⏭</ControlButton>
            <span className="type-body tabular-nums">
              {stamp(time)} <span className="text-text-4">/ {stamp(duration)}</span>
              {cuts.length > 0 && <span className="ml-2 text-danger">→ {stamp(Math.max(0, duration - removed))}</span>}
            </span>
          </div>
        </section>

        {/* ---- Captions (ផ្ទាំង) + toolbar ខាងស្តាំ ---- */}
        {panel === 'motion' && (
          <aside aria-label="Motion" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line p-4">
            <MotionPanel
              motion={motion}
              onChange={(patch) => setMotion((current) => ({ ...current, ...patch }))}
              transition={transition}
              onTransition={setTransition}
              cutCount={cuts.length}
            />
          </aside>
        )}
        {panel === 'cleanup' && (
          <aside aria-label="Speech cleanup" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line p-4">
            <CleanupPanel
              project={project}
              onSeek={seek}
              onApply={(found) => {
                change(normalize([...cuts, ...found.map((item): Cut => [item.start, item.end])]))
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
              footer={<p className="m-0 shrink-0 border-t border-line px-5 py-3 type-hint text-text-4">Style នេះដុតចូលវីដេអូពេល Export</p>}
            />
          </aside>
        )}
        <nav aria-label="ឧបករណ៍" className="flex w-[92px] shrink-0 flex-col items-center gap-2 border-l border-line py-4">
          <ToolButton label="Captions" on={panel === 'captions'} onClick={() => setPanel((value) => (value === 'captions' ? null : 'captions'))}>
            <SubtitlesIcon size={20} weight={1.75} />
          </ToolButton>
          <ToolButton label="Motion" on={panel === 'motion'} onClick={() => setPanel((value) => (value === 'motion' ? null : 'motion'))}>
            <MotionIcon />
          </ToolButton>
          <ToolButton label="AI enhance" note="Phase 3">✦</ToolButton>
          <ToolButton label="Brand template" note="Phase 3">◧</ToolButton>
          <ToolButton label="B-roll" note="Phase 3">▣</ToolButton>
        </nav>
      </div>

      {/* timeline ពេញទទឹង ដូចរូប OpusClip (ផ្នែកទី ៣) */}
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
        cuts={cuts}
        splits={splits}
        part={part}
        partCut={partCut}
        onPick={setPartTime}
        onSplit={splitHere}
        onTogglePart={togglePart}
        onTrim={trim}
        noTrack={look.tracking ? look.no_track : []}
        subjects={look.subjects.map((item): [number, number] => [item.start, item.end])}
        time={time}
        playing={playing}
        audioReady={Boolean(words?.ready)}
        onSeek={seek}
      />
    </div>
  )
}

/** ជំហានមួយក្នុង undo/redo: ការកាត់ និងចំណុច split ជាមួយគ្នា. */
type Snapshot = { cuts: Cut[]; splits: number[] }

/** ផ្នែកមួយនៃ transcript — `memo`: គូរឡើងវិញតែពេលពាក្យសកម្មចូល/ចេញពីផ្នែកនេះ ឬការស្វែងរកប្តូរ. */
const Chunk = memo(function Chunk({
  items,
  first,
  active,
  flags,
  marks,
  colours,
  fills,
  showPauses,
  hideCut,
  needle,
  onItem,
}: {
  items: EditorItem[]
  first: number
  active: number // index ក្នុងផ្នែកនេះ, -1 = គ្មាន
  flags: string // មួយតួក្នុងមួយធាតុ: c = លុប, s = ជ្រើស
  marks: string // មួយតួក្នុងមួយធាតុ: 1 / 2 = ពាក្យសំខាន់ (ពណ៌ទី ១ / ២), - ឬទទេ = ធម្មតា
  colours: [string, string] // ពណ៌ពាក្យសំខាន់ពីរ (Captions › Font)
  fills: string // មួយតួក្នុងមួយធាតុ: f = ពាក្យ filler (Filter)
  showPauses: boolean // Filter: បង្ហាញស្លាក pause
  hideCut: boolean // Filter: លាក់ពាក្យ និង pause ដែលលុប
  needle: string
  onItem: (index: number, shift: boolean) => void
}) {
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
              data-at={first + at}
              onClick={(event) => onItem(first + at, event.shiftKey)}
              title={gone ? 'បានលុប — ចុចដើម្បីស្តារ' : `ស្ងាត់ ${item.pause.toFixed(2)} វិនាទី`}
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
              data-at={first + at}
              data-keyword={keyword ? mark : undefined}
              onClick={(event) => onItem(first + at, event.shiftKey)}
              title={gone ? 'បានលុប — ចុចដើម្បីស្តារ' : keyword ? 'ពាក្យសំខាន់ (AI keywords highlighter)' : undefined}
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
                        ? 'bg-gold-tint text-gold'
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

/** look ពី sidecar ដោយគ្មាន field ផ្សេង (ឧ. `name`) — ដូច្នេះ PUT ផ្ញើតែ look ប៉ុណ្ណោះ. */
function lookOf(answer: Partial<Look>): Look {
  const { background, blur, color, image, radius, spacing, tracking, no_track, subjects } = { ...DEFAULT_LOOK, ...answer }
  return { background, blur, color, image, radius, spacing, tracking, no_track, subjects }
}

export function TranscribeState({ job, busy, onRetry }: { job: JobStatus | null; busy: boolean; onRetry: () => void }) {
  const fraction = job?.progress.fraction?.transcribe ?? 0
  if (job?.state === 'failed')
    return (
      <div className="flex flex-col items-start gap-3 py-10">
        <p className="type-body text-danger">Transcribe មិនបាន: {job.error || 'មើល log'}</p>
        <button type="button" onClick={onRetry} className={`cursor-pointer rounded-button border-0 bg-field px-4 py-2 type-label text-text ${focusRing}`}>
          សាកម្តងទៀត
        </button>
      </div>
    )
  return (
    <div className="flex flex-col gap-3 py-10">
      <p className="type-body-lg font-semibold">
        {busy && !job ? 'រង់ចាំ job ផ្សេងចប់ (GPU តែមួយ)…' : 'កំពុង transcribe វីដេអូនេះ…'}
      </p>
      <p className="type-hint text-text-3">លើកដំបូងតែប៉ុណ្ណោះ — transcript ត្រូវបានរក្សាទុកសម្រាប់លើកក្រោយ (Whisper លើកុំព្យូទ័រនេះ)</p>
      <div className="h-2 overflow-hidden rounded-full bg-raised-2" role="progressbar" aria-valuenow={Math.round(fraction * 100)}>
        <div className="h-full bg-ok transition-[width]" style={{ width: `${Math.max(3, fraction * 100)}%` }} />
      </div>
      {fraction > 0 && <span className="type-hint tabular-nums text-text-3">{khmerNumber(Math.round(fraction * 100))}%</span>}
    </div>
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
      className={`flex w-[78px] cursor-pointer flex-col items-center gap-1 rounded-button border-0 px-1 py-2.5 text-[12px] font-semibold disabled:cursor-default disabled:opacity-40 ${
        on ? 'bg-gold-tint text-gold' : 'bg-transparent text-text-2 hover:bg-field'
      } ${focusRing}`}
    >
      <span className="text-[19px] leading-none">{children}</span>
      {label}
    </button>
  )
}
