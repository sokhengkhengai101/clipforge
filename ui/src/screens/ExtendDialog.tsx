import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { sourceUrl, type EditorItem } from '../api'
import { isCut, type Cut } from '../cutList'
import { Dialog } from '../kit/Dialog'
import { focusRing } from '../kit/styles'
import { useT } from '../i18n'

/** "+ Extend a clip" របស់ Edit Video — រចនាតាម dialog "Add a section from transcript" របស់ OpusClip.
 *
 *  Add ដាក់ផ្នែកដែលជ្រើស **នៅកន្លែងដែលអ្នកជ្រើស** (អ្នកអភិវឌ្ឍ 2026-10-28):
 *  - កន្លែងដើម = យកវាចេញពី cut list (ស្តារ) — បានតែពេលផ្នែកនោះត្រូវកាត់;
 *  - ដើម (hook) / playhead / ចុង = **ចម្លង**វាជា insert `{start, end, at}` (pipeline `cuts.sequence`);
 *    ផ្នែកដែលនៅក្នុងវីដេអូរួច នឹងលេចពីរដង ហើយ footer និយាយដូច្នោះ.
 *
 *  ឆ្វេង: ប្រយោគពី transcript ([0:00:01] ...) — ចុច = ប្រយោគទាំងមូល, អូស = ពាក្យពីណាដល់ណា; ពាក្យដែល
 *  កាត់ឥឡូវ គូសឆ្នូត. ស្តាំ: វីដេអូដើមនៅចំណុចចាប់ផ្តើម, ▶ ចាក់តែផ្នែកដែលជ្រើស, slider ពីរក្បាលលើវីដេអូ
 *  ទាំងមូល, និង − / + (0.1 s) សម្រាប់ចំណុចនីមួយៗ. */
export function ExtendDialog({
  items,
  duration,
  cuts,
  videoPath,
  initialTime,
  onAdd,
  snapTo,
  onClose,
}: {
  items: EditorItem[]
  duration: number
  cuts: Cut[]
  videoPath: string
  initialTime: number // playhead របស់ editor — ប្រយោគនៅទីនោះត្រូវជ្រើសតាំងពីបើក
  onAdd: (range: Cut, at: number | null) => void // at = null: ស្តារនៅកន្លែងដើម
  snapTo?: (seconds: number, alt: boolean) => number // Snap របស់ timeline: អូស handle = ជាប់គែមពាក្យ
  onClose: () => void
}) {
  const t = useT()
  const sentences = useMemo(() => sentencesOf(items), [items])
  const [range, setRange] = useState<Cut | null>(() => {
    const here = sentences.find((sentence) => initialTime < sentence.end) ?? sentences[0]
    return here ? [here.start, here.end] : null
  })

  // ---- អូសលើពាក្យ: anchor = ពាក្យដែលចុច, ចុចដោយមិនអូស = ប្រយោគទាំងមូល ----
  const drag = useRef<{ anchor: number; moved: boolean } | null>(null)
  const wordsRange = (a: number, b: number): Cut => [items[Math.min(a, b)].start, items[Math.max(a, b)].end]
  useEffect(() => {
    const stop = () => {
      const done = drag.current
      drag.current = null
      if (!done || done.moved) return
      const sentence = sentences.find((item) => done.anchor >= item.from && done.anchor <= item.to)
      if (sentence) setRange([sentence.start, sentence.end])
    }
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [sentences])

  // ---- វីដេអូ: នៅចំណុចចាប់ផ្តើមពេលផ្អាក, ▶ ចាក់តែផ្នែក ----
  const player = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(range?.[0] ?? 0)
  const [playing, setPlaying] = useState(false)
  const start = range?.[0] ?? 0
  useEffect(() => {
    const node = player.current
    if (!node || !node.paused) return
    node.currentTime = start
  }, [start])
  const togglePlay = () => {
    const node = player.current
    if (!node || !range) return
    if (!node.paused) return node.pause()
    if (node.currentTime < range[0] || node.currentTime >= range[1] - 0.05) node.currentTime = range[0]
    void node.play()
  }

  // វិនាទីដែលកាត់ឥឡូវក្នុងផ្នែកនេះ = អ្វីដែលកាត់សរុប − អ្វីដែលនៅកាត់ក្រោយ Add
  const comesBack = range ? cuts.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, range[1]) - Math.max(a, range[0])), 0) : 0
  const length = range ? range[1] - range[0] : 0
  // ដាក់នៅណា: null = ស្វ័យប្រវត្តិ (កាត់ = កន្លែងដើម, មិនកាត់ = hook នៅដើម); "កន្លែងដើម" លើផ្នែកមិនកាត់ = hook
  const [position, setPosition] = useState<Position | null>(null)
  const canRestore = comesBack >= 0.05
  const where: Position = position === 'own' && !canRestore ? 'start' : (position ?? (canRestore ? 'own' : 'start'))
  const at = where === 'own' ? null : where === 'start' ? 0 : where === 'playhead' ? initialTime : duration
  const twice = where !== 'own' && length - comesBack > 0.05 // ផ្នែកខ្លះនៅក្នុងវីដេអូរួច = លេចពីរដង
  const listBox = useRef<HTMLDivElement>(null)
  // Side by side = transcript + វីដេអូ; Caption only = transcript ពេញទទឹង (ចងចាំក្នុង localStorage)
  const [view, setView] = useState<View>(loadView)
  // ប្រយោគដែលជ្រើសនៅក្នុងទិដ្ឋភាពពេលបើក
  useEffect(() => {
    listBox.current?.querySelector('[data-picked="true"]')?.scrollIntoView({ block: 'center' })
  }, [])

  return (
    <Dialog
      title={t('បន្ថែមផ្នែកពី transcript', 'Add a section from transcript')}
      width={view === 'side' ? 1100 : 760} // Caption only: បន្ទាត់ខ្លីល្មមអាន
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label={t('ដាក់នៅ', 'Place at')} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 type-label text-text-3">{t('ដាក់នៅ:', 'Place at:')}</span>
            {(
              [
                ['own', t('កន្លែងដើម (ស្តារ)', 'Its own place (restore)'), !canRestore],
                ['start', t('ដើមវីដេអូ (hook)', 'Start (hook)'), false],
                ['playhead', `${t('Playhead', 'Playhead')} ${clockMs(initialTime)}`, false],
                ['end', t('ចុងវីដេអូ', 'End'), false],
              ] as const
            ).map(([value, label, disabled]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={where === value}
                disabled={disabled}
                title={disabled ? t('ផ្នែកនេះមិនត្រូវកាត់ — វានៅកន្លែងដើមរួចហើយ', 'This section is not cut — it is already in its place') : undefined}
                onClick={() => setPosition(value)}
                className={`min-h-8 cursor-pointer rounded-full border-0 px-3 type-label font-semibold disabled:cursor-default disabled:opacity-35 ${
                  where === value ? 'bg-gold text-on-gold' : 'bg-raised text-text-2 hover:bg-raised-2'
                } ${focusRing}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
          <p className="m-0 min-w-0 flex-1 type-hint text-text-3" role="status">
            {!range
              ? t('ជ្រើសផ្នែកមួយ', 'Select a section')
              : where === 'own'
                ? t(`នឹងបន្ថែម ${comesBack.toFixed(1)} s ដែលកាត់ឥឡូវ មកវិញ នៅកន្លែងដើម`, `Adds back ${comesBack.toFixed(1)} s that is cut now, in its own place`)
                : t(
                    `ចម្លង ${clockMs(range[0])}–${clockMs(range[1])} (${length.toFixed(1)} s) ទៅ${where === 'start' ? 'ដើមវីដេអូ' : where === 'end' ? 'ចុងវីដេអូ' : ` ${clockMs(initialTime)}`}`,
                    `Copies ${clockMs(range[0])}–${clockMs(range[1])} (${length.toFixed(1)} s) to ${where === 'start' ? 'the start' : where === 'end' ? 'the end' : clockMs(initialTime)}`,
                  ) + (twice ? t(' — ផ្នែកនេះនឹងលេចពីរដងក្នុងវីដេអូ', ' — this section will play twice') : '')}
          </p>
          <button
            type="button"
            disabled={!range || (where === 'own' && !canRestore)}
            onClick={() => range && onAdd(range, at)}
            className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-button border-0 bg-white px-5 type-body font-bold text-bg disabled:cursor-default disabled:opacity-40 ${focusRing}`}
          >
            <span aria-hidden="true">＋</span> {t('បន្ថែម', 'Add')}
          </button>
          </div>
        </div>
      }
    >
      <div className="-mt-3 flex items-center gap-3 border-b border-line pb-3">
        <p className="m-0 min-w-0 flex-1 type-body text-text-3">{t('ចុច ឬអូស ដើម្បីជ្រើសផ្នែកមួយ.', 'Click or drag to select a section.')}</p>
        <ViewMenu
          view={view}
          onView={(next) => {
            setView(next)
            saveView(next)
          }}
        />
      </div>
      <div className="flex min-h-0 gap-6">
        {/* ---- ប្រយោគ ---- */}
        <div ref={listBox} className="max-h-[56vh] min-w-0 flex-1 overflow-y-auto pr-3 select-none">
          {sentences.map((sentence) => {
            const picked = range !== null && sentence.start < range[1] && sentence.end > range[0]
            return (
              <div key={sentence.from} data-picked={picked} className="flex gap-5 py-2.5">
                <button
                  type="button"
                  onClick={() => setRange([sentence.start, sentence.end])}
                  title={t('ជ្រើសប្រយោគនេះ', 'Select this sentence')}
                  className={`w-[88px] shrink-0 cursor-pointer self-start rounded-field border-0 bg-transparent p-0 pt-1 text-left type-label tabular-nums text-text-3 hover:text-text ${focusRing}`}
                >
                  [{clock(sentence.start)}]
                </button>
                <p className="m-0 text-[17px] leading-[2]">
                  {items.slice(sentence.from, sentence.to + 1).map((item, offset) => {
                    if (!('word' in item)) return null
                    const index = sentence.from + offset
                    const chosen = inRange(range, item)
                    // ចន្លោះរវាងពាក្យជ្រើសពីរ ក៏មានពណ៌ដែរ — ការជ្រើសជាបន្ទះមួយ មិនមែនប្រអប់ដាច់ៗ
                    const before = items.slice(sentence.from, index).findLast((other) => 'word' in other)
                    const joined = chosen && before !== undefined && inRange(range, before)
                    const gone = isCut(cuts, item.start, item.end)
                    return (
                      <span key={index}>
                        {offset > 0 && <span className={joined ? 'bg-info/35' : ''}> </span>}
                        <span
                          onPointerDown={(event: ReactPointerEvent) => {
                            if (event.button !== 0) return
                            drag.current = { anchor: index, moved: false }
                            setRange(wordsRange(index, index))
                          }}
                          onPointerEnter={() => {
                            const now = drag.current
                            if (!now) return
                            if (index !== now.anchor) now.moved = true
                            setRange(wordsRange(now.anchor, index))
                          }}
                          title={gone ? t('កាត់ឥឡូវ — Add នឹងយកមកវិញ', 'Cut now — Add brings it back') : undefined}
                          className={`cursor-pointer box-decoration-clone py-0.5 ${chosen ? 'bg-info/35 text-text' : ''} ${
                            gone ? 'text-text-4 line-through decoration-danger' : ''
                          }`}
                        >
                          {item.word}
                        </span>
                      </span>
                    )
                  })}
                </p>
              </div>
            )
          })}
        </div>

        {/* ---- preview + ចំណុចចាប់ផ្តើម / បញ្ចប់ (Caption only = លាក់) ---- */}
        {view === 'side' && (
          <div className="flex w-[440px] shrink-0 flex-col justify-center gap-5 border-l border-line pl-6">
            <div className="relative aspect-video overflow-hidden rounded-[10px] bg-black">
              <video
                ref={player}
                src={sourceUrl(videoPath)}
                preload="metadata"
                onLoadedMetadata={(event) => (event.currentTarget.currentTime = start)}
                onTimeUpdate={(event) => {
                  const node = event.currentTarget
                  setTime(node.currentTime)
                  if (range && !node.paused && node.currentTime >= range[1]) node.pause() // ឈប់នៅចុងផ្នែក
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                className="size-full object-contain"
              />
              <button
                type="button"
                onClick={togglePlay}
                disabled={!range}
                aria-label={playing ? t('ផ្អាក', 'Pause') : t('ចាក់ផ្នែកនេះ', 'Play this section')}
                className={`absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-1 border-0 bg-transparent text-white ${
                  playing ? 'opacity-0 hover:opacity-100' : ''
                } ${focusRing}`}
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-white text-[20px] text-bg shadow-lg">{playing ? '❚❚' : '▶'}</span>
                <span className="type-label font-semibold tabular-nums [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">{clockMs(time)}</span>
              </button>
            </div>
            <RangeSlider
              duration={duration}
              range={range}
              snapTo={snapTo}
              onChange={(next) => {
                setRange(next)
                player.current?.pause()
              }}
            />
          </div>
        )}
      </div>
    </Dialog>
  )
}

/** slider ពីរក្បាលលើវីដេអូទាំងមូល + − / + និងពេលក្រោមក្បាលនីមួយៗ (រូប OpusClip). */
function RangeSlider({
  duration,
  range,
  snapTo,
  onChange,
}: {
  duration: number
  range: Cut | null
  snapTo?: (seconds: number, alt: boolean) => number // តែពេលអូស; − / + និង ←/→ នៅតែ 0.1 s ពិត
  onChange: (range: Cut) => void
}) {
  const t = useT()
  const track = useRef<HTMLDivElement>(null)
  const [a, b] = range ?? [0, 0]
  const total = duration || 1
  const MIN = 0.1 // ផ្នែកខ្លីបំផុត (វិនាទី)
  const set = (side: 0 | 1, seconds: number) => {
    const value = Math.round(seconds * 1000) / 1000
    if (side === 0) onChange([Math.min(Math.max(0, value), b - MIN), b])
    else onChange([a, Math.max(Math.min(duration, value), a + MIN)])
  }
  const secondsAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect()
    if (!box) return 0
    return ((clientX - box.left) / box.width) * total
  }
  return (
    <div className={`flex flex-col gap-3 ${range ? '' : 'pointer-events-none opacity-40'}`}>
      <div ref={track} className="relative mx-3 h-7">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-raised-2" />
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white" style={{ left: `${(a / total) * 100}%`, width: `${((b - a) / total) * 100}%` }} />
        {([0, 1] as const).map((side) => (
          <div
            key={side}
            role="slider"
            tabIndex={0}
            aria-label={side === 0 ? t('ចំណុចចាប់ផ្តើម', 'Start') : t('ចំណុចបញ្ចប់', 'End')}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(side === 0 ? a : b)}
            aria-valuetext={clockMs(side === 0 ? a : b)}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (event.buttons !== 1) return
              const at = secondsAt(event.clientX)
              set(side, snapTo ? snapTo(at, event.altKey) : at)
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 1 : 0.1
              const delta = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
              if (!delta) return
              event.preventDefault()
              set(side, (side === 0 ? a : b) + delta)
            }}
            className={`absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-text-4 bg-raised-3 active:cursor-grabbing ${focusRing}`}
            style={{ left: `${((side === 0 ? a : b) / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        {([0, 1] as const).map((side) => (
          <span key={side} className="flex items-center gap-2">
            <Nudge label={t('-0.1 វិនាទី', '-0.1 s')} onClick={() => set(side, (side === 0 ? a : b) - 0.1)}>
              −
            </Nudge>
            <span className="w-[72px] text-center type-label tabular-nums text-text-2">{clockMs(side === 0 ? a : b)}</span>
            <Nudge label={t('+0.1 វិនាទី', '+0.1 s')} onClick={() => set(side, (side === 0 ? a : b) + 0.1)}>
              +
            </Nudge>
          </span>
        ))}
      </div>
    </div>
  )
}

function Nudge({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex size-7 cursor-pointer items-center justify-center rounded-field border border-line bg-transparent text-text-2 hover:bg-field ${focusRing}`}
    >
      {children}
    </button>
  )
}

/** Add ដាក់ផ្នែកនៅណា (រូប OpusClip គ្មាន — ជម្រើសរបស់អ្នកអភិវឌ្ឍ). */
type Position = 'own' | 'start' | 'playhead' | 'end'

type View = 'side' | 'captions'

/** ប៊ូតុងរូបផ្ទាំង (ជ្រុងស្តាំខាងលើ) + menu "Side by side / Caption only" (រូប OpusClip).
 *  Escape បិទតែ menu (capture + stopPropagation) មិនមែន dialog ទាំងមូលទេ — ដូច Menu.tsx. */
function ViewMenu({ view, onView }: { view: View; onView: (view: View) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  const options: [View, string, ReactNode][] = [
    ['side', t('ក្បែរគ្នា', 'Side by side'), <SideIcon key="side" />],
    ['captions', t('តែ caption', 'Caption only'), <CaptionIcon key="captions" />],
  ]
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('របៀបបង្ហាញ', 'View')}
        title={t('របៀបបង្ហាញ', 'View')}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-field border-0 bg-transparent text-text-2 hover:bg-raised hover:text-text ${focusRing}`}
      >
        {view === 'side' ? <SideIcon /> : <CaptionIcon />}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('របៀបបង្ហាញ', 'View')}
          className="absolute top-full right-0 z-20 mt-1 w-[190px] rounded-card border border-line bg-chrome p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
        >
          {options.map(([value, label, icon]) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={view === value}
              onClick={() => {
                onView(value)
                setOpen(false)
              }}
              className={`flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-field border-0 px-3 text-left type-body font-bold text-text hover:bg-raised ${
                view === value ? 'bg-raised' : 'bg-transparent'
              } ${focusRing}`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SideIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2.5" y="3" width="13" height="12" rx="1.5" />
      <path d="M9 3v12" />
    </svg>
  )
}

function CaptionIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="2" y="3.5" width="14" height="11" rx="3" />
      <path d="M8 7.6a1.8 1.8 0 1 0 0 2.8M13 7.6a1.8 1.8 0 1 0 0 2.8" />
    </svg>
  )
}

/* របៀបបង្ហាញក្នុង localStorage (try/catch: private window អាចបិទ storage) */
const VIEW_KEY = 'kcs.extendView'
function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'captions' ? 'captions' : 'side'
  } catch {
    return 'side'
  }
}
function saveView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // គ្មាន storage = របៀបនៅតែប្តូរក្នុងពេលនេះ
  }
}

/** ពាក្យនៅក្នុងផ្នែកដែលជ្រើស — តាមចំណុចកណ្តាលរបស់វា ដូច `isCut` និង pipeline. */
function inRange(range: Cut | null, item: EditorItem): boolean {
  const mid = (item.start + item.end) / 2
  return range !== null && mid >= range[0] && mid <= range[1]
}

/** ប្រយោគពីពាក្យ: បញ្ចប់ក្រោយពាក្យ .?! ឬនៅ pause ≥ 1 s, ឬនៅ pause ណាមួយពេលប្រយោគវែងជាង 20 s
 *  (Whisper ខ្លះគ្មានវណ្ណយុត្តិ — Rhino). `from` / `to` = index ក្នុង items (pause នៅខាងក្នុងក៏បាន). */
type Sentence = { from: number; to: number; start: number; end: number }
function sentencesOf(items: EditorItem[]): Sentence[] {
  const out: Sentence[] = []
  let from = -1
  let last = -1 // ពាក្យចុងក្រោយនៃប្រយោគបច្ចុប្បន្ន
  const close = () => {
    if (from >= 0 && last >= from) out.push({ from, to: last, start: items[from].start, end: items[last].end })
    from = -1
    last = -1
  }
  items.forEach((item, index) => {
    if ('pause' in item) {
      const long = from >= 0 && item.start - items[from].start > 20
      if (item.pause >= 1 || long) close()
      return
    }
    if (from < 0) from = index
    last = index
    if (/[.?!]["')\]]*$/.test(item.word)) close()
  })
  close()
  return out
}

/** 1.5 -> "0:00:01" (ដូចរូប). */
function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** 1.826 -> "0:01.826". */
function clockMs(seconds: number): string {
  const whole = Math.max(0, seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole - minutes * 60
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`
}
