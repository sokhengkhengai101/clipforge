import { useEffect, useState } from 'react'
import { api, sourceFrameUrl, type ReframeResult, type Video, type VideoFormat } from '../api'
import { Chip, Segmented, Switch } from '../kit/controls'
import { Dialog } from '../kit/Dialog'
import { focusRing } from '../kit/styles'
import { clock, khmerNumber, relativeDay } from './khmer'
import { Illustration, Source } from './VideoPicker'

export type ReframeSettings = {
  aspect: '9:16' | '1:1' | '4:5' | '16:9'
  layouts: string[] // --layout: fill, fit, split, three, four (center ជានិច្ចជាជម្រើសចុងក្រោយ)
  captions: boolean // false = --no-captions (.srt/.vtt នៅតែសរសេរ)
  tool?: string // crumb លើ screen ដំណើរការ: 'AI Reframe' (លំនាំដើម) ឬ 'Auto Subtitles'
}

/** ទំហំ (w/h) នៃ aspect នីមួយៗ — សម្រាប់គូរប្រអប់ crop លើ frame ដើម. */
const RATIO: Record<ReframeSettings['aspect'], number> = { '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9 }

/** Layout ដែល AI អាចជ្រើស (ReframeSetup.html) — នីមួយៗជាឈ្មោះពិតរបស់ `--layout`.
 *  "៣–៤ នាក់" design សរសេរ "ឆាប់ៗ" តែ pipeline មាន three/four រួចហើយ ដូច្នេះវាបើក. */
const LAYOUTS = [
  // Fill = layout តែមួយដែលតាមដាន subject (មុខ -> មនុស្ស/សត្វ -> ចលនា); design សរសេរ "អ្នកនិយាយ ១"
  // ដែលធ្វើឲ្យវាមើលទៅដូចសម្រាប់ podcast ប៉ុណ្ណោះ — អ្នកអភិវឌ្ឍបិទវា ហើយ AI កាត់កណ្តាលគ្រប់ shot
  { id: 'fill', label: 'Fill', hint: 'តាមមុខ · មនុស្ស · សត្វ', flags: ['fill'] },
  { id: 'fit', label: 'Fit', hint: 'គ្មានមុខ', flags: ['fit'] },
  { id: 'split', label: 'Split', hint: '២ នាក់', flags: ['split'] },
  { id: 'group', label: '៣–៤ នាក់', hint: '', flags: ['three', 'four'] },
  // អេក្រង់ចែករំលែក + webcam តូចនៅគែម -> slide ខាងលើ, មនុស្សខាងក្រោម (`--layout screen`)
  { id: 'screen', label: 'ScreenShare', hint: 'slide + webcam', flags: ['screen'] },
]

/** ល្បឿនដែលបានវាស់: interview 47 នាទី `--full` (transcribe + plan + render) = 15½ នាទីលើ GPU. */
const MEASURED_RATIO = 15.5 / 47

/** Dialog "AI Reframe" (design/screens/ReframeSetup.html) ពីលើ Home: បម្លែងវីដេអូទាំងមូលទៅបញ្ឈរ.
 *
 *  ពិត: aspect, layout ដែលអនុញ្ញាត, subtitles បើក/បិទ (= `--full --aspect --layout [--no-captions]`),
 *  frame ពិតពីវីដេអូ ជាមួយប្រអប់ crop តាម aspect, និងពេលប៉ាន់ពីល្បឿនដែលបានវាស់.
 *  មិនទាន់មាន (បង្ហាញ តែចុចមិនបាន): វីដេអូក្នុង Fit ជា 4:3 / 1:1, ផ្ទៃខ្មៅ / ពណ៌ brand (Phase 3),
 *  ScreenShare និង Gameplay. គ្មាន "ប្រើ [១៣] នាទី" ទេ — app មិនរាប់នាទី (local-first). */
export function ReframeSetup({
  video,
  videos,
  device,
  previous,
  busy,
  error,
  dropOver,
  onChoose,
  onChoosePath,
  onClear,
  onShowPrevious,
  onStart,
  onClose,
}: {
  video: Video | null
  videos: Video[] // samples/
  device: string // cuda / cpu
  previous: ReframeResult[] // reframe ដែលធ្លាប់ធ្វើលើវីដេអូនេះ
  busy: boolean
  error: string // job ចាប់ផ្តើមមិនបាន (ឧ. 409 មាន job កំពុងរត់)
  onChoose: (video: Video) => void
  onChoosePath: (path: string) => void
  dropOver: boolean // file កំពុងអូសលើ window (Tauri)
  onClear: () => void // "ប្ដូរ": ត្រឡប់ទៅជំហាន ១
  onShowPrevious: (result: ReframeResult) => void
  onStart: (settings: ReframeSettings) => void
  onClose: () => void
}) {
  const [aspect, setAspect] = useState<ReframeSettings['aspect']>('9:16')
  // លំនាំដើម = គ្រប់ layout (ដូច `--layout auto` ដែល pipeline សាកល្បងរួច); design បើកតែ Fill + Fit
  const [layouts, setLayouts] = useState(() => new Set(LAYOUTS.map((item) => item.id)))
  const [captions, setCaptions] = useState(true)

  // ទំហំ/រយៈពេលពិត (ffprobe) — ប្រើសម្រាប់ស្លាក ប្រអប់ crop និងពេលប៉ាន់
  const path = video?.path ?? ''
  const [probed, setProbed] = useState<{ path: string; format: VideoFormat | null } | null>(null)
  useEffect(() => {
    if (!path) return
    let stale = false
    api
      .probe(path)
      .then((format) => !stale && setProbed({ path, format }))
      .catch(() => !stale && setProbed({ path, format: null }))
    return () => {
      stale = true
    }
  }, [path])
  const format = probed?.path === path ? probed.format : null

  // ពេលនៃ frame preview: slider រំកិលឆ្វេង/ស្តាំ។ `wanted` ប្តូររាល់ចលនា ប៉ុន្តែ `shown`
  // (ពេលដែលសុំ FFmpeg ពិតៗ) ប្តូរតែក្រោយឈប់រំកិល 150 ms — មិនឲ្យ FFmpeg រត់រាល់ pixel។
  // ទុកជាមួយ path ដើម្បីឲ្យវីដេអូថ្មីចាប់ផ្តើមពីពេលលំនាំដើមវិញ។
  const defaultAt = format?.seconds ? Math.min(60, format.seconds * 0.1) : 5
  const [wanted, setWanted] = useState<{ path: string; at: number } | null>(null)
  const [shown, setShown] = useState<{ path: string; at: number } | null>(null)
  const wantedAt = wanted?.path === path ? wanted.at : defaultAt
  const shownAt = shown?.path === path ? shown.at : defaultAt
  useEffect(() => {
    if (!wanted) return
    const timer = window.setTimeout(() => setShown(wanted), 150)
    return () => window.clearTimeout(timer)
  }, [wanted])
  const sourceRatio = format?.width && format?.height ? format.width / format.height : 16 / 9

  // ប្រអប់ crop: ផ្ទៃដែល aspect ថ្មីយកពី frame ដើម (9:16 លើ 16:9 = ទទឹង 31.64%, ដូច design)
  const target = RATIO[aspect]
  const box = target < sourceRatio ? { w: (target / sourceRatio) * 100, h: 100 } : { w: 100, h: (sourceRatio / target) * 100 }

  const flags = LAYOUTS.filter((item) => layouts.has(item.id)).flatMap((item) => item.flags)
  const minutes = format?.seconds ? Math.max(1, Math.ceil((format.seconds / 60) * MEASURED_RATIO)) : null

  const toggle = (id: string) =>
    setLayouts((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })


  const pressed = 'bg-segment text-bg font-bold'
  const idle = 'bg-raised text-text-2'
  const title = (
    <span className="flex items-center gap-2">
      AI Reframe <Chip tone="gold">AI</Chip>
    </span>
  )

  // ជំហាន ១ ដូច Long to Short: ជ្រើសវីដេអូមុនការកំណត់
  if (!video) {
    return (
      <Dialog width={640} onClose={onClose} title={title}>
        <p className="-mt-2.5 type-body-lg text-text-3">
          AI បម្លែងវីដេអូផ្ដេកទៅជាបញ្ឈរសម្រាប់ TikTok, Reels និង Shorts ហើយតាមដានអ្នកនិយាយ។
        </p>
        <Illustration variant="reframe" video={[...videos].sort((a, b) => b.mb - a.mb)[0] ?? null} />
        <Source videos={videos} dropOver={dropOver} onChoose={onChoose} onChoosePath={onChoosePath} />
      </Dialog>
    )
  }

  return (
    <Dialog width={640} onClose={onClose} title={title}>
      <p className="-mt-2 pr-8 text-[14.5px] leading-[1.7] text-text-2-dim">
        AI បម្លែងវីដេអូផ្ដេកទៅជាទំហំសម្រាប់ TikTok, Reels និង Shorts ហើយរក្សាអ្នកនិយាយនៅក្នុង frame ជានិច្ច។
      </p>

      {/* ---- frame ពិត + ប្រអប់ crop ---- */}
      <div className="flex flex-col items-center gap-2">
        <div
          role="img"
          aria-label={`Preview: ផ្ទៃ ${aspect} លើវីដេអូដើម`}
          className="relative h-[203px] w-[360px] overflow-hidden rounded-[12px] bg-raised-2"
        >
          {video?.path ? (
            <img
              src={sourceFrameUrl(video.path, shownAt)}
              alt=""
              className="size-full object-contain"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center type-hint text-text-4">មិនទាន់ជ្រើសវីដេអូ</span>
          )}
          {format && (
            <span className="absolute top-2.5 left-2.5 z-[2] rounded-[6px] bg-black/65 px-2 py-0.5 text-[12px] font-bold">
              {format.width && format.height ? `${Math.min(format.width, format.height)}p` : '—'}
              {format.seconds ? ` · ${clock(format.seconds)}` : ''}
            </span>
          )}
          {video?.path && (
            <div
              className="absolute top-1/2 left-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 border-2 border-gold shadow-[0_0_0_999px_rgba(0,0,0,0.5)]"
              style={{ width: `${box.w}%`, height: `${box.h}%` }}
            />
          )}
        </div>
        {video?.path && format?.seconds ? (
          <label className="flex w-[360px] items-center gap-2.5">
            <input
              type="range"
              min={0}
              max={format.seconds}
              step={0.5}
              value={wantedAt}
              onChange={(event) => setWanted({ path, at: Number(event.target.value) })}
              aria-label="ពេលក្នុងវីដេអូសម្រាប់ preview"
              className={`h-1.5 flex-1 cursor-pointer accent-gold ${focusRing}`}
            />
            <span className="w-11 text-right type-hint tabular-nums text-text-3">{clock(wantedAt)}</span>
          </label>
        ) : null}
        <p className="type-hint text-text-4">ប្រអប់ = ផ្ទៃ {aspect} · AI ផ្លាស់ទីវាតាមមុខក្នុង shot នីមួយៗ</p>
      </div>

      {/* ---- វីដេអូ ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-label text-text-3">វីដេអូ:</span>
        <span className="min-w-0 flex-1 truncate type-body font-semibold">{video?.name ?? '—'}</span>
        <button
          type="button"
          onClick={onClear}
          className={`min-h-9 cursor-pointer rounded-field border-0 bg-raised-2 px-3 type-label text-text hover:bg-raised-3 ${focusRing}`}
        >
          ប្ដូរ
        </button>
      </div>

      {/* ---- ការកំណត់ ---- */}
      <div className="flex flex-col gap-2">
        <span className="type-label font-semibold text-text-2">ទំហំ (aspect ratio)</span>
        <Segmented
          label="ទំហំ (aspect ratio)"
          value={aspect}
          onChange={setAspect}
          options={[
            { value: '9:16', label: '9:16', hint: 'TikTok · Reels' },
            { value: '1:1', label: '1:1' },
            { value: '4:5', label: '4:5', hint: 'Facebook' },
            { value: '16:9', label: '16:9' },
          ]}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="type-label font-semibold text-text-2">
          Layout ដែល AI អាចជ្រើស <span className="font-normal text-text-4">· AI ជ្រើសសម្រាប់ shot នីមួយៗ</span>
        </span>
        <div role="group" aria-label="Layout ដែល AI អាចជ្រើស" className="flex flex-wrap gap-2">
          {LAYOUTS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={layouts.has(item.id)}
              onClick={() => toggle(item.id)}
              className={`inline-flex min-h-10.5 cursor-pointer items-center gap-1.5 rounded-button border-0 px-3.5 type-body ${
                layouts.has(item.id) ? pressed : idle
              } ${focusRing}`}
            >
              {item.label}
              {item.hint && <span className="text-[12px] font-normal opacity-80">{item.hint}</span>}
            </button>
          ))}
          {['Gameplay'].map((label) => (
            <button key={label} type="button" disabled className={`min-h-10.5 rounded-button border-0 px-3.5 type-body opacity-40 ${idle}`}>
              {label} · ឆាប់ៗ
            </button>
          ))}
        </div>
        {!layouts.has('fill') && (
          <p className="rounded-button bg-warn-bg px-3 py-2 type-hint text-warn-text">
            Fill បិទ: AI នឹង<strong>មិនតាមដាន</strong>មនុស្សម្នាក់ ឬសត្វទេ — shot ទាំងនោះនឹងកាត់កណ្តាល
            (Fit សម្រាប់តែរូបស្ងៀម ដូចជា slide, Split សម្រាប់មនុស្ស ២ នាក់)
          </p>
        )}
        <p className="type-hint text-text-4">
          {flags.length ? `--layout ${flags.join(',')}` : 'គ្មាន layout — AI នឹងកាត់កណ្តាលគ្រប់ shot'} · គ្មានមុខ = កាត់កណ្តាល ជាជម្រើសចុងក្រោយ
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <span className="type-label font-semibold text-text-2">វីដេអូក្នុង Fit</span>
          <Segmented
            label="វីដេអូក្នុង Fit"
            size="sm"
            value="original"
            onChange={() => {}}
            options={[
              { value: 'original', label: 'ទំហំដើម' },
              { value: '4:3', label: '4:3', disabled: true },
              { value: '1:1', label: '1:1', disabled: true },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="type-label font-semibold text-text-2">ផ្ទៃខាងក្រោយ</span>
          <Segmented
            label="ផ្ទៃខាងក្រោយ"
            size="sm"
            value="blur"
            onChange={() => {}}
            options={[
              { value: 'blur', label: 'Blur' },
              { value: 'black', label: 'ខ្មៅ', disabled: true },
              { value: 'brand', label: 'ពណ៌ brand', disabled: true },
            ]}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="type-label font-semibold text-text-2">ដាក់ subtitles</span>
          <span className="type-hint text-text-4">បិទ = គ្មាន caption ដុត · .srt/.vtt នៅតែសរសេរ</span>
        </span>
        <Switch label="ដាក់ subtitles" checked={captions} onChange={setCaptions} />
      </div>

      {previous.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-button bg-field px-3.5 py-2.5">
          <span className="type-hint text-text-3">ធ្លាប់ reframe:</span>
          {previous.map((result) => (
            <button
              key={result.folder}
              type="button"
              onClick={() => onShowPrevious(result)}
              className={`min-h-8 cursor-pointer rounded-full border-0 bg-raised px-3 type-hint text-text hover:bg-raised-2 ${focusRing}`}
            >
              {result.aspect} · {relativeDay(result.modified)}
            </button>
          ))}
        </div>
      )}

      <p className="m-0 flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-text-3">
        {minutes && (
          <span>
            ប្រហែល <strong className="text-text">{khmerNumber(minutes)} នាទី</strong> លើ {device === 'cuda' ? 'GPU' : 'CPU'}
          </span>
        )}
        <span>វាស់: វីដេអូ ៤៧ នាទី → ១៥½ នាទី · លឿនជាងនេះបើ transcript មានរួច</span>
        <span>វីដេអូនៅលើកុំព្យូទ័ររបស់អ្នក</span>
      </p>

      {error && <p className="type-hint text-danger">{error}</p>}
      <button
        type="button"
        disabled={!video?.path || busy}
        onClick={() => onStart({ aspect, layouts: flags, captions })}
        title={busy ? 'មាន job កំពុងរត់' : !video?.path ? 'ជ្រើសវីដេអូមុន' : undefined}
        className={`min-h-13.5 cursor-pointer rounded-[12px] border-0 bg-white text-[16px] font-bold text-on-gold disabled:cursor-default disabled:opacity-40 ${focusRing}`}
      >
        {busy ? 'មាន job កំពុងរត់...' : 'Reframe វីដេអូក្នុង ១ ចុច'}
      </button>
    </Dialog>
  )
}
