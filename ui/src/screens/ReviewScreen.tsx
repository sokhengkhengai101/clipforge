import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { api, type Clip, type ExportResult, type Grades } from '../api'
import { clipMedia, type ReviewMedia } from './reviewMedia'
import { Button, Select, TextField } from '../kit/controls'
import { CheckIcon, CloseIcon, PlayMark, PlusIcon, SubtitlesIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { parseVtt, type Cue } from '../vtt'
import { clock, khmerNumber } from './khmer'
import type { Order, RatingFilter, ReviewChoices } from './reviewChoices'

type Layout = 'grid' | 'list'

// context: component តូចៗ (កាត, player, transcript) យក URL ពីទីនេះ ជំនួសការបញ្ជូន prop គ្រប់ជាន់
const MediaContext = createContext<ReviewMedia | null>(null)
function useMedia(): ReviewMedia {
  const media = useContext(MediaContext)
  if (!media) throw new Error('ReviewScreen media missing')
  return media
}
type Rating = 'like' | 'dislike' | null

/** Screen "ពិនិត្យ Clips" — រចនាតាមរូប OpusClip ដែលអ្នកអភិវឌ្ឍផ្ញើ (2026-10-23):
 *
 *  - **ក្រឡា** (លំនាំដើម): clips ទាំងអស់ជាកាតបញ្ឈរ, ប៊ូតុងតូចបី (Subtitles · ទាញយក · ចាក់)
 *    នៅក្រោមរូប និងចំណងជើង. ចុចកាត = dialog នៃ clip នោះ (↑ / ↓ ទៅ clip មុន/បន្ទាប់).
 *  - **បញ្ជី**: clip នីមួយៗជាជួរធំ — ♡ / 👎, វីដេអូចាក់បាន, ចំណងជើង + ពេលក្នុងវីដេអូដើម +
 *    អត្ថបទពី `.vtt`, ហេតុអ្វី AI ជ្រើស (Hook/Flow/Value), និងប៊ូតុងសកម្មភាព.
 *  - ជួរខាងលើ: ក្រឡា/បញ្ជី · Filter (♡ / លាក់ 👎) · តម្រៀប · រក clips បន្ថែម · ជ្រើស (export ច្រើន).
 *
 *  ប៊ូតុងក្នុងរូបដែល pipeline មិនមាន (Publish on Social, Export XML, Upscale, Edit clip,
 *  1:1, Duplicate) មិនត្រូវបានគូរទេ. ♡ / 👎 រក្សាទុកក្នុង project.json តាមចន្លោះពេលរបស់ clip. */
export function ReviewScreen({
  project,
  clips,
  busy,
  choices,
  onChoices,
  onSubtitles,
  onExported,
  onMore,
  onRate,
  onHome,
  media: given,
}: {
  project: string
  choices: ReviewChoices // រស់នៅក្នុង App: ការចេញទៅ Subtitles ឬ Export រួចរាល់ មិនបាត់វាទេ
  onChoices: (change: Partial<ReviewChoices>) => void
  clips: Clip[] // បញ្ជីតាមលំដាប់ពិន្ទុទាំងមូលពី clips.json — រួមទាំង clip ដែលមិនទាន់ render
  busy: boolean
  onSubtitles: (index: number) => void
  onExported: (result: ExportResult) => void
  onMore: (maxClips: number) => void
  onRate: (index: number, rating: Rating) => Promise<void>
  onHome: () => void // crumb: ត្រឡប់ទៅ Projects របស់ខ្ញុំ
  media?: ReviewMedia // គ្មាន = clips របស់ project
}) {
  const media = useMemo(() => given ?? clipMedia(project), [given, project])

  // បង្ហាញតែ clip ដែលមាន .mp4 — clip ក្រោយ --max-clips មិនទាន់ render ទេ
  const rendered = useMemo(() => clips.filter((clip) => clip.files.mp4), [clips])
  const { order, destination } = choices
  const filter = choices.filter ?? 'all'
  const shown = useMemo(() => filterClips(sortClips(rendered, order), filter), [rendered, order, filter])
  const picked = new Set(rendered.map((item) => item.index).filter((index) => !choices.unpicked.includes(index)))

  const [layout, setLayout] = useState<Layout>(loadLayout)
  const chooseLayout = (next: Layout) => {
    setLayout(next)
    saveLayout(next)
  }
  // "ជ្រើស" (Select ក្នុងរូប): បង្ហាញ checkbox លើកាត និងរបារ export ខាងក្រោម
  const [selecting, setSelecting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  // កន្លែង export លំនាំដើម គណនាក្នុង Python (~/Videos/ClipForge/<project>)
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

  // ក្រឡា: ចុចកាត = dialog លើក្រឡា (រូបទី ១). `order` = លេខ clip តាមលំដាប់ដែលបង្ហាញ ពេលបើក —
  // ថតទុក ដើម្បីកុំឲ្យ ↑ / ↓ លោតរំលង ពេលដក ♡ ក្រោម Filter "ចូលចិត្ត" ហើយ clip បាត់ពីក្រឡា
  const [viewing, setViewing] = useState<{ index: number; order: number[] } | null>(null)
  const openDialog = (index: number) => {
    onChoices({ selected: index })
    setViewing({ index, order: shown.map((item) => item.index) })
  }
  // clip តែមួយ (រូបទី ២): គ្មានក្រឡា/បញ្ជី — បង្ហាញ clip នោះធំៗតែម្តង, មិនគិត Filter
  const single = rendered.length === 1 ? rendered[0] : null

  const toggle = (index: number) =>
    onChoices({
      unpicked: choices.unpicked.includes(index)
        ? choices.unpicked.filter((item) => item !== index)
        : [...choices.unpicked, index],
    })

  const runExport = async (indexes: number[]) => {
    setExporting(true)
    setExportError('')
    try {
      // MP4 + SRT ដូច ExportDone.html ("MP4 9:16 1080p + SRT")
      const result = await media.exportItems(indexes, destination.trim() || undefined)
      onExported(result)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  // clip ក្នុង clips.json ច្រើនជាងដែល render = "រក clips បន្ថែម" គ្រាន់តែ render បន្ថែម (គ្មាន LLM)
  const more = Math.min(clips.length, rendered.length + 5)
  const chosen = shown.filter((item) => picked.has(item.index)).map((item) => item.index)

  return (
    <MediaContext.Provider value={media}>
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      {/* នៅក្នុង AppShell (sidebar + ជួរខាងលើ) — crumb នាំត្រឡប់ទៅ Projects របស់ខ្ញុំ */}
      <nav aria-label="Breadcrumb" className="flex shrink-0 items-center gap-2 px-6 pt-1 type-body">
        <button
          type="button"
          onClick={onHome}
          className={`cursor-pointer rounded-field border-0 bg-transparent px-1 text-text-3 hover:text-text ${focusRing}`}
        >
          ‹ Projects របស់ខ្ញុំ
        </button>
        <span className="text-text-4">/</span>
        <span className="min-w-0 truncate font-semibold">{project}</span>
      </nav>

      {/* ---- ជួរខាងលើ (រូប: ក្រឡា/បញ្ជី · Select · Filter · តម្រៀប) ---- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 px-6 pt-4 pb-2">
        {!single && (
        <div role="group" aria-label="របៀបបង្ហាញ" className="flex rounded-button bg-field p-1">
          {(['grid', 'list'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={layout === value}
              aria-label={value === 'grid' ? 'ក្រឡា' : 'បញ្ជី'}
              title={value === 'grid' ? 'ក្រឡា' : 'បញ្ជី'}
              onClick={() => chooseLayout(value)}
              className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-field border-0 ${
                layout === value ? 'bg-raised-3 text-text' : 'bg-transparent text-text-3 hover:text-text'
              } ${focusRing}`}
            >
              {value === 'grid' ? <GridGlyph /> : <ListGlyph />}
            </button>
          ))}
        </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {!media.whole && (
          <Button size="sm" variant="ghost" disabled={busy || more <= rendered.length} onClick={() => onMore(more)}
            title={
              more > rendered.length
                ? `render clip ${khmerNumber(rendered.length + 1)}-${khmerNumber(more)} ពីបញ្ជី AI · មិនចាំបាច់ transcribe ម្ដងទៀត`
                : `AI រកឃើញ ${khmerNumber(clips.length)} clips — បាន render ទាំងអស់ហើយ`
            }
          >
            <PlusIcon /> រក clips បន្ថែម
          </Button>
          )}
          {!single && (
          <>
          <button
            type="button"
            aria-pressed={selecting}
            onClick={() => setSelecting((value) => !value)}
            className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-button border px-3.5 type-label font-semibold ${
              selecting ? 'border-gold bg-gold-tint text-gold' : 'border-raised-3 bg-transparent text-text hover:bg-field'
            } ${focusRing}`}
          >
            <CheckIcon size={16} /> ជ្រើស
          </button>
          {!media.whole && (
          <>
          <label className="flex items-center gap-1.5 type-label text-text-3">
            Filter
            <Select size="sm" value={filter} onChange={(event) => onChoices({ filter: event.target.value as RatingFilter })}>
              <option value="all">ទាំងអស់</option>
              <option value="liked">♡ ចូលចិត្ត</option>
              <option value="hide-disliked">លាក់ 👎</option>
            </Select>
          </label>
          <label className="flex items-center gap-1.5 type-label text-text-3">
            តម្រៀប
            <Select size="sm" value={order} onChange={(event) => onChoices({ order: event.target.value as Order })}>
              <option value="rank">លំដាប់ AI</option>
              <option value="score">ពិន្ទុ</option>
              <option value="time">ពេលវេលា</option>
            </Select>
          </label>
          </>
          )}
          </>
          )}
        </div>
      </div>

      <h1 className="shrink-0 px-6 pt-2 pb-4 type-body-lg text-text-3">
        {media.whole ? 'វីដេអូទាំងមូល' : 'Clips ដើម'} <span className="text-text-4">({khmerNumber(single ? 1 : shown.length)})</span>
      </h1>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 [scrollbar-gutter:stable]">
        {single ? (
          <div className="mx-auto max-w-[1180px]">
            <ClipDetail
              project={project}
              clip={single}
              onRate={(rating) => onRate(single.index, rating)}
              onSubtitles={() => onSubtitles(single.index)}
              onExport={() => void runExport([single.index])}
              exporting={exporting}
            />
          </div>
        ) : (
        <>
        {shown.length === 0 && (
          <p className="py-16 text-center type-body text-text-3">
            គ្មាន clip ត្រូវនឹង Filter នេះទេ —{' '}
            <button type="button" onClick={() => onChoices({ filter: 'all' })} className="cursor-pointer border-0 bg-transparent p-0 text-gold underline">
              បង្ហាញទាំងអស់
            </button>
          </p>
        )}

        {layout === 'grid' ? (
          // ទទឹងអប្បបរមា 210: ៥ ជួរនៅ 1440, ៤ នៅ 1100
          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-x-5 gap-y-7">
            {shown.map((clip) => (
              <GridCard
                key={clip.index}
                project={project}
                clip={clip}
                selecting={selecting}
                checked={picked.has(clip.index)}
                onToggle={() => toggle(clip.index)}
                onOpen={() => openDialog(clip.index)}
                onSubtitles={() => onSubtitles(clip.index)}
                onExport={() => void runExport([clip.index])}
                exporting={exporting}
              />
            ))}
          </div>
        ) : (
          <div className="mx-auto flex max-w-[1180px] flex-col gap-6">
            {shown.map((clip) => (
              <ClipDetail
                key={clip.index}
                project={project}
                clip={clip}
                selecting={selecting}
                checked={picked.has(clip.index)}
                onToggle={() => toggle(clip.index)}
                onRate={(rating) => onRate(clip.index, rating)}
                onSubtitles={() => onSubtitles(clip.index)}
                onExport={() => void runExport([clip.index])}
                exporting={exporting}
              />
            ))}
          </div>
        )}
        </>
        )}
      </div>

      {viewing && (
        <ClipDialog
          project={project}
          clips={rendered}
          viewing={viewing}
          onMove={(index) => {
            onChoices({ selected: index })
            setViewing({ ...viewing, index })
          }}
          onClose={() => setViewing(null)}
          onRate={onRate}
          onSubtitles={onSubtitles}
          onExport={(index) => void runExport([index])}
          exporting={exporting}
        />
      )}

      {/* ---- Export ច្រើន: តែពេល "ជ្រើស" ឬ export បរាជ័យ ---- */}
      {(selecting || exportError) && (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-chrome px-5 py-3.5">
          <span className="type-body text-text-2">
            បានជ្រើស <strong>{khmerNumber(chosen.length)}</strong> ក្នុងចំណោម {khmerNumber(shown.length)} clips
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
            <Button variant="primary" disabled={chosen.length === 0 || exporting} onClick={() => void runExport(chosen)}>
              {exporting ? 'កំពុង export...' : `Export ${khmerNumber(chosen.length)} Clips`}
            </Button>
          </div>
        </footer>
      )}
    </div>
    </MediaContext.Provider>
  )
}

// ---------- ក្រឡា ----------

/** កាតបញ្ឈរ (រូបទី ១): thumbnail 9:16 + ពិន្ទុ + រយៈពេល, ប៊ូតុងតូចបី, ចំណងជើង ២ បន្ទាត់. */
function GridCard({
  project,
  clip,
  selecting,
  checked,
  onToggle,
  onOpen,
  onSubtitles,
  onExport,
  exporting,
}: {
  project: string
  clip: Clip
  selecting: boolean
  checked: boolean
  onToggle: () => void
  onOpen: () => void
  onSubtitles: () => void
  onExport: () => void
  exporting: boolean
}) {
  const score = Math.round(clip.total)
  const media = useMedia()
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative">
        <button
          type="button"
          onClick={selecting ? onToggle : onOpen}
          title={selecting ? 'ជ្រើស / ដក' : 'មើល clip'}
          className={`group block w-full cursor-pointer overflow-hidden rounded-card border-0 bg-raised-2 p-0 ${focusRing}`}
        >
          <Thumb project={project} clip={clip} className="aspect-[9/16] w-full group-hover:scale-[1.02]" />
          {!media.whole && (
            <span className={`absolute top-2 left-2 rounded-[6px] px-1.5 text-[12.5px] font-bold ${scoreTone(score)}`}>
              {score} {clip.letter}
            </span>
          )}
          <span className="absolute right-2 bottom-2 rounded-[6px] bg-black/70 px-1.5 text-[12px] font-semibold text-white tabular-nums">
            {clock(clip.duration)}
          </span>
          {clip.rating && (
            <span className="absolute top-2 right-2 rounded-full bg-black/70 px-1.5 text-[13px]" aria-label={clip.rating === 'like' ? 'ចូលចិត្ត' : 'មិនចូលចិត្ត'}>
              {clip.rating === 'like' ? '♥' : '👎'}
            </span>
          )}
        </button>
        {selecting && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`ជ្រើស clip ${clip.index} សម្រាប់ export`}
            className={`absolute right-2.5 bottom-9 size-5 cursor-pointer accent-gold ${focusRing}`}
          />
        )}
      </div>
      {/* ប៊ូតុងតូចបី (រូប: calendar · download · scissors) — ជា Subtitles · ទាញយក · ចាក់ */}
      <div className="flex justify-center gap-6 text-text-2">
        {media.whole ? (
          media.onShots && (
            <IconAction label="មើល shots និង layout" onClick={() => media.onShots?.(clip.index)}>
              <ShotsGlyph />
            </IconAction>
          )
        ) : (
          <IconAction label="កែ Subtitles" onClick={onSubtitles}>
            <SubtitlesIcon size={18} weight={1.75} />
          </IconAction>
        )}
        <IconAction label="Export clip នេះ (MP4 + SRT)" onClick={onExport} disabled={exporting}>
          <DownloadGlyph />
        </IconAction>
        <IconAction label="មើល clip" onClick={onOpen}>
          <PlayMark size={14} />
        </IconAction>
      </div>
      <p className="line-clamp-2 px-1 text-[15px] leading-[1.5] font-semibold" title={clip.title}>
        {clip.title}
      </p>
    </div>
  )
}

// ---------- clip មួយ: clip តែមួយ, ជួរក្នុងបញ្ជី, និង dialog ប្រើ component ដូចគ្នា ----------

/** រូបទី ២: ♡ / 👎 · វីដេអូ · ចំណងជើង + ពិន្ទុ + hook + transcript តាមពេល · សកម្មភាព. */
function ClipDetail({
  project,
  clip,
  selecting = false,
  checked = false,
  onToggle,
  onRate,
  onSubtitles,
  onExport,
  exporting,
}: {
  project: string
  clip: Clip
  selecting?: boolean
  checked?: boolean
  onToggle?: () => void
  onRate: (rating: Rating) => Promise<void>
  onSubtitles: () => void
  onExport: () => void
  exporting: boolean
}) {
  const [saving, setSaving] = useState(false)
  const rate = (rating: 'like' | 'dislike') => {
    setSaving(true)
    // ចុចម្តងទៀតលើអ្វីដែលបានជ្រើស = លុបវា
    void onRate(clip.rating === rating ? null : rating).finally(() => setSaving(false))
  }
  const score = Math.round(clip.total)
  const media = useMedia()
  // វីដេអូនៅទីនេះ ដើម្បីឲ្យចុចលើផ្នែក transcript រំកិលវីដេអូទៅពេលនោះបាន
  const video = useRef<HTMLVideoElement>(null)
  const [now, setNow] = useState(0)
  // "Transcript only" (រូបទី ២): លាក់ hook និង "ហេតុអ្វី AI ជ្រើស" ទុកតែអត្ថបទ
  const [transcriptOnly, setTranscriptOnly] = useState(false)
  const seek = (seconds: number) => {
    const player = video.current
    if (!player) return
    player.currentTime = seconds
    void player.play()
  }

  return (
    <section aria-label={clip.title} className="flex items-start gap-4">
      <div className="flex shrink-0 flex-col gap-2.5 pt-1">
        {selecting && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`ជ្រើស clip ${clip.index} សម្រាប់ export`}
            className={`mx-auto mb-1 size-5 cursor-pointer accent-gold ${focusRing}`}
          />
        )}
        {!media.whole && (
          <>
            <RateButton label="ចូលចិត្ត" on={clip.rating === 'like'} disabled={saving} onClick={() => rate('like')}>
              {clip.rating === 'like' ? '♥' : '♡'}
            </RateButton>
            <RateButton label="មិនចូលចិត្ត" on={clip.rating === 'dislike'} disabled={saving} onClick={() => rate('dislike')}>
              👎
            </RateButton>
          </>
        )}
      </div>

      <div className="flex min-w-0 flex-1 overflow-hidden rounded-card border border-line bg-card">
        <RowPlayer
          video={video}
          src={media.fileUrl(clip.index, 'mp4')}
          poster={media.thumbUrl(clip.index)}
          wide={clip.type === 'whole-wide'}
          onTime={setNow}
        />
        {/* កម្ពស់ស្មើវីដេអូ (260 x 16/9 ≈ 462): transcript វែងរំកិលក្នុងខ្លួនវា */}
        <div className="flex max-h-[462px] min-w-0 flex-1 flex-col gap-3 p-5">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line pb-3">
            <h2 className="min-w-0 type-body-lg font-semibold">{clip.title}</h2>
            {!media.whole && (
              <span className={`shrink-0 rounded-[6px] px-2 py-0.5 type-label font-bold ${scoreTone(score)}`}>
                {score} {clip.letter}
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <p className="type-body text-text-3 tabular-nums">
              [{clock(clip.start)} - {clock(clip.end)}] · {clock(clip.duration)}
            </p>
            <label className="flex cursor-pointer items-center gap-2 type-label text-text-2">
              <input
                type="checkbox"
                checked={transcriptOnly}
                onChange={(event) => setTranscriptOnly(event.target.checked)}
                className={`size-4 cursor-pointer accent-gold ${focusRing}`}
              />
              Transcript only
            </label>
          </div>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            {!transcriptOnly && clip.hook && <p className="type-body leading-[1.7] text-text">{clip.hook}</p>}
            <Transcript project={project} index={clip.index} now={now} onSeek={seek} />
            {!transcriptOnly && !media.whole && <WhyPicked clip={clip} />}
          </div>
        </div>
      </div>

      <div className="flex w-[190px] shrink-0 flex-col gap-2.5">
        <SideAction onClick={onExport} disabled={exporting} icon={<DownloadGlyph />}>
          {exporting ? 'កំពុង export...' : 'Export MP4 + SRT'}
        </SideAction>
        {media.whole ? (
          media.onShots && (
            <SideAction onClick={() => media.onShots?.(clip.index)} icon={<ShotsGlyph />}>
              មើល shots និង layout
            </SideAction>
          )
        ) : (
          <SideAction onClick={onSubtitles} icon={<SubtitlesIcon size={16} weight={1.75} />}>
            កែ Subtitles
          </SideAction>
        )}
      </div>
    </section>
  )
}

/** វីដេអូ 9:16: ប៊ូតុង Play ធំនៅកណ្តាល រហូតដល់ចាក់ (រូបទី ២), បន្ទាប់មក control របស់ browser.
 *  `onPlay` (មិនមែនតែការចុច) បង្ហាញ control — ចុចលើ transcript ក៏ចាប់ផ្តើមចាក់ដែរ. */
function RowPlayer({
  video,
  src,
  poster,
  wide = false,
  onTime,
}: {
  video: RefObject<HTMLVideoElement | null>
  src: string
  poster: string
  wide?: boolean // វីដេអូទាំងមូល 16:9 / 1:1 — ប្រអប់ទូលាយជាង 9:16
  onTime: (seconds: number) => void
}) {
  const [started, setStarted] = useState(false)
  return (
    <div className={`relative shrink-0 bg-black ${wide ? 'aspect-video w-[440px]' : 'aspect-[9/16] w-[260px]'}`}>
      <video
        ref={video}
        src={src}
        poster={poster}
        preload="metadata"
        controls={started}
        onPlay={() => setStarted(true)}
        onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
        className="size-full object-contain"
      />
      {!started && (
        <button
          type="button"
          aria-label="Play"
          onClick={() => void video.current?.play()}
          className={`absolute inset-0 flex cursor-pointer items-center justify-center border-0 bg-transparent ${focusRing}`}
        >
          <span className="inline-flex size-14 items-center justify-center rounded-full bg-white/90 text-bg">
            <PlayMark size={20} />
          </span>
        </button>
      )}
    </div>
  )
}

/** អត្ថបទដែលនិយាយក្នុង clip — `.vtt` ពិតរបស់វា ជាកថាខណ្ឌមានពេល `[0:01 - 0:41]` (រូបទី ២).
 *  ចុចកថាខណ្ឌ = វីដេអូទៅពេលនោះ; កថាខណ្ឌដែលកំពុងចាក់មានពណ៌ gold. */
function Transcript({
  project,
  index,
  now,
  onSeek,
}: {
  project: string
  index: number
  now: number
  onSeek: (seconds: number) => void
}) {
  const [parts, setParts] = useState<Cue[] | null>(null)
  const { fileUrl } = useMedia()
  useEffect(() => {
    let stale = false
    fetch(fileUrl(index, 'vtt'))
      .then((answer) => (answer.ok ? answer.text() : ''))
      .then((body) => !stale && setParts(paragraphs(parseVtt(body))))
      .catch(() => !stale && setParts([]))
    return () => {
      stale = true
    }
  }, [project, index, fileUrl])
  if (parts === null) return <p className="type-body text-text-4">…</p>
  if (parts.length === 0) return <p className="type-hint text-text-4">គ្មាន transcript សម្រាប់ clip នេះ</p>
  return (
    <div className="flex flex-col gap-1">
      {parts.map((part) => {
        const playing = now >= part.start && now < part.end
        return (
          <button
            key={part.start}
            type="button"
            onClick={() => onSeek(part.start)}
            className={`cursor-pointer rounded-field border-0 px-2 py-1 text-left type-body leading-[1.7] ${
              playing ? 'bg-gold-tint text-text' : 'bg-transparent text-text-2 hover:bg-field'
            } ${focusRing}`}
          >
            <span className={`mr-1.5 tabular-nums ${playing ? 'text-gold' : 'text-text-4'}`}>
              [{clock(part.start)} - {clock(part.end)}]
            </span>
            {part.text}
          </button>
        )
      })}
    </div>
  )
}

/** ផ្គុំ cue (២-៥ ពាក្យនីមួយៗ) ជាកថាខណ្ឌ: ផ្តាច់នៅពេលស្ងាត់ > 1 វិនាទី ឬពេលកថាខណ្ឌវែងជាង
 *  20 វិនាទី ហើយប្រយោគចប់ (.?!). ឧ. "Coming straight here." (0.3-1.7) រួចស្ងាត់ 26 វិនាទី
 *  -> កថាខណ្ឌ [0:00 - 0:01] មួយ, ហើយ "That's the difference..." ចាប់ផ្តើមកថាខណ្ឌថ្មី. */
function paragraphs(cues: Cue[]): Cue[] {
  const out: Cue[] = []
  for (const cue of cues) {
    const last = out.at(-1)
    const pause = last ? cue.start - last.end : Infinity
    const longEnough = last ? last.end - last.start > 20 && /[.?!]$/.test(last.text) : false
    if (!last || pause > 1 || longEnough) out.push({ ...cue })
    else {
      last.end = cue.end
      last.text = `${last.text} ${cue.text}`
    }
  }
  return out
}

// ---------- dialog លើក្រឡា (រូបទី ១) ----------

/** clip មួយលើក្រឡា: ↑ / ↓ ទៅ clip មុន/បន្ទាប់ (ប៊ូតុង ឬ keyboard), ✕ / Escape / ចុចខាងក្រៅ = បិទ. */
function ClipDialog({
  project,
  clips,
  viewing,
  onMove,
  onClose,
  onRate,
  onSubtitles,
  onExport,
  exporting,
}: {
  project: string
  clips: Clip[]
  viewing: { index: number; order: number[] }
  onMove: (index: number) => void
  onClose: () => void
  onRate: (index: number, rating: Rating) => Promise<void>
  onSubtitles: (index: number) => void
  onExport: (index: number) => void
  exporting: boolean
}) {
  const clip = clips.find((item) => item.index === viewing.index)
  const { whole } = useMedia()
  const at = viewing.order.indexOf(viewing.index)
  const previous = at > 0 ? viewing.order[at - 1] : null
  const next = at >= 0 && at < viewing.order.length - 1 ? viewing.order[at + 1] : null

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // ↑ / ↓ ក្នុង checkbox ឬ select មានន័យរបស់វា — មិនដណ្តើមទេ
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowUp' && previous !== null) {
        event.preventDefault()
        onMove(previous)
      } else if (event.key === 'ArrowDown' && next !== null) {
        event.preventDefault()
        onMove(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previous, next, onMove, onClose])

  if (!clip) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={clip.title}
        className="relative flex max-h-[calc(100vh-48px)] w-full max-w-[1180px] flex-col overflow-hidden rounded-dialog bg-bg font-kantumruy text-text shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
          <span className="type-label text-text-3 tabular-nums">
            {whole ? 'វីដេអូ' : 'Clip'} {khmerNumber(at + 1)} / {khmerNumber(viewing.order.length)}
          </span>
          <div className="ml-auto flex gap-1.5">
            <IconAction label="Clip មុន (↑)" onClick={() => previous !== null && onMove(previous)} disabled={previous === null}>
              <UpDownGlyph up />
            </IconAction>
            <IconAction label="Clip បន្ទាប់ (↓)" onClick={() => next !== null && onMove(next)} disabled={next === null}>
              <UpDownGlyph />
            </IconAction>
            <IconAction label="បិទ" onClick={onClose}>
              <CloseIcon size={14} weight={1.5} />
            </IconAction>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto p-6">
          {/* key: clip ថ្មី = វីដេអូ និង transcript ថ្មី (មិនចាក់បន្តពីពេលរបស់ clip មុន) */}
          <ClipDetail
            key={clip.index}
            project={project}
            clip={clip}
            onRate={(rating) => onRate(clip.index, rating)}
            onSubtitles={() => onSubtitles(clip.index)}
            onExport={() => onExport(clip.index)}
            exporting={exporting}
          />
        </div>
      </div>
    </div>
  )
}

function WhyPicked({ clip }: { clip: Clip }) {
  const parts: [keyof Grades, string][] = [
    ['hook', 'Hook'],
    ['flow', 'Flow'],
    ['value', 'Value'],
  ]
  return (
    <details className="group rounded-xl bg-[#161b24] px-4 py-3">
      <summary className="cursor-pointer type-label font-semibold text-gold">ហេតុអ្វី AI ជ្រើស clip នេះ</summary>
      <div className="mt-3 flex flex-col gap-2.5">
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
    </details>
  )
}

// ---------- ផ្នែកតូចៗ ----------

function Thumb({ clip, className }: { project: string; clip: Clip; className: string }) {
  const [failed, setFailed] = useState(false)
  const media = useMedia()
  return failed ? (
    <span className={`flex items-center justify-center bg-raised-2 type-hint text-text-4 ${className}`}>គ្មានរូប</span>
  ) : (
    <img
      src={media.thumbUrl(clip.index)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${clip.type === 'whole-wide' ? 'bg-black object-contain' : 'object-cover'} transition-transform ${className}`}
    />
  )
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-field border-0 bg-transparent text-text-2 hover:bg-field hover:text-text disabled:cursor-default disabled:opacity-40 ${focusRing}`}
    >
      {children}
    </button>
  )
}

function SideAction({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-button border-0 bg-field px-3.5 text-left type-label font-semibold text-text hover:bg-raised-2 disabled:cursor-default disabled:opacity-40 ${focusRing}`}
    >
      <span className="text-text-2">{icon}</span>
      {children}
    </button>
  )
}

function RateButton({
  label,
  on,
  disabled,
  onClick,
  children,
}: {
  label: string
  on: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-12 cursor-pointer items-center justify-center rounded-button border-0 text-[19px] disabled:cursor-wait ${
        on ? 'bg-gold-tint text-gold' : 'bg-field text-text-2 hover:bg-raised-2'
      } ${focusRing}`}
    >
      {children}
    </button>
  )
}

function sortClips(clips: Clip[], order: Order): Clip[] {
  if (order === 'rank') return clips
  // sort ថេរ (stable): ពិន្ទុស្មើគ្នា = នៅតាមលំដាប់ AI
  if (order === 'score') return [...clips].sort((a, b) => b.total - a.total)
  return [...clips].sort((a, b) => a.start - b.start)
}

function filterClips(clips: Clip[], filter: RatingFilter): Clip[] {
  if (filter === 'liked') return clips.filter((clip) => clip.rating === 'like')
  if (filter === 'hide-disliked') return clips.filter((clip) => clip.rating !== 'dislike')
  return clips
}

/** ពិន្ទុ ≥ 80 = gold, 70-79 = raised-2, ក្រោមនោះ = raised-3. */
function scoreTone(score: number): string {
  if (score >= 80) return 'bg-gold text-on-gold'
  if (score >= 70) return 'bg-raised-2 text-text'
  return 'bg-raised-3 text-text'
}

/** "A", "A-" = gold-tint; ផ្សេងទៀត = raised. */
function letterTone(letter: string): string {
  return letter.startsWith('A') ? 'bg-gold-tint text-gold' : 'bg-raised text-text'
}

// ក្រឡា/បញ្ជី ចងចាំលើកុំព្យូទ័រនេះ (ក្រឡាជាលំនាំដើម — អ្នកអភិវឌ្ឍជ្រើស)
const LAYOUT_KEY = 'kcs.reviewLayout'
function loadLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}
function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, layout)
  } catch {
    // គ្មាន storage — ចងចាំតែក្នុង session នេះ
  }
}

function GridGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  )
}

function ListGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01" />
    </svg>
  )
}

function UpDownGlyph({ up = false }: { up?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} />
    </svg>
  )
}

function ShotsGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M9 6v12M15 6v12" />
    </svg>
  )
}

function DownloadGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 19h14" />
    </svg>
  )
}
