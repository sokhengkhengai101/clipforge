import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, clipFileUrl, type Clip, type PreviewCues } from '../api'
import type { CaptionStyle } from '../captionStyle'
import { parseVtt, type Cue } from '../vtt'
import { Button } from '../kit/controls'
import { ChevronIcon, PauseMark, PlayMark, SubtitleIcon, type SubtitleIconName } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { TopBar } from '../kit/TopBar'
import { AccountButton } from './AccountButton'
import { CaptionOverlay } from './CaptionOverlay'
import { CaptionPanel } from './CaptionPanel'
import { clock, clockTenths, khmerNumber } from './khmer'

/** តំបន់ដែល UI របស់ platform បាំង — config.CAPTION_SAFE_TOP / CAPTION_SAFE_BOTTOM,
 *  លេខដដែលដែល check_cues() ប្រើពិនិត្យ caption ពិត (design គូរ 11% / 22%). */
const SAFE_TOP = 0.08
const SAFE_BOTTOM = 0.18

/** Screen "កែ Subtitles" (design/screens/Subtitles.html) សម្រាប់ clip មួយ.
 *
 *  ពិត: បន្ទាត់ subtitle ពី `.vtt` របស់ clip (ពេល, អត្ថបទ, បន្ទាត់ដែលកំពុងចាក់, ចុចដើម្បីលោត),
 *  timeline, safe zone, និង style ដែលជា flag ពិត (`captionStyle.ts`) — "រក្សាទុក" render
 *  clips ទាំងអស់ម្តងទៀតជាមួយ style នោះ.
 *  មិនទាន់មាន (បង្ហាញ ប៉ុន្តែចុចមិនបាន): កែអត្ថបទ (cue សង់ឡើងវិញពី transcript រាល់ render),
 *  "AI មិនប្រាកដពាក្យ", font ផ្សេង, ស្រមោល, animation ផ្សេងពី Pop, Box/Neon, ការបំបែក
 *  បន្ទាត់ខ្មែរ (Phase 2), និងឧបករណ៍ AI enhance / library / brand / B-roll / Motion.
 *  Preview ផ្ទាល់: ពេល clip មាន `clip_XX_clean.mp4` (គ្មាន caption) preview ចាក់វា ហើយ
 *  `CaptionOverlay` គូរ caption ជាមួយ style បច្ចុប្បន្ន — ប្តូរភ្លាមៗ គ្មាន render. បើគ្មាន វាចាក់
 *  clip ដែល render រួច ហើយបង្កើត preview ដោយខ្លួនឯង (`--clean-only`, ម្តងក្នុងមួយ project).
 *  ប៊ូតុង Captions ក្នុង Editor tools បិទ/បើកផ្ទាំង Presets/Font/Effects. */
export function SubtitlesScreen({
  project,
  clip,
  clipCount,
  style,
  onStyle,
  busy,
  preview,
  previewVersion,
  onMakePreview,
  onSave,
  onBack,
  onHome,
}: {
  project: string
  clip: Clip
  clipCount: number
  style: CaptionStyle
  onStyle: (style: CaptionStyle) => void
  busy: boolean
  // ស្ថានភាព job --clean-only: 'none' = គ្មាន path វីដេអូដើម (project ពី CLI) ដូច្នេះបង្កើតមិនបាន
  preview: 'ready' | 'idle' | 'running' | 'failed' | 'none'
  previewVersion: string // ប្តូរពេល job --clean-only ចប់ -> ទាញ video និង cue ឡើងវិញ
  onMakePreview: () => void
  onSave: () => void
  onBack: () => void
  onHome: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [missing, setMissing] = useState(false)
  const [time, setTime] = useState(0)
  const [length, setLength] = useState(clip.duration)
  const [playing, setPlaying] = useState(false)
  const [safeZone, setSafeZone] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true) // ប៊ូតុង Captions ខាងស្តាំ បិទ/បើក
  const live = Boolean(clip.files.clean)

  // បង្កើត preview ដោយខ្លួនឯង ពេលបើក clip ដែលមិនទាន់មាន copy គ្មាន caption (អ្នកអភិវឌ្ឍចង់
  // មើល style ភ្លាមៗលើ video ណាក៏បាន ដោយមិនបាច់ចុចប៊ូតុង)។ ម្តងក្នុងមួយការបើក screen
  // (`asked`): បើ job បរាជ័យ វាមិនសាកឡើងវិញជារង្វង់ទេ — ប៊ូតុង "សាកម្តងទៀត" នៅតែមាន។
  // បើ job ផ្សេងកំពុងរត់ (`busy`) វារង់ចាំ ព្រោះ sidecar ទទួល job តែមួយម្តង (409)។
  const asked = useRef(false)
  useEffect(() => {
    if (preview !== 'idle' || busy || asked.current) return
    asked.current = true
    onMakePreview()
  }, [preview, busy, onMakePreview])

  // cue ពិតពី captions.py សម្រាប់ preview ផ្ទាល់ — ទាញឡើងវិញតែពេលអ្វីដែលប្តូរការបំបែក/ទីតាំងប្តូរ
  // (ពណ៌ គ្រោង អក្សរធំ គូរនៅ browser ដូច្នេះមិនចាំបាច់សួរ sidecar)
  const [previewCues, setPreviewCues] = useState<PreviewCues | null>(null)
  const { words, size, position, lines } = style
  useEffect(() => {
    if (!live) return
    let stale = false
    api
      .cues(project, clip.index, { words, size, position, lines })
      .then((answer) => !stale && setPreviewCues(answer))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [live, project, clip.index, words, size, position, lines, previewVersion])

  // កម្ពស់ preview ពិត (ប្តូរតាម window) — caption បង្រួមតាមវា
  const stage = useRef<HTMLDivElement>(null)
  const [stageHeight, setStageHeight] = useState(0)
  useEffect(() => {
    const element = stage.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setStageHeight(entry.contentRect.height))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // App ផ្តល់ `key` = clip ដូច្នេះ state ចាប់ផ្តើមទទេ; effect គ្រាន់តែទាញ .vtt
  useEffect(() => {
    let stale = false
    fetch(clipFileUrl(project, clip.index, 'vtt'))
      .then((answer) => (answer.ok ? answer.text() : Promise.reject(new Error('no vtt'))))
      .then((text) => !stale && setCues(parseVtt(text)))
      .catch(() => !stale && setMissing(true))
    return () => {
      stale = true
    }
  }, [project, clip.index])

  const active = cues.findIndex((cue) => time >= cue.start && time < cue.end)

  // បន្ទាត់ដែលកំពុងចាក់ត្រូវនៅក្នុងទិដ្ឋភាព ពេល video ដើរ
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (active < 0 || !playing) return
    list.current?.querySelector(`[data-cue="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, playing])

  const seek = (at: number) => {
    if (video.current) video.current.currentTime = at
    setTime(at)
  }
  const toggle = () => {
    const element = video.current
    if (!element) return
    if (element.paused) void element.play()
    else element.pause()
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      <TopBar
        onHome={onHome}
        crumb={
          <span className="flex min-w-0 items-center gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className={`cursor-pointer truncate rounded-chip border-0 bg-transparent p-0 type-body text-text-3 hover:text-text ${focusRing}`}
            >
              {project}
            </button>
            <span className="text-text-5">/</span>
            <span className="truncate">{clip.title}</span>
          </span>
        }
      >
        <AccountButton />
      </TopBar>

      <div className="flex min-h-0 flex-1">
        {/* ---- បន្ទាត់ Subtitles ---- */}
        <section
          aria-labelledby="lines-title"
          className="flex w-[340px] shrink-0 flex-col gap-2.5 border-r border-line bg-sidebar px-4 py-4.5"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="lines-title" className="text-[15px] font-bold">
              Subtitles · {khmerNumber(cues.length)} បន្ទាត់
            </h2>
            <Button size="sm" variant="ghost" disabled title="កែអត្ថបទមិនទាន់បាន">
              ស្វែងរក និងជំនួស
            </Button>
          </div>
          <div ref={list} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
            {missing && (
              <p className="type-hint text-text-4">គ្មាន .vtt ក្បែរ clip នេះ — render ម្តងទៀតដើម្បីសរសេរវា។</p>
            )}
            {cues.map((cue, index) => {
              const now = index === active
              return (
                <button
                  key={index}
                  type="button"
                  data-cue={index}
                  onClick={() => seek(cue.start + 0.01)}
                  className={`flex cursor-pointer flex-col gap-1 rounded-chip border-0 px-2.5 py-2 text-left ${
                    now ? 'bg-field' : 'bg-transparent hover:bg-card'
                  } ${focusRing}`}
                >
                  <span className={`text-[12px] tabular-nums ${now ? 'text-gold' : 'text-text-4'}`}>
                    {clockTenths(cue.start)} – {clockTenths(cue.end)}
                    {now && ' · កំពុងចាក់'}
                  </span>
                  <span className="text-[16px] leading-normal text-text">{cue.text}</span>
                </button>
              )
            })}
          </div>
          <p className="type-hint text-text-3">
            Subtitles សង់ពីពាក្យរបស់ Whisper រាល់ពេល render ដូច្នេះការកែអត្ថបទមិនទាន់បានទេ។ ចុចលើបន្ទាត់ ដើម្បីលោតទៅពេលនោះ។
          </p>
        </section>

        {/* ---- Preview ---- */}
        <section aria-label="Preview" className="flex min-w-0 flex-1 flex-col bg-chrome">
          <div role="toolbar" aria-label="Video" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-2.5">
            <ToolbarButton icon="phone" disabled title="សមាមាត្ររបស់ clip ដែល render រួច">
              9:16
            </ToolbarButton>
            <ToolbarButton icon="layout" disabled title="Reframe — ជំហាន ៧">
              Layout: Auto
            </ToolbarButton>
            <ToolbarButton icon="background" disabled title="មិនទាន់មាន">
              Background
            </ToolbarButton>
            <ToolbarButton icon="tracker" disabled title="Reframe — ជំហាន ៧">
              Tracker
            </ToolbarButton>
            <ToolbarButton icon="shield" pressed={safeZone} onClick={() => setSafeZone(!safeZone)}>
              Safe zone: {safeZone ? 'ON' : 'OFF'}
            </ToolbarButton>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5 px-5 pt-2 pb-5">
            <div
              ref={stage}
              className="relative aspect-[9/16] h-[clamp(380px,calc(100vh-300px),700px)] overflow-hidden bg-raised outline outline-line"
            >
              <video
                ref={video}
                // `v=`: preview ដែលបង្កើតឡើងវិញមាន URL ដដែល — browser នឹងចាក់ file ចាស់ពី cache
                src={`${clipFileUrl(project, clip.index, live ? 'clean' : 'mp4')}${live ? `&v=${previewVersion}` : ''}`}
                onClick={toggle}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
                className="size-full cursor-pointer bg-black object-contain"
              />
              {live && previewCues && stageHeight > 0 && (
                <CaptionOverlay cues={previewCues} style={style} time={time} height={stageHeight} playing={playing} />
              )}
              {safeZone && (
                <>
                  <div aria-hidden="true" className="safe-band pointer-events-none absolute inset-x-0 top-0" style={{ height: `${SAFE_TOP * 100}%` }} />
                  <div
                    aria-hidden="true"
                    className="safe-band pointer-events-none absolute inset-x-0 bottom-0 flex items-end p-1.5"
                    style={{ height: `${SAFE_BOTTOM * 100}%` }}
                  >
                    <span className="rounded-[4px] bg-black/60 px-1.5 text-[10.5px] font-semibold text-white">ប៊ូតុង TikTok / Reels</span>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={toggle}
                className={`inline-flex size-11 cursor-pointer items-center justify-center rounded-full border-0 bg-gold text-on-gold ${focusRing}`}
              >
                {playing ? <PauseMark size={15} /> : <PlayMark size={15} />}
              </button>
              <span className="type-label text-text-3 tabular-nums">
                {clock(time)} / {clock(length)}
              </span>
            </div>
            <PreviewNote preview={preview} layoutKnown={previewCues?.layout_known ?? true} onMakePreview={onMakePreview} />
          </div>
        </section>

        {/* ---- Caption style ---- */}
        {panelOpen && (
        <aside id="caption-style" aria-label="Caption style" className="flex w-[360px] shrink-0 flex-col border-l border-line bg-sidebar">
          <CaptionPanel
            style={style}
            onStyle={onStyle}
            footer={
              <label className="flex shrink-0 items-start gap-2.5 border-t border-line px-5 py-3.5">
                <input type="checkbox" checked disabled className="mt-0.5 size-[18px] shrink-0 accent-gold" />
                <span className="flex flex-col">
                  <span className="type-label text-text-2">ប្រើ style នេះលើ clips ទាំង {khmerNumber(clipCount)}</span>
                  <span className="type-hint text-text-4">pipeline render clips ទាំងអស់ជាមួយ style តែមួយ</span>
                </span>
              </label>
            }
          />
        </aside>
        )}

        {/* ---- Editor tools ---- */}
        <nav aria-label="Editor tools" className="flex w-[92px] shrink-0 flex-col gap-1 border-l border-line bg-sidebar px-1.5 py-3">
          {(
            [
              ['enhance', 'AI enhance'],
              ['captions', 'Captions'],
              ['library', 'My library'],
              ['brand', 'Brand template'],
              ['broll', 'B-roll'],
              ['motion', 'Motion'],
            ] as [SubtitleIconName, string][]
          ).map(([icon, label]) => {
            const here = icon === 'captions'
            const on = here && panelOpen
            return (
              <button
                key={icon}
                type="button"
                aria-pressed={on}
                aria-controls={here ? 'caption-style' : undefined}
                disabled={!here}
                // Captions = បិទ/បើកផ្ទាំង Presets/Font/Effects; ឯទៀតមិនទាន់មាន
                onClick={here ? () => setPanelOpen(!panelOpen) : undefined}
                title={here ? (panelOpen ? 'បិទផ្ទាំង Captions' : 'បើកផ្ទាំង Captions') : 'មិនទាន់មាន'}
                className={`flex min-h-18 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-button border-0 px-1 py-2 text-[12px] disabled:cursor-default disabled:opacity-40 ${
                  on ? 'bg-field text-white' : 'bg-transparent text-text-3 hover:bg-card'
                } ${focusRing}`}
              >
                <SubtitleIcon name={icon} size={22} />
                {label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* ---- Footer: ត្រឡប់, timeline, រក្សាទុក ---- */}
      <footer className="flex shrink-0 flex-wrap items-center gap-4 border-t border-line bg-chrome px-5 py-3">
        <Button onClick={onBack}>
          <ChevronIcon direction="left" size={14} />
          ត្រឡប់ទៅ Clips
        </Button>
        <Timeline cues={cues} length={length} time={time} active={active} onSeek={seek} />
        <Button variant="primary" disabled={busy} onClick={onSave}>
          {busy ? 'មាន job កំពុងរត់...' : 'រក្សាទុក · Render ម្តងទៀត'}
        </Button>
      </footer>
    </div>
  )
}

/** ក្រោម preview: ប្រាប់ថា preview ផ្ទាល់ឬអត់ ហើយអនុញ្ញាតឲ្យបង្កើតវា. */
function PreviewNote({
  preview,
  layoutKnown,
  onMakePreview,
}: {
  preview: 'ready' | 'idle' | 'running' | 'failed' | 'none'
  layoutKnown: boolean // preview ចាស់ មុនពេល render សរសេរ clip_XX_layout.json
  onMakePreview: () => void
}) {
  if (preview === 'ready' && !layoutKnown)
    return (
      <div className="flex max-w-[460px] flex-col items-center gap-2 text-center">
        <p className="type-hint text-warn-text">
          Preview នេះមិនដឹងថា shot ណាជា split ទេ — caption លើ split អាចនៅខុសកន្លែង (render ពិតដាក់វាលើស្នាម)
        </p>
        <Button size="sm" onClick={onMakePreview}>
          បង្កើត preview ឡើងវិញ
        </Button>
      </div>
    )
  if (preview === 'ready')
    return (
      <p className="type-hint text-text-4">
        Preview ផ្ទាល់ · ប្តូរ style ឃើញភ្លាមៗ (ជិតដូច render) · ចុច រក្សាទុក ដើម្បី render ពិត
      </p>
    )
  if (preview === 'none')
    return (
      <p className="max-w-[420px] text-center type-hint text-text-4">
        Preview ចាក់ clip ដែល render រួច · project នេះមិនដឹង path វីដេអូដើម ដូច្នេះបង្កើត preview ផ្ទាល់មិនបាន
      </p>
    )
  return (
    <div className="flex max-w-[460px] flex-col items-center gap-2 text-center">
      <p className="type-hint text-text-4">
        {preview === 'running'
          ? 'កំពុងបង្កើត preview គ្មាន caption... (~១០ វិនាទីក្នុងមួយ clip)'
          : preview === 'failed'
            ? 'បង្កើត preview មិនបាន — សាកម្តងទៀត'
            : 'Preview នេះមាន caption ដុតរួច · preview គ្មាន caption នឹងចាប់ផ្តើមបង្កើតពេល job ផ្សេងចប់'}
      </p>
      <Button size="sm" disabled={preview === 'running'} onClick={onMakePreview}>
        {preview === 'running' ? 'កំពុងបង្កើត...' : 'បង្កើត preview ភ្លាមៗ'}
      </Button>
    </div>
  )
}

function ToolbarButton({
  icon,
  pressed,
  disabled,
  title,
  onClick,
  children,
}: {
  icon: SubtitleIconName
  pressed?: boolean
  disabled?: boolean
  title?: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      // Safe zone ពេលបើក: ផ្ទៃក្រហមស្រាល ដូច design (#2A1A1A / #FCA5A5)
      className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-field border-0 px-3 type-body font-semibold disabled:cursor-default disabled:opacity-40 ${
        pressed ? 'bg-[#2a1a1a] text-[#fca5a5]' : 'bg-transparent text-[#e5e7eb] hover:bg-field'
      } ${focusRing}`}
    >
      <SubtitleIcon name={icon} />
      {children}
    </button>
  )
}

/** cue នីមួយៗជាប្លុកលើរបារ (Subtitles.html footer); ប្លុកដែលកំពុងចាក់ពណ៌ gold, បន្ទាត់ស = ពេលឥឡូវ. */
function Timeline({
  cues,
  length,
  time,
  active,
  onSeek,
}: {
  cues: Cue[]
  length: number
  time: number
  active: number
  onSeek: (at: number) => void
}) {
  const span = Math.max(length, 0.1)
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`Timeline: subtitle ${cues.length} ប្លុកក្នុង clip ${Math.round(span)} វិនាទី`}
      aria-valuemin={0}
      aria-valuemax={Math.round(span)}
      aria-valuenow={Math.round(time)}
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect()
        onSeek(((event.clientX - box.left) / box.width) * span)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') onSeek(Math.min(span, time + 1))
        if (event.key === 'ArrowLeft') onSeek(Math.max(0, time - 1))
      }}
      className={`relative h-10 min-w-0 flex-1 basis-[300px] cursor-pointer overflow-hidden rounded-field bg-field ${focusRing}`}
    >
      {cues.map((cue, index) => (
        <div
          key={index}
          className={`absolute inset-y-2 rounded-[4px] ${index === active ? 'bg-gold' : 'bg-raised-3'}`}
          style={{ left: `${(cue.start / span) * 100}%`, width: `max(2px, ${((cue.end - cue.start) / span) * 100}% - 1px)` }}
        />
      ))}
      <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(time / span) * 100}%` }} />
    </div>
  )
}

