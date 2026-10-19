import { useEffect, useMemo, useRef, useState } from 'react'
import { api, clipFileUrl, clipThumbUrl, type Clip, type ExportResult, type Grades } from '../api'
import { Button, Select, TextField } from '../kit/controls'
import { ChevronIcon, PauseMark, PlayMark, PlusIcon, SubtitlesIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { TopBar } from '../kit/TopBar'
import { AccountButton } from './AccountButton'
import { clock, clockTenths, khmerNumber } from './khmer'
import type { Order, ReviewChoices } from './reviewChoices'

/** Screen "ពិនិត្យ Clips" (design/screens/Review.html), ភ្ជាប់ទៅ clip ពិតរបស់ project.
 *
 *  អ្វីដែល design គូរ ហើយ pipeline មិនទាន់មាន — screen ប្រាប់ត្រង់ៗ ជាជាងធ្វើពុត:
 *  - កាត់ចាប់ផ្តើម/បញ្ចប់ដោយដៃ: គ្មាន flag សម្រាប់វា ដូច្នេះចំណុចកាត់ពិតបង្ហាញជាអាន-តែប៉ុណ្ណោះ.
 *  - កែចំណងជើង: ចំណងជើងមកពី clips.json ហើយ export ប្រើវាជាឈ្មោះ file — អាន-តែប៉ុណ្ណោះ.
 *  - "ពិន្ទុជាលេខគំរូ": ពិន្ទុនៅទីនេះពិត (rubric Hook/Flow/Value ពី LLM).
 *  "កែ Subtitles" បើក screen Subtitles របស់ clip នេះ; Export សរសេរ file ពិត រួចបើក
 *  screen Export រួចរាល់ (ExportDone.html). */
export function ReviewScreen({
  project,
  clips,
  busy,
  choices,
  onChoices,
  onSubtitles,
  onExported,
  onMore,
  onHome,
}: {
  project: string
  choices: ReviewChoices // រស់នៅក្នុង App: ការចេញទៅ Subtitles ឬ Export រួចរាល់ មិនបាត់វាទេ
  onChoices: (change: Partial<ReviewChoices>) => void
  clips: Clip[] // បញ្ជីតាមលំដាប់ពិន្ទុទាំងមូលពី clips.json — រួមទាំង clip ដែលមិនទាន់ render
  busy: boolean
  onSubtitles: (index: number) => void
  onExported: (result: ExportResult) => void
  onMore: (maxClips: number) => void
  onHome: () => void
}) {
  // បង្ហាញតែ clip ដែលមាន .mp4 — clip ក្រោយ --max-clips មិនទាន់ render ទេ
  const rendered = useMemo(() => clips.filter((clip) => clip.files.mp4), [clips])
  // "លំដាប់ AI" = clips.json (rank_clips) ដែលមិនដូចពិន្ទុទេ: rubric ផ្តល់ពិន្ទុជិតៗគ្នា
  // ហើយ AI ប្រៀបធៀប clip ម្តងទៀតដើម្បីតម្រៀប (CLAUDE.md) — ឧ. #3 មាន 90 នៅក្រោម #1 ដែលមាន 80
  const { order, destination } = choices
  const shown = useMemo(() => sortClips(rendered, order), [rendered, order])
  const clip = rendered.find((item) => item.index === choices.selected) ?? rendered[0]
  // ជ្រើសសម្រាប់ export: clip ទាំងអស់ជាលំនាំដើម (design ធីក ៣ ក្នុង ៥ ជាឧទាហរណ៍) — App ទុកតែ
  // clip ដែលអ្នក**ដក** ដូច្នេះ clip ថ្មីពី "រក clips បន្ថែម" ចាប់ផ្តើមជាជ្រើស
  const picked = new Set(rendered.map((item) => item.index).filter((index) => !choices.unpicked.includes(index)))

  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  // កន្លែង export លំនាំដើម គណនាក្នុង Python (~/Videos/ClipForge/<project>)
  // (តែពេលអ្នកមិនទាន់វាយ folder ផ្ទាល់ខ្លួន)
  const needsDestination = destination === ''
  useEffect(() => {
    if (!needsDestination) return
    let stale = false
    api
      .exportPreview(project, ['mp4'])
      .then((answer) => !stale && onChoices({ destination: answer.destination }))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [project, needsDestination, onChoices])

  // រយៈពេលវីដេអូដើម — សម្រាប់គូររបារកាត់ (clip នៅត្រង់ណាក្នុងវីដេអូ)
  const [sourceSeconds, setSourceSeconds] = useState<number | null>(null)
  useEffect(() => {
    let stale = false
    api
      .transcript(project)
      .then((answer) => !stale && setSourceSeconds(answer.duration))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [project])

  if (!clip) return null

  const position = shown.findIndex((item) => item.index === clip.index)
  const step = (by: number) => {
    const next = shown[position + by]
    if (next) onChoices({ selected: next.index })
  }
  const toggle = (index: number) =>
    onChoices({
      unpicked: choices.unpicked.includes(index)
        ? choices.unpicked.filter((item) => item !== index)
        : [...choices.unpicked, index],
    })

  const chosen = rendered.filter((item) => picked.has(item.index)).map((item) => item.index)
  const runExport = async () => {
    setExporting(true)
    setExportError('')
    try {
      // MP4 + SRT ដូច ExportDone.html ("MP4 9:16 1080p + SRT")
      const result = await api.exportClips(project, {
        destination: destination.trim() || undefined,
        clips: chosen,
        kinds: ['mp4', 'srt'],
      })
      onExported(result)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  // clip ក្នុង clips.json ច្រើនជាងដែល render = "រក clips បន្ថែម" គ្រាន់តែ render បន្ថែម (គ្មាន LLM)
  const more = Math.min(clips.length, rendered.length + 5)

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      <TopBar crumb={project} onHome={onHome}>
        <AccountButton />
      </TopBar>

      <div className="flex min-h-0 flex-1">
        {/* ---- Clips ដែល AI ជ្រើស ---- */}
        <section
          aria-labelledby="clips-title"
          className="flex w-[330px] shrink-0 flex-col gap-2 overflow-y-auto border-r border-line bg-sidebar px-3.5 py-4.5"
        >
          <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
            <h2 id="clips-title" className="text-[15px] font-bold">
              Clips {khmerNumber(rendered.length)} ដែល AI ជ្រើស
            </h2>
            <label className="flex items-center gap-1.5 text-[12px] text-text-3">
              តម្រៀប
              <Select size="sm" value={order} onChange={(event) => onChoices({ order: event.target.value as Order })}>
                <option value="rank">លំដាប់ AI</option>
                <option value="score">ពិន្ទុ</option>
                <option value="time">ពេលវេលា</option>
              </Select>
            </label>
          </div>

          {shown.map((item) => (
            <ClipRow
              key={item.index}
              project={project}
              clip={item}
              active={item.index === clip.index}
              checked={picked.has(item.index)}
              onSelect={() => onChoices({ selected: item.index })}
              onToggle={() => toggle(item.index)}
            />
          ))}

          <Button
            className="mt-1"
            disabled={busy || more <= rendered.length}
            onClick={() => onMore(more)}
          >
            <PlusIcon />
            រក clips បន្ថែម
          </Button>
          <p className="mx-1 mt-0.5 type-hint text-text-4">
            {more > rendered.length
              ? `render clip ${khmerNumber(rendered.length + 1)}-${khmerNumber(more)} ពីបញ្ជី AI · មិនចាំបាច់ transcribe ម្ដងទៀត`
              : `AI រកឃើញ ${khmerNumber(clips.length)} clips ក្នុងវីដេអូនេះ — បាន render ទាំងអស់ហើយ`}
          </p>
        </section>

        {/* ---- Preview ---- */}
        <section aria-label="Preview" className="flex min-w-0 flex-1 flex-col items-center gap-4 overflow-y-auto p-6">
          <Player
            key={clip.index}
            src={clipFileUrl(project, clip.index, 'mp4')}
            canBack={position > 0}
            canForward={position < shown.length - 1}
            onStep={step}
          />
        </section>

        {/* ---- ព័ត៌មាន Clip ---- */}
        <aside
          aria-labelledby="details-title"
          className="flex w-[360px] shrink-0 flex-col gap-4.5 overflow-y-auto border-l border-line bg-sidebar p-5"
        >
          <h2 id="details-title" className="text-[15px] font-bold">
            ព័ត៌មាន Clip
          </h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="clip-title" className="type-label text-text-3">
              ចំណងជើង
            </label>
            <TextField id="clip-title" readOnly value={clip.title} className="min-h-10.5 type-body" />
            <p className="type-hint text-text-4">ប្រើជាឈ្មោះ file ពេល export · កែមិនទាន់បាន</p>
          </div>

          <WhyPicked clip={clip} />

          <TrimView clip={clip} sourceSeconds={sourceSeconds} />

          <Button className="w-full" onClick={() => onSubtitles(clip.index)}>
            <SubtitlesIcon size={16} weight={1.75} />
            កែ Subtitles របស់ clip នេះ
          </Button>
        </aside>
      </div>

      {/* ---- Export ---- */}
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-chrome px-5 py-3.5">
        <span className="type-body text-text-2">
          បានជ្រើស <strong>{khmerNumber(chosen.length)}</strong> ក្នុងចំណោម {khmerNumber(rendered.length)} clips
          {exportError && <span className="ml-3 text-danger">{exportError}</span>}
        </span>
        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="export-folder" className="type-label text-text-3">
            រក្សាទុកក្នុង
          </label>
          <TextField
            id="export-folder"
            value={destination}
            onChange={(event) => onChoices({ destination: event.target.value })}
            className="min-h-11 w-[320px] type-label text-text-2"
          />
          <Button variant="primary" disabled={chosen.length === 0 || exporting} onClick={runExport}>
            {exporting ? 'កំពុង export...' : `Export ${khmerNumber(chosen.length)} Clips`}
          </Button>
        </div>
      </footer>

    </div>
  )
}


function sortClips(clips: Clip[], order: Order): Clip[] {
  if (order === 'rank') return clips
  // sort ថេរ (stable): ពិន្ទុស្មើគ្នា = នៅតាមលំដាប់ AI
  if (order === 'score') return [...clips].sort((a, b) => b.total - a.total)
  return [...clips].sort((a, b) => a.start - b.start)
}

/** ពិន្ទុ ≥ 80 = gold, 70-79 = raised-2, ក្រោមនោះ = raised-3 (Review.html: 87/82 · 78/71 · 66). */
function scoreTone(score: number): string {
  if (score >= 80) return 'bg-gold text-on-gold'
  if (score >= 70) return 'bg-raised-2 text-text'
  return 'bg-raised-3 text-text'
}

/** "A", "A-" = gold-tint; ផ្សេងទៀត = raised (Review.html "ហេតុអ្វី AI ជ្រើស"). */
function letterTone(letter: string): string {
  return letter.startsWith('A') ? 'bg-gold-tint text-gold' : 'bg-raised text-text'
}

function gradeLine(clip: Clip): string {
  const parts = [clock(clip.duration)]
  if (clip.grades)
    parts.push(`Hook ${clip.grades.hook.letter}`, `Flow ${clip.grades.flow.letter}`, `Value ${clip.grades.value.letter}`)
  else parts.push(clip.letter)
  return parts.join(' · ')
}

function ClipRow({
  project,
  clip,
  active,
  checked,
  onSelect,
  onToggle,
}: {
  project: string
  clip: Clip
  active: boolean
  checked: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const score = Math.round(clip.total)
  const id = `clip-${clip.index}`
  return (
    <div
      className={`flex items-center gap-2.5 rounded-button border-2 p-2.5 ${
        active ? 'border-gold bg-[#1b202a]' : 'border-transparent hover:bg-card'
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`ជ្រើស clip ${clip.index} សម្រាប់ export`}
        className={`size-[18px] shrink-0 cursor-pointer accent-gold ${focusRing}`}
      />
      <button
        type="button"
        onClick={onSelect}
        aria-current={active}
        className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left text-text ${focusRing}`}
      >
        <span className="relative h-[60px] w-[34px] shrink-0 overflow-hidden rounded-[5px] bg-raised-4">
          {!thumbFailed && (
            <img
              src={clipThumbUrl(project, clip.index)}
              alt=""
              onError={() => setThumbFailed(true)}
              className="size-full object-cover"
            />
          )}
          <span className="absolute top-0.5 left-0.5 rounded-[3px] bg-black/60 px-1 text-[10.5px] font-bold text-white">
            #{clip.index}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`line-clamp-2 type-body leading-normal font-bold ${checked ? '' : 'text-text-2-dim'}`}>
            {clip.title}
          </span>
          <span className="block text-[12px] text-text-3">{gradeLine(clip)}</span>
        </span>
        <span
          aria-label={`ពិន្ទុ ${score} ក្នុង 100`}
          className={`inline-flex h-7.5 min-w-[38px] shrink-0 items-center justify-center rounded-field px-1 type-body font-bold ${scoreTone(score)}`}
        >
          {score}
        </span>
      </button>
    </div>
  )
}

/** Video ពិតជាមួយប៊ូតុងរបស់ design (មុន / Play / បន្ទាប់ + ពេល). design គ្មានរបារ seek
 *  ទេ តែការពិនិត្យ clip ត្រូវការលោតទៅកណ្តាល — ដូច្នេះមានរបារស្តើងនៅក្រោម video.
 *  `key` = clip ដូច្នេះប្តូរ clip = state ថ្មី (មិនចាក់បន្តពីពេលចាស់). */
function Player({
  src,
  canBack,
  canForward,
  onStep,
}: {
  src: string
  canBack: boolean
  canForward: boolean
  onStep: (by: number) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [length, setLength] = useState(0)

  const toggle = () => {
    const element = video.current
    if (!element) return
    if (element.paused) void element.play()
    else element.pause()
  }

  const round = `inline-flex size-11 cursor-pointer items-center justify-center rounded-full border-0 bg-raised text-text-2 disabled:cursor-default disabled:opacity-40 ${focusRing}`
  return (
    <>
      {/* 9:16, ខ្ពស់តាម window (design: 270×480 — តូចពេកលើអេក្រង់ធំ) */}
      <div className="aspect-[9/16] h-[clamp(420px,calc(100vh-290px),720px)] overflow-hidden rounded-2xl bg-raised">
        <video
          ref={video}
          src={src}
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
          className="size-full cursor-pointer bg-black object-contain"
        />
      </div>
      <input
        type="range"
        aria-label="ទីតាំងក្នុង clip"
        min={0}
        max={length || 0}
        step={0.1}
        value={time}
        onChange={(event) => {
          const at = Number(event.target.value)
          if (video.current) video.current.currentTime = at
          setTime(at)
        }}
        className={`w-[min(100%,405px)] cursor-pointer accent-gold ${focusRing}`}
      />
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Clip មុន" disabled={!canBack} onClick={() => onStep(-1)} className={round}>
          <ChevronIcon direction="left" />
        </button>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={toggle}
          className={`inline-flex size-13 cursor-pointer items-center justify-center rounded-full border-0 bg-gold text-on-gold ${focusRing}`}
        >
          {playing ? <PauseMark /> : <PlayMark size={18} />}
        </button>
        <button type="button" aria-label="Clip បន្ទាប់" disabled={!canForward} onClick={() => onStep(1)} className={round}>
          <ChevronIcon direction="right" />
        </button>
        <span className="ml-1.5 type-label text-text-3 tabular-nums">
          {clock(time)} / {clock(length)}
        </span>
      </div>
    </>
  )
}

function WhyPicked({ clip }: { clip: Clip }) {
  const parts: [keyof Grades, string][] = [
    ['hook', 'Hook'],
    ['flow', 'Flow'],
    ['value', 'Value'],
  ]
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-[#161b24] px-4 py-3.5">
      <div className="flex items-baseline justify-between">
        <p className="type-label font-semibold text-gold">ហេតុអ្វី AI ជ្រើស clip នេះ</p>
        <p>
          <span className="text-[24px] font-bold">{Math.round(clip.total)}</span>
          <span className="type-label text-text-3"> /100</span>
        </p>
      </div>
      {clip.grades ? (
        parts.map(([key, label]) => {
          const grade = clip.grades![key]
          return (
            <div key={key} className="flex gap-2.5">
              <span
                className={`inline-flex h-7 w-[34px] shrink-0 items-center justify-center rounded-[6px] type-label font-bold ${letterTone(grade.letter)}`}
              >
                {grade.letter}
              </span>
              <span className="min-w-0">
                <span className="block type-label font-semibold">{label}</span>
                <span className="block type-hint text-text-2-dim">{grade.reason}</span>
              </span>
            </div>
          )
        })
      ) : (
        // clip ដែលដាក់ពិន្ទុមុន rubric មានតែពិន្ទុសរុប និងហេតុផលមួយ
        <p className="type-hint text-text-2-dim">
          {clip.reason || clip.hook} · clip នេះដាក់ពិន្ទុមុនមាន Hook/Flow/Value — មានតែពិន្ទុសរុប។
        </p>
      )}
    </div>
  )
}

/** "កាត់ចាប់ផ្ដើម និងបញ្ចប់": ចំណុចកាត់ពិតរបស់ clip ក្នុងវីដេអូដើម. របារបង្ហាញ clip
 *  (ផ្ទៃ gold) ក្នុងចន្លោះជុំវិញវា; ការអូសកាត់ដោយដៃមិនទាន់មាន ដូច្នេះប្រអប់ទាំងពីរអាន-តែប៉ុណ្ណោះ. */
function TrimView({ clip, sourceSeconds }: { clip: Clip; sourceSeconds: number | null }) {
  const pad = Math.max(5, clip.duration * 0.25)
  const from = Math.max(0, clip.start - pad)
  const to = sourceSeconds ? Math.min(sourceSeconds, clip.end + pad) : clip.end + pad
  const span = Math.max(1, to - from)
  const left = ((clip.start - from) / span) * 100
  const right = ((to - clip.end) / span) * 100
  const field = 'min-h-9.5 rounded-field px-2.5 type-body text-text-2'
  return (
    <div className="flex flex-col gap-2">
      <p className="type-label text-text-3">កាត់ចាប់ផ្ដើម និងបញ្ចប់</p>
      <div className="relative h-11 overflow-hidden rounded-field bg-field" title={`${clockTenths(from)} – ${clockTenths(to)}`}>
        <div
          className="absolute inset-y-0 border-x-4 border-gold bg-gold-tint"
          style={{ left: `${left}%`, right: `${right}%` }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[12px] text-text-3">
          ចាប់ផ្ដើម
          <TextField readOnly value={clockTenths(clip.start)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-text-3">
          បញ្ចប់
          <TextField readOnly value={clockTenths(clip.end)} className={field} />
        </label>
      </div>
      <p className="type-hint text-text-4">AI កាត់ឲ្យចប់ប្រយោគរួចហើយ · ការកាត់ដោយដៃមិនទាន់មាន</p>
    </div>
  )
}
