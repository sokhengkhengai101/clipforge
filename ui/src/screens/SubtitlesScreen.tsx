import { useEffect, useRef, useState, type ReactNode } from 'react'
import { clipFileUrl, type Clip } from '../api'
import {
  CAPTION_COLORS,
  presetOf,
  STYLE_PRESETS,
  type CaptionStyle,
  type StylePreset,
} from '../captionStyle'
import { parseVtt, type Cue } from '../vtt'
import { Button, Chip, Segmented, Select, Switch } from '../kit/controls'
import { ChevronIcon, PauseMark, PlayMark, SubtitleIcon, type SubtitleIconName } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { TopBar } from '../kit/TopBar'
import { AccountButton } from './AccountButton'
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
 *  Preview ចាក់ clip **ដែល render រួច** — style ថ្មីលេចឡើងក្រោយ render. */
export function SubtitlesScreen({
  project,
  clip,
  clipCount,
  style,
  onStyle,
  busy,
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
  const [tab, setTab] = useState<'presets' | 'font' | 'effects'>('presets')

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
  const change = (part: Partial<CaptionStyle>) => onStyle({ ...style, ...part })

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
            <div className="relative aspect-[9/16] h-[clamp(380px,calc(100vh-300px),700px)] overflow-hidden bg-raised outline outline-line">
              <video
                ref={video}
                src={clipFileUrl(project, clip.index, 'mp4')}
                onClick={toggle}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
                className="size-full cursor-pointer bg-black object-contain"
              />
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
            <p className="type-hint text-text-4">Preview ចាក់ clip ដែល render រួច · style ថ្មីលេចឡើងក្រោយចុច រក្សាទុក</p>
          </div>
        </section>

        {/* ---- Caption style ---- */}
        <aside aria-label="Caption style" className="flex w-[360px] shrink-0 flex-col border-l border-line bg-sidebar">
          <div role="tablist" aria-label="Caption style" className="grid grid-cols-3 border-b border-raised px-3 pt-1.5">
            {(
              [
                ['presets', 'Presets'],
                ['font', 'Font'],
                ['effects', 'Effects'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`min-h-11.5 cursor-pointer border-0 border-b-2 bg-transparent text-[15px] ${
                  tab === id ? 'border-gold font-bold text-text' : 'border-transparent font-medium text-text-4'
                } ${focusRing}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4.5">
            {tab === 'presets' && <Presets style={style} onStyle={onStyle} />}
            {tab === 'font' && <FontTab style={style} change={change} />}
            {tab === 'effects' && <EffectsTab style={style} change={change} />}
          </div>

          <label className="flex items-start gap-2.5 border-t border-line px-5 py-3.5">
            <input type="checkbox" checked disabled className="mt-0.5 size-[18px] shrink-0 accent-gold" />
            <span className="flex flex-col">
              <span className="type-label text-text-2">ប្រើ style នេះលើ clips ទាំង {khmerNumber(clipCount)}</span>
              <span className="type-hint text-text-4">pipeline render clips ទាំងអស់ជាមួយ style តែមួយ</span>
            </span>
          </label>
        </aside>

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
            return (
              <button
                key={icon}
                type="button"
                aria-pressed={here}
                disabled={!here}
                title={here ? undefined : 'មិនទាន់មាន'}
                className={`flex min-h-18 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-button border-0 px-1 py-2 text-[12px] disabled:cursor-default disabled:opacity-40 ${
                  here ? 'bg-field text-white' : 'bg-transparent text-text-3'
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

function Presets({ style, onStyle }: { style: CaptionStyle; onStyle: (style: CaptionStyle) => void }) {
  const current = presetOf(style)
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {STYLE_PRESETS.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            on={preset.id === current}
            onPick={() => preset.style && onStyle({ ...style, ...preset.style })}
          />
        ))}
      </div>
      <p className="type-hint text-text-4">
        Preset នីមួយៗជាបណ្តុំការកំណត់ពិត ហើយអាចកែបន្តនៅ Font និង Effects។ Box ខ្មៅ និង Neon មិនទាន់មានក្នុង renderer ទេ។
        {current === null && ' · style ផ្ទាល់ខ្លួន'}
      </p>
    </>
  )
}

/** គំរូតូចនៃ preset នីមួយៗ — CSS គូរ "ចាប់ផ្ដើម អាជីវកម្ម" ដូច design (font UI, មិនមែន font render). */
function PresetCard({ preset, on, onPick }: { preset: StylePreset; on: boolean; onPick: () => void }) {
  const sample: Record<string, ReactNode> = {
    off: <SubtitleIcon name="none" size={32} />,
    bold: (
      <span className="text-[17px] leading-snug font-bold text-white [text-shadow:0_2px_3px_#000]">
        ចាប់ផ្ដើម<span className="text-gold">អាជីវកម្ម</span>
      </span>
    ),
    karaoke: (
      <span className="text-[17px] font-bold text-white [-webkit-text-stroke:1px_#000]">
        ចាប់ផ្ដើម <span className="text-[#00e054]">អាជីវកម្ម</span>
      </span>
    ),
    box: <span className="rounded-[4px] bg-black px-2 py-0.5 text-[15px] font-bold text-white">ចាប់ផ្ដើម</span>,
    clean: <span className="text-[16px] font-medium text-white">ចាប់ផ្ដើម</span>,
    neon: <span className="text-[17px] font-bold text-gold [text-shadow:0_0_6px_#ff8a3d]">ចាប់ផ្ដើម</span>,
  }
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={!preset.style}
      onClick={onPick}
      title={preset.style ? undefined : 'renderer មិនទាន់គូរ style នេះបាន'}
      className={`flex cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-0 text-left disabled:cursor-default disabled:opacity-40 ${
        on ? 'text-text' : 'text-text-3'
      } ${focusRing}`}
    >
      <span
        className={`flex h-21 items-center justify-center rounded-button border-2 bg-raised text-text-4 ${
          on ? 'border-white' : 'border-transparent'
        }`}
      >
        {sample[preset.id]}
      </span>
      <span className={`text-[13px] ${on ? 'font-semibold' : ''}`}>{preset.name}</span>
    </button>
  )
}

function Row({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="type-label text-text-2">{label}</span>
        {children}
      </div>
      {hint && <p className="type-hint text-text-4">{hint}</p>}
    </div>
  )
}

function FontTab({ style, change }: { style: CaptionStyle; change: (part: Partial<CaptionStyle>) => void }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor="f-family" className="type-label text-text-2">
          Font settings
        </label>
        {/* config.CAPTION_FONT — font ខ្មែរ (Battambang) មកជាមួយ subtitles ខ្មែរ Phase 2 */}
        <Select id="f-family" disabled value="Montserrat ExtraBold">
          <option>Montserrat ExtraBold</option>
        </Select>
        <p className="type-hint text-text-4">Font ប្តូរមិនទាន់បាន · subtitles ខ្មែរ (Battambang) = Phase 2</p>
      </div>
      <Row label="ទំហំអក្សរ">
        <Segmented
          label="ទំហំអក្សរ"
          size="sm"
          tone="gold"
          value={String(style.size)}
          options={[
            { value: '85', label: 'តូច' },
            { value: '100', label: 'មធ្យម' },
            { value: '115', label: 'ធំ' },
          ]}
          onChange={(value) => change({ size: Number(value) })}
        />
      </Row>
      <Row label="អក្សរធំទាំងអស់ (ABC)" hint="បិទ = សរសេរដូចដែល Whisper ឮ (Abc)">
        <Switch label="អក្សរធំទាំងអស់" checked={style.uppercase} onChange={(on) => change({ uppercase: on })} />
      </Row>
      <Row label="Font stroke (គ្រោងខ្មៅ)">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-6 rounded-full border-2 border-raised-3 bg-black" />
          <Select
            size="sm"
            aria-label="កម្រាស់ stroke"
            value={style.outline}
            onChange={(event) => change({ outline: Number(event.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((px) => (
              <option key={px} value={px}>
                {px} px
              </option>
            ))}
          </Select>
        </span>
      </Row>
      <Row label="Font shadows" hint="ស្រមោល 1px ថេរ (config.CAPTION_SHADOW) · ប្តូរមិនទាន់បាន">
        <Switch label="Font shadows" checked disabled onChange={() => {}} />
      </Row>
    </>
  )
}

function EffectsTab({ style, change }: { style: CaptionStyle; change: (part: Partial<CaptionStyle>) => void }) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="type-label text-text-2">ទីតាំង</span>
        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              ['auto', 'Auto'],
              ['top', 'លើ'],
              ['middle', 'កណ្ដាល'],
              ['bottom', 'ក្រោម'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={style.position === value}
              onClick={() => change({ position: value })}
              className={`min-h-10 cursor-pointer rounded-button border-0 text-[13px] font-bold ${
                style.position === value ? 'bg-segment text-bg' : 'bg-raised text-text-2'
              } ${focusRing}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="type-hint text-text-4">Auto: មួយភាគបីខាងក្រោម ហើយលើស្នាមកណ្ដាល ពេលអេក្រង់ចែកជាផ្ទាំង</p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="anim" className="type-label text-text-2">
          Animation
        </label>
        <Select id="anim" disabled value="pop">
          <option value="pop">Pop — ពាក្យដែលកំពុងនិយាយធំ 110%</option>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <span className="type-label text-text-2">ពាក្យក្នុងមួយ cue</span>
        <Segmented
          label="ពាក្យក្នុងមួយ cue"
          size="sm"
          tone="gold"
          value={String(style.words)}
          options={['2', '3', '4', '5', '6', '7', '8'].map((count) => ({ value: count, label: khmerNumber(count) }))}
          onChange={(value) => change({ words: Number(value) })}
        />
        <p className="type-hint text-text-4">ចំនួនពាក្យអតិបរមាដែលបង្ហាញម្តង (≤ ៣ បន្ទាត់ · ១៦ តួក្នុងមួយបន្ទាត់)</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="type-label text-text-2">ពណ៌ពាក្យដែលកំពុងនិយាយ</span>
        <div role="group" aria-label="ពណ៌ពាក្យដែលកំពុងនិយាយ" className="flex flex-wrap gap-2.5">
          {CAPTION_COLORS.map((option) => {
            const on = option.hex.toLowerCase() === style.color.toLowerCase()
            return (
              <button
                key={option.hex}
                type="button"
                aria-pressed={on}
                aria-label={option.name}
                title={option.name}
                onClick={() => change({ color: option.hex })}
                className={`size-10 cursor-pointer rounded-full border-2 ${on ? 'border-text' : 'border-raised-3'} ${focusRing}`}
                style={{ background: option.hex }}
              />
            )
          })}
        </div>
      </div>
      <Row
        label={
          <span className="flex flex-col">
            បំបែកបន្ទាត់តាមពាក្យខ្មែរ
            <Chip>PHASE 2</Chip>
          </span>
        }
      >
        <Switch label="បំបែកបន្ទាត់តាមពាក្យខ្មែរ" checked={false} disabled onChange={() => {}} />
      </Row>
    </>
  )
}
