import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { api, type Clip, type ExportResult, type Grades } from '../api'
import { clipMedia, type EditorStart, type ReviewMedia } from './reviewMedia'
import { Button, Select, TextField } from '../kit/controls'
import { CheckIcon, CloseIcon, PlayMark, PlusIcon, SubtitlesIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { parseVtt, type Cue } from '../vtt'
import { clock, khmerNumber } from './khmer'
import { ASPECTS, nearestAspect, RATIO, type Aspect } from './aspects'
import { useT } from '../i18n'
import type { Order, RatingFilter, ReviewChoices } from './reviewChoices'

type Layout = 'grid' | 'list'

// context: component តូចៗ (កាត, player, transcript) យក URL ពីទីនេះ ជំនួសការបញ្ជូន prop គ្រប់ជាន់
const MediaContext = createContext<ReviewMedia | null>(null)
/** render ទំហំថ្មីរបស់ clip មួយ (App ជាម្ចាស់ job). នៅ context ដាច់ពី media: tick មិនត្រូវឲ្យ transcript សួរម្តងទៀតទេ. */
export type AspectRender = { index: number; aspect: Aspect; startedAt: number; seconds: number }
type AspectTools = { job: AspectRender | null; busy: boolean; start?: (index: number, aspect: Aspect) => void; duplicate?: (index: number) => Promise<unknown>; size: (index: number) => Aspect | undefined; setSize: (index: number, aspect: Aspect) => void }
const AspectContext = createContext<AspectTools>({ job: null, busy: false, size: () => undefined, setSize: () => {} })
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
  fileName,
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
  onEditClip,
  aspectJob = null,
  onRenderAspect,
  onDuplicate,
}: {
  project: string
  fileName?: string // ឈ្មោះឯកសារវីដេអូក្នុង crumb; គ្មាន = ឈ្មោះ project
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
  aspectJob?: AspectRender | null
  onRenderAspect?: (index: number, aspect: Aspect) => void
  onDuplicate?: (index: number) => Promise<number> // ឆ្លើយលេខ clip ថ្មី; គ្មាន = វីដេអូទាំងមូល / វីដេអូដើម
  onEditClip?: (start?: EditorStart) => void // បើក editor; គ្មាន = project មិនដឹងផ្លូវវីដេអូដើម (គ្មានប៊ូតុង)
}) {
  const t = useT()
  const media = useMemo(() => ({ ...(given ?? clipMedia(project)), onEditClip }), [given, project, onEditClip])
  // ទំហំដែលជ្រើសរបស់ clip នីមួយៗ: ក្រឡា បញ្ជី និង dialog ប្រើតែមួយ (នៅក្នុង App ដើម្បីកុំបាត់ពេលទៅ Subtitles)
  const sizes = choices.sizes
  const defaultSize = choices.defaultSize
  const aspectTools = useMemo(
    () => ({
      job: aspectJob,
      busy,
      start: onRenderAspect,
      // ច្បាប់ចម្លងបង្ហាញទំហំដូច clip ដើម (ឯកសារគ្រប់ទំហំត្រូវបានចម្លងរួចហើយ)
      duplicate:
        onDuplicate &&
        (async (index: number) => {
          const copy = await onDuplicate(index)
          if (sizes[index]) onChoices({ sizes: { ...sizes, [copy]: sizes[index] } })
        }),
      size: (index: number) => sizes[index] ?? defaultSize,
      setSize: (index: number, aspect: Aspect) => onChoices({ sizes: { ...sizes, [index]: aspect } }),
    }),
    [aspectJob, busy, onRenderAspect, onDuplicate, sizes, defaultSize, onChoices],
  )

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

  const runExport = async (indexes: number[], aspect?: Aspect) => {
    setExporting(true)
    setExportError('')
    try {
      // MP4 + SRT ដូច ExportDone.html ("MP4 9:16 1080p + SRT")
      const result = await media.exportItems(indexes, destination.trim() || undefined, aspect)
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
    <AspectContext.Provider value={aspectTools}>
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      {/* នៅក្នុង AppShell (sidebar + ជួរខាងលើ) — crumb នាំត្រឡប់ទៅ Projects របស់ខ្ញុំ */}
      <nav aria-label="Breadcrumb" className="flex shrink-0 items-center gap-2 px-6 pt-1 type-body">
        <button
          type="button"
          onClick={onHome}
          className={`cursor-pointer rounded-field border-0 bg-transparent px-1 text-text-3 hover:text-text ${focusRing}`}
        >
          {t('Projects របស់ខ្ញុំ', 'My projects')}
        </button>
        <span className="text-text-4">/</span>
        <span className="min-w-0 truncate font-semibold">{fileName ?? project}</span>
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
        {media.whole && !media.onEdit ? 'វីដេអូទាំងមូល' : 'Clips ដើម'} <span className="text-text-4">({khmerNumber(single ? 1 : shown.length)})</span>
      </h1>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 [scrollbar-gutter:stable]">
        {single ? (
          <div className="mx-auto max-w-[1180px]">
            <ClipDetail
              project={project}
              clip={single}
              onRate={(rating) => onRate(single.index, rating)}
              onSubtitles={() => onSubtitles(single.index)}
              onExport={(aspect) => void runExport([single.index], aspect)}
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
          // ទទឹងអប្បបរមា 240: ប្រអប់ការ៉េ វីដេអូនៅកណ្តាលតាមទំហំពិតរបស់វា (រូប OpusClip)
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-5 gap-y-7">
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
                onExport={(aspect) => void runExport([clip.index], aspect)}
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
                onExport={(aspect) => void runExport([clip.index], aspect)}
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
          onExport={(index, aspect) => void runExport([index], aspect)}
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
            <Button variant="primary" disabled={chosen.length === 0 || exporting} onClick={() => void runExport(chosen, defaultSize)}>
              {exporting ? 'កំពុង export...' : `Export ${khmerNumber(chosen.length)} Clips`}
            </Button>
          </div>
        </footer>
      )}
    </div>
    </AspectContext.Provider>
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
  onExport: (aspect?: Aspect) => void
  exporting: boolean
}) {
  const score = Math.round(clip.total)
  const media = useMedia()
  const tools = useContext(AspectContext)
  const edit = media.onEdit ?? media.onEditClip
  // ទំហំដែលជ្រើស (មានឯកសារហើយប៉ុណ្ណោះ); វីដេអូទាំងមូល: ទំហំពិតពីរូប ព្រោះ folder នីមួយៗមានទំហំខ្លួនឯង
  const chosen = tools.size(clip.index)
  const size = chosen && chosen !== '9:16' && clip.aspects?.[chosen] ? chosen : undefined
  const [natural, setNatural] = useState<number | null>(null)
  const ratio = size ? RATIO[size] : media.whole ? natural ?? RATIO['16:9'] : RATIO['9:16']
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative">
        <button
          type="button"
          onClick={selecting ? onToggle : onOpen}
          title={selecting ? 'ជ្រើស / ដក' : 'មើល clip'}
          className={`group flex aspect-square w-full cursor-pointer items-center justify-center border-0 bg-transparent p-0 ${focusRing}`}
        >
          {/* ជ្រុងវែងពេញប្រអប់ការ៉េ: 9:16 ពេញកម្ពស់, 16:9 ពេញទទឹង */}
          <span
            className="block overflow-hidden rounded-[10px] bg-raised-2"
            style={ratio >= 1 ? { width: '100%', aspectRatio: ratio } : { height: '100%', aspectRatio: ratio }}
          >
            <Thumb project={project} clip={clip} aspect={size} onRatio={media.whole ? setNatural : undefined} className="block size-full group-hover:scale-[1.02]" />
          </span>
          {!media.whole && (
            <span className={`absolute top-2 right-2 rounded-[6px] px-1.5 text-[12.5px] font-bold ${scoreTone(score)}`}>
              {score} {clip.letter}
            </span>
          )}
          <span className="absolute right-2 bottom-2 rounded-[6px] bg-black/70 px-1.5 text-[12px] font-semibold text-white tabular-nums">
            {clock(clip.duration)}
          </span>
          {clip.rating && (
            <span className="absolute top-2 left-2 rounded-full bg-black/70 px-1.5 text-[13px]" aria-label={clip.rating === 'like' ? 'ចូលចិត្ត' : 'មិនចូលចិត្ត'}>
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
            className={`absolute bottom-2 left-2 size-5 cursor-pointer accent-gold ${focusRing}`}
          />
        )}
      </div>
      {/* ប៊ូតុងតូចបី (រូប: calendar · download · scissors) — ជា Subtitles · ទាញយក · Edit clip */}
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
        <DownloadMenu onDownload={() => onExport(size)} disabled={exporting} />
        {edit ? (
          <EditClipMenu onEdit={() => edit()} onAutoZoom={() => edit({ panel: 'motion' })} />
        ) : (
          <IconAction label="មើល clip" onClick={onOpen}>
            <PlayMark size={14} />
          </IconAction>
        )}
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
  onExport: (aspect?: Aspect) => void
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
  const [aspect, setAspect] = useState<Aspect | null>(null)
  const edit = media.onEdit ?? media.onEditClip
  const tools = useContext(AspectContext)
  const [copying, setCopying] = useState(false)
  const [copyError, setCopyError] = useState('')
  const duplicate = () => {
    setCopying(true)
    setCopyError('')
    tools.duplicate?.(clip.index)
      .catch((error: Error) => setCopyError(error.message))
      .finally(() => setCopying(false))
  }
  // ទំហំដែលជ្រើស: render ចប់ ហើយ clips ថ្មីមកដល់ វាមានឯកសារ ដូច្នេះវីដេអូប្តូរដោយខ្លួនឯង
  const chosenSize = tools.size(clip.index)
  const shown = chosenSize && (chosenSize === '9:16' || clip.aspects?.[chosenSize]) ? chosenSize : null
  const rendering = tools.job?.index === clip.index ? tools.job : null
  const shownParam = shown && shown !== '9:16' ? shown : undefined
  // clip: ទំហំដែលជ្រើស; វីដេអូទាំងមូល / វីដេអូដើម: ទំហំពិតពី metadata
  const playerRatio = shownParam ? RATIO[shownParam] : media.whole && aspect ? RATIO[aspect] : clip.type === 'whole-wide' ? RATIO['16:9'] : undefined
  const stacked = isStacked(rendering ? RATIO[rendering.aspect] : playerRatio ?? RATIO['9:16'])
  const chooseAspect = (next: Aspect) => {
    if (media.whole) return edit?.({ aspect: next }) // វីដេអូទាំងមូល / វីដេអូដើម: render វែង -> editor
    tools.setSize(clip.index, next)
    if (next !== '9:16' && !clip.aspects?.[next]) tools.start?.(clip.index, next)
  }
  // "Transcript only" (រូបទី ២): លាក់ hook និង "ហេតុអ្វី AI ជ្រើស" ទុកតែអត្ថបទ
  const [transcriptOnly, setTranscriptOnly] = useState(false)
  const seek = (seconds: number) => {
    const player = video.current
    if (!player) return
    player.currentTime = seconds
    void player.play()
  }

  return (
    <section aria-label={clip.title} className="flex items-start justify-center gap-4">
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

      {/* កាតទទឹងស្មើគ្នាគ្រប់ទំហំ ដើម្បីឲ្យជួរតម្រង់គ្នា. 16:9: វីដេអូពេញទទឹងនៅលើ អត្ថបទនៅក្រោម; 9:16, 1:1, 4:5: ក្បែរគ្នា (រូប OpusClip) */}
      <div className={`flex min-w-0 flex-1 overflow-hidden rounded-card border border-line bg-card max-w-[680px] ${stacked ? 'flex-col' : ''}`}>
        {rendering ? (
          <RenderCountdown job={rendering} />
        ) : (
        <RowPlayer
          key={shown ?? 'base'}
          video={video}
          src={media.fileUrl(clip.index, 'mp4', shownParam)}
          poster={media.thumbUrl(clip.index, shownParam)}
          wide={clip.type === 'whole-wide'}
          ratio={playerRatio}
          cover={clip.type === 'source' && !aspect}
          onTime={setNow}
          onRatio={(ratio) => setAspect(nearestAspect(ratio))}
        />
        )}
        {/* កម្ពស់ស្មើវីដេអូ (260 x 16/9 ≈ 462): transcript វែងរំកិលក្នុងខ្លួនវា */}
        <div className={`flex min-w-0 flex-1 flex-col gap-3 p-5 ${stacked ? 'max-h-[230px]' : 'max-h-[416px]'}`}>
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line pb-3">
            <h2 className="min-w-0 type-body-lg font-semibold">{clip.title}</h2>
            {media.onEdit && <span className="shrink-0 rounded-[6px] bg-raised-2 px-2 py-0.5 type-label font-bold text-text-2">មិនទាន់ Export</span>}
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
        {/* វីដេអូដើម: មិនទាន់ render = គ្មានអ្វីទាញយក; Export ពី editor ជាមុនសិន */}
        <SideAction
          onClick={() => onExport(shownParam)}
          disabled={exporting || Boolean(media.onEdit) || Boolean(rendering)}
          title={media.onEdit ? 'មិនទាន់ render — ចុច Edit clip រួច Export' : 'ចម្លង MP4 + SRT ទៅ folder Export'}
          icon={<DownloadGlyph />}
        >
          {exporting ? 'កំពុង export...' : 'Export HD'}
        </SideAction>
        <SideAction disabled title="មិនទាន់មានក្នុង app" icon={<DownloadGlyph />}>
          Upscale & Export
        </SideAction>
        <div className="h-2.5" aria-hidden="true" />
        {edit && (
          <SideAction onClick={() => edit()} icon={<ShotsGlyph />}>
            Edit clip
          </SideAction>
        )}
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
        <AiToolsMenu onAutoZoom={edit && (() => edit({ panel: 'motion' }))} />
        <AspectMenu
          current={rendering?.aspect ?? aspect}
          rendering={Boolean(rendering)}
          blocked={tools.busy && !rendering}
          onChoose={media.whole ? edit && chooseAspect : tools.start && chooseAspect}
        />
        <SideAction
          onClick={duplicate}
          disabled={!tools.duplicate || tools.busy || copying}
          title={!tools.duplicate ? 'មានតែ clips ប៉ុណ្ណោះ' : tools.busy ? 'រង់ចាំ job ចប់' : copyError || 'ចម្លង clip នេះជាប្រអប់ថ្មី'}
          icon={<CopyGlyph />}
        >
          {copying ? 'កំពុងចម្លង...' : copyError ? 'ចម្លងមិនបាន' : 'Duplicate'}
        </SideAction>
      </div>
    </section>
  )
}

/** វីដេអូ 9:16: ប៊ូតុង Play ធំនៅកណ្តាល រហូតដល់ចាក់ (រូបទី ២), បន្ទាប់មក control របស់ browser.
 *  `onPlay` (មិនមែនតែការចុច) បង្ហាញ control — ចុចលើ transcript ក៏ចាប់ផ្តើមចាក់ដែរ. */
/** ប្រអប់វីដេអូ: ផ្ដេក (16:9) ពេញទទឹងកាត (កាតខ្លួនវា 680 px); ផ្សេងទៀតក្បែរអត្ថបទ:
 *  9:16 = 234x416, 4:5 = 306x383, 1:1 = 342x342. */
const isStacked = (ratio: number) => ratio >= 1.5
function boxStyle(ratio: number) {
  return { aspectRatio: ratio, width: isStacked(ratio) ? '100%' : Math.min(342, (ratio < 0.6 ? 416 : 383) * ratio) }
}

function RowPlayer({
  video,
  src,
  poster,
  wide = false,
  ratio,
  cover = false,
  onTime,
  onRatio,
}: {
  video: RefObject<HTMLVideoElement | null>
  src: string
  poster: string
  wide?: boolean // វីដេអូទាំងមូល 16:9 / 1:1 — ប្រអប់ទូលាយជាង 9:16
  ratio?: number // ទំហំពិត: ប្រអប់តាមទំហំនោះ (`boxStyle`)
  cover?: boolean // វីដេអូដើមផ្ដេកក្នុងប្រអប់ 9:16: កាតគែមក្នុង preview ប៉ុណ្ណោះ, file មិនប្រែ
  onTime: (seconds: number) => void
  onRatio: (ratio: number) => void
}) {
  const [started, setStarted] = useState(false)
  return (
    <div
      className={`relative shrink-0 self-start bg-black ${ratio ? '' : wide ? 'aspect-video w-[440px]' : 'aspect-[9/16] w-[234px]'}`}
      style={ratio ? boxStyle(ratio) : undefined}
    >
      <video
        ref={video}
        src={src}
        poster={poster}
        preload="metadata"
        controls={started}
        onPlay={() => setStarted(true)}
        onTimeUpdate={(event) => onTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => onRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight)}
        className={`size-full ${cover ? 'object-cover' : 'object-contain'}`}
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
  const { fileUrl, cues } = useMedia()
  useEffect(() => {
    let stale = false
    const load = cues
      ? cues()
      : fetch(fileUrl(index, 'vtt'))
          .then((answer) => (answer.ok ? answer.text() : ''))
          .then(parseVtt)
    load.then((found) => !stale && setParts(paragraphs(found))).catch(() => !stale && setParts([]))
    return () => {
      stale = true
    }
  }, [project, index, fileUrl, cues])
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
  onExport: (index: number, aspect?: Aspect) => void
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
            onExport={(aspect) => onExport(clip.index, aspect)}
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

function Thumb({ clip, className, aspect, onRatio }: { project: string; clip: Clip; className: string; aspect?: Aspect; onRatio?: (ratio: number) => void }) {
  const [failed, setFailed] = useState(false)
  const media = useMedia()
  return failed ? (
    <span className={`flex items-center justify-center bg-raised-2 type-hint text-text-4 ${className}`}>គ្មានរូប</span>
  ) : (
    <img
      src={media.thumbUrl(clip.index, aspect)}
      alt=""
      loading="lazy"
      onLoad={(event) => onRatio?.(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
      onError={() => setFailed(true)}
      className={`${clip.type === 'whole-wide' ? 'bg-black object-contain' : 'object-cover'} transition-transform ${className}`}
    />
  )
}

function ScissorsGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.1 8.1 20 20M8.1 15.9 20 4" />
    </svg>
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
  title,
  icon,
  children,
}: {
  onClick?: () => void
  disabled?: boolean
  title?: string // disabled: ហេតុផល
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
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

/** បិទពេលចុចខាងក្រៅ ឬ Escape (capture: Escape មិនបិទ dialog ខាងក្រោយទេ). */
function useDismiss(open: boolean, close: () => void) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, close])
  return box
}

const MENU_PANEL = 'flex flex-col gap-0.5 rounded-[14px] border border-line bg-raised p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]'
const MENU_ROW = `flex min-h-10 cursor-pointer items-center gap-2.5 rounded-field border-0 bg-transparent px-3 text-left type-label font-semibold whitespace-nowrap text-text hover:bg-raised-2 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${focusRing}`

/** ទំហំពិតរបស់ file. ជ្រើសទំហំផ្សេង = បើក editor នៅទំហំនោះ ព្រោះការប្តូរទំហំត្រូវ render ថ្មី.
 *  ម៉ឺនុយបើកទៅឆ្វេង: ជួរនេះនៅគែមស្តាំ window (រូប OpusClip បើកទៅស្តាំ តែគ្មានកន្លែងនៅទីនេះ). */
function AspectMenu({
  current,
  rendering,
  blocked,
  onChoose,
}: {
  current: Aspect | null
  rendering: boolean // clip នេះកំពុង render ទំហំថ្មី: ប៊ូតុងវិល
  blocked: boolean // job ផ្សេងកំពុងរត់ (GPU តែមួយ)
  onChoose?: (aspect: Aspect) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const box = useDismiss(open, close)
  return (
    <div ref={box} className="relative" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      {hover && !open && (
        <span role="tooltip" className="absolute right-0 bottom-full z-20 mb-1.5 rounded-[8px] bg-white px-3 py-1.5 type-label font-semibold whitespace-nowrap text-bg">
          {blocked ? t('រង់ចាំ job ផ្សេងចប់', 'Waiting for another job to finish') : t('ប្តូរទំហំរបស់ clip', 'Adjust the aspect ratio of your clip')}
        </span>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!onChoose || rendering || blocked}
        onClick={() => setOpen((value) => !value)}
        className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-button border-0 bg-field px-3.5 text-left type-label font-semibold text-text hover:bg-raised-2 disabled:cursor-default disabled:opacity-40 ${focusRing}`}
      >
        {rendering && <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-text-3 border-t-transparent" />}
        <span className="text-text-2">
          <FrameGlyph aspect={current ?? '16:9'} />
        </span>
        {current ?? '…'}
      </button>
      {open && (
        <div role="menu" className={`absolute top-0 right-full z-20 mr-2 min-w-[110px] ${MENU_PANEL}`}>
          {ASPECTS.map((item) => (
            <button
              key={item}
              type="button"
              role="menuitemradio"
              aria-checked={item === current}
              onClick={() => {
                close()
                if (item !== current) onChoose?.(item)
              }}
              className={`${MENU_ROW} ${item === current ? 'bg-raised-2' : ''}`}
            >
              <span className="w-4 text-center">{item === current ? '✓' : ''}</span>
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** ពេល render ទំហំថ្មី: ប្រអប់ខ្មៅ + ពេលនៅសល់ (រូប OpusClip). ប៉ាន់ពីល្បឿនវាស់ (`App.startAspect`). */
function RenderCountdown({ job }: { job: AspectRender }) {
  const t = useT()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const left = Math.ceil(job.seconds - (now - job.startedAt) / 1000)
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center self-start bg-black type-body-lg font-semibold text-ok tabular-nums"
      style={boxStyle(RATIO[job.aspect])}
    >
      ⏱ {left > 0 ? t(`នៅសល់ ${left}s`, `${left}s left`) : t('ជិតរួច…', 'Almost done…')}
    </div>
  )
}

/** AI tools: បើកពេល hover (ចុច = keyboard). មានតែ Auto zoom ដែល pipeline មាន (Motion ក្នុង editor);
 *  ផ្សេងទៀត disabled ជាមួយហេតុផល, ហើយគ្មានស្លាកមកុដ / credit ព្រោះ app គ្មាន billing. */
type AiRow = { label: string; path: string; note?: string; run?: () => void }
function aiRows(later: string, onAutoZoom?: () => void): AiRow[] {
  return [
    { label: 'Add B-roll', path: 'M8 4h11v11H8zM5 8v12h11', note: 'Phase 3' },
    { label: 'Enhance speech', path: 'M9 4a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3ZM4 11a5 5 0 0 0 10 0M9 16v4M18 6v4M16 8h4', note: later },
    { label: 'Video dubbing', path: 'M4 6h9M8 4v2M11 6c-1 4-3 7-6 9M6 10c1 2 3 4 5 5M13 20l4-9 4 9M14.5 17h5', note: later },
    { label: 'AI viral hook', path: 'M15 4v9a5 5 0 0 1-10 0v-2M15 4l3 3', note: later },
    { label: 'Auto zoom', path: 'M4 4h7v7H4zM13 13h7v7h-7zM11 8h5v5', run: onAutoZoom },
    { label: 'Eye contact correction', path: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z', note: later },
  ]
}

function AiRowButton({ row, onDone }: { row: AiRow; onDone: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      role="menuitem"
      disabled={!row.run}
      title={row.run ? t('បើក Motion ក្នុង editor', 'Opens Motion in the editor') : row.note}
      onClick={() => {
        onDone()
        row.run?.()
      }}
      className={MENU_ROW}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={row.path} />
      </svg>
      {row.label}
    </button>
  )
}

/** កន្ត្រៃលើកាត grid: ចុច = Edit clip; hover = ម៉ឺនុយ Edit clip + AI tools (រូប OpusClip).
 *  `fixed`: ក្រឡាជួរចុងក្រោយ/ស្តាំនឹងកាត់ម៉ឺនុយក្នុង scroller បើប្រើ absolute. */
function EditClipMenu({ onEdit, onAutoZoom }: { onEdit: () => void; onAutoZoom: () => void }) {
  const t = useT()
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const close = useCallback(() => setPlace(null), [])
  const box = useDismiss(place !== null, close)
  const openBeside = (button: HTMLElement) => {
    const rect = button.getBoundingClientRect()
    const fitsRight = rect.right + EDIT_MENU_W <= window.innerWidth
    setPlace({
      left: fitsRight ? rect.right : rect.left - EDIT_MENU_W,
      top: Math.max(8, Math.min(rect.top - 60, window.innerHeight - EDIT_MENU_H - 8)),
    })
  }
  return (
    <div ref={box} className="relative" onPointerEnter={(event) => openBeside(event.currentTarget)} onPointerLeave={close}>
      <button
        type="button"
        aria-label="Edit clip"
        aria-haspopup="menu"
        aria-expanded={place !== null}
        onClick={onEdit}
        className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-field border-0 bg-transparent text-text-2 hover:bg-field hover:text-text ${focusRing}`}
      >
        <ScissorsGlyph />
      </button>
      {place && (
        // px-2 ជាផ្នែកនៃម៉ឺនុយ: mouse ឆ្លងពីប៊ូតុងទៅម៉ឺនុយមិនចាកចេញពី hover
        <div className="fixed z-30 px-2" style={{ left: place.left, top: place.top, width: EDIT_MENU_W }}>
          <div role="menu" className={MENU_PANEL}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close()
                onEdit()
              }}
              className={MENU_ROW}
            >
              <ScissorsGlyph />
              Edit clip
            </button>
            {aiRows(t('មិនទាន់មានក្នុង app', 'Not built yet'), onAutoZoom).map((row) => (
              <AiRowButton key={row.label} row={row} onDone={close} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
const EDIT_MENU_W = 270

/** ប៊ូតុងទាញយកលើកាត grid: ចុច = ម៉ឺនុយ (រូប OpusClip). Export HD ចម្លងឯកសារដែល render រួច;
 *  Upscale មិនទាន់មាន. `fixed` ដូច EditClipMenu ដើម្បីកុំឲ្យ scroller កាត់ម៉ឺនុយ. */
function DownloadMenu({ onDownload, disabled }: { onDownload: () => void; disabled: boolean }) {
  const t = useT()
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  const close = useCallback(() => setPlace(null), [])
  const box = useDismiss(place !== null, close)
  const toggle = (button: HTMLElement) => {
    if (place) return close()
    const rect = button.getBoundingClientRect()
    const below = rect.bottom + 4 + DOWNLOAD_MENU_H <= window.innerHeight
    setPlace({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - DOWNLOAD_MENU_W - 8)),
      top: below ? rect.bottom + 4 : rect.top - 4 - DOWNLOAD_MENU_H,
    })
  }
  return (
    <div ref={box}>
      <button
        type="button"
        aria-label="Export"
        aria-haspopup="menu"
        aria-expanded={place !== null}
        title="Export"
        disabled={disabled}
        onClick={(event) => toggle(event.currentTarget)}
        className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-field border-0 bg-transparent text-text-2 hover:bg-field hover:text-text disabled:cursor-default disabled:opacity-40 ${focusRing}`}
      >
        <DownloadGlyph />
      </button>
      {place && (
        <div role="menu" className={`fixed z-30 ${MENU_PANEL}`} style={{ left: place.left, top: place.top, width: DOWNLOAD_MENU_W }}>
          <button
            type="button"
            role="menuitem"
            title={t('ចម្លង MP4 + SRT ទៅ folder Export', 'Copies MP4 + SRT to the Export folder')}
            onClick={() => {
              close()
              onDownload()
            }}
            className={MENU_ROW}
          >
            Export HD
          </button>
          <button type="button" role="menuitem" disabled title={t('មិនទាន់មានក្នុង app', 'Not built yet')} className={MENU_ROW}>
            Upscale & Export
          </button>
        </div>
      )}
    </div>
  )
}
const DOWNLOAD_MENU_W = 210
const DOWNLOAD_MENU_H = 100
const EDIT_MENU_H = 340

function AiToolsMenu({ onAutoZoom }: { onAutoZoom?: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const box = useDismiss(open, close)
  const rows = aiRows(t('មិនទាន់មានក្នុង app', 'Not built yet'), onAutoZoom)
  return (
    <div ref={box} className="relative" onPointerEnter={() => setOpen(true)} onPointerLeave={close}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-button border-0 bg-field px-3.5 text-left type-label font-semibold text-text hover:bg-raised-2 ${focusRing}`}
      >
        <span className="text-text-2">
          <SparkGlyph />
        </span>
        <span className="flex-1">AI tools</span> ›
      </button>
      {open && (
        // pr-2 ជាផ្នែកនៃម៉ឺនុយ: mouse ឆ្លងពីប៊ូតុងទៅម៉ឺនុយមិនចាកចេញពី hover
        <div className="absolute top-0 right-full z-20 pr-2">
          <div role="menu" className={MENU_PANEL}>
            {rows.map((row) => (
              <AiRowButton key={row.label} row={row} onDone={close} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SparkGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4l1.8 5.2L18 11l-5.2 1.8L11 18l-1.8-5.2L4 11l5.2-1.8L11 4Z" />
      <path d="M18.5 16v4M16.5 18h4" />
    </svg>
  )
}

function FrameGlyph({ aspect }: { aspect: Aspect }) {
  // គូររាងពិតរបស់ទំហំ (9:16 បញ្ឈរ, 16:9 ផ្ដេក)
  const ratio = RATIO[aspect]
  const width = ratio >= 1 ? 18 : 18 * ratio
  const height = ratio >= 1 ? 18 / ratio : 18
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x={12 - width / 2} y={12 - height / 2} width={width} height={height} rx="2" />
    </svg>
  )
}

function CopyGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
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
