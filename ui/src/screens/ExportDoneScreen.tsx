import { useEffect, useState } from 'react'
import { api, clipThumbUrl as defaultThumb, type Clip, type ExportResult, type VideoFormat } from '../api'
import { Button, Chip } from '../kit/controls'
import { FolderIcon, PlusIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { TopBar } from '../kit/TopBar'
import { AccountButton } from './AccountButton'
import { clock, khmerNumber } from './khmer'

/** Screen "Export រួចរាល់" (design/screens/ExportDone.html), បង្ហាញលទ្ធផល export ពិត.
 *
 *  design មានបីផ្ទាំងដែល app នេះគ្មានទិន្នន័យ ហើយវាត្រូវបានជំនួសដោយលេខពិតក្នុងទម្រង់ដដែល:
 *  - "ពេលវេលាដែលអ្នកសន្សំបាន [១ ម៉ោង ៤០ នាទី]" ធៀបនឹង "ដោយដៃ ប្រហែល ២ ម៉ោង" — គ្មាននរណាវាស់
 *    ការកាត់ដោយដៃទេ. ជំនួសដោយ: clips ប៉ុន្មាននាទី ដែល AI ជ្រើសចេញពីវីដេអូប៉ុន្មាននាទី.
 *  - "Caption ដែល AI ស្នើ សម្រាប់ TikTok" — pipeline មិនសរសេរ caption សម្រាប់ post ទេ. ជំនួសដោយ
 *    hook ដែល LLM សរសេរពិតសម្រាប់ clip ដែលជ្រើស (highlights.py `hook`).
 *  - "Free plan · នាទីនៅសល់" — គ្មានគណនី គ្មាននាទី. ជំនួសដោយ file ដែលបានសរសេរពិត.
 *  "ចម្លង caption" លើ card នីមួយៗចម្លង title + hook របស់ clip នោះ. */
export function ExportDoneScreen({
  project,
  result,
  clips,
  onReview,
  onNewProject,
  onHome,
  thumbUrl = (index) => defaultThumb(project, index),
}: {
  project: string
  result: ExportResult
  clips: Clip[]
  onReview: () => void
  onNewProject: () => void
  onHome: () => void
  thumbUrl?: (index: number) => string // វីដេអូទាំងមូល: រូបពី reframe/<folder>/thumb
}) {
  // clip ដែល export (លំដាប់ដូច file: 01, 02 ...) — result.files មាន mp4 និង srt របស់ clip នីមួយៗ
  const indexes = [...new Set(result.files.map((file) => file.index))]
  const exported = indexes
    .map((index) => clips.find((clip) => clip.index === index))
    .filter((clip): clip is Clip => Boolean(clip))
  const kinds = [...new Set(result.files.map((file) => file.kind.toUpperCase()))]

  const [format, setFormat] = useState<VideoFormat | null>(null)
  const [sourceSeconds, setSourceSeconds] = useState<number | null>(null)
  useEffect(() => {
    let stale = false
    // ffprobe លើ clip ទីមួយ (ទំហំ, fps) និងរយៈពេលវីដេអូដើម (transcript.json)
    api.exportPreview(project, ['mp4']).then((answer) => !stale && setFormat(answer.format)).catch(() => {})
    api.transcript(project).then((answer) => !stale && setSourceSeconds(answer.duration)).catch(() => {})
    return () => {
      stale = true
    }
  }, [project])

  const [picked, setPicked] = useState(exported[0]?.index ?? 0)
  const pickedClip = exported.find((clip) => clip.index === picked) ?? exported[0]
  const [copied, setCopied] = useState('')
  const [revealFailed, setRevealFailed] = useState(false)

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((current) => (current === key ? '' : current)), 1500)
    } catch {
      setCopied('fail')
    }
  }

  const size = format?.width && format?.height ? `${format.width}×${format.height}` : null
  const aspect = format?.width && format?.height ? aspectName(format.width, format.height) : null
  // "1080p" = ជ្រុងខ្លី (1080×1920 បញ្ឈរ ក៏ជា 1080p ដូចក្នុង design)
  const lines = format?.width && format?.height ? `${Math.min(format.width, format.height)}p` : null
  // "MP4 9:16 1080p + SRT"
  const what = [[kinds[0], aspect, lines].filter(Boolean).join(' '), ...kinds.slice(1)].join(' + ')
  const subtitle = `${result.destination} · ${what}`

  const clipSeconds = exported.reduce((sum, clip) => sum + clip.duration, 0)
  const share = sourceSeconds ? Math.min(100, (clipSeconds / sourceSeconds) * 100) : null

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      <TopBar
        onHome={onHome}
        crumb={
          <button
            type="button"
            onClick={onReview}
            className={`cursor-pointer truncate rounded-chip border-0 bg-transparent p-0 type-body text-text-3 hover:text-text ${focusRing}`}
          >
            {project}
          </button>
        }
      >
        <AccountButton />
      </TopBar>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-9 [scrollbar-gutter:stable]">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-6">
          {/* ---- ចំណងជើង + ប៊ូតុង ---- */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span className="inline-flex size-13 shrink-0 items-center justify-center rounded-full bg-ok-bg text-ok">
                <svg width="24" height="24" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div className="min-w-0">
                <h1 className="type-page">Clips {khmerNumber(exported.length)} រួចរាល់ហើយ!</h1>
                <p className="mt-0.5 type-body break-all text-text-3">{subtitle}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button
                className="min-h-11.5 bg-raised"
                onClick={() => api.reveal(result.files[0]?.path ?? result.destination).catch(() => setRevealFailed(true))}
              >
                <FolderIcon size={16} />
                បើក Folder
              </Button>
              <Button variant="primary" className="min-h-11.5" onClick={onNewProject}>
                <PlusIcon />
                Project ថ្មី
              </Button>
            </div>
          </div>
          {revealFailed && <p className="type-hint text-danger">បើក folder មិនបាន</p>}

          {/* ---- អ្វីដែល AI ជ្រើស (ជំនួស "ពេលវេលាដែលអ្នកសន្សំបាន") ---- */}
          <section aria-labelledby="saved-title" className="flex flex-wrap items-center gap-6 rounded-2xl bg-card px-6 py-5.5">
            <div className="min-w-0 flex-1 basis-[280px]">
              <p className="type-label text-text-3">អ្វីដែល AI ជ្រើសចេញពីវីដេអូ</p>
              <h2 id="saved-title" className="mt-0.5 text-[34px] leading-[1.35] font-bold text-gold">
                {spoken(clipSeconds)}
              </h2>
              <p className="mt-1 type-label text-text-3">
                {sourceSeconds ? `ពីវីដេអូ ${spoken(sourceSeconds)} — អ្នកមិនចាំបាច់មើលទាំងមូលទេ` : 'រយៈពេលវីដេអូដើមមិនស្គាល់'}
              </p>
            </div>
            <div className="flex min-w-0 flex-[1.4] basis-[360px] flex-col gap-3">
              <Bar label="វីដេអូដើម" value={sourceSeconds ? clock(sourceSeconds) : '—'} percent={100} tone="bg-raised-3" />
              <Bar
                label={`Clips ទាំង ${khmerNumber(exported.length)}`}
                value={clock(clipSeconds)}
                percent={share ?? 0}
                tone="bg-gold"
                track
              />
            </div>
          </section>

          {/* ---- Clip cards ---- */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            {exported.map((clip) => {
              const key = `card-${clip.index}`
              return (
                <div
                  key={clip.index}
                  className={`flex gap-3.5 rounded-card border-2 bg-card p-3.5 ${
                    clip.index === pickedClip?.index ? 'border-gold' : 'border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setPicked(clip.index)}
                    aria-label={`មើល hook របស់ clip ${clip.index}`}
                    className={`h-[132px] w-[74px] shrink-0 cursor-pointer overflow-hidden rounded-field border-0 bg-raised-2 p-0 ${focusRing}`}
                  >
                    <img src={thumbUrl(clip.index)} alt="" className="size-full object-cover" />
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <p className="type-body leading-normal font-bold">{clip.title}</p>
                    <p className="type-hint text-text-3">
                      {clock(clip.duration)}
                      {size && ` · ${size}`}
                    </p>
                    <Button
                      size="sm"
                      className="mt-auto min-h-9 bg-raised text-text-2"
                      title={`${clip.title}\n${clip.hook}`}
                      onClick={() => copy(key, captionOf(clip))}
                    >
                      {copied === key ? 'បានចម្លង ✓' : 'ចម្លង caption'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-4">
            {/* ---- Hook ពិតរបស់ LLM (ជំនួស "Caption ដែល AI ស្នើ សម្រាប់ TikTok") ---- */}
            <section aria-labelledby="caption-title" className="flex min-w-0 flex-[1.4] basis-[380px] flex-col gap-2.5 rounded-card bg-card px-5 py-4.5">
              <div className="flex items-center justify-between gap-2">
                <h2 id="caption-title" className="text-[15px] font-bold">
                  Hook ដែល AI សរសេរ · clip #{pickedClip?.index}
                </h2>
                <Chip tone="gold">AI</Chip>
              </div>
              <p className="rounded-button bg-field px-3.5 py-3 type-body leading-[1.8] text-text-2">
                {pickedClip?.hook || pickedClip?.title}
              </p>
              <p className="type-hint text-text-4">
                AI សរសេរ hook ជាភាសាដូចវីដេអូ ពេលជ្រើស clip · caption សម្រាប់ TikTok ជាខ្មែរ មិនទាន់មាន
              </p>
              <Button
                size="sm"
                className="self-start bg-raised text-text-2"
                onClick={() => pickedClip && copy('hook', captionOf(pickedClip))}
              >
                {copied === 'hook' ? 'បានចម្លង ✓' : 'ចម្លង'}
              </Button>
              {copied === 'fail' && <p className="type-hint text-danger">ចម្លងមិនបាន (clipboard បិទ)</p>}
            </section>

            {/* ---- File ពិត (ជំនួស "Free plan ខែនេះ") ---- */}
            <section aria-labelledby="files-title" className="flex min-w-0 flex-1 basis-[280px] flex-col gap-2.5 rounded-card bg-card px-5 py-4.5">
              <h2 id="files-title" className="text-[15px] font-bold">
                File ដែលបានរក្សាទុក
              </h2>
              <div className="flex justify-between type-label">
                <span className="text-text-2-dim">{khmerNumber(result.files.length)} file</span>
                <span className="text-text-3">{result.mb} MB</span>
              </div>
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {result.files.map((file) => (
                  <li key={file.path} className="flex justify-between gap-3 type-hint">
                    <span className="truncate text-text-2">{file.path.split(/[\\/]/).pop()}</span>
                    <span className="shrink-0 text-text-4">{file.mb >= 0.1 ? `${file.mb} MB` : `${Math.ceil(file.bytes / 1024)} KB`}</span>
                  </li>
                ))}
              </ul>
              {result.skipped.length > 0 && (
                <p className="type-hint text-warn-text">
                  រំលង {khmerNumber(result.skipped.length)} file: {result.skipped.map((file) => `${file.name} (${file.reason})`).join(', ')}
                </p>
              )}
              <p className="mt-auto type-hint text-text-4">គ្មានគណនី គ្មាននាទីកំណត់ — ការងារទាំងអស់នៅលើកុំព្យូទ័រនេះ</p>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

function Bar({ label, value, percent, tone, track }: { label: string; value: string; percent: number; tone: string; track?: boolean }) {
  return (
    <div>
      <div className="mb-1.5 flex justify-between type-label">
        <span className="text-text-2-dim">{label}</span>
        <span className="text-text-3 tabular-nums">{value}</span>
      </div>
      <div className={`h-3 overflow-hidden rounded-full ${track ? 'bg-raised' : ''}`}>
        {/* យ៉ាងហោចណាស់ 1% ឲ្យមើលឃើញ: clip ១ នាទីក្នុងវីដេអូ ៧០ នាទី = 1.4% */}
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(1, percent)}%` }} />
      </div>
    </div>
  )
}

/** title + hook = អ្វីដែលអ្នកអាចបិទភ្ជាប់ជា caption របស់ post. */
function captionOf(clip: Clip): string {
  return clip.hook && clip.hook !== clip.title ? `${clip.title}\n${clip.hook}` : clip.title
}

/** 95 -> "១ នាទី ៣៥ វិនាទី", 6120 -> "១ ម៉ោង ៤២ នាទី" (design: "[១ ម៉ោង ៤០ នាទី]"). */
function spoken(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return `${khmerNumber(h)} ម៉ោង ${khmerNumber(m)} នាទី`
  if (m) return s ? `${khmerNumber(m)} នាទី ${khmerNumber(s)} វិនាទី` : `${khmerNumber(m)} នាទី`
  return `${khmerNumber(s)} វិនាទី`
}

/** 1080×1920 -> "9:16" (ExportDone.html "MP4 9:16 1080p"). */
function aspectName(width: number, height: number): string {
  const known: [string, number][] = [
    ['9:16', 9 / 16],
    ['4:5', 4 / 5],
    ['1:1', 1],
    ['16:9', 16 / 9],
  ]
  const ratio = width / height
  const found = known.find(([, value]) => Math.abs(value - ratio) < 0.01)
  return found ? found[0] : `${width}×${height}`
}
