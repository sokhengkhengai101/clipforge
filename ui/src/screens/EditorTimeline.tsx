import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { api, sourceFrameUrl, type ReframeShot } from '../api'
import { trimEdges, type Cut } from '../cutList'
import { focusRing } from '../kit/styles'
import { kindOf } from './layoutKinds'

const TILE_PX = 100 // ទទឹងរូបតូចមួយលើ timeline (រូប OpusClip)
const MAX_TILES = 60 // FFmpeg ដករូបម្តងមួយ — កំណត់ចំនួន ដើម្បីកុំឲ្យ sidecar រវល់ពេក
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8]
const TRIM_SIDES = ['start', 'end'] as const

/** ពេលលើបន្ទាត់វាស់: រាល់ 1, 2, 5, 10, 15, 30, 60 ... វិនាទី ឲ្យឃ្លាតគ្នាប្រហែល 90 px. */
function tickStep(pxPerSecond: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return steps.find((step) => step * pxPerSecond >= 90) ?? 900
}

function label(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : String(rest)
}

/** Timeline ខាងក្រោម editor (ផ្នែកទី ៣) — រូប OpusClip: ជួរ layout, ជួររូបតូច, waveform, playhead.
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
  noTrack = [],
  subjects = [],
  splits = [],
  part = null,
  partCut = false,
  onPick,
  onSplit,
  onTogglePart,
  onTrim,
  onSeek,
}: {
  project: string
  videoPath: string
  duration: number
  time: number
  playing: boolean
  audioReady: boolean // transcript មានហើយ = audio.wav មាន (waveform)
  cuts?: [number, number][] // ចន្លោះដែលលុប — ឆ្នូតក្រហមពីលើជួរ
  noTrack?: [number, number][] // scene ដែលបិទ tracking — ស៊ុមដាច់ៗលើជួរ layout
  subjects?: [number, number][] // scene ដែលតាមប្រធានបទដោយដៃ — ស៊ុម gold
  splits?: number[] // ចំណុច Split (បន្ទាត់ស)
  part?: Cut | null // ផ្នែកដែលជ្រើស (ស៊ុម gold)
  partCut?: boolean // ផ្នែកនោះលុបរួចហើយ -> ប៊ូតុង "ស្តារ"
  onPick?: (seconds: number) => void // ចុចលើ timeline = ជ្រើសផ្នែកនៅពេលនោះ
  onSplit?: (exact: boolean) => void
  onTogglePart?: () => void
  onTrim?: (side: 'start' | 'end', seconds: number, exact: boolean) => void
  onSeek: (seconds: number) => void
}) {
  const [hidden, setHidden] = useState(false)
  const [zoom, setZoom] = useState(1)
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)

  // ទទឹងពិតនៃផ្ទៃ timeline (ប្តូរពេល window ប្តូរទំហំ)
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    const observer = new ResizeObserver(() => setWidth(box.clientWidth))
    observer.observe(box)
    setWidth(box.clientWidth)
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
  const content = Math.max(width, width * zoom)
  const pxPerSecond = content / total
  const tiles = Math.min(MAX_TILES, Math.max(1, Math.round(content / TILE_PX)))
  const step = tickStep(pxPerSecond)
  const playheadX = (Math.min(time, total) / total) * content

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
    const x = event.clientX - box.getBoundingClientRect().left
    return Math.max(0, Math.min(total, (x / content) * total))
  }
  const seekAt = (event: PointerEvent<HTMLDivElement>) => onSeek(secondsAt(event, event.currentTarget))
  const track = useRef<HTMLDivElement>(null)

  // Trim handle: អូស = បង្ហាញទីតាំងថ្មី (ghost), លែង = ការកាត់មួយ (undo មួយជំហាន មិនមែនរាប់រយ)
  const [head, tail] = trimEdges(cuts, total)
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
      const raw = secondsAt(event, track.current)
      // handle ដើមមិនអាចឆ្លងហួស handle ចុង (ទុកយ៉ាងហោចណាស់ 0.5 s)
      const at = side === 'start' ? Math.min(raw, tail - 0.5) : Math.max(raw, head + 0.5)
      setDrag({ side, at })
      onSeek(at) // preview បង្ហាញ frame ត្រង់កន្លែងដែលកំពុងកាត់
    },
    onPointerUp: (event: PointerEvent<HTMLSpanElement>) => {
      if (drag) onTrim?.(side, drag.at, event.altKey)
      setDrag(null)
    },
  })
  const headX = (drag?.side === 'start' ? drag.at : head) * pxPerSecond
  const tailX = (drag?.side === 'end' ? drag.at : tail) * pxPerSecond

  const zoomAt = ZOOMS.indexOf(zoom)
  return (
    <section aria-label="Timeline" className="shrink-0 border-t border-line bg-chrome">
      <div className="flex items-center gap-3 px-5 py-2">
        <button
          type="button"
          onClick={() => setHidden((value) => !value)}
          className={`cursor-pointer rounded-field border-0 bg-transparent px-2 py-1 type-label font-semibold text-text hover:bg-field ${focusRing}`}
        >
          {hidden ? 'Show timeline' : 'Hide timeline'}
        </button>
        {onSplit && (
          <div role="group" aria-label="Timeline tools" className="flex items-center gap-1">
            <button
              type="button"
              onClick={(event) => onSplit(event.altKey)}
              title="Split នៅ playhead (S) — រំកិលចេញពីកណ្តាលពាក្យ; Alt = ចំណុចពិត"
              className={`flex cursor-pointer items-center gap-1.5 rounded-field border-0 bg-transparent px-2 py-1 type-label text-text hover:bg-field ${focusRing}`}
            >
              <SplitIcon /> Split
            </button>
            <button
              type="button"
              disabled={!part}
              onClick={onTogglePart}
              title={part ? `${part[0].toFixed(2)}–${part[1].toFixed(2)} s (Delete)` : 'Split ជាមុនសិន រួចចុចលើផ្នែកមួយ'}
              className={`flex cursor-pointer items-center gap-1.5 rounded-field border-0 bg-transparent px-2 py-1 type-label hover:bg-field disabled:cursor-default disabled:opacity-35 ${
                partCut ? 'text-ok' : 'text-danger'
              } ${focusRing}`}
            >
              {partCut ? '↺ ស្តារផ្នែក' : '🗑 លុបផ្នែក'}
            </button>
            <span className="type-hint text-text-4">
              {splits.length ? `${splits.length} split · ចុចលើផ្នែកមួយ` : 'អូស ‖ ដើម/ចុង ដើម្បីកាត់'}
            </span>
          </div>
        )}
        {!hidden && (
          <label className="ml-auto flex items-center gap-2 type-label text-text-3">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoomAt <= 0}
              onClick={() => setZoom(ZOOMS[Math.max(0, zoomAt - 1)])}
              className={`cursor-pointer rounded-field border-0 bg-transparent px-1.5 text-text disabled:opacity-30 ${focusRing}`}
            >
              −
            </button>
            <input
              type="range"
              min={0}
              max={ZOOMS.length - 1}
              value={zoomAt}
              onChange={(event) => setZoom(ZOOMS[Number(event.target.value)])}
              aria-label="Zoom timeline"
              className={`w-32 cursor-pointer accent-white ${focusRing}`}
            />
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoomAt >= ZOOMS.length - 1}
              onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomAt + 1)])}
              className={`cursor-pointer rounded-field border-0 bg-transparent px-1.5 text-text disabled:opacity-30 ${focusRing}`}
            >
              +
            </button>
            <span className="w-8 tabular-nums">{zoom}x</span>
          </label>
        )}
      </div>

      {!hidden && (
        <div ref={scroller} className="overflow-x-auto overflow-y-hidden px-0 pb-3">
          <div
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label="ពេលក្នុងវីដេអូ"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(time)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') onSeek(Math.min(total, time + 1))
              if (event.key === 'ArrowLeft') onSeek(Math.max(0, time - 1))
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              seekAt(event)
              onPick?.(secondsAt(event, event.currentTarget)) // ជ្រើសផ្នែកនៅពេលចុច (មិនមែនពេលអូស)
            }}
            onPointerMove={(event) => event.buttons === 1 && seekAt(event)}
            className={`relative cursor-pointer select-none ${focusRing}`}
            style={{ width: content }}
          >
            {/* បន្ទាត់វាស់ */}
            <div className="relative h-5 text-[11px] text-text-4">
              {Array.from({ length: Math.floor(total / step) + 1 }, (_, at) => at * step).map((second) => (
                <span key={second} className="absolute top-0 -translate-x-1/2 tabular-nums" style={{ left: second * pxPerSecond }}>
                  {second % (step * 2) === 0 ? label(second) : '·'}
                </span>
              ))}
            </div>

            {/* ជួរ layout: shot ពី reframe ចុងក្រោយ, បើគ្មាន = វីដេអូដើម */}
            <div className="relative h-6 overflow-hidden rounded-t-[6px] bg-raised">
              {shots.length ? (
                shots.map((shot) => {
                  const kind = kindOf(shot.kind)
                  return (
                    <span
                      key={shot.start}
                      title={`${kind.label}: ${shot.start.toFixed(1)}-${shot.end.toFixed(1)} s`}
                      className={`absolute top-0 flex h-full items-center overflow-hidden border-r border-chrome px-1.5 text-[11px] font-semibold ${kind.bar} ${kind.ink}`}
                      style={{ left: shot.start * pxPerSecond, width: Math.max(2, (shot.end - shot.start) * pxPerSecond) }}
                    >
                      {kind.label}
                    </span>
                  )
                })
              ) : (
                <span className="flex h-full items-center px-2 text-[11px] font-semibold text-text-3">វីដេអូដើម · មិនទាន់ reframe</span>
              )}
              {noTrack.map(([start, end]) => (
                <span
                  key={`nt${start}`}
                  title={`Tracking បិទ: ${start.toFixed(1)}-${end.toFixed(1)} s`}
                  className="pointer-events-none absolute top-0 flex h-full items-center justify-end overflow-hidden rounded-[4px] border-2 border-dashed border-info bg-info/15 px-1 text-[10px] font-bold text-info"
                  style={{ left: start * pxPerSecond, width: Math.max(2, (end - start) * pxPerSecond) }}
                >
                  Tracker OFF
                </span>
              ))}
              {subjects.map(([start, end]) => (
                <span
                  key={`sj${start}`}
                  title={`តាមដោយដៃ: ${start.toFixed(1)}-${end.toFixed(1)} s`}
                  className="pointer-events-none absolute top-0 flex h-full items-center justify-end overflow-hidden rounded-[4px] border-2 border-gold bg-gold/15 px-1 text-[10px] font-bold text-gold"
                  style={{ left: start * pxPerSecond, width: Math.max(2, (end - start) * pxPerSecond) }}
                >
                  Subject
                </span>
              ))}
            </div>

            {/* រូបតូច: frame ពិតនៅកណ្តាលប្រអប់នីមួយៗ; lazy = ទាញតែពេលឃើញ (zoom ច្រើន) */}
            <div className="flex h-[56px] overflow-hidden rounded-b-[6px] border-2 border-text-3 bg-raised-2">
              {Array.from({ length: tiles }, (_, at) => (
                <img
                  key={`${tiles}-${at}`}
                  src={sourceFrameUrl(videoPath, ((at + 0.5) / tiles) * total)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="h-full min-w-0 flex-1 object-cover"
                />
              ))}
            </div>

            {/* waveform: peaks 0..1 -> បន្ទាត់ឈរ, SVG ពង្រីកតាមទទឹង (preserveAspectRatio none) */}
            <div className="mt-1.5 h-10 rounded-[6px] bg-raised/60">
              {peaks.length > 0 && (
                <svg viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" className="size-full" aria-hidden="true">
                  <path
                    d={peaks.map((peak, at) => `M${at + 0.5} ${50 - peak * 46}V${50 + peak * 46}`).join('')}
                    stroke="currentColor"
                    strokeWidth="0.6"
                    className="text-text-3"
                  />
                </svg>
              )}
            </div>

            {/* ចន្លោះដែលលុប: ឆ្នូតក្រហម (repeating-linear-gradient) ពីលើរូប និង waveform */}
            {cuts.map(([start, end]) => (
              <span
                key={start}
                aria-hidden="true"
                className="pointer-events-none absolute top-5 bottom-0 border-x border-danger"
                style={{
                  left: start * pxPerSecond,
                  width: Math.max(2, (end - start) * pxPerSecond),
                  background:
                    'repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-danger) 45%, transparent) 0 6px, transparent 6px 12px)',
                }}
              />
            ))}

            {/* ផ្នែកដែលជ្រើស: ស៊ុម gold ពីលើរូប និង waveform */}
            {part && (
              <span
                aria-label={`ផ្នែកដែលជ្រើស ${part[0].toFixed(2)}–${part[1].toFixed(2)} s`}
                className="pointer-events-none absolute top-11 bottom-0 rounded-[6px] border-2 border-gold bg-gold/10"
                style={{ left: part[0] * pxPerSecond, width: Math.max(4, (part[1] - part[0]) * pxPerSecond) }}
              />
            )}

            {/* ចំណុច Split: បន្ទាត់សពេញកម្ពស់ ដោយមានក្បាលតូច */}
            {splits.map((at) => (
              <span
                key={at}
                data-split={at}
                aria-hidden="true"
                className="pointer-events-none absolute top-11 bottom-0 w-0.5 -translate-x-1/2 bg-text"
                style={{ left: at * pxPerSecond }}
              >
                <span className="absolute -top-1 -left-[3px] size-2 rotate-45 bg-text" />
              </span>
            ))}

            {/* Trim handles: ដើម និងចុងនៃផ្នែកដែលនៅសល់; អូស = កាត់ពីដើម / ដល់ចុង */}
            {onTrim &&
              TRIM_SIDES.map((side) => (
                <span
                  key={side}
                  role="slider"
                  aria-label={side === 'start' ? 'Trim ដើម' : 'Trim ចុង'}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(total)}
                  aria-valuenow={Math.round((side === 'start' ? headX : tailX) / pxPerSecond)}
                  {...handle(side)}
                  className={`absolute top-11 bottom-0 z-[1] flex w-3 cursor-ew-resize touch-none items-center justify-center rounded-[4px] bg-gold text-[9px] font-bold text-on-gold ${
                    side === 'start' ? '' : '-translate-x-full'
                  }`}
                  style={{ left: side === 'start' ? headX : tailX }}
                >
                  ‖
                  {drag?.side === side && (
                    <span className="absolute -top-6 rounded-[4px] bg-black/80 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-text tabular-nums">
                      {drag.at.toFixed(2)} s
                    </span>
                  )}
                </span>
              ))}

            {/* playhead */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-4 bottom-0 w-0.5 bg-white"
              style={{ left: playheadX }}
            >
              <span className="absolute -top-1 -left-[5px] h-3 w-3 rounded-[3px] border-2 border-white bg-chrome" />
            </span>
          </div>
        </div>
      )}
    </section>
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
