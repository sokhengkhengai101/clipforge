import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { api, sourceFrameUrl, type ReframeShot } from '../api'
import { outputTime, partAtOutput, sourceAt } from '../cutList'
import { asParts, edgeLimit, trimClip, type Clip } from '../clipList'
import { focusRing } from '../kit/styles'
import { kindOf } from './layoutKinds'
import { useT } from '../i18n'

const TILE_PX = 100 // ទទឹងរូបតូចមួយលើ timeline (រូប OpusClip)
const TILE_ZOOMED_PX = 50 // zoom ចូល: រូបមួយគ្រប់ពេលខ្លីជាង ដូច្នេះវាជិតនឹង preview ត្រង់ playhead
const MAX_BLOCK_TILES = 200 // ក្នុងប្លុកមួយ — loading=lazy ដករូបតែអ្វីដែលជិតឃើញ
const MAX_TILES = 60 // FFmpeg ដករូបម្តងមួយ — កំណត់ចំនួន ដើម្បីកុំឲ្យ sidecar រវល់ពេក
const ZOOMS = [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8] // 1 = Fit (ពេញទទឹង); តូចជាង 1 = ប្លុកខ្លីជាង timeline (រូប OpusClip)
const ADD_CLIP_PX = 80 // = w-20 នៃប៊ូតុង +
const ADD_CLIP_GAP = 12
const JOIN_MIN_PX = 28 // ប្លុកតូចជាងនេះ: គ្មានប៊ូតុង transition (= ទំហំអប្បបរមានៃ ‖)
const TRIM_SIDES = ['start', 'end'] as const
// Trim handle (រូប OpusClip): ‖ ពណ៌សលើជួររូបប៉ុណ្ណោះ, មិនលើ waveform; គ្មានផ្ទៃ ដូច្នេះរូបនៅតែឃើញ
const TRIM_HANDLE = 'absolute top-[calc(56px+var(--space-h))] z-[2] flex h-14 w-5 cursor-ew-resize touch-none items-center justify-center'
const TRIM_HANDLE_PX = 20 // = w-5: ‖ នៅកណ្តាល ដូច្នេះឃ្លាតពីគែមប្លុក ~6 px (រូប OpusClip)
const EDGE_PX = 10 // ចន្លោះឆ្វេង/ស្តាំក្នុង scroller: ក្បាល playhead នៅ 0 s មិនត្រូវកាត់ពាក់កណ្តាល

// កម្ពស់ថេររបស់ជួររូបតូច (px); waveform = h-12 (48 px). ពេលអូសគែមលើរបស់ timeline ទាំងពីរនេះមិនប្តូរទេ —
// មានតែ **តំបន់ទំនេរ** រវាង ruler និង band ប៉ុណ្ណោះដែលប្តូរ (ដូច OpusClip: កន្លែងសម្រាប់ layer នៅពេលក្រោយ)
const STRIP_PX = 56
const SPACE_DEFAULT = 96 // តំបន់ទំនេរលំនាំដើម (អ្នកអភិវឌ្ឍ: "មានទំហំដើមខ្លះ ដូច OpusClip")
const SPACE_KEY = 'kcs.timelineSpace'
// កម្ពស់ timeline ពេលតំបន់ទំនេរ = 0 (toolbar, ruler, band, រូប, waveform, scrollbar) — វាស់ 247 px
const BASE_PX = 247

/** តំបន់ទំនេរធំបំផុត: timeline ទាំងមូលមិនលើស 55% នៃ window — ទុកកន្លែងឲ្យ preview. តូចបំផុត = 0. */
function spaceMax(): number {
  return Math.max(0, Math.floor(window.innerHeight * 0.55 - BASE_PX))
}
const clampSpace = (px: number) => Math.round(Math.min(spaceMax(), Math.max(0, px)))

function loadSpace(): number {
  try {
    const saved = localStorage.getItem(SPACE_KEY)
    return clampSpace(saved === null ? SPACE_DEFAULT : Number(saved) || 0)
  } catch {
    return clampSpace(SPACE_DEFAULT)
  }
}

function saveSpace(px: number) {
  try {
    if (px === SPACE_DEFAULT) localStorage.removeItem(SPACE_KEY)
    else localStorage.setItem(SPACE_KEY, String(px))
  } catch {
    // private window / storage បិទ — ទំហំនៅតែប្តូរ គ្រាន់តែមិនចាំ
  }
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

/** បន្ទាត់វាស់ (រូប OpusClip): លេខតែនៅចំណុចធំ (ឃ្លាតយ៉ាងហោច 500 px, ឧ. 0 · 30) និងចំណុចតូចៗនៅចន្លោះ
 *  (ឃ្លាតយ៉ាងហោច 60 px ហើយចែកចំណុចធំដាច់ ដើម្បីឲ្យលេខធ្លាក់ត្រូវលើចំណុចមួយ). */
function rulerSteps(pxPerSecond: number): { labelEvery: number; dotEvery: number } {
  const labelEvery = STEPS.find((step) => step * pxPerSecond >= 500) ?? 7200
  const dotEvery = STEPS.find((step) => labelEvery % step === 0 && step * pxPerSecond >= 60) ?? labelEvery
  return { labelEvery, dotEvery }
}

/** `00:01.06` ដូចរូប OpusClip: នាទី:វិនាទី.ភាគរយ. */
function stamp(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, '0')}:${(safe - minutes * 60).toFixed(2).padStart(5, '0')}`
}

function label(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : String(rest)
}

/** Timeline ខាងក្រោម editor (ផ្នែកទី ៣) — រូប OpusClip: toolbar (ឧបករណ៍ · ⏮ ▶ ⏭ + ពេល · zoom),
 *  បន្ទាត់វាស់, ជួរ layout, ប្លុក clip រូបតូច (+ សងខាង), waveform, playhead.
 *
 *  ពិតទាំងអស់: រូបតូចពី `/probe/frame` (frame ពិតនៃវីដេអូដើម), waveform ពី `audio.wav`
 *  (`/projects/{name}/waveform`), ជួរ layout ពី `layout.json` នៃ reframe ចុងក្រោយ (បើធ្លាប់ធ្វើ).
 *  ចុច ឬអូសលើ timeline = វីដេអូលោត; zoom 0.1-8x (1x = Fit); playhead តាមពេលចាក់. */
export function EditorTimeline({
  project,
  videoPath,
  duration,
  time,
  playing,
  audioReady,
  clips,
  playingPart = -1,
  noTrack = [],
  subjects = [],
  selected = null,
  onSelect,
  linkable = false,
  onLink,
  canSplit = false,
  onSplit,
  deletable = false,
  onTogglePart,
  snap = true,
  onSnap,
  initialVolume = 100,
  onVolume,
  onMoveBlock,
  onTrimBlock,
  onAddTransition,
  onSeek,
  onScrub,
  onTogglePlay,
}: {
  project: string
  videoPath: string
  duration: number
  time: number
  playing: boolean
  audioReady: boolean // transcript មានហើយ = audio.wav មាន (waveform)
  clips: Clip[] // ផ្នែកនៃវីដេអូដើមតាមលំដាប់ចេញ — ប្លុកនីមួយៗលើ timeline
  playingPart?: number // part ដែលកំពុងចាក់ (លំដាប់ចេញ); -1 = មិនចាក់
  noTrack?: [number, number][] // scene ដែលបិទ tracking — ស៊ុមដាច់ៗលើជួរ layout
  subjects?: [number, number][] // scene ដែលតាមប្រធានបទដោយដៃ — ស៊ុម gold
  selected?: [number, number] | null // clip ដែលជ្រើស [ទីមួយ, ចុងក្រោយ] ក្នុងបញ្ជី (ស៊ុមស + ‖)
  onSelect?: (range: [number, number] | null) => void // ចុច = មួយ; អូសចតុកោណ = ច្រើន
  linkable?: boolean // clip ដែលជ្រើសបន្តពីគ្នា -> Link អាចភ្ជាប់វា
  onLink?: () => void
  canSplit?: boolean
  onSplit?: (exact: boolean) => void
  deletable?: boolean
  onTogglePart?: () => void
  snap?: boolean // ប៊ូតុងមេដែក: Split / trim ជាប់គែមពាក្យ
  onSnap?: () => void
  initialVolume?: number // ប៊ូតុង Speaker: កម្រិតសំឡេង preview 0-100 ពេលបើក editor
  onVolume?: (volume: number) => void
  onMoveBlock?: (from: number, gap: number) => void // អូសប្លុក: ទៅចន្លោះ `gap` (0 = មុនប្លុកទី 0)
  onTrimBlock?: (index: number, side: 'start' | 'end', seconds: number, alt: boolean) => void // អូសគែមប្លុក
  onAddTransition?: (index: number) => void // ចុចប៊ូតុងនៅចន្លោះប្លុក: index = ប្លុកដែលចាប់ផ្តើមនៅទីនោះ
  onSeek: (seconds: number, clip?: number) => void // clip = ប្លុកណា (ពេលដើមមួយអាចនៅពីរប្លុក)
  onScrub?: (seconds: number) => void // ពេលកំពុងអូស: តែវីដេអូ seek (គ្មាន setTime របស់ editor); លែង = onSeek
  onTogglePlay: () => void
}) {
  const t = useT()
  const [hidden, setHidden] = useState(false)
  const [zoom, setZoom] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)

  // ---- អូសគែមលើ: តំបន់ទំនេរប្តូរ (អថេរ CSS `--space-h`). ពេលអូស សរសេរវាផ្ទាល់ (មិន setState) ដើម្បីកុំ
  // render timeline (រូប 60 + waveform) រាល់ការរំកិលមេម៉ៅ; state ប្តូរតែម្តងពេលលែង ----
  const [space, setSpace] = useState(loadSpace)
  const section = useRef<HTMLElement>(null)
  const resize = useRef<{ y: number; space: number; now: number } | null>(null)
  const applySpace = (px: number) => section.current?.style.setProperty('--space-h', `${px}px`)
  const commitSpace = (px: number) => {
    applySpace(px)
    setSpace(px)
    saveSpace(px)
  }
  const [width, setWidth] = useState(1000)

  // ទទឹងពិតនៃផ្ទៃ timeline (ប្តូរពេល window ប្តូរទំហំ)
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const observer = new ResizeObserver(() => setWidth(box.clientWidth - 2 * EDGE_PX))
    observer.observe(box)
    setWidth(box.clientWidth - 2 * EDGE_PX)
    return () => observer.disconnect()
  }, [hidden])

  const [peaks, setPeaks] = useState<number[]>([])
  useEffect(() => {
    if (!audioReady) return
    let stale = false
    api.waveform(project).then((answer) => !stale && setPeaks(answer.peaks)).catch(() => {})
    return () => {
      stale = true
    }
  }, [project, audioReady])

  // shot + layout ពី reframe ចុងក្រោយរបស់វីដេអូនេះ (Auto Reframe / Auto Subtitles / Edit Video export)
  const [shots, setShots] = useState<ReframeShot[]>([])
  useEffect(() => {
    let stale = false
    api
      .reframes(project)
      .then((results) => {
        const newest = [...results].sort((a, b) => b.modified - a.modified)[0]
        if (!stale) setShots(newest?.shots ?? [])
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [project])

  const total = Math.max(1, duration)
  // ខ្នាត px/s ថេរ: កាត់ ឬពង្រីកប្លុកមិនប្តូរវាទេ, ប្តូរតែ zoom ឬ Fit (Fit = ប្រវែងបច្ចុប្បន្នពេញទទឹង)
  const [fitSeconds, setFitSeconds] = useState<number | null>(null)
  const scaleSeconds = Math.max(0.5, fitSeconds ?? total)

  // Timeline បង្ហាញតែអ្វីដែល Export ចេញ, តាមលំដាប់ចេញ: clip នីមួយៗ = ប្លុកមួយ. xOf / tOf: ពេលក្នុងវីដេអូដើម ↔ px
  // អូស || ចេញ: ប្លុកធំឡើងភ្លាម ហើយរុញប្លុកក្រោយៗ (មិនត្រួតលើគ្នា)
  const [edgeDrag, setEdgeDrag] = useState<{ index: number; side: 'start' | 'end'; at: number } | null>(null)
  const edgeOut = edgeDrag !== null && clips[edgeDrag.index] !== undefined && (edgeDrag.side === 'start' ? edgeDrag.at < clips[edgeDrag.index][0] : edgeDrag.at > clips[edgeDrag.index][1])
  const liveClips = useMemo(() => (edgeOut && edgeDrag ? trimClip(clips, edgeDrag.index, edgeDrag.side, edgeDrag.at) : clips), [clips, edgeOut, edgeDrag])
  const outParts = useMemo(() => asParts(liveClips), [liveClips])
  const outSeconds = outParts.reduce((s, p) => s + (p.end - p.start), 0)
  const baseSeconds = clips.reduce((sum, clip) => sum + (clip[1] - clip[0]), 0)
  const pxPerSecond = (width * zoom) / scaleSeconds
  const grownPx = (outSeconds - baseSeconds) * pxPerSecond
  const rowWidth = outSeconds * pxPerSecond // ជួរ band / រូប / waveform ប្រវែងស្មើប្លុក
  const liveContent = Math.max(width, rowWidth) // ផ្ទៃ timeline មិនតូចជាងទិដ្ឋភាព: ruler បន្តហួសចុងវីដេអូ
  const addClipInside = rowWidth + ADD_CLIP_GAP + ADD_CLIP_PX <= width // មានកន្លែង: + នៅជាប់ប្លុក

  // Pre-compute each part's output x offset (only rebuilt when parts or pxPerSecond change)
  const partOffsets = useMemo(() => {
    let px = 0
    return outParts.map(p => {
      const entry = { start: p.start, end: p.end, insert: p.insert, outX: px }
      px += (p.end - p.start) * pxPerSecond
      return entry
    })
  // pxPerSecond changes with zoom/width but useMemo deps must be stable values
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outParts, pxPerSecond])

  const xOf = (sourceTime: number): number => {
    for (const p of partOffsets) {
      if (sourceTime >= p.start && sourceTime < p.end) return p.outX + (sourceTime - p.start) * pxPerSecond
    }
    const last = partOffsets[partOffsets.length - 1]
    return last ? last.outX + (last.end - last.start) * pxPerSecond : 0
  }
  // px លើ timeline -> ពេល និងប្លុក (ហួសចុង = ចុងប្លុកចុងក្រោយ មិនមែនចុងវីដេអូដើមទេ: ប្លុកចុងក្រោយអាចជាផ្នែកដើមវីដេអូ)
  const placeOf = (x: number) => partAtOutput(outParts, x / pxPerSecond)
  // ចន្លោះ [a, b] -> {left, width}: គូរក្នុង part ដែលមាន `a` (xOf(b) អាចនៅប្លុកផ្សេងទាំងស្រុង)
  const box = (a: number, b: number, min = 2) => {
    const inPart = partOffsets.find((p) => a >= p.start - 0.001 && a < p.end)
    if (!inPart || b - a <= 0.001) return null
    return { left: xOf(a), width: Math.max(min, (Math.min(b, inPart.end) - a) * pxPerSecond) }
  }
  const stillParts = useMemo(() => asParts(clips), [clips]) // រូបមិនប្តូរពេលកំពុងអូស: រូបថ្មីនីមួយៗ = FFmpeg ម្តង
  const tiles = Math.min(MAX_TILES, Math.max(1, Math.round(rowWidth / TILE_PX)))
  const { labelEvery, dotEvery } = rulerSteps(pxPerSecond)
  // ពេល scrub: playhead និងម៉ោងនៅក្នុង timeline ផ្ទាល់ (state តូច) — editor មិន render រាល់ចលនា
  // (វីដេអូ 35 នាទី: render transcript 6600 ពាក្យ ~140 ms រាល់ចលនា = ញាក់); លែង = onSeek ម្តង
  // ជាពេលក្នុងវីដេអូ Export មិនមែនវីដេអូដើម: ពេលដើមមួយអាចនៅពីរកន្លែង ហើយ playhead ត្រូវនៅកន្លែងដែលកំពុងអូស
  const [scrubAt, setScrubAt] = useState<number | null>(null)
  // output mode: ម៉ោង និង playhead រាប់តាមវីដេអូដែល Export (ពេលមួយអាចនៅពីរកន្លែង: part ដែលកំពុងចាក់ឈ្នះ)
  const shownOut = scrubAt ?? outputTime(outParts, time, playingPart)
  const playheadX = shownOut * pxPerSecond
  // ⏮ ⏭ និងព្រួញ: ដើរតាមវីដេអូដែល Export មិនមែនលោតទៅប្លុកផ្សេង
  const stepBy = (delta: number) => {
    const place = partAtOutput(outParts, Math.max(0, Math.min(outSeconds - 0.05, shownOut + delta)))
    onSeek(place.time, place.index)
  }

  // ពេលចាក់: រក្សា playhead ក្នុងទិដ្ឋភាព (រំកិលម្តងមួយទំព័រ ដូច editor វីដេអូទូទៅ)
  useEffect(() => {
    const box = scroller.current
    if (!box || !playing) return
    if (playheadX < box.scrollLeft || playheadX > box.scrollLeft + box.clientWidth - 40) {
      box.scrollLeft = Math.max(0, playheadX - 40)
    }
  }, [playheadX, playing])

  // ចុច ឬអូស = seek (pointer capture: អូសចេញក្រៅ timeline ក៏នៅតែតាម)
  // អូស scrub: ទីតាំងនៅ timeline + វីដេអូ seek (គ្មាន onScrub = seek ពេញលេញដូចមុន)
  const scrubTo = (event: PointerEvent<HTMLDivElement>) => {
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left
    const place = placeOf(x)
    if (!onScrub) return onSeek(place.time, place.index)
    setScrubAt(Math.max(0, Math.min(outSeconds, x / pxPerSecond)))
    onScrub(place.time)
  }

  // ---- ចតុកោណជ្រើស (marquee): មាន split ហើយ អូសលើ strip / band / waveform = ជ្រើសផ្នែក;
  // អូសលើ ruler (ឬមិនទាន់មាន split) = scrub ដូចមុន; ចុចដោយមិនអូស = seek + ជ្រើសផ្នែកមួយ ----
  const RULER_PX = 28 // កម្ពស់ ruler (h-7)
  const press = useRef<{ x: number; y: number; scrub: boolean; moved: boolean; block: number | null } | null>(null)

  // ---- អូសប្លុកលើជួររូប (រូប OpusClip): ប្រអប់ដាច់ៗប្រវែងស្មើប្លុកនៅកន្លែងដើម, ប្លុកតាម mouse,
  // បន្ទាត់ gold = កន្លែងទម្លាក់; លែង = ប្លុកឆក់ជាប់គ្នា (គ្មានចន្លោះ) ----
  const blocks = useMemo(() => {
    let px = 0
    return outParts.map((block) => {
      const w = (block.end - block.start) * pxPerSecond
      const x = px
      px += w
      return { ...block, x, w }
    })
  }, [outParts, pxPerSecond])
  const isSelectedX = (x: number) => {
    if (!selected || !blocks[selected[1]]) return false
    return x >= blocks[selected[0]].x - 0.5 && x < blocks[selected[1]].x + blocks[selected[1]].w - 0.5
  }
  const [dragBlock, setDragBlock] = useState<{ from: number; x: number; grab: number; gap: number } | null>(null)
  const selectAt = (x: number) => {
    const at = blockAt(x)
    onSelect?.(at >= 0 ? [at, at] : null)
  }
  const blockAt = (x: number) => blocks.findIndex((block) => x >= block.x && x < block.x + block.w)
  // ចន្លោះដែល mouse នៅ: 0 = មុនប្លុក 0, blocks.length = ក្រោយប្លុកចុង (ប្លុកដែលកំពុងអូសមិនរាប់)
  const gapAt = (x: number, from: number) => {
    const found = blocks.findIndex((block, at) => at !== from && x < block.x + block.w / 2)
    return found < 0 ? blocks.length : found
  }
  const isNewPlace = (from: number, gap: number) => gap !== from && gap !== from + 1
  const dropBlock = (from: number, gap: number) => {
    if (isNewPlace(from, gap)) onMoveBlock?.(from, gap) // លែងនៅកន្លែងដើម = ត្រឡប់មកវិញ
  }
  // Escape = បោះបង់ការអូស (ប្លុកត្រឡប់ទៅកន្លែងដើម)
  const dragging = dragBlock !== null
  useEffect(() => {
    if (!dragging) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      press.current = null
      setDragBlock(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dragging])
  // ---- អូសគែមប្លុក: អូសចូល = កាត់; អូសចេញ = យកផ្នែកដែលកាត់មកវិញ រហូតដល់ clip ជិតបំផុតតាមពេល (`edgeLimit`),
  // គ្មានអ្វីចាក់ពីរដងទេ; ប្លុកប្តូរទំហំពេលលែង (= undo មួយជំហាន); ចុចពីរដង = ទៅដល់ដែននោះភ្លាម ----
  const edgeGrabX = useRef(0)
  // អូសគែមចុងហួសទិដ្ឋភាព: scroller រំកិលតាម ឲ្យ || នៅតែឃើញ
  const edgeEndX = edgeOut && edgeDrag?.side === 'end' ? blocks[edgeDrag.index].x + blocks[edgeDrag.index].w : null
  useEffect(() => {
    const box = scroller.current
    if (!box || edgeEndX === null) return
    const past = edgeEndX + EDGE_PX + 40 - (box.scrollLeft + box.clientWidth)
    if (past > 0) box.scrollLeft += past
  }, [edgeEndX])
  const MIN_BLOCK_SEC = 0.5
  const edgeHandle = (index: number, side: 'start' | 'end') => {
    const limit = edgeLimit(clips, index, side, total)
    const [clipStart, clipEnd] = clips[index]
    const edge = side === 'start' ? clipStart : clipEnd // គែមមុនអូស: `blocks` ប្រែតាមការអូសរួចហើយ
    return {
      onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        edgeGrabX.current = event.clientX // រាប់ពីកន្លែងចុច: ចុចកណ្តាល || គែមមិនលោតមក mouse
        setEdgeDrag({ index, side, at: edge })
      },
      onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        if (edgeDrag?.index !== index || edgeDrag.side !== side) return
        const raw = edge + (event.clientX - edgeGrabX.current) / pxPerSecond
        const at = side === 'start' ? Math.max(limit, Math.min(raw, clipEnd - MIN_BLOCK_SEC)) : Math.min(limit, Math.max(raw, clipStart + MIN_BLOCK_SEC))
        setEdgeDrag({ index, side, at })
        onScrub?.(at) // preview បង្ហាញ frame ត្រង់គែមថ្មី
      },
      onPointerUp: (event: PointerEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        const at = edgeDrag?.at
        setEdgeDrag(null)
        if (at === undefined || Math.abs(at - edge) <= 0.001) return // ចុចដោយមិនអូស មិនមែនការកាត់ទេ
        onTrimBlock?.(index, side, at, event.altKey) // editor seek ទៅគែមថ្មី (ក្រោយ Snap)
      },
      onDoubleClick: (event: MouseEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        if (Math.abs(limit - edge) > 0.001) onTrimBlock?.(index, side, limit, true)
      },
    }
  }
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const pointIn = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const track = useRef<HTMLDivElement>(null)

  const timeSpan = liveContent / pxPerSecond // ruler គូរពេញផ្ទៃ ទោះហួសចុងវីដេអូ
  const zoomAt = ZOOMS.indexOf(zoom)
  return (
    <section
      ref={section}
      aria-label="Timeline"
      className="relative shrink-0 border-t border-line bg-chrome"
      style={{ '--space-h': `${hidden ? 0 : space}px` } as CSSProperties}
    >
      {/* គែមលើ: អូសឡើង = តំបន់ទំនេរធំ, ចុះ = តូច (ដល់ 0); ↑/↓ = 8 px; ចុចពីរដង = ទំហំដើម.
          គ្មានពណ៌ ឬប៊ូតុង (អ្នកអភិវឌ្ឍ) — cursor ↕ ប្រាប់ថាអូសបាន */}
      {!hidden && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('ពង្រីក / បង្រួម timeline', 'Resize the timeline')}
          aria-valuemin={0}
          aria-valuemax={spaceMax()}
          aria-valuenow={space}
          tabIndex={0}
          title={t('អូសដើម្បីពង្រីក / បង្រួម timeline · ចុចពីរដង = ទំហំដើម', 'Drag to resize the timeline · double-click = default')}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            resize.current = { y: event.clientY, space, now: space }
            document.body.style.cursor = 'row-resize'
          }}
          onPointerMove={(event) => {
            const start = resize.current
            if (!start) return
            start.now = clampSpace(start.space + (start.y - event.clientY)) // 1 px មេម៉ៅ = 1 px timeline
            applySpace(start.now)
          }}
          onPointerUp={() => {
            const done = resize.current
            if (!done) return
            resize.current = null
            document.body.style.cursor = ''
            commitSpace(done.now)
          }}
          onDoubleClick={() => commitSpace(clampSpace(SPACE_DEFAULT))}
          onKeyDown={(event) => {
            const delta = event.key === 'ArrowUp' ? 8 : event.key === 'ArrowDown' ? -8 : 0
            if (!delta) return
            event.preventDefault()
            event.stopPropagation() // កុំឲ្យ editor យក ↑/↓
            commitSpace(clampSpace(space + delta))
          }}
          className={`absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none ${focusRing}`}
        />
      )}
      {/* toolbar ៣ ផ្នែក: ឧបករណ៍ (ឆ្វេង) · ⏮ ▶ ⏭ + ពេល (កណ្តាល) · zoom (ស្តាំ) */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 py-2">
        <div role="group" aria-label="Timeline tools" className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setHidden((value) => !value)}
            className={`flex cursor-pointer items-center gap-2 rounded-field border-0 bg-transparent px-2 py-1.5 type-label font-semibold whitespace-nowrap text-text hover:bg-field ${focusRing}`}
          >
            <HideIcon /> {hidden ? 'Show timeline' : 'Hide timeline'}
          </button>
          {onSplit && (
            <>
              <ToolIcon
                label={t('Split នៅ playhead (S) · Alt = ផ្ទុយពី Snap', 'Split at the playhead (S) · Alt = the opposite of Snap')}
                disabled={!canSplit}
                onClick={(event) => onSplit(event.altKey)}
              >
                <SplitIcon />
              </ToolIcon>
              {/* Link: ភ្ជាប់ clip ដែលជ្រើស ហើយបន្តពីគ្នា ជាមួយ (ដក Split) */}
              <ToolIcon
                label={
                  linkable
                    ? t('ភ្ជាប់ផ្នែកដែលជ្រើសជាផ្នែកតែមួយ', 'Link the selected parts into one')
                    : blocks.length < 2
                      ? t('Split ជាមុនសិន ដើម្បីបង្កើតផ្នែក', 'Split first to create parts')
                      : t('អូសចតុកោណលើផ្នែកច្រើន ដើម្បីភ្ជាប់វា', 'Drag a box over several parts to link them')
                }
                disabled={!linkable}
                onClick={onLink}
              >
                <LinkIcon />
              </ToolIcon>
              {/* Delete: clip ដែលជ្រើស (វីដេអូត្រូវមានអ្វីមួយនៅសល់) */}
              <ToolIcon
                label={
                  deletable
                    ? `${t('លុបផ្នែក', 'Delete part')} (Delete)`
                    : blocks.length < 2
                      ? t('Split ជាមុនសិន រួចចុចលើផ្នែកមួយ · ឬអូស ‖ ដើម/ចុង ដើម្បីកាត់', 'Split first, then click a part · or drag ‖ at the start / end to trim')
                      : t('ចុចលើផ្នែកមួយក្នុង timeline ជាមុនសិន', 'Click a part of the timeline first')
                }
                disabled={!deletable}
                onClick={onTogglePart}
                tone={deletable ? 'text-danger' : undefined}
              >
                <TrashIcon />
              </ToolIcon>
            </>
          )}
          {/* Speaker: កម្រិតសំឡេង preview ប៉ុណ្ណោះ (Export មិនប្តូរ) */}
          {onVolume && <VolumeButton initial={initialVolume} onVolume={onVolume} />}
          {/* Snap: ភ្លឺ = Split / trim ‖ ជាប់គែមពាក្យ; បិទ = ចំណុចពិត */}
          {onSnap && (
            <ToolIcon
              label={
                snap
                  ? t('Snap បើក — Split / trim ជាប់គែមពាក្យ (Alt = ចំណុចពិត)', 'Snap on — split / trim stick to word edges (Alt = exact point)')
                  : t('Snap បិទ — Split / trim នៅចំណុចពិត (Alt = ជាប់គែមពាក្យ)', 'Snap off — split / trim at the exact point (Alt = word edges)')
              }
              pressed={snap}
              tone={snap ? 'text-gold' : undefined}
              onClick={onSnap}
            >
              <SnapIcon />
            </ToolIcon>
          )}
          {/* Fit: ប្រវែងបច្ចុប្បន្នពេញទទឹង (ភ្លឺពេលវាពេញទទឹងពិត) */}
          {!hidden && (
            <ToolIcon
              label={t('Fit · បង្ហាញវីដេអូទាំងមូល', 'Fit · show the whole video')}
              pressed={zoom === 1 && Math.abs(scaleSeconds - outSeconds) < 0.05}
              onClick={() => {
                setZoom(1)
                setFitSeconds(outSeconds)
              }}
            >
              <FitIcon />
            </ToolIcon>
          )}
        </div>

        <div role="group" aria-label={t('ចាក់វីដេអូ', 'Playback')} className="flex items-center gap-3">
          <ToolIcon label={t('ថយក្រោយ 5 វិនាទី', 'Back 5 seconds')} onClick={() => stepBy(-5)}>
            <SkipIcon back />
          </ToolIcon>
          <ToolIcon label={playing ? 'Pause' : 'Play'} onClick={onTogglePlay}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </ToolIcon>
          <ToolIcon label={t('ទៅមុខ 5 វិនាទី', 'Forward 5 seconds')} onClick={() => stepBy(5)}>
            <SkipIcon />
          </ToolIcon>
          <span className="ml-3 type-body font-semibold whitespace-nowrap tabular-nums">
            <span className="inline-block text-right" style={{ minWidth: `${stamp(duration).length}ch` }}>{stamp(shownOut)}</span>
            {' '}<span className="mx-1 font-normal text-text-4">/</span>
            <span className="font-normal text-text-3">{stamp(outSeconds)}</span>
          </span>
        </div>

        {!hidden ? (
          <div className="flex items-center justify-end gap-2 type-label text-text-3">
            <span aria-hidden="true" className="mr-2 h-7 w-px bg-line" />
            <ToolIcon label="Zoom out" disabled={zoomAt <= 0} onClick={() => setZoom(ZOOMS[Math.max(0, zoomAt - 1)])}>
              <ZoomIcon />
            </ToolIcon>
            <input
              type="range"
              min={0}
              max={ZOOMS.length - 1}
              value={zoomAt}
              onChange={(event) => setZoom(ZOOMS[Number(event.target.value)])}
              aria-label="Zoom timeline"
              title={`${zoom}x`}
              className={`w-32 cursor-pointer accent-white ${focusRing}`}
            />
            <ToolIcon label="Zoom in" disabled={zoomAt >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomAt + 1)])}>
              <ZoomIcon plus />
            </ToolIcon>
          </div>
        ) : (
          <span />
        )}
      </div>

      {!hidden && (
        <>
        <div className="flex items-start gap-3 px-5 pb-3">
          {/* + មុន clip (រូប OpusClip = បន្ថែមវីដេអូមុន) — មិនទាន់មាន */}
          <AddClip label={t('បន្ថែមវីដេអូមុន clip នេះ — ជំហានបន្ទាប់', 'Add a video before this clip — next step')} />
          {/* overflow-x-scroll (មិនមែន auto): កន្លែង scrollbar មានជានិច្ច — auto បន្ថែម 10 px ពេល zoom > 1x
              ហើយ timeline ខ្ពស់ឡើង / preview តូចចុះរាល់ការ zoom (វាស់ 237 -> 247 px) */}
          <div ref={scroller} className="min-w-0 flex-1 overflow-x-scroll overflow-y-hidden" style={{ paddingInline: EDGE_PX }}>
          <div
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label={t('ពេលក្នុងវីដេអូ', 'Time in the video')}
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(time)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') stepBy(1)
              if (event.key === 'ArrowLeft') stepBy(-1)
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              const { x, y } = pointIn(event)
              // ចុចលើជួររូប = ប្លុកមួយ: អូស = ផ្លាស់ទី, ចុចដោយមិនអូស = seek (ពេលលែង)
              const stripTop = RULER_PX + space + 28 // ruler + តំបន់ទំនេរ + band (h-6 + mb-1)
              const onStrip = y >= stripTop && y < stripTop + STRIP_PX && Boolean(onMoveBlock)
              const block = onStrip ? blockAt(x) : -1
              if (block >= 0) {
                press.current = { x, y, scrub: false, moved: false, block }
                return
              }
              const scrub = y < RULER_PX || blocks.length < 2
              press.current = { x, y, scrub, moved: false, block: null }
              if (!scrub) return // ចាំមើលថាអូស (ចតុកោណ) ឬចុច (seek) — ពេលលែង
              scrubTo(event)
              selectAt(x) // ជ្រើសផ្នែកនៅពេលចុច (មិនមែនពេលអូស)
            }}
            onPointerMove={(event) => {
              const start = press.current
              if (event.buttons !== 1 || !start) return
              if (start.scrub) return scrubTo(event)
              const { x, y } = pointIn(event)
              if (!start.moved && Math.hypot(x - start.x, y - start.y) < 4) return // ញ័រដៃ ≠ អូស
              start.moved = true
              if (start.block !== null) {
                setDragBlock({ from: start.block, x, grab: start.x - blocks[start.block].x, gap: gapAt(x, start.block) })
                return
              }
              setMarquee({ x0: start.x, y0: start.y, x1: x, y1: y })
            }}
            onPointerUp={(event) => {
              const start = press.current
              press.current = null
              if (!start) return
              if (start.scrub) {
                // លែង scrub: editor ទទួលពេលចុងក្រោយម្តង (transcript, caption, ...)
                const place = placeOf(event.clientX - event.currentTarget.getBoundingClientRect().left)
                if (scrubAt !== null) onSeek(place.time, place.index)
                setScrubAt(null)
                return
              }
              const { x } = pointIn(event)
              if (start.block !== null && start.moved) {
                dropBlock(start.block, gapAt(x, start.block))
                setDragBlock(null)
              } else if (start.moved) {
                setMarquee(null)
                const from = blockAt(Math.max(0, Math.min(start.x, x)))
                const to = blockAt(Math.min(rowWidth - 1, Math.max(start.x, x)))
                onSelect?.(from >= 0 && to >= from ? [from, to] : null)
              } else {
                const place = placeOf(x)
                onSeek(place.time, place.index)
                selectAt(x)
              }
            }}
            // គ្មាន focusRing (អ្នកអភិវឌ្ឍ): គែមទាំងពីរមើលទៅដូច marker; keyboard ឃើញ playhead និងម៉ោងរំកិលជំនួស
            className="relative cursor-pointer outline-none select-none"
            // អូសគែមដើមចេញ: ប្លុកមុនៗរុញទៅឆ្វេង ដូច្នេះ || នៅជាមួយ mouse
            style={{ width: liveContent, transform: edgeOut && edgeDrag?.side === 'start' ? `translateX(${-grownPx}px)` : undefined }}
          >
            {/* បន្ទាត់វាស់: លេខនៅចំណុចធំ, ចំណុចតូចនៅចន្លោះ */}
            <div className="relative h-7 text-[12px] text-text-3">
              {Array.from({ length: Math.floor(timeSpan / dotEvery) + 1 }, (_, at) => at * dotEvery).map((second) =>
                second % labelEvery === 0 ? (
                  <span
                    key={second}
                    className="absolute top-1 -translate-x-1/2 tabular-nums"
                    style={{ left: second * pxPerSecond }}
                  >
                    {label(second)}
                  </span>
                ) : (
                  <span key={second} aria-hidden="true" className="absolute top-3 size-[3px] -translate-x-1/2 rounded-full bg-text-4" style={{ left: second * pxPerSecond }} />
                ),
              )}
            </div>

            {/* តំបន់ទំនេរ (រូប OpusClip): អូសគែមលើ = ប្តូរវា; ចុច = seek, អូស = ចតុកោណជ្រើស */}
            <div aria-hidden="true" data-space className="h-(--space-h)" />

            {/* ជួរ layout: shot ពី reframe ចុងក្រោយ, បើគ្មាន = វីដេអូដើម */}
            <div className="relative mb-1 h-6 overflow-hidden rounded-[6px] bg-raised" style={{ width: rowWidth }}>
              {/* ប្លុកដែលជ្រើសភ្លឺជាងគេ (រូប OpusClip); ស្លាកក្នុងវាដិតជាង */}
              {selected && blocks[selected[1]] && (
                <span
                  data-band-selected
                  aria-hidden="true"
                  className="absolute top-0 h-full bg-raised-3"
                  style={{ left: blocks[selected[0]].x, width: blocks[selected[1]].x + blocks[selected[1]].w - blocks[selected[0]].x }}
                />
              )}
              {shots.length ? (
                shots.map((shot) => {
                  const kind = kindOf(shot.kind)
                  const at = box(shot.start, shot.end)
                  if (!at) return null
                  const lit = isSelectedX(at.left)
                  return (
                    <span
                      key={shot.start}
                      title={`${t(kind.label, kind.en)}: ${shot.start.toFixed(1)}-${shot.end.toFixed(1)} s`}
                      className={`absolute top-0 flex h-full items-center overflow-hidden border-r border-chrome px-2 text-[11px] whitespace-nowrap ${lit ? 'font-bold text-text' : 'font-medium text-text-3'}`}
                      style={at}
                    >
                      {t(kind.label, kind.en)}
                    </span>
                  )
                })
              ) : (
                // មិនទាន់ reframe: ស្លាកមួយក្នុងមួយប្លុក
                blocks.map((block, idx) => (
                  <span
                    key={idx}
                    className={`absolute top-0 flex h-full items-center overflow-hidden px-2 text-[11px] whitespace-nowrap ${isSelectedX(block.x) ? 'font-bold text-text' : 'font-medium text-text-3'}`}
                    style={{ left: block.x, width: block.w }}
                  >
                    {t('Original · មិនទាន់ reframe', 'Original · not reframed')}
                  </span>
                ))
              )}
              {noTrack.map(([start, end]) => box(start, end) && (
                <span
                  key={`nt${start}`}
                  title={`${t('Tracking បិទ', 'Tracking off')}: ${start.toFixed(1)}-${end.toFixed(1)} s`}
                  className="pointer-events-none absolute top-0 flex h-full items-center justify-end overflow-hidden rounded-[4px] border-2 border-dashed border-info bg-info/15 px-1 text-[10px] font-bold text-info"
                  style={box(start, end)!}
                >
                  Tracker OFF
                </span>
              ))}
              {subjects.map(([start, end]) => box(start, end) && (
                <span
                  key={`sj${start}`}
                  title={`${t('តាមដោយដៃ', 'Tracked by hand')}: ${start.toFixed(1)}-${end.toFixed(1)} s`}
                  className="pointer-events-none absolute top-0 flex h-full items-center justify-end overflow-hidden rounded-[4px] border-2 border-gold bg-gold/15 px-1 text-[10px] font-bold text-gold"
                  style={box(start, end)!}
                >
                  Subject
                </span>
              ))}
            </div>

            {/* រូបតូច: output mode = ប្លុក parts; source mode = continuous strip */}
            <>
              <div className="relative flex h-14 overflow-hidden rounded-[8px]" style={{ width: rowWidth }}>
                {/* ផ្នែកច្រើនជាង MAX_TILES (ឧ. Speech cleanup): រូបមួយជួរតាមពេល Export — មិនមែនរូបក្នុងផ្នែកនីមួយៗ
                    ព្រោះ FFmpeg ដករូបម្តងមួយ */}
                {partOffsets.length > MAX_TILES && (
                  <div className="absolute inset-0 flex">
                    {Array.from({ length: tiles }, (_, at) => (
                      <img
                        key={`${tiles}-${at}`}
                        src={sourceFrameUrl(videoPath, sourceAt(stillParts, ((at + 0.5) / tiles) * baseSeconds))}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="h-full min-w-0 flex-1 object-cover"
                      />
                    ))}
                  </div>
                )}
                {partOffsets.map((p, idx) => {
                  const blockW = Math.max(2, (p.end - p.start) * pxPerSecond)
                  const isInsert = p.insert !== null
                  // ប្លុកដែលកំពុងអូសចេញ: រក្សារូបចាស់ ផ្នែកថ្មីនៅទទេ រហូតដល់លែង
                  const held = edgeOut && edgeDrag?.index === idx ? clips[idx] : null
                  const [tileStart, tileEnd] = held ?? [p.start, p.end]
                  const tilesW = Math.max(2, (tileEnd - tileStart) * pxPerSecond)
                  const blockTiles = partOffsets.length > MAX_TILES ? 0 : Math.min(MAX_BLOCK_TILES, Math.max(1, Math.round(tilesW / (zoom > 1 ? TILE_ZOOMED_PX : TILE_PX))))
                  return (
                    <div
                      key={idx}
                      className={`relative shrink-0 overflow-hidden ${blockTiles ? 'bg-raised-2' : ''}
                        ${isInsert ? 'ring-2 ring-inset ring-gold' : ''}`}
                      style={{ width: blockW }}
                    >
                      {isInsert && (
                        <div className="pointer-events-none absolute top-0 left-0 z-10 rounded-br-[4px] bg-gold px-1.5 py-0.5 text-[9px] font-black uppercase leading-tight tracking-wide text-on-gold select-none">
                          HOOK
                        </div>
                      )}
                      <div
                        className={`flex h-full ${onMoveBlock ? 'cursor-grab active:cursor-grabbing' : ''}`}
                        style={held ? { width: tilesW, marginLeft: edgeDrag?.side === 'start' ? blockW - tilesW : 0 } : undefined}
                      >
                        {Array.from({ length: blockTiles }, (_, ti) => {
                          const tileTime = tileStart + ((ti + 0.5) / blockTiles) * (tileEnd - tileStart)
                          return (
                            <img
                              key={`${blockTiles}-${ti}`}
                              src={sourceFrameUrl(videoPath, tileTime)}
                              alt=""
                              loading="lazy"
                              draggable={false}
                              className={`h-full min-w-0 flex-1 object-cover ${isInsert ? 'opacity-85' : ''}`}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>

            {/* waveform: panel តែមួយ (រូប OpusClip); ចំណុចភ្ជាប់ប្លុកជាស្នាមតូចលើ និងក្រោមប៉ុណ្ណោះ */}
            <>
              <div className="mt-3 flex h-12 overflow-hidden rounded-[8px]" style={{ width: rowWidth }}>
                {partOffsets.map((p, idx) => {
                  const blockW = Math.max(2, (p.end - p.start) * pxPerSecond)
                  const isInsert = p.insert !== null
                  const p0 = Math.floor((p.start / total) * peaks.length)
                  const p1 = Math.ceil((p.end / total) * peaks.length)
                  const blockPeaks = peaks.slice(p0, p1)
                  return (
                    <div
                      key={idx}
                      className={`relative shrink-0 ${isInsert ? 'bg-gold/15' : 'bg-raised'}`}
                      style={{ width: blockW }}
                    >
                      {idx > 0 && (
                        <>
                          <span data-wave-notch aria-hidden="true" className="absolute top-0 -left-px h-1.5 w-0.5 bg-chrome" />
                          <span data-wave-notch aria-hidden="true" className="absolute bottom-0 -left-px h-1.5 w-0.5 bg-chrome" />
                        </>
                      )}
                      {blockPeaks.length > 0 && (
                        <svg viewBox={`0 0 ${blockPeaks.length} 100`} preserveAspectRatio="none" className="size-full" aria-hidden="true">
                          <path
                            d={blockPeaks.map((peak, at) => `M${at + 0.5} ${50 - peak * 46}V${50 + peak * 46}`).join('')}
                            stroke="currentColor"
                            strokeWidth="0.6"
                            className={isInsert ? 'text-gold' : 'text-text-3'}
                          />
                        </svg>
                      )}
                    </div>
                  )
                })}
              </div>
            </>

            {/* ចន្លោះដែលលុបមិនគូរទេ: វាបាត់ពី timeline (output mode) ដូច trim */}

            {/* zoom out មានកន្លែង: + នៅជាប់ប្លុកចុងក្រោយ (រូប OpusClip) */}
            {addClipInside && (
              <div data-add-inside className="absolute top-0" style={{ left: rowWidth + ADD_CLIP_GAP }} onPointerDown={(event) => event.stopPropagation()}>
                <AddClip label={t('បន្ថែមវីដេអូក្រោយ clip នេះ — ជំហានបន្ទាប់', 'Add a video after this clip — next step')} />
              </div>
            )}

            {/* ផ្នែកដែលជ្រើស: ស៊ុមសជុំវិញប្លុក (រូប OpusClip) — ផ្នែកច្រើន = ស៊ុមមួយលើប្លុកទាំងនោះ */}
            {selected && blocks[selected[1]] && (
              <span
                aria-label={t('ផ្នែកដែលជ្រើស', 'Selected part')}
                className="pointer-events-none absolute top-[calc(56px+var(--space-h))] z-[2] h-14 rounded-[8px] border-2 border-white"
                style={{ left: blocks[selected[0]].x, width: blocks[selected[1]].x + blocks[selected[1]].w - blocks[selected[0]].x }}
              />
            )}
            {/* ចតុកោណជ្រើស ពេលកំពុងអូស */}
            {marquee && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute z-20 border border-white/70 bg-white/10"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}

            {/* Split = ចន្លោះ 2 px ពណ៌ផ្ទៃ timeline កាត់ band និងរូប -> ផ្នែកនីមួយៗជាប្លុកដាច់ (រូប OpusClip) */}
            {blocks.slice(1).map((block, at) => (
              <span
                key={at}
                data-split={block.start}
                aria-hidden="true"
                className="pointer-events-none absolute top-[calc(28px+var(--space-h))] z-[1] w-0.5 -translate-x-1/2 bg-chrome"
                style={{ left: block.x, height: RULER_PX + STRIP_PX }}
              />
            ))}

            {/* អូសប្លុក: ប្រអប់ដាច់ៗនៅកន្លែងដើម, ប្លុកដែលតាម mouse, បន្ទាត់កន្លែងទម្លាក់ */}
            {dragBlock && (() => {
              const block = blocks[dragBlock.from]
              const lastBlock = blocks[blocks.length - 1]
              const lineX = dragBlock.gap < blocks.length ? blocks[dragBlock.gap].x : lastBlock.x + lastBlock.w
              return (
                // overflow-hidden: ប្លុកដែលអូសហួសចុង timeline មិនបន្ថែម scrollbar ឬធ្វើឲ្យ timeline ធំឡើង
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[3] overflow-hidden">
                  <span
                    data-drag-slot
                    aria-hidden="true"
                    className="pointer-events-none absolute top-[calc(56px+var(--space-h))] z-[3] h-14 rounded-[8px] border-2 border-dashed border-white/70 bg-raised"
                    style={{ left: block.x, width: block.w }}
                  />
                  <span
                    data-drag-ghost
                    aria-hidden="true"
                    className="pointer-events-none absolute top-[calc(56px+var(--space-h))] z-[4] h-14 cursor-grabbing rounded-[8px] border-2 border-white bg-raised-2 bg-[length:auto_100%] bg-repeat-x opacity-90 shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
                    style={{
                      left: dragBlock.x - dragBlock.grab,
                      width: block.w,
                      backgroundImage: `url("${sourceFrameUrl(videoPath, (block.start + block.end) / 2)}")`,
                    }}
                  />
                  {isNewPlace(dragBlock.from, dragBlock.gap) && (
                    <span
                      data-drop-line
                      aria-hidden="true"
                      className="pointer-events-none absolute top-[calc(56px+var(--space-h))] z-[5] h-14 w-1 -translate-x-1/2 rounded-full bg-gold shadow-[0_0_6px_2px_var(--color-gold)]"
                      style={{ left: lineX }}
                    />
                  )}
                </div>
              )
            })()}

            {/* Trim handles: ដើម និងចុងនៃផ្នែកដែលនៅសល់; អូស = កាត់ពីដើម / ដល់ចុង */}
            {/* ប្លុកច្រើន: ‖ តែលើប្លុកដែលជ្រើស — គែមដើមនៃប្លុកទីមួយ និងគែមចុងនៃប្លុកចុងក្រោយក្នុងការជ្រើស.
                មិនជ្រើស = គ្មាន handle ដូច្នេះអូសពីគែមប្លុក គឺប្តូរលំដាប់ មិនមែនកាត់ដោយមើលមិនឃើញ */}
            {onTrimBlock && selected && blocks.flatMap((block, index) => {
              if (block.w < 28) return []
              const sides = TRIM_SIDES.filter((side) => index === (side === 'start' ? selected[0] : selected[1]))
              return sides.map((side) => {
                const moving = edgeDrag?.index === index && edgeDrag.side === side ? edgeDrag.at : null
                // shift = អូសចូលប៉ុណ្ណោះ (បិទបាំង); អូសចេញ ប្លុកធំឡើងពិត ហើយ handle នៅគែមរបស់វា
                const inward = moving !== null && (side === 'start' ? moving > clips[index][0] : moving < clips[index][1])
                const shift = inward ? (moving - (side === 'start' ? clips[index][0] : clips[index][1])) * pxPerSecond : 0
                // អូសចេញហួសចុងជួរ: handle នៅក្នុងទិដ្ឋភាព
                const left = Math.max(-EDGE_PX, Math.min(liveContent + EDGE_PX - TRIM_HANDLE_PX, (side === 'start' ? block.x : block.x + block.w - TRIM_HANDLE_PX) + shift))
                // cursor ប្រាប់ទិសដែលអូសបាន: ដល់ដែន `edgeLimit` = ពង្រីកលែងបាន, ដល់ប្រវែងខ្លីបំផុត = កាត់លែងបាន
                const edge = moving ?? (side === 'start' ? clips[index][0] : clips[index][1])
                const outLimit = edgeLimit(clips, index, side, total)
                const atOutLimit = side === 'start' ? edge <= outLimit + 0.001 : edge >= outLimit - 0.001
                const blockSeconds = side === 'start' ? clips[index][1] - edge : edge - clips[index][0]
                const atShortest = blockSeconds <= MIN_BLOCK_SEC + 0.001
                const canLeft = side === 'start' ? !atOutLimit : !atShortest
                const canRight = side === 'start' ? !atShortest : !atOutLimit
                const cursor = canLeft && canRight ? 'ew-resize' : canLeft ? 'w-resize' : canRight ? 'e-resize' : 'not-allowed'
                return (
                  <span key={`${index}-${side}`}>
                    {/* ផ្នែកដែលនឹងត្រូវកាត់: បិទបាំង មើលទៅប្លុករួញ */}
                    {moving !== null && (side === 'start' ? shift > 0 : shift < 0) && (
                      <span
                        data-edge-cover
                        aria-hidden="true"
                        className="pointer-events-none absolute top-[calc(28px+var(--space-h))] bottom-0 z-[1] bg-chrome"
                        style={side === 'start' ? { left: block.x, width: shift } : { left: block.x + block.w + shift, width: -shift }}
                      />
                    )}
                    <span
                      role="slider"
                      data-block-edge={side}
                      aria-label={side === 'start' ? t('គែមដើមប្លុក', 'Block start') : t('គែមចុងប្លុក', 'Block end')}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(total)}
                      aria-valuenow={Math.round(moving ?? (side === 'start' ? block.start : block.end))}
                      title={t('អូសចូល = កាត់ · អូសចេញ = ពង្រីក · ចុចពីរដង = យកផ្នែកដែលកាត់មកវិញ', 'Drag in = trim · drag out = extend · double-click = bring the trimmed part back')}
                      {...edgeHandle(index, side)}
                      className={TRIM_HANDLE}
                      style={{ left, cursor }}
                    >
                      <GripBars />
                      {moving !== null && (
                        <span className="absolute -top-6 rounded-[4px] bg-black/80 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-text tabular-nums">
                          {moving.toFixed(2)} s
                        </span>
                      )}
                    </span>
                  </span>
                )
              })
            })}

            {/* Hover ចន្លោះប្លុក = ប៊ូតុង Add transition. ប្លុកតូចពេក (zoom out, Speech cleanup) គ្មានកន្លែងទេ.
                ក្រោយ ‖ ក្នុង DOM: ឈរលើ 6 px ខាងក្រៅរបស់វា តែ grip នៅតែចាប់បាន */}
            {onAddTransition && !dragBlock && !edgeDrag && blocks.slice(1).map((block, at) => block.w < JOIN_MIN_PX || blocks[at].w < JOIN_MIN_PX ? null : (
              <button
                key={at}
                type="button"
                data-add-transition={at + 1}
                aria-label={t('បន្ថែម transition', 'Add transition')}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onAddTransition(at + 1)}
                className="group absolute top-[calc(56px+var(--space-h))] z-[3] h-14 w-3 -translate-x-1/2 cursor-pointer border-0 bg-transparent p-0 outline-none"
                style={{ left: block.x }}
              >
                <span className="absolute top-1/2 left-1/2 hidden size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-chrome text-text shadow-[0_2px_8px_rgba(0,0,0,0.6)] group-hover:flex group-focus-visible:flex group-focus-visible:border-gold hover:text-gold">
                  <TransitionIcon />
                </span>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute bottom-[calc(50%+18px)] left-1/2 hidden -translate-x-1/2 rounded-[4px] bg-black/90 px-2 py-1 text-[12px] whitespace-nowrap text-text group-hover:block group-focus-visible:block"
                >
                  {t('បន្ថែម transition', 'Add transition')}
                </span>
              </button>
            ))}

            {/* playhead: បន្ទាត់ស ដែលមានក្បាលមូលនៅលើបន្ទាត់វាស់ (អូសបាន — track ចាប់ pointer) */}
            <span aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 z-[2] w-px -translate-x-1/2 bg-white" style={{ left: playheadX }}>
              <span className="absolute top-0 left-1/2 h-6 w-3.5 -translate-x-1/2 rounded-[5px] border-2 border-white bg-chrome" />
            </span>
          </div>
          </div>
          {/* invisible មិនមែនដកចេញ: ទុកកន្លែងដដែល ដូច្នេះទទឹង timeline មិនប្តូរពេល zoom */}
          <div className={`shrink-0 ${addClipInside ? 'invisible' : ''}`}>
            <AddClip label={t('បន្ថែមវីដេអូក្រោយ clip នេះ — ជំហានបន្ទាប់', 'Add a video after this clip — next step')} />
          </div>
        </div>

        </>
      )}
    </section>
  )
}


/** ‖ ពណ៌សពីរបន្ទាត់ (មានស្រមោល ដើម្បីឃើញលើរូបភ្លឺ). */
function GripBars() {
  return (
    <span data-grip aria-hidden="true" className="flex gap-[3px] drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]">
      <span className="h-4 w-0.5 rounded-full bg-white" />
      <span className="h-4 w-0.5 rounded-full bg-white" />
    </span>
  )
}

/** ប៊ូតុង icon ក្នុង toolbar (36 px), tooltip = label. */
function ToolIcon({
  label,
  pressed,
  disabled = false,
  tone,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  tone?: string // ពណ៌ (លុប = ក្រហម, ស្តារ = បៃតង)
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border-0 disabled:cursor-default disabled:opacity-35 ${
        pressed ? 'bg-raised-2' : 'bg-transparent hover:bg-field'
      } ${tone ?? 'text-text'} ${focusRing}`}
    >
      {children}
    </button>
  )
}

/** "+" សងខាង clip (រូប OpusClip): បន្ថែមវីដេអូមុន / ក្រោយ — គូរបិទ រហូតមានការភ្ជាប់វីដេអូ. */
function AddClip({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      title={label}
      aria-label={label}
      className="mt-[calc(56px+var(--space-h))] flex h-14 w-20 shrink-0 cursor-default items-center justify-center rounded-[8px] border border-line bg-raised text-[22px] font-light text-text-3 opacity-60"
    >
      +
    </button>
  )
}

const ICON = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true } as const

function HideIcon() {
  return (
    <svg {...ICON}>
      <rect x="2" y="3.5" width="14" height="11" rx="2.5" />
      <path d="M6.5 8l2.5 2.5L11.5 8" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg {...ICON}>
      <path d="M7.5 10.5l3-3M8 5.5l1.3-1.3a2.8 2.8 0 014 4L12 9.5M10 12.5l-1.3 1.3a2.8 2.8 0 01-4-4L6 8.5" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg {...ICON}>
      <path d="M3 5h12M7 5V3.5h4V5M4.5 5l.8 9.5h7.4l.8-9.5M7.5 8v4M10.5 8v4" />
    </svg>
  )
}

/** 🔊 + ផ្ទាំងតូចពីលើ (រូប OpusClip): slider 0-100 និងលេខ. កម្រិតនៅក្នុង component នេះ (state តូច) ហើយ
 *  `onVolume` កំណត់ `video.volume` ផ្ទាល់ — អូស slider មិន render editor ទាំងមូលរាល់ចលនាទេ.
 *  បិទពេលចុចខាងក្រៅ ឬ Escape. */
function VolumeButton({ initial, onVolume }: { initial: number; onVolume: (volume: number) => void }) {
  const t = useT()
  const [volume, setVolume] = useState(initial)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: globalThis.PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation() // បិទតែផ្ទាំងនេះ
      setOpen(false)
    }
    // capture: Transform box បញ្ឈប់ pointerdown (stopPropagation) — bubble នឹងមិនមកដល់ document ទេ
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  const change = (next: number) => {
    setVolume(next)
    onVolume(next)
  }
  return (
    <div ref={box} className="relative">
      <ToolIcon label={t(`កម្រិតសំឡេង preview: ${volume}`, `Preview volume: ${volume}`)} pressed={open} onClick={() => setOpen((value) => !value)}>
        <SpeakerIcon volume={volume} />
      </ToolIcon>
      {open && (
        <div
          role="dialog"
          aria-label={t('កម្រិតសំឡេង preview', 'Preview volume')}
          className="absolute bottom-full left-1/2 z-30 mb-2 flex w-[210px] -translate-x-1/2 items-center gap-3 rounded-[10px] border border-line bg-chrome px-4 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
        >
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            autoFocus
            onChange={(event) => change(Number(event.target.value))}
            aria-label={t('កម្រិតសំឡេង preview (Export មិនប្តូរ)', 'Preview volume (the export keeps its sound)')}
            className={`min-w-0 flex-1 cursor-pointer accent-white ${focusRing}`}
          />
          <span className="w-8 text-right type-body font-bold tabular-nums">{volume}</span>
        </div>
      )}
    </div>
  )
}

/** 0 = ✕, តិចជាង 50 = រលកមួយ, ផ្សេងពីនេះ = ពីរ. */
function SpeakerIcon({ volume }: { volume: number }) {
  return (
    <svg {...ICON}>
      <path d="M3 7h2.5L9 4v10l-3.5-3H3z" />
      {volume === 0 ? (
        <path d="M12 7l4 4M16 7l-4 4" />
      ) : (
        <path d={volume < 50 ? 'M12 6.5a3.5 3.5 0 0 1 0 5' : 'M12 6.5a3.5 3.5 0 0 1 0 5M14 4.5a6.5 6.5 0 0 1 0 9'} />
      )}
    </svg>
  )
}

/** មេដែកដូចរូប OpusClip: ពាក់កណ្តាលពីរ ហើយបន្ទាត់ចំកណ្តាល. */
function TransitionIcon() {
  return (
    <svg {...ICON} width={16} height={16}>
      <path d="M3 4.5v9l6-4.5-6-4.5ZM15 4.5v9L9 9l6-4.5Z" strokeLinejoin="round" />
    </svg>
  )
}

function SnapIcon() {
  return (
    <svg {...ICON}>
      <path d="M7.5 5H4.5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h3M10.5 5h3a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-3M1 9h16" />
    </svg>
  )
}

function FitIcon() {
  return (
    <svg {...ICON}>
      <rect x="3" y="5" width="12" height="7" rx="1.5" />
      <path d="M1 8.5h2M15 8.5h2M6 14.5v1.5M9 14.5v1.5M12 14.5v1.5" />
    </svg>
  )
}

function SkipIcon({ back = false }: { back?: boolean }) {
  return (
    <svg {...ICON} style={back ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M5 4l7 5-7 5z" fill="currentColor" stroke="none" />
      <path d="M13.5 4v10" strokeWidth="1.8" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg {...ICON}>
      <path d="M5.5 3.5l9 5.5-9 5.5z" fill="currentColor" stroke="none" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg {...ICON}>
      <path d="M6 4v10M12 4v10" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function ZoomIcon({ plus = false }: { plus?: boolean }) {
  return (
    <svg {...ICON}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M12 12l4 4M5.5 8h5" />
      {plus && <path d="M8 5.5v5" />}
    </svg>
  )
}

/** រូប Split (ដូច OpusClip): ប្រអប់ពីរ និងបន្ទាត់ដាច់ៗរវាងវា. */
function SplitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="1.5" y="4" width="4.5" height="8" rx="1" />
      <rect x="10" y="4" width="4.5" height="8" rx="1" />
      <path d="M8 2v12" strokeDasharray="2 1.5" />
    </svg>
  )
}
