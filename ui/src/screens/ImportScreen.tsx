import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Health, Project, Video } from '../api'
import type { Pack } from '../packs'
import { flagsOf, type Preset } from '../presets'
import { Button, Segmented, TextField, type Segment } from '../kit/controls'
import { ArrowRightIcon, CheckIcon, CpuIcon, PlusIcon, UploadIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { TopBar } from '../kit/TopBar'
import { khmerNumber, relativeDay } from './khmer'
import { pickVideo } from './pickFile'
import { AccountButton } from './AccountButton'

/** Screen "Import" (design/screens/Main.html): drop / ជ្រើស file, ការកំណត់, ប៊ូតុងចាប់ផ្តើម.
 *
 *  អ្វីដែល design គូរ តែ pipeline មិនទាន់មាន នៅលើអេក្រង់ ហើយប្រាប់ត្រង់ៗ:
 *  ភាសាខ្មែរ និង subtitles ខ្មែរ = Phase 2; ប្រវែង clip មិនមាន flag ទេ (AI ជ្រើស 15–90 វិ).
 *  Link YouTube ត្រូវជំនួសដោយប្រអប់ path — app នេះមិនទាញវីដេអូពី internet ទេ.
 *  "[២៣] នាទីនៅសល់" លាក់ ព្រោះគ្មានគណនីទេ (local-first). ImportLowMinutes.html មិនសង់. */
export function ImportScreen({
  videos,
  projects,
  chosen,
  preset,
  pack,
  health,
  error,
  connected,
  busy,
  clips,
  dropOver,
  maxClips,
  onMaxClips,
  onChoose,
  onChoosePath,
  onClear,
  onStart,
  onOpenProject,
  onReview,
  onRetry,
  onHome,
  onShowJob,
}: {
  videos: Video[] // samples/
  projects: Project[]
  chosen: Video | null
  preset: Preset
  pack: Pack
  health: Health | null
  error: string
  connected: boolean
  busy: boolean
  clips: number // clip ដែលវីដេអូដែលជ្រើសមានរួចហើយ
  dropOver: boolean // file កំពុងអូសលើ window (Tauri)
  maxClips: number
  onMaxClips: (count: number) => void
  onChoose: (video: Video) => void
  onChoosePath: (path: string) => void
  onClear: () => void
  onStart: () => void
  onOpenProject: (project: Project) => void
  onReview: () => void
  onRetry: () => void
  onHome: () => void
  onShowJob: () => void // job កំពុងរត់: ប៊ូតុងចាប់ផ្តើមនាំទៅមើលវា
}) {
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')
  const [over, setOver] = useState(false)
  const pathInput = useRef<HTMLInputElement>(null)

  /** "ជ្រើសឯកសារពីកុំព្យូទ័រ": ផ្ទាំងជ្រើស file ពិតក្នុង app; browser មិនអាចឲ្យ path ពេញទេ. */
  const pick = async () => {
    try {
      const picked = await pickVideo()
      if (picked === 'browser') {
        setNote('Browser មិនអាចអានផ្លូវពេញរបស់ file បានទេ — បិទភ្ជាប់ path ខាងក្រោម។')
        pathInput.current?.focus()
      } else if (picked) {
        setNote('')
        onChoosePath(picked)
      }
    } catch (e) {
      setNote(`បើកផ្ទាំងជ្រើស file មិនបាន: ${(e as Error).message}`)
    }
  }

  /** drop ក្នុង browser ផ្តល់តែឈ្មោះ file — ប្រៀបនឹង samples/, បើមិនមាន សុំ path.
   *  (ក្នុង app desktop `App` ទទួល drop ពី window ទាំងមូល ហើយ path ពេញមកដល់តាម `chosen`.) */
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    const match = videos.find((video) => video.name === file.name)
    if (match) {
      setNote('')
      onChoose(match)
    } else {
      setTyped(file.name)
      setNote(`${file.name} មិននៅក្នុង samples/ ទេ — browser មិនអាចអានផ្លូវពេញបាន ដូច្នេះបិទភ្ជាប់ path ខាងក្រោម។`)
      pathInput.current?.focus()
    }
  }

  const applyPath = () => {
    if (!typed.trim()) return
    setNote('')
    onChoosePath(typed.trim())
  }

  const ready = !!chosen?.path && connected && !busy
  const recent = [...projects].sort((a, b) => b.created - a.created)

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      <TopBar onHome={onHome}>
        <AccountButton />
      </TopBar>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Projects"
          className="flex w-[260px] shrink-0 flex-col gap-1.5 border-r border-line bg-sidebar px-4 py-5"
        >
          <button
            type="button"
            onClick={onClear}
            className={`mb-4.5 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-button border-0 bg-gold-tint type-body font-semibold text-gold ${focusRing}`}
          >
            <PlusIcon /> Project ថ្មី
          </button>
          <p className="mb-1.5 ml-2 text-[12px] font-semibold text-text-4">Projects ថ្មីៗ</p>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {recent.length === 0 && (
              <p className="px-3 type-hint text-text-4">មិនទាន់មាន project ទេ។</p>
            )}
            {recent.map((project) => (
              <button
                key={project.name}
                type="button"
                onClick={() => onOpenProject(project)}
                className={`block w-full cursor-pointer rounded-field border-0 px-3 py-2.5 text-left hover:bg-field ${
                  chosen && stem(chosen.name) === project.name ? 'bg-field' : 'bg-transparent'
                } ${focusRing}`}
              >
                <span className="block truncate text-[14px] font-semibold text-text">{project.name}</span>
                <span className="block text-[12px] text-text-3">
                  {relativeDay(project.created)} · {khmerNumber(project.clips)} clips
                </span>
              </button>
            ))}
          </div>
          <div className="mt-auto border-t border-line px-2 pt-3">
            <p className="text-[12px] text-text-4">Folder រក្សាទុក</p>
            <p className="mt-0.5 text-[12px] break-all text-text-2">{health?.output_dir ?? '…'}</p>
          </div>
        </nav>

        {/* TopBar នៅក្រៅផ្ទៃដែល scroll — ប៊ូតុង window មិនរមូរបាត់. គ្មាន padding ខាងក្រោម:
            Chromium គណនា `sticky bottom-0` របស់ footer ពីគែម content ដូច្នេះ pb-10
            ធ្លាប់ធ្វើឲ្យ footer អណ្តែតខ្ពស់ពីបាត 40px ហើយមាតិការមូរនៅពីក្រោមវា */}
        <main className="min-w-0 flex-1 overflow-y-auto px-8 pt-10 [scrollbar-gutter:stable]">
          <div className="mx-auto flex max-w-[760px] flex-col gap-6">
            {error && (
              <div className="flex items-center gap-3 rounded-[12px] bg-card px-4 py-3">
                <span className={`flex-1 type-label ${connected ? 'text-danger' : 'text-text-3'}`}>{error}</span>
                {!connected && (
                  <Button size="sm" onClick={onRetry}>
                    Retry
                  </Button>
                )}
              </div>
            )}

            <div>
              <h1 className="type-page">Project ថ្មី</h1>
              <p className="mt-1.5 type-body-lg text-text-3">
                ទាញវីដេអូវែងចូល ហើយ AI នឹងរក clips ល្អបំផុតជូនអ្នក។ វីដេអូនៅលើកុំព្យូទ័ររបស់អ្នកជានិច្ច។
              </p>
              {/* ឧបករណ៍ដែលជ្រើសនៅ Home — design មិនបង្ហាញវាទេ តែបើគ្មាន វាមើលមិនឃើញ */}
              <p className="mt-2 type-label text-text-3">
                ឧបករណ៍ <span className="font-semibold text-text">{preset.title}</span>
                {flagsOf(preset) && <span className="text-text-4"> · {flagsOf(preset)}</span>}
                <button
                  type="button"
                  onClick={onHome}
                  className="ml-2 cursor-pointer border-0 bg-transparent p-0 type-label text-gold hover:underline"
                >
                  ប្ដូរ
                </button>
              </p>
            </div>

            <div
              onDragOver={(event) => {
                event.preventDefault()
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={drop}
              // #141821 ប្រើតែលើ drop zone (6× ក្នុង screens) ហើយមិនមានក្នុង TOKENS.md
              className={`flex flex-col items-center gap-2.5 rounded-[16px] border-2 border-dashed px-6 py-11 text-center ${
                over || dropOver ? 'border-gold bg-gold-tint' : 'border-raised-3 bg-[#141821]'
              }`}
            >
              {chosen ? (
                <>
                  <span className="inline-flex size-12 items-center justify-center rounded-full bg-gold text-on-gold">
                    <CheckIcon />
                  </span>
                  <p className="mt-1.5 type-section break-all">{chosen.name}</p>
                  <p className="type-hint break-all text-text-4">{chosen.path || 'project ពី CLI — គ្មាន path វីដេអូដើម'}</p>
                </>
              ) : (
                <>
                  <span className="text-gold">
                    <UploadIcon />
                  </span>
                  <p className="mt-1.5 text-[20px] font-bold">ទាញឯកសារវីដេអូមកទីនេះ</p>
                  <p className="type-body text-text-3">MP4, MOV, MKV ឬ MP3 · ទម្រង់ណាដែល FFmpeg អានបាន</p>
                </>
              )}
              <button
                type="button"
                onClick={pick}
                className={`mt-2.5 min-h-11 cursor-pointer rounded-button border-0 bg-raised-2 px-5 type-body font-semibold text-text hover:bg-raised-3 ${focusRing}`}
              >
                {chosen ? 'ជ្រើសឯកសារផ្សេង' : 'ជ្រើសឯកសារពីកុំព្យូទ័រ'}
              </button>
              {note && <p className="max-w-[560px] type-hint text-warn-text">{note}</p>}
            </div>

            <div className="flex items-center gap-3 text-[13px] text-text-4">
              <span className="h-px flex-auto bg-line" />ឬ<span className="h-px flex-auto bg-line" />
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="video-path" className="type-body font-semibold">
                បិទភ្ជាប់ផ្លូវឯកសារ (path)
              </label>
              <div className="flex gap-2">
                <TextField
                  id="video-path"
                  ref={pathInput}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && applyPath()}
                  placeholder="D:\videos\podcast.mp4"
                  spellCheck={false}
                  className="min-w-0 flex-1"
                />
                <Button onClick={applyPath} disabled={!typed.trim()}>
                  ប្រើផ្លូវនេះ
                </Button>
              </div>
              {videos.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 type-hint text-text-4">វីដេអូគំរូ (samples/):</span>
                  {videos.map((video) => (
                    <button
                      key={video.path}
                      type="button"
                      onClick={() => onChoose(video)}
                      className={`min-h-8 cursor-pointer rounded-full border-0 px-3 type-hint ${
                        chosen?.path === video.path ? 'bg-segment text-bg font-semibold' : 'bg-raised text-text-2 hover:bg-raised-2'
                      } ${focusRing}`}
                    >
                      {video.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field legend="ភាសាក្នុងវីដេអូ" hint="ខ្មែរ · PHASE 2 — ឥឡូវ English ប៉ុណ្ណោះ">
                <Segmented
                  label="ភាសាក្នុងវីដេអូ"
                  tone="gold"
                  size="sm"
                  value="en"
                  onChange={() => {}}
                  options={phased([
                    ['km', 'ខ្មែរ', true],
                    ['en', 'English', false],
                    ['mix', 'លាយពីរភាសា', true],
                  ])}
                />
              </Field>
              <Field legend="Subtitles" hint="ខ្មែរ · PHASE 2 — subtitles ជាភាសាដូចសំឡេង">
                <Segmented
                  label="Subtitles"
                  tone="gold"
                  size="sm"
                  value="en"
                  onChange={() => {}}
                  options={phased([
                    ['en', 'English', false],
                    ['km', 'ខ្មែរ', true],
                    ['km-en', 'ខ្មែរ + English', true],
                  ])}
                />
              </Field>
              <Field legend="ចំនួន Clips">
                <Segmented
                  label="ចំនួន Clips"
                  tone="gold"
                  size="sm"
                  value={String(maxClips)}
                  onChange={(value) => onMaxClips(Number(value))}
                  options={[5, 10, 15].map((count) => ({ value: String(count), label: khmerNumber(count) }))}
                />
              </Field>
              <Field legend="ប្រវែង Clip" hint="AI ជ្រើសប្រវែង 15–90 វិ ដោយខ្លួនឯង — មិនទាន់កំណត់បាន">
                <Segmented
                  label="ប្រវែង Clip"
                  tone="gold"
                  size="sm"
                  value=""
                  onChange={() => {}}
                  options={phased([
                    ['15-30', '15–30 វិ', true],
                    ['30-60', '30–60 វិ', true],
                    ['60-90', '60–90 វិ', true],
                  ])}
                />
              </Field>
            </div>

            {/* sticky: ប៊ូតុងចាប់ផ្តើមតែងមើលឃើញ — ជាមួយ chip វីដេអូគំរូ និងបន្ទាត់ឧបករណ៍
                វាធ្លាក់ក្រោមអេក្រង់នៅ 1440×900 (បញ្ហាដូច launch bar ចាស់ធ្លាប់ដោះស្រាយ) */}
            <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-4 border-t border-line bg-bg/95 px-4 py-4 backdrop-blur">
              <p className="flex items-center gap-2 text-[13px] text-text-3">
                <CpuIcon />
                កុំព្យូទ័រនេះ: {health ? (health.device === 'cuda' ? 'NVIDIA GPU' : 'CPU') : '…'} · {pack.label} (
                {pack.options.whisper_model} + {pack.options.model})
              </p>
              <div className="flex items-center gap-2.5">
                {clips > 0 && (
                  <Button onClick={onReview}>មើល {khmerNumber(clips)} clips</Button>
                )}
                <button
                  type="button"
                  onClick={busy ? onShowJob : onStart}
                  disabled={!ready && !busy}
                  title={!chosen ? 'ជ្រើសវីដេអូមុន' : !chosen.path ? 'គ្មាន path វីដេអូដើម' : undefined}
                  className={`inline-flex min-h-13 cursor-pointer items-center gap-2.5 rounded-[12px] border-0 bg-gold px-7 text-[16px] font-bold text-on-gold disabled:cursor-default disabled:opacity-40 ${focusRing}`}
                >
                  {busy ? 'មើលការដំណើរការ' : 'ចាប់ផ្ដើមបង្កើត Clips'}
                  <ArrowRightIcon size={16} />
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>

    </div>
  )
}

/** fieldset មួយក្នុងក្រឡាចត្រង្គ (radius 12, ផ្ទៃ card, padding 14/16) ដូច Main.html.
 *  legend នៅពាក់កណ្តាលលើគែមកាត — ឥរិយាបថរបស់ fieldset ក្នុង Chromium ដែល design ក៏មាន.
 *  `hint` ពន្យល់ជម្រើសដែលបិទ. */
function Field({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 min-w-0 rounded-[12px] border-0 bg-card px-4 py-3.5">
      <legend className="px-1.5 text-[13px] font-semibold text-text-2">{legend}</legend>
      {children}
      {hint && <p className="mt-2 type-hint text-text-4">{hint}</p>}
    </fieldset>
  )
}

/** [value, label, disabled] -> Segment — ជម្រើសដែល pipeline មិនទាន់មាន ត្រូវបិទ. */
function phased(rows: [string, string, boolean][]): Segment<string>[] {
  return rows.map(([value, label, disabled]) => ({ value, label, disabled }))
}

/** "podcast.mp4" -> "podcast" (ឈ្មោះ folder ក្នុង output/). */
function stem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}
