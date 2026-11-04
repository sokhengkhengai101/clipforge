import { useRef, useState } from 'react'
import { api, reframeFileUrl, sourceFrameUrl, type ExportResult, type ReframeResult, type ReframeShot } from '../api'
import { Button, Chip } from '../kit/controls'
import { PauseMark, PlayMark } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { TopBar } from '../kit/TopBar'
import { AccountButton } from './AccountButton'
import { clock, khmerNumber } from './khmer'
import { kindOf } from './layoutKinds'


/** Screen "Reframe រួចរាល់" (design/screens/ReframeResult.html) — អាន-តែប៉ុណ្ណោះ (សម្រេចជាមួយអ្នកអភិវឌ្ឍ).
 *
 *  ពិត: វីដេអូលទ្ធផល, frame ពិតពីវីដេអូដើមនៅ shot ដែលជ្រើស, shot ទាំងអស់ពី `clip_01_layout.json`
 *  ជាមួយ layout ដែល AI ជ្រើស និងហេតុផលរបស់ planner, timeline តាមពណ៌ layout (ចុច = លោតទៅ),
 *  ចំនួន shot/layout ប្តូរក្នុងមួយនាទី, ពេលក្នុង layout នីមួយៗ, និង Export ដែលចម្លង file.
 *  មិនទាន់មាន (បង្ហាញ តែចុចមិនបាន): ប្តូរ layout / អ្នកផ្ដោតតាម shot, អូសប្រអប់ crop ដោយដៃ —
 *  ទាំងនោះត្រូវការ override ផែនការក្នុង pipeline. "មុខនៅក្នុង frame %" និង "អ្នកនិយាយបង្ហាញ %"
 *  មិនត្រូវបានវាស់ពេល render ទេ ដូច្នេះមិនបង្ហាញលេខ. */
export function ReframeResultScreen({
  project,
  videoPath,
  result,
  onAgain,
  onHome,
  onBack,
}: {
  project: string
  videoPath: string // វីដេអូដើម (frame preview) — '' បើមិនដឹង
  result: ReframeResult
  onAgain: () => void
  onHome: () => void
  onBack?: () => void // បើកពី Review វីដេអូទាំងមូល -> ប៊ូតុង ‹ ត្រឡប់
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [length, setLength] = useState(result.seconds ?? 0)
  const [playing, setPlaying] = useState(false)
  const [picked, setPicked] = useState(0)
  const [exported, setExported] = useState<ExportResult | null>(null)
  const [exportError, setExportError] = useState('')
  const [exporting, setExporting] = useState(false)

  const shots = result.shots
  // shot ដែលកំពុងចាក់ (ពេល video ដើរ) ឬដែលអ្នកចុច
  const playingShot = shots.findIndex((shot) => time >= shot.start && time < shot.end)
  const current = shots[playing && playingShot >= 0 ? playingShot : picked]
  const total = result.seconds ?? (shots.length ? shots[shots.length - 1].end : 0)
  const sameKind = current ? shots.filter((shot) => shot.kind === current.kind).length : 0
  // frame ពីវីដេអូដើម: តាម shot ដែលអ្នក**ចុច** ប៉ុណ្ណោះ — បើតាម shot ដែលកំពុងចាក់ FFmpeg decode
  // វីដេអូដើមរាល់ពេល shot ប្តូរ ខណៈ video កំពុងចាក់ (ការងារឥតប្រយោជន៍ដែលប្រកួតប្រជែង CPU)
  const frameShot = shots[picked]

  const seekShot = (index: number) => {
    setPicked(index)
    const at = shots[index].start + 0.05
    if (video.current) video.current.currentTime = at
    setTime(at)
  }
  const toggle = () => {
    const element = video.current
    if (!element) return
    if (element.paused) void element.play()
    else element.pause()
  }
  const runExport = async () => {
    setExporting(true)
    setExportError('')
    try {
      setExported(await api.exportReframe(project, result.folder, { kinds: ['mp4', 'srt'] }))
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      <TopBar crumb={`${project} · Reframe`} onHome={onHome}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={`cursor-pointer rounded-field border-0 bg-field px-3 py-1.5 type-label text-text hover:bg-raised-2 ${focusRing}`}
          >
            ‹ ត្រឡប់ទៅលទ្ធផល
          </button>
        )}
        <Chip tone="ok">Reframe រួចរាល់</Chip>
        <AccountButton />
      </TopBar>

      <div className="flex min-h-0 flex-1">
        {/* ---- Preview: វីដេអូដើម + លទ្ធផល ---- */}
        <section aria-label="Preview" className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-8 overflow-y-auto bg-chrome p-6">
          <div className="flex flex-col items-center gap-2">
            <span className="type-label text-text-3">វីដេអូដើម · frame នៃ shot {frameShot ? khmerNumber(picked + 1) : '—'}</span>
            <div className="h-[203px] w-[360px] overflow-hidden rounded-[12px] bg-raised-2">
              {videoPath && frameShot ? (
                <img src={sourceFrameUrl(videoPath, (frameShot.start + frameShot.end) / 2)} alt="" className="size-full object-contain" />
              ) : (
                <span className="flex size-full items-center justify-center type-hint text-text-4">គ្មាន path វីដេអូដើម</span>
              )}
            </div>
            <p className="type-hint text-text-4">ការអូសប្រអប់ crop ដោយដៃ មិនទាន់មាន</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="type-label text-text-3">
              លទ្ធផល · {result.aspect}
              {current ? ` · ${kindOf(current.kind).label}` : ''}
            </span>
            <div
              className="overflow-hidden rounded-[12px] bg-black"
              style={{ aspectRatio: result.aspect.replace(':', ' / '), height: 'clamp(320px, calc(100vh - 360px), 620px)' }}
            >
              <video
                ref={video}
                // `v=`: URL ដដែលសម្រាប់ file ដែល render ឡើងវិញ អាចឲ្យ WebView2 លាយ bytes ចាស់ក្នុង cache
                // ជាមួយ bytes ថ្មី (video ផ្ទុកជាដុំៗតាម Range) — version ធ្វើឲ្យ file ថ្មីជា URL ថ្មី
                src={`${reframeFileUrl(project, result.folder, 'mp4')}&v=${Math.round(result.modified)}`}
                onClick={toggle}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
                className="size-full cursor-pointer object-contain"
              />
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
          </div>
        </section>

        {/* ---- Shot ដែលជ្រើស ---- */}
        <aside aria-labelledby="shot-title" className="flex w-[340px] shrink-0 flex-col gap-4.5 overflow-y-auto border-l border-line bg-sidebar p-5">
          {current ? (
            <>
              <div className="flex flex-col gap-1">
                <h2 id="shot-title" className="text-[16px] font-bold">
                  Shot {khmerNumber(shots.indexOf(current) + 1)} · {clock(current.start)}–{clock(current.end)}
                </h2>
                <p className="type-body text-text-2-dim">
                  AI ជ្រើស {kindOf(current.kind).label} ព្រោះ {kindOf(current.kind).why}
                </p>
              </div>
              <ReadOnlyChoice label="Layout" options={['Fill', 'Fit', 'Split', '៣ នាក់', '៤ នាក់']} value={kindOf(current.kind).label} />
              <ReadOnlyChoice label="ផ្ដោតលើ" options={['មុខធំបំផុត', 'A ជានិច្ច', 'B ជានិច្ច']} value="មុខធំបំផុត" />
              <label className="flex items-center gap-2.5 type-label text-text-3">
                <input type="checkbox" disabled className="size-[18px] accent-gold" />
                ប្រើលើ shots ស្រដៀងគ្នា ({khmerNumber(sameKind)} shots ជា {kindOf(current.kind).label})
              </label>
              <p className="-mt-2 type-hint text-text-4">ការកែតាម shot ត្រូវការ override ផែនការក្នុង pipeline — មិនទាន់មាន</p>
            </>
          ) : (
            <h2 id="shot-title" className="text-[16px] font-bold">
              គ្មានព័ត៌មាន shot
            </h2>
          )}
          {/* --layout គ្មាន single (Fill) = AI មិនតាមដាន subject — ឃើញពិត: --layout fit = center ទាំងមូល */}
          {result.allowed && !result.allowed.includes('single') && (
            <p className="rounded-button bg-warn-bg px-3 py-2.5 type-hint text-warn-text">
              Fill ត្រូវបានបិទក្នុង run នេះ ដូច្នេះ AI មិនបានតាមដានមនុស្ស ឬសត្វទេ
              {total && result.layout_seconds.center ? ` — កាត់កណ្តាល ${Math.round((result.layout_seconds.center / total) * 100)}% នៃវីដេអូ` : ''}
              {' · ចុច Reframe ម្ដងទៀត ហើយបើក Fill'}
            </p>
          )}
          {!shots.length && (
            <p className="type-hint text-warn-text">Reframe នេះធ្វើមុនពេល pipeline កត់ layout របស់ shot — Reframe ម្ដងទៀត ដើម្បីឃើញវា</p>
          )}

          <div className="flex flex-col gap-2.5 rounded-[12px] bg-[#161b24] px-4 py-3.5">
            <p className="type-label font-semibold text-gold">ព័ត៌មាន Reframe</p>
            <Metric label="Shots" value={shots.length ? khmerNumber(shots.length) : '—'} />
            <Metric label="ប្ដូរ shot" value={result.shots_per_minute != null ? `${khmerNumber(result.shots_per_minute)} ដង/នាទី` : '—'} />
            <Metric
              label="ប្ដូរ layout"
              value={result.layout_switches_per_minute != null ? `${khmerNumber(result.layout_switches_per_minute)} ដង/នាទី` : '—'}
            />
            <Metric label="Subtitles" value={result.captions ? 'ដុតរួច' : 'គ្មាន'} />
            <Metric label="ទំហំ file" value={`${(result.bytes / 1e6).toFixed(0)} MB`} />
            {Object.entries(result.layout_seconds).map(([kind, seconds]) => (
              <div key={kind} className="flex items-center gap-2 type-hint">
                <span className={`h-2.5 w-3.5 shrink-0 rounded-[3px] ${kindOf(kind).bar}`} />
                <span className="flex-1 text-text-2-dim">{kindOf(kind).label}</span>
                <span className="text-text-3 tabular-nums">{total ? Math.round((seconds / total) * 100) : 0}%</span>
              </div>
            ))}
            <p className="type-hint text-text-4">"មុខនៅក្នុង frame %" មិនត្រូវបានវាស់ពេល render ទេ</p>
          </div>
        </aside>
      </div>

      {/* ---- Timeline + ប៊ូតុង ---- */}
      <footer className="flex shrink-0 flex-col gap-2.5 border-t border-line bg-chrome px-5 pt-3 pb-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-text-3">
            {Object.keys(result.layout_seconds).map((kind) => (
              <span key={kind} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-3.5 rounded-[3px] ${kindOf(kind).bar}`} />
                {kindOf(kind).label}
              </span>
            ))}
          </p>
          <span className="text-[12.5px] text-text-4">ចុចលើ shot ដើម្បីមើល</span>
        </div>
        <ShotTimeline shots={shots} total={total} time={time} current={current} onPick={seekShot} />
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {exported && (
            <span className="mr-auto flex items-center gap-2 type-hint text-ok-text">
              បានរក្សាទុក {khmerNumber(exported.files.length)} file
              <button
                type="button"
                onClick={() => api.reveal(exported.files[0]?.path ?? exported.destination).catch(() => {})}
                className={`cursor-pointer border-0 bg-transparent p-0 type-hint font-semibold text-gold ${focusRing}`}
              >
                បើក Folder
              </button>
            </span>
          )}
          {exportError && <span className="mr-auto type-hint text-danger">{exportError}</span>}
          <Button className="bg-raised" onClick={onAgain}>
            Reframe ម្ដងទៀត
          </Button>
          <Button
            className="bg-raised"
            disabled
            title={result.captions ? 'មាន subtitles រួចហើយ' : 'បើក "ដាក់ subtitles" ក្នុង Reframe ម្ដងទៀត'}
          >
            {result.captions ? 'មាន Subtitles រួច' : 'បន្ថែម Subtitles'}
          </Button>
          <Button variant="primary" disabled={exporting} onClick={runExport}>
            {exporting ? 'កំពុង export...' : `Export ${result.aspect}`}
          </Button>
        </div>
      </footer>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 type-label">
      <span className="text-text-2-dim">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  )
}

/** ប៊ូតុងរបស់ design ដែលបង្ហាញជម្រើសរបស់ AI តែកែមិនបាន. */
function ReadOnlyChoice({ label, options, value }: { label: string; options: string[]; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="type-label text-text-3">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled
            aria-pressed={option === value}
            className={`min-h-10 rounded-field border-0 px-3.5 type-body ${
              option === value ? 'bg-segment font-bold text-bg' : 'bg-raised text-text-2 opacity-40'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

/** shot នីមួយៗជាប្លុកពណ៌តាម layout, ទទឹងតាមរយៈពេល; បន្ទាត់ស = ពេលកំពុងចាក់. */
function ShotTimeline({
  shots,
  total,
  time,
  current,
  onPick,
}: {
  shots: ReframeShot[]
  total: number
  time: number
  current: ReframeShot | undefined
  onPick: (index: number) => void
}) {
  if (!shots.length || !total) return <div className="h-11 rounded-field bg-field" />
  return (
    <div role="group" aria-label={`Timeline: ${shots.length} shots តាមពណ៌ layout`} className="relative flex h-11 gap-0.5 overflow-hidden rounded-field bg-field">
      {shots.map((shot, index) => {
        const kind = kindOf(shot.kind)
        const width = ((shot.end - shot.start) / total) * 100
        return (
          <button
            key={index}
            type="button"
            onClick={() => onPick(index)}
            title={`Shot ${index + 1} · ${kind.label} · ${clock(shot.start)}–${clock(shot.end)}`}
            aria-label={`Shot ${index + 1} ${kind.label}`}
            aria-pressed={shot === current}
            className={`flex min-w-[3px] cursor-pointer items-center overflow-hidden border-0 p-0 pl-1.5 text-[11.5px] font-bold whitespace-nowrap ${kind.bar} ${kind.ink} ${
              shot === current ? 'ring-3 ring-white ring-inset' : ''
            } ${focusRing}`}
            style={{ flex: `${width} 1 0` }}
          >
            {width > 6 ? kind.label : ''}
          </button>
        )
      })}
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: `${(time / total) * 100}%` }} />
    </div>
  )
}
