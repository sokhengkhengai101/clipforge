import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { api, sourceFrameUrl, type ReframeShot } from '../api'
import { blockEdgeLimit, blocksOf, keepRanges, moveBlock, outputSeconds, outputTime, sequence, sourceAt, trimEdges, type Cut, type Insert } from '../cutList'
import { focusRing } from '../kit/styles'
import { kindOf } from './layoutKinds'
import { useT } from '../i18n'

const TILE_PX = 100 // ទទឹងរូបតូចមួយលើ timeline (រូប OpusClip)
const MAX_TILES = 60 // FFmpeg ដករូបម្តងមួយ — កំណត់ចំនួន ដើម្បីកុំឲ្យ sidecar រវល់ពេក
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8]
const TRIM_SIDES = ['start', 'end'] as const
// Trim handle (រូប OpusClip): ‖ ពណ៌សលើជួររូបប៉ុណ្ណោះ, មិនលើ waveform; គ្មានផ្ទៃ ដូច្នេះរូបនៅតែឃើញ
const TRIM_HANDLE = 'absolute top-[calc(56px+var(--space-h))] z-[2] flex h-14 w-3 cursor-ew-resize touch-none items-center justify-center'
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
 *  ចុច ឬអូសលើ timeline = វីដេអូលោត; zoom 1-8x; playhead តាមពេលចាក់. */
export function EditorTimeline({
  project,
  videoPath,
  duration,
  time,
  playing,
  audioReady,
  cuts = [],
  inserts = [],
  order = [],
  playingPart = -1,
  noTrack = [],
  subjects = [],
  splits = [],
  part = null,
  picked = false,
  partCut = false,
  onPick,
  onPickRange,
  linkable = false,
  onLink,
  onSplit,
  onTogglePart,
  onTrim,
  snap = true,
  onSnap,
  initialVolume = 100,
  onVolume,
  onMoveInsert,
  onMoveBlock,
  onTrimBlock,
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
  cuts?: [number, number][] // ចន្លោះដែលលុប — ឆ្នូតក្រហមពីលើជួរ
  inserts?: Insert[] // ផ្នែកដែលបន្ថែម — សញ្ញា ＋ gold នៅពេល `at`
  order?: Cut[] // ប្លុកតាមលំដាប់ដែលអូស; [] = លំដាប់ពេល
  playingPart?: number // part ដែលកំពុងចាក់ (លំដាប់ចេញ); -1 = មិនចាក់
  noTrack?: [number, number][] // scene ដែលបិទ tracking — ស៊ុមដាច់ៗលើជួរ layout
  subjects?: [number, number][] // scene ដែលតាមប្រធានបទដោយដៃ — ស៊ុម gold
  splits?: number[] // ចំណុច Split (បន្ទាត់ស)
  part?: Cut | null // ផ្នែកដែលជ្រើស (ស៊ុម gold)
  picked?: boolean // ចុចជ្រើសលើ timeline រួច (វីដេអូគ្មាន split ក៏ជ្រើសបាន) -> បង្ហាញ ‖
  partCut?: boolean // ផ្នែកនោះលុបរួចហើយ -> ប៊ូតុង "ស្តារ"
  onPick?: (seconds: number) => void // ចុចលើ timeline = ជ្រើសផ្នែកនៅពេលនោះ
  onPickRange?: (from: number, to: number) => void // អូសចតុកោណ = ជ្រើសផ្នែកទាំងអស់ដែលវាប៉ះ
  linkable?: boolean // ការជ្រើសមានផ្នែកច្រើន -> Link អាចភ្ជាប់វា
  onLink?: () => void
  onSplit?: (exact: boolean) => void
  onTogglePart?: () => void
  onTrim?: (side: 'start' | 'end', seconds: number, alt: boolean) => void // alt = ផ្ទុយពី Snap
  snap?: boolean // ប៊ូតុងមេដែក: Split / trim ជាប់គែមពាក្យ
  onSnap?: () => void
  initialVolume?: number // ប៊ូតុង Speaker: កម្រិតសំឡេង preview 0-100 ពេលបើក editor
  onVolume?: (volume: number) => void
  onMoveInsert?: (insertIdx: number, newAt: number) => void // drag ប្លុក HOOK ទៅទីតាំងថ្មី
  onMoveBlock?: (order: Cut[]) => void // drag ប្លុកធម្មតា = លំដាប់ថ្មី
  onTrimBlock?: (block: Cut, side: 'start' | 'end', seconds: number, alt: boolean) => void // អូសគែមប្លុក (ក្រោយប្តូរលំដាប់)
  onSeek: (seconds: number) => void
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
  const [head, tail] = trimEdges(cuts, total)
  const span = Math.max(0.5, tail - head)
  const content = Math.max(width, width * zoom)

  // Output-order mode: when inserts, a dragged order or a cut in the middle exist the timeline shows
  // only what Export keeps, in export order (អ្វីដែលកាត់បាត់ពី timeline). xOf / tOf map source time ↔ output px.
  const outParts = useMemo(
    () => (inserts.length > 0 || order.length > 0 || keepRanges(cuts, total).length > 1 ? sequence(cuts, inserts, total, order) : null),
    [inserts, cuts, total, order],
  )
  const outSeconds = outParts ? outParts.reduce((s, p) => s + (p.end - p.start), 0) : span
  const pxPerSecond = content / Math.max(0.5, outParts ? outSeconds : span)

  // Pre-compute each part's output x offset (only rebuilt when parts or pxPerSecond change)
  const partOffsets = useMemo(() => {
    if (!outParts) return []
    let px = 0
    return outParts.map(p => {
      const entry = { start: p.start, end: p.end, insert: p.insert, outX: px }
      px += (p.end - p.start) * pxPerSecond
      return entry
    })
  // pxPerSecond changes with zoom/width but useMemo deps must be stable values
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outParts, pxPerSecond])

  const xOf = outParts
    ? (sourceTime: number): number => {
        for (const p of partOffsets) {
          if (sourceTime >= p.start && sourceTime < p.end)
            return p.outX + (sourceTime - p.start) * pxPerSecond
        }
        const last = partOffsets[partOffsets.length - 1]
        return last ? last.outX + (last.end - last.start) * pxPerSecond : 0
      }
    : (seconds: number) => (seconds - head) * pxPerSecond
  const tOf = outParts
    ? (x: number): number => {
        for (const p of partOffsets) {
          const blockW = (p.end - p.start) * pxPerSecond
          if (x < p.outX + blockW) return p.start + (x - p.outX) / pxPerSecond
        }
        return total
      }
    : (x: number) => Math.max(head, Math.min(tail, head + x / pxPerSecond))
  // ចន្លោះ [a, b] -> {left, width}; in source mode clamp to view [head,tail]; in output mode use xOf directly
  const box = (a: number, b: number, min = 2) => {
    if (outParts) {
      // ប្លុកមិនតាមលំដាប់ពេលទេ: គូរក្នុង part ដែលមាន `a` (xOf(b) អាចនៅប្លុកផ្សេងទាំងស្រុង)
      const inPart = partOffsets.find((p) => a >= p.start - 0.001 && a < p.end)
      if (!inPart || b - a <= 0.001) return null
      return { left: xOf(a), width: Math.max(min, (Math.min(b, inPart.end) - a) * pxPerSecond) }
    }
    const from = Math.max(a, head)
    const to = Math.min(b, tail)
    if (to - from <= 0.001) return null
    const l = xOf(from)
    const r = xOf(to)
    return r - l > 0 ? { left: l, width: Math.max(min, r - l) } : null
  }
  const tiles = Math.min(MAX_TILES, Math.max(1, Math.round(content / TILE_PX)))
  const { labelEvery, dotEvery } = rulerSteps(pxPerSecond)
  // ពេល scrub: playhead និងម៉ោងនៅក្នុង timeline ផ្ទាល់ (state តូច) — editor មិន render រាល់ចលនា
  // (វីដេអូ 35 នាទី: render transcript 6600 ពាក្យ ~140 ms រាល់ចលនា = ញាក់); លែង = onSeek ម្តង
  const [scrubAt, setScrubAt] = useState<number | null>(null)
  const shown = scrubAt ?? time
  // output mode: ម៉ោង និង playhead រាប់តាមវីដេអូដែល Export (ពេលមួយអាចនៅពីរកន្លែង: part ដែលកំពុងចាក់ឈ្នះ)
  const shownOut = outParts ? outputTime(outParts, shown, playingPart) : shown
  const playheadX = outParts ? shownOut * pxPerSecond : xOf(Math.max(head, Math.min(shown, tail)))
  // ⏮ ⏭ និងព្រួញ: ដើរតាមវីដេអូដែល Export មិនមែនលោតទៅប្លុកផ្សេង
  const stepBy = (delta: number) => {
    if (!outParts) return onSeek(Math.max(0, Math.min(total, time + delta)))
    onSeek(sourceAt(outParts, Math.max(0, Math.min(outSeconds - 0.05, shownOut + delta))))
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
  const secondsAt = (event: PointerEvent<HTMLElement>, box: HTMLElement) => {
    return tOf(event.clientX - box.getBoundingClientRect().left)
  }
  // អូស scrub: ទីតាំងនៅ timeline + វីដេអូ seek (គ្មាន onScrub = seek ពេញលេញដូចមុន)
  const scrubTo = (event: PointerEvent<HTMLDivElement>) => {
    const at = secondsAt(event, event.currentTarget)
    if (!onScrub) return onSeek(at)
    setScrubAt(at)
    onScrub(at)
  }

  // ---- ចតុកោណជ្រើស (marquee): មាន split ហើយ អូសលើ strip / band / waveform = ជ្រើសផ្នែក;
  // អូសលើ ruler (ឬមិនទាន់មាន split) = scrub ដូចមុន; ចុចដោយមិនអូស = seek + ជ្រើសផ្នែកមួយ ----
  const RULER_PX = 28 // កម្ពស់ ruler (h-7)
  const press = useRef<{ x: number; y: number; scrub: boolean; moved: boolean; block: number | null } | null>(null)

  // ---- អូសប្លុកលើជួររូប (រូប OpusClip): ប្រអប់ដាច់ៗប្រវែងស្មើប្លុកនៅកន្លែងដើម, ប្លុកតាម mouse,
  // បន្ទាត់ gold = កន្លែងទម្លាក់; លែង = ប្លុកឆក់ជាប់គ្នា (គ្មានចន្លោះ) ----
  const blocks = useMemo(() => {
    let px = 0
    return blocksOf(outParts ?? sequence(cuts, [], total), splits).map((block) => {
      const w = (block.end - block.start) * pxPerSecond
      const x = outParts ? px : (block.start - head) * pxPerSecond
      px += w
      return { ...block, x, w }
    })
  }, [outParts, cuts, total, splits, pxPerSecond, head])
  const [dragBlock, setDragBlock] = useState<{ from: number; x: number; grab: number; gap: number } | null>(null)
  // ប្លុកដែលនៅក្នុងការជ្រើស (ចុចមួយ ឬចតុកោណ): ‖ នៅគែមទីមួយ និងគែមចុងក្រោយប៉ុណ្ណោះ
  const inSelection = (block: { start: number; end: number }) =>
    part !== null && part[0] <= block.start + 0.001 && part[1] >= block.end - 0.001
  const firstSelected = blocks.findIndex(inSelection)
  const lastSelected = blocks.findLastIndex(inSelection)
  const blockAt = (x: number) => blocks.findIndex((block) => x >= block.x && x < block.x + block.w)
  // ចន្លោះដែល mouse នៅ: 0 = មុនប្លុក 0, blocks.length = ក្រោយប្លុកចុង (ប្លុកដែលកំពុងអូសមិនរាប់)
  const gapAt = (x: number, from: number) => {
    const found = blocks.findIndex((block, at) => at !== from && x < block.x + block.w / 2)
    return found < 0 ? blocks.length : found
  }
  const isNewPlace = (from: number, gap: number) => gap !== from && gap !== from + 1
  const dropBlock = (from: number, gap: number) => {
    if (!isNewPlace(from, gap)) return // លែងនៅកន្លែងដើម = ត្រឡប់មកវិញ
    const block = blocks[from]
    if (block.insert === null) onMoveBlock?.(moveBlock(blocks, from, gap))
    else {
      // ផ្នែកបន្ថែមចូលមុនប្លុករក្សាបន្ទាប់ (`cuts.sequence`); គ្មានប្លុកបន្ទាប់ = ចុងវីដេអូ
      const next = blocks.slice(gap).find((item, at) => item.insert === null && at + gap !== from)
      onMoveInsert?.(block.insert, next ? next.start : total)
    }
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
  // ---- អូសគែមប្លុក (ក្រោយប្តូរលំដាប់): គែមដើម / ចុងរបស់ប្លុកនីមួយៗ ជំនួស trim handle ទាំងពីរ. អូសចូល = កាត់,
  // អូសចេញ = ស្តារ; ប្លុករួញពេលលែង (ការកាត់មួយ = undo មួយជំហាន); ចុចពីរដង = ស្តារទាំងអស់ ----
  const [edgeDrag, setEdgeDrag] = useState<{ index: number; side: 'start' | 'end'; at: number } | null>(null)
  const MIN_BLOCK_SEC = 0.5
  const edgeHandle = (index: number, side: 'start' | 'end') => {
    const block = blocks[index]
    const range: Cut = [block.start, block.end]
    const limit = blockEdgeLimit(cuts, order, range, side)
    const edge = side === 'start' ? block.start : block.end
    return {
      onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        setEdgeDrag({ index, side, at: edge })
      },
      onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        if (edgeDrag?.index !== index || edgeDrag.side !== side || !track.current) return
        const x = event.clientX - track.current.getBoundingClientRect().left
        const raw = side === 'start' ? block.start + (x - block.x) / pxPerSecond : block.end + (x - block.x - block.w) / pxPerSecond
        const at = side === 'start' ? Math.max(limit, Math.min(raw, block.end - MIN_BLOCK_SEC)) : Math.min(limit, Math.max(raw, block.start + MIN_BLOCK_SEC))
        setEdgeDrag({ index, side, at })
        onScrub?.(at) // preview បង្ហាញ frame ត្រង់គែមថ្មី
      },
      onPointerUp: (event: PointerEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        const at = edgeDrag?.at
        setEdgeDrag(null)
        if (at === undefined || Math.abs(at - edge) <= 0.001) return // ចុចដោយមិនអូស មិនមែនការកាត់ទេ
        onTrimBlock?.(range, side, at, event.altKey) // editor seek ទៅគែមថ្មី (ក្រោយ Snap)
      },
      onDoubleClick: (event: MouseEvent<HTMLSpanElement>) => {
        event.stopPropagation()
        if (Math.abs(limit - edge) > 0.001) onTrimBlock?.(range, side, limit, true)
      },
    }
  }
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const pointIn = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top }
  }
  const secondsOfX = tOf
  const track = useRef<HTMLDivElement>(null)

  // Trim handle: អូស = គែមប្លុកតាម mouse ហើយផ្នែកដែលនឹងកាត់ត្រូវបិទបាំង (រួញ, មិនមែនក្រហម);
  // លែង = ការកាត់មួយ (undo មួយជំហាន) ហើយប្លុករុញទៅ 0. អូសចេញក្រៅប្លុក = យកផ្នែកដែល trim មកវិញ;
  // ចុចពីរដងលើ handle = យកវាមកវិញទាំងអស់
  const [drag, setDrag] = useState<{ side: 'start' | 'end'; at: number } | null>(null)
  const handle = (side: 'start' | 'end') => ({
    onPointerDown: (event: PointerEvent<HTMLSpanElement>) => {
      event.stopPropagation() // កុំឲ្យ timeline seek
      event.currentTarget.setPointerCapture(event.pointerId)
      setDrag({ side, at: side === 'start' ? head : tail })
    },
    onPointerMove: (event: PointerEvent<HTMLSpanElement>) => {
      event.stopPropagation() // timeline មិន seek ដោយខ្លួនឯងទេ — handle seek ទៅទីតាំងរបស់វា
      if (!drag || !track.current) return
      // មិនកាត់ត្រឹមទិដ្ឋភាពទេ: អូសទៅឆ្វេងនៃ 0 (ឬស្តាំនៃចុង) = យកផ្នែកដែល trim មកវិញ
      const x = event.clientX - track.current.getBoundingClientRect().left
      const raw = Math.max(0, Math.min(total, head + x / pxPerSecond))
      // handle ដើមមិនអាចឆ្លងហួស handle ចុង (ទុកយ៉ាងហោចណាស់ 0.5 s)
      const at = side === 'start' ? Math.min(raw, tail - 0.5) : Math.max(raw, head + 0.5)
      setDrag({ side, at })
      onSeek(at) // preview បង្ហាញ frame ត្រង់កន្លែងដែលកំពុងកាត់
    },
    onPointerUp: (event: PointerEvent<HTMLSpanElement>) => {
      // ចុចដោយមិនអូស (ឧ. ចុចពីរដង) មិនមែនការ trim ទេ — បើមិនដូច្នោះ Snap រំកិលគែមទៅពាក្យដោយមិនចង់
      if (drag && Math.abs(drag.at - (side === 'start' ? head : tail)) > 0.001) onTrim?.(side, drag.at, event.altKey)
      setDrag(null)
    },
    onDoubleClick: () => onTrim?.(side, side === 'start' ? 0 : total, true),
  })
  // ទីតាំង handle: ធម្មតា = គែមប្លុក (0 / content); ពេលអូស = តាម mouse (អាចចេញក្រៅប្លុកបន្តិច)
  const headX = drag?.side === 'start' ? Math.max(-EDGE_PX, xOf(drag.at)) : 0
  const tailX = drag?.side === 'end' ? Math.min(content + EDGE_PX, xOf(drag.at)) : content

  // peaks ក្នុងទិដ្ឋភាព — in source mode: head..tail slice; in output mode: per-part (computed inline)
  const shownPeaks = outParts ? [] : peaks.slice(Math.floor((head / total) * peaks.length), Math.ceil((tail / total) * peaks.length))
  // timeSpan for the ruler: in output mode count output seconds, in source mode use source span
  const timeSpan = outParts ? outSeconds : span
  const zoomAt = ZOOMS.indexOf(zoom)
  // ប្រវែងវីដេអូដែល Export: ផ្នែករក្សា + ផ្នែកដែលបន្ថែម (ដូច pipeline `sequence`)
  const edited = cuts.length > 0 || inserts.length > 0 || order.length > 0
  const outLength = edited ? outputSeconds(sequence(cuts, inserts, duration, order)) : duration
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
                disabled={
                  time <= head ||
                  time >= tail ||
                  // playhead ជិតចំណុច split ដែលមានស្រាប់ (MIN_CUT = 0.05 s)
                  !!splits?.some((s) => Math.abs(s - time) < 0.05)
                }
                onClick={(event) => onSplit(event.altKey)}
              >
                <SplitIcon />
              </ToolIcon>
              {/* ភ្ជាប់ / ផ្ដាច់ audio ពី video — មិនទាន់មានក្នុង pipeline */}
              {/* Link: ភ្ជាប់ផ្នែកដែលជ្រើស (អូសចតុកោណលើផ្នែកច្រើន) ជាផ្នែកតែមួយ = ដក split ខាងក្នុង */}
              {/* Link: enable ពេល split មាន + ផ្នែកច្រើនជ្រើស */}
              <ToolIcon
                label={
                  linkable
                    ? t('ភ្ជាប់ផ្នែកដែលជ្រើសជាផ្នែកតែមួយ', 'Link the selected parts into one')
                    : !splits?.length
                      ? t('Split ជាមុនសិន ដើម្បីបង្កើតផ្នែក', 'Split first to create parts')
                      : t('អូសចតុកោណលើផ្នែកច្រើន ដើម្បីភ្ជាប់វា', 'Drag a box over several parts to link them')
                }
                disabled={!linkable || !splits?.length}
                onClick={onLink}
              >
                <LinkIcon />
              </ToolIcon>
              {/* Delete: enable ពេល split មាន + ផ្នែកត្រូវបានជ្រើស */}
              <ToolIcon
                label={
                  part
                    ? `${partCut ? t('ស្តារផ្នែក', 'Restore part') : t('លុបផ្នែក', 'Delete part')} ${part[0].toFixed(2)}–${part[1].toFixed(2)} s (Delete)`
                    : !splits?.length
                      ? t('Split ជាមុនសិន រួចចុចលើផ្នែកមួយ · ឬអូស ‖ ដើម/ចុង ដើម្បីកាត់', 'Split first, then click a part · or drag ‖ at the start / end to trim')
                      : t('ចុចលើផ្នែកមួយក្នុង timeline ជាមុនសិន', 'Click a part of the timeline first')
                }
                disabled={!part || !splits?.length}
                onClick={onTogglePart}
                tone={part && splits?.length ? (partCut ? 'text-ok' : 'text-danger') : undefined}
              >
                {partCut ? <span className="text-[15px] leading-none">↺</span> : <TrashIcon />}
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
          {/* Fit = zoom 1x: ឃើញវីដេអូទាំងមូល (ភ្លឺពេលកំពុង 1x) */}
          {!hidden && (
            <ToolIcon label={t('Fit · បង្ហាញវីដេអូទាំងមូល', 'Fit · show the whole video')} pressed={zoom === 1} onClick={() => setZoom(1)}>
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
            <span className="font-normal text-text-3">{stamp(outParts ? outLength : duration)}</span>
            {edited && !outParts && (
              <span className={`ml-2 font-normal ${outLength < duration ? 'text-danger' : 'text-gold'}`}>→ {stamp(outLength)}</span>
            )}
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
              const scrub = y < RULER_PX || !splits.length || !onPickRange
              press.current = { x, y, scrub, moved: false, block: null }
              if (!scrub) return // ចាំមើលថាអូស (ចតុកោណ) ឬចុច (seek) — ពេលលែង
              scrubTo(event)
              onPick?.(secondsAt(event, event.currentTarget)) // ជ្រើសផ្នែកនៅពេលចុច (មិនមែនពេលអូស)
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
                if (scrubAt !== null) onSeek(secondsAt(event, event.currentTarget))
                setScrubAt(null)
                return
              }
              const { x } = pointIn(event)
              if (start.block !== null && start.moved) {
                dropBlock(start.block, gapAt(x, start.block))
                setDragBlock(null)
              } else if (start.moved) {
                setMarquee(null)
                onPickRange?.(secondsOfX(Math.min(start.x, x)), secondsOfX(Math.max(start.x, x)))
              } else {
                onSeek(secondsOfX(x))
                onPick?.(secondsOfX(x))
              }
            }}
            className={`relative cursor-pointer select-none ${focusRing}`}
            style={{ width: content }}
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
            <div className="relative mb-1 h-6 overflow-hidden rounded-[6px] bg-raised-2">
              {shots.length ? (
                shots.map((shot) => {
                  const kind = kindOf(shot.kind)
                  const at = box(shot.start, shot.end)
                  if (!at) return null
                  return (
                    <span
                      key={shot.start}
                      title={`${t(kind.label, kind.en)}: ${shot.start.toFixed(1)}-${shot.end.toFixed(1)} s`}
                      className="absolute top-0 flex h-full items-center overflow-hidden border-r border-chrome px-2 text-[11px] font-semibold whitespace-nowrap text-text"
                      style={at}
                    >
                      {t(kind.label, kind.en)}
                    </span>
                  )
                })
              ) : (
                <span className="flex h-full items-center px-2 text-[11px] font-semibold text-text-2">{t('Original · មិនទាន់ reframe', 'Original · not reframed')}</span>
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
            {outParts ? (
              <div className="relative flex h-14 overflow-hidden rounded-[8px] border border-text-4">
                {/* ផ្នែកច្រើនជាង MAX_TILES (ឧ. Speech cleanup): រូបមួយជួរតាមពេល Export — មិនមែនរូបក្នុងផ្នែកនីមួយៗ
                    ព្រោះ FFmpeg ដករូបម្តងមួយ */}
                {partOffsets.length > MAX_TILES && (
                  <div className="absolute inset-0 flex">
                    {Array.from({ length: tiles }, (_, at) => (
                      <img
                        key={`${tiles}-${at}`}
                        src={sourceFrameUrl(videoPath, sourceAt(outParts, ((at + 0.5) / tiles) * outSeconds))}
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
                  const blockTiles = partOffsets.length > MAX_TILES ? 0 : Math.min(MAX_TILES, Math.max(1, Math.round(blockW / TILE_PX)))
                  return (
                    <div
                      key={idx}
                      className={`relative shrink-0 overflow-hidden ${blockTiles ? 'bg-raised-2' : ''}
                        ${isInsert ? 'ring-2 ring-inset ring-gold' : ''}
                        ${idx > 0 ? 'border-l-2 border-chrome' : ''}`}
                      style={{ width: blockW }}
                    >
                      {isInsert && (
                        <div className="pointer-events-none absolute top-0 left-0 z-10 rounded-br-[4px] bg-gold px-1.5 py-0.5 text-[9px] font-black uppercase leading-tight tracking-wide text-on-gold select-none">
                          HOOK
                        </div>
                      )}
                      <div className={`flex h-full ${onMoveBlock ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                        {Array.from({ length: blockTiles }, (_, ti) => {
                          const tileTime = p.start + ((ti + 0.5) / blockTiles) * (p.end - p.start)
                          const dimmed = part != null && (tileTime < part[0] || tileTime > part[1])
                          return (
                            <img
                              key={`${blockTiles}-${ti}`}
                              src={sourceFrameUrl(videoPath, tileTime)}
                              alt=""
                              loading="lazy"
                              draggable={false}
                              className={`h-full min-w-0 flex-1 object-cover transition-opacity duration-150 ${dimmed ? 'opacity-40' : (isInsert ? 'opacity-85' : 'opacity-100')}`}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className={`flex h-14 overflow-hidden rounded-[8px] border border-text-4 bg-raised-2 ${onMoveBlock ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                {Array.from({ length: tiles }, (_, at) => {
                  const tileTime = head + ((at + 0.5) / tiles) * span
                  const dimmed = part != null && (tileTime < part[0] || tileTime > part[1])
                  return (
                    <img
                      key={`${tiles}-${at}`}
                      src={sourceFrameUrl(videoPath, tileTime)}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      className={`h-full min-w-0 flex-1 object-cover transition-opacity duration-150 ${dimmed ? 'opacity-40' : 'opacity-100'}`}
                    />
                  )
                })}
              </div>
            )}

            {/* waveform: output mode = per-part segments; source mode = continuous */}
            {outParts ? (
              <div className="mt-3 flex h-12">
                {partOffsets.map((p, idx) => {
                  const blockW = Math.max(2, (p.end - p.start) * pxPerSecond)
                  const isInsert = p.insert !== null
                  const p0 = Math.floor((p.start / total) * peaks.length)
                  const p1 = Math.ceil((p.end / total) * peaks.length)
                  const blockPeaks = peaks.slice(p0, p1)
                  return (
                    <div
                      key={idx}
                      className={`relative shrink-0 rounded-[8px] px-0.5 ${isInsert ? 'bg-gold/15' : 'bg-raised'} ${idx > 0 ? 'border-l-2 border-chrome' : ''}`}
                      style={{ width: blockW }}
                    >
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
            ) : (
              <div className="mt-3 h-12 rounded-[8px] bg-raised px-1">
                {shownPeaks.length > 0 && (
                  <svg viewBox={`0 0 ${shownPeaks.length} 100`} preserveAspectRatio="none" className="size-full" aria-hidden="true">
                    <path
                      d={shownPeaks.map((peak, at) => `M${at + 0.5} ${50 - peak * 46}V${50 + peak * 46}`).join('')}
                      stroke="currentColor"
                      strokeWidth="0.6"
                      className="text-text-3"
                    />
                  </svg>
                )}
              </div>
            )}

            {/* ចន្លោះដែលលុបមិនគូរទេ: វាបាត់ពី timeline (output mode) ដូច trim */}

            {/* ផ្នែកដែលជ្រើស: ស៊ុមសជុំវិញប្លុក (រូប OpusClip) — ផ្នែកច្រើន = ស៊ុមមួយលើប្លុកទាំងនោះ */}
            {/* គ្មាន split: ប្លុកតែមួយ — ស៊ុមសជុំវិញវាពេលជ្រើស */}
            {picked && !part && blocks.length === 1 && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-[calc(56px+var(--space-h))] z-[2] h-14 rounded-[8px] border-2 border-white"
                style={{ left: blocks[0].x, width: blocks[0].w }}
              />
            )}
            {part && (
              <span
                aria-label={`${t('ផ្នែកដែលជ្រើស', 'Selected part')} ${part[0].toFixed(2)}–${part[1].toFixed(2)} s`}
                className="pointer-events-none absolute top-[calc(56px+var(--space-h))] z-[2] h-14 rounded-[8px] border-2 border-white"
                style={box(part[0], part[1], 4) ?? { display: 'none' }}
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

            {/* ផ្នែកដែលបន្ថែម: source mode = gold ＋ line at `at`; output mode = shown as HOOK block above */}
            {!outParts && inserts.map((item, index) => (
              <span
                key={`in${index}`}
                data-insert={item.at}
                title={`＋ ${stamp(item.start)}–${stamp(item.end)} ${t('ចាក់នៅទីនេះ', 'plays here')}`}
                className="pointer-events-none absolute top-[calc(56px+var(--space-h))] bottom-0 w-0.5 -translate-x-1/2 bg-gold"
                style={{ left: xOf(Math.max(head, Math.min(item.at, tail))) }}
              >
                <span className="absolute -top-2.5 left-1/2 flex size-4 -translate-x-1/2 items-center justify-center rounded-full bg-gold text-[11px] leading-none font-bold text-on-gold">
                  ＋
                </span>
              </span>
            ))}
            {/* Split = ចន្លោះ 4 px ពណ៌ផ្ទៃ timeline កាត់ band និងរូប -> ផ្នែកនីមួយៗជាប្លុកដាច់ (រូប OpusClip);
                waveform នៅជាប់គ្នា ព្រោះសំឡេងនៅតែមួយ */}
            {splits.filter((at) => at > head && at < tail).map((at) => (
              <span
                key={at}
                data-split={at}
                aria-hidden="true"
                className="pointer-events-none absolute top-[calc(28px+var(--space-h))] z-[1] w-1 -translate-x-1/2 rounded-full bg-chrome"
                style={{ left: xOf(at), height: RULER_PX + STRIP_PX }}
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

            {/* ពេលអូស handle ចូល: បិទបាំងផ្នែកដែលនឹងត្រូវ trim (ពណ៌ផ្ទៃ timeline) — ប្លុក និង waveform មើលទៅរួញ */}
            {drag && (drag.side === 'start' ? headX > 0 : tailX < content) && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-[calc(28px+var(--space-h))] bottom-0 z-[1] bg-chrome"
                style={drag.side === 'start' ? { left: -1, width: headX + 1 } : { left: tailX, width: content - tailX + 1 }}
              />
            )}

            {/* Trim handles: ដើម និងចុងនៃផ្នែកដែលនៅសល់; អូស = កាត់ពីដើម / ដល់ចុង */}
            {/* ប្លុកច្រើន: ‖ តែលើប្លុកដែលជ្រើស — គែមដើមនៃប្លុកទីមួយ និងគែមចុងនៃប្លុកចុងក្រោយក្នុងការជ្រើស.
                មិនជ្រើស = គ្មាន handle ដូច្នេះអូសពីគែមប្លុក គឺប្តូរលំដាប់ មិនមែនកាត់ដោយមើលមិនឃើញ */}
            {onTrimBlock && blocks.length > 1 && blocks.flatMap((block, index) => {
              if (block.insert !== null || block.w < 28 || !inSelection(block)) return []
              const sides = TRIM_SIDES.filter((side) => index === (side === 'start' ? firstSelected : lastSelected))
              return sides.map((side) => {
                const moving = edgeDrag?.index === index && edgeDrag.side === side ? edgeDrag.at : null
                const shift = moving === null ? 0 : (moving - (side === 'start' ? block.start : block.end)) * pxPerSecond
                const left = (side === 'start' ? block.x : block.x + block.w - 12) + shift
                return (
                  <span key={`${block.start}-${side}`}>
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
                      title={t('អូស = កាត់ · ចុចពីរដង = យកផ្នែកដែលកាត់មកវិញ', 'Drag = trim · double-click = bring the trimmed part back')}
                      {...edgeHandle(index, side)}
                      className={TRIM_HANDLE}
                      style={{ left }}
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

            {/* ប្លុកតែមួយ: ‖ ពីរនៅចុងជួរ ពេលជ្រើសវា */}
            {onTrim && picked && blocks.length === 1 &&
              TRIM_SIDES.map((side) => (
                <span
                  key={side}
                  role="slider"
                  aria-label={side === 'start' ? t('Trim ដើម', 'Trim start') : t('Trim ចុង', 'Trim end')}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(total)}
                  aria-valuenow={Math.round(drag?.side === side ? drag.at : side === 'start' ? head : tail)}
                  title={t('អូស = trim · ចុចពីរដង = យកផ្នែកដែល trim មកវិញ', 'Drag = trim · double-click = bring the trimmed part back')}
                  {...handle(side)}
                  className={`${TRIM_HANDLE} ${side === 'start' ? '' : '-translate-x-full'}`}
                  style={{ left: side === 'start' ? headX : tailX }}
                >
                  <GripBars />
                  {drag?.side === side && (
                    <span className="absolute -top-6 rounded-[4px] bg-black/80 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-text tabular-nums">
                      {drag.at.toFixed(2)} s
                    </span>
                  )}
                </span>
              ))}

            {/* playhead: បន្ទាត់ស ដែលមានក្បាលមូលនៅលើបន្ទាត់វាស់ (អូសបាន — track ចាប់ pointer) */}
            <span aria-hidden="true" className="pointer-events-none absolute top-0 bottom-0 z-[2] w-px -translate-x-1/2 bg-white" style={{ left: playheadX }}>
              <span className="absolute top-0 left-1/2 h-6 w-3.5 -translate-x-1/2 rounded-[5px] border-2 border-white bg-chrome" />
            </span>
          </div>
          </div>
          <AddClip label={t('បន្ថែមវីដេអូក្រោយ clip នេះ — ជំហានបន្ទាប់', 'Add a video after this clip — next step')} />
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
