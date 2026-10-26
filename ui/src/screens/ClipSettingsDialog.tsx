import { useEffect, useState, type ReactNode } from 'react'
import { api, sourceFrameUrl, type Health, type Video, type VideoFormat } from '../api'
import { presetOf, STYLE_PRESETS, type CaptionStyle } from '../captionStyle'
import type { PackChoice } from '../defaults'
import { PACKS, fits, type Pack } from '../packs'
import { type Preset } from '../presets'
import { Button, Chip, TextField } from '../kit/controls'
import { Dialog } from '../kit/Dialog'
import { ArrowRightIcon, CpuIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { clock, khmerNumber } from './khmer'
import { PresetCard } from './PresetCard'
import { Illustration, Source } from './VideoPicker'

type Mode = 'clip' | 'full'

/** Dialog "វីដេអូវែង → clips ខ្លី" — ជំនួសទំព័រ Import (អ្នកអភិវឌ្ឍសម្រេច 2026-10-23).
 *
 *  ជំហានពីរក្នុង dialog តែមួយ: (១) គ្មានវីដេអូ -> ជ្រើសវីដេអូ; (២) មានវីដេអូ -> ការកំណត់ រចនាតាម
 *  OpusClip (ភាសា, tab "AI កាត់ clips / មិនកាត់", AI model · ប្រវែង · ចំនួន, genre, ពេលជាក់លាក់,
 *  ចន្លោះពេល, Quick presets). ប៊ូតុងចាប់ផ្តើមនៅ footer របស់ Dialog ដែលមិនរំកិល.
 *
 *  រត់ពិតឥឡូវ: AI model, ចំនួន clips, style caption. គូរ តែមិនទាន់រត់ (ជំហានបន្ទាប់ — flag ថ្មីក្នុង
 *  pipeline): ប្រវែង clip, genre, ពេលជាក់លាក់, ចន្លោះពេល. ភាសា/subtitles ខ្មែរ = Phase 2.
 *  "មិនកាត់" = វីដេអូទាំងមូលបញ្ឈរ = AI Reframe (App បិទ dialog នេះ ហើយបើក dialog Reframe). */
export function ClipSettingsDialog({
  videos,
  chosen,
  preset,
  pack,
  packChoice,
  autoPack,
  vramMb,
  onPackChoice,
  captionStyle,
  onCaptionStyle,
  savedAt,
  onSaveDefaults,
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
  onReframe,
  onReview,
  onRetry,
  onShowJob,
  onClose,
}: {
  videos: Video[] // samples/
  chosen: Video | null
  preset: Preset
  pack: Pack // pack ដែល job នឹងរត់ពិត (Auto ត្រូវបានដោះរួច)
  packChoice: PackChoice
  autoPack: Pack // Auto = pack នេះ (BEST FIT)
  vramMb: number | null | undefined // undefined = /env មិនទាន់ឆ្លើយ; null = គ្មាន GPU
  onPackChoice: (choice: PackChoice) => void
  captionStyle: CaptionStyle
  onCaptionStyle: (style: CaptionStyle) => void
  savedAt: number | null
  onSaveDefaults: () => boolean
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
  onClear: () => void // "ប្ដូរ": ត្រឡប់ទៅជំហាន ១
  onStart: () => void
  onReframe: () => void // "មិនកាត់": dialog AI Reframe ជាមួយវីដេអូនេះ
  onReview: () => void
  onRetry: () => void
  onShowJob: () => void // job កំពុងរត់: ប៊ូតុងចាប់ផ្តើមនាំទៅមើលវា
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('clip')
  const [saveFailed, setSaveFailed] = useState(false)

  // "720p · 1:09:51 · 29.97 fps" — ffprobe ពិត
  const [probed, setProbed] = useState<{ path: string; format: VideoFormat | null } | null>(null)
  const chosenPath = chosen?.path ?? ''
  useEffect(() => {
    if (!chosenPath) return
    let stale = false
    api
      .probe(chosenPath)
      .then((format) => !stale && setProbed({ path: chosenPath, format }))
      .catch(() => !stale && setProbed({ path: chosenPath, format: null }))
    return () => {
      stale = true
    }
  }, [chosenPath])
  const format = probed?.path === chosenPath ? probed.format : null

  const ready = !!chosen?.path && connected && !busy
  const currentPreset = presetOf(captionStyle)

  const footer = chosen ? (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-[13px] text-text-3">
        <CpuIcon />
        {health ? (health.device === 'cuda' ? 'NVIDIA GPU' : 'CPU') : '…'} · {pack.label} ({pack.options.whisper_model} +{' '}
        {pack.options.model})
      </p>
      <div className="flex items-center gap-2.5">
        {clips > 0 && <Button onClick={onReview}>មើល {khmerNumber(clips)} clips</Button>}
        <button
          type="button"
          onClick={busy ? onShowJob : mode === 'full' ? onReframe : onStart}
          disabled={!ready && !busy}
          title={!chosen.path ? 'គ្មាន path វីដេអូដើម' : undefined}
          className={`inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-[12px] border-0 bg-gold px-6 text-[16px] font-bold text-on-gold disabled:cursor-default disabled:opacity-40 ${focusRing}`}
        >
          {busy ? 'មើលការដំណើរការ' : mode === 'full' ? 'បើក AI Reframe' : 'ចាប់ផ្ដើមបង្កើត Clips'}
          <ArrowRightIcon size={16} />
        </button>
      </div>
    </div>
  ) : undefined

  return (
    <Dialog
      width={chosen ? 780 : 640} // ជំហាន ១ តូចដូចរូប OpusClip; ការកំណត់ត្រូវការកន្លែងច្រើន
      onClose={onClose}
      footer={footer}
      title={
        <span className="flex flex-wrap items-center gap-2">
          Long to Short
          {/* chip តែពេល preset ផ្សេង (ឧ. Caption Studio) — Long to Short ខ្លួនឯងគ្មានចាំបាច់ទេ */}
          {preset.id !== 'shorts' && <Chip tone="gold">{preset.title}</Chip>}
        </span>
      }
    >
      {error && (
        <div className="flex items-center gap-3 rounded-[12px] bg-raised px-4 py-3">
          <span className={`flex-1 type-label ${connected ? 'text-danger' : 'text-text-3'}`}>{error}</span>
          {!connected && (
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}

      {!chosen ? (
        <>
          <p className="-mt-2.5 type-body-lg text-text-3">
            AI រក hook និង highlight ហើយបម្លែងវីដេអូរបស់អ្នកជា clips ខ្លីសម្រាប់ TikTok, Reels និង Shorts។
          </p>
          {/* វីដេអូគំរូធំជាងគេ = វីដេអូវែង (podcast) ដែលឧបករណ៍នេះសម្រាប់ */}
          <Illustration video={[...videos].sort((a, b) => b.mb - a.mb)[0] ?? null} />
          <Source videos={videos} dropOver={dropOver} onChoose={onChoose} onChoosePath={onChoosePath} />
        </>
      ) : (
        <div className="flex flex-col gap-7">
          {/* វីដេអូដែលជ្រើស (រូប OpusClip: រូបតូច + 1080p) */}
          <div className="flex flex-wrap items-center gap-5">
            <Frame chosen={chosen} format={format} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <p className="truncate type-body-lg font-semibold">{chosen.name}</p>
              <p className="type-hint text-text-3">
                {[format?.seconds ? clock(format.seconds) : null, format?.fps ? `${format.fps} fps` : null]
                  .filter(Boolean)
                  .join(' · ') || '…'}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 type-body text-text-3">
                <InlineSelect
                  label="ភាសាសំឡេង"
                  value="en"
                  onChange={() => {}}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'km', label: 'ខ្មែរ · PHASE 2', disabled: true },
                    { value: 'mix', label: 'លាយពីរភាសា · PHASE 2', disabled: true },
                  ]}
                />
                <InlineSelect
                  label="Subtitles"
                  value="en"
                  onChange={() => {}}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'km', label: 'ខ្មែរ · PHASE 2', disabled: true },
                    { value: 'km-en', label: 'ខ្មែរ + English · PHASE 2', disabled: true },
                  ]}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={onClear}
              className={`min-h-9 cursor-pointer self-start rounded-field border-0 bg-raised-2 px-4 type-label font-semibold text-text hover:bg-raised-3 ${focusRing}`}
            >
              ប្ដូរវីដេអូ
            </button>
          </div>

          {/* tab ដូចរូប: "AI clipping / Don't clip" — អក្សរ គ្មានផ្ទៃ */}
          <div role="tablist" aria-label="របៀប" className="flex gap-8">
            {(
              [
                ['clip', 'AI កាត់ clips'],
                ['full', 'មិនកាត់ (វីដេអូទាំងមូល)'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={`cursor-pointer border-0 bg-transparent p-0 text-[17px] ${
                  mode === value ? 'font-bold text-text' : 'text-text-4 hover:text-text-3'
                } ${focusRing}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'full' ? (
            <div className="flex flex-col gap-2 rounded-card bg-raised p-5">
              <p className="type-body-lg font-semibold">បម្លែងវីដេអូទាំងមូលទៅជាបញ្ឈរ</p>
              <p className="type-body text-text-3">
                មិនជ្រើស clip ទេ — AI តាមដានមុខ/មនុស្ស ហើយដាក់ subtitles លើវីដេអូទាំងមូល។ ចុច "បើក AI Reframe"
                ខាងក្រោម ដើម្បីជ្រើសទំហំ និង layout។
              </p>
            </div>
          ) : (
            <>
              {/* ការកំណត់មួយជួរ (រូប: "Clip model · Clip length · Auto headline") */}
              <div className="flex flex-wrap items-center gap-x-9 gap-y-4 type-body text-text-3">
                <InlineSelect
                  label="AI model"
                  value={packChoice}
                  onChange={(value) => onPackChoice(value as PackChoice)}
                  title={`Auto = ${autoPack.label} · ${pack.options.whisper_model} + ${pack.options.model}`}
                  options={[
                    { value: 'auto', label: `Auto (${autoPack.label})` },
                    ...PACKS.map((item) => ({
                      value: item.id,
                      label: item.label,
                      // Pro ត្រូវការ VRAM 10 GB — បិទពេលមិនគ្រប់ (មុន /env ឆ្លើយ មិនទាន់ដឹង -> បើក)
                      disabled: vramMb !== undefined && !fits(item, vramMb),
                    })),
                  ]}
                />
                <InlineSelect
                  label="ប្រវែង clip"
                  value="auto"
                  onChange={() => {}}
                  title="ជំហានបន្ទាប់: --min-sec / --max-sec"
                  options={[
                    { value: 'auto', label: 'Auto (15–90 វិ)' },
                    { value: '15-30', label: '15–30 វិ · ជំហានបន្ទាប់', disabled: true },
                    { value: '30-60', label: '30–60 វិ · ជំហានបន្ទាប់', disabled: true },
                    { value: '60-90', label: '60–90 វិ · ជំហានបន្ទាប់', disabled: true },
                  ]}
                />
                <InlineSelect
                  label="ចំនួន clips"
                  value={String(maxClips)}
                  onChange={(value) => onMaxClips(Number(value))}
                  options={[5, 10, 15].map((count) => ({ value: String(count), label: khmerNumber(count) }))}
                />
              </div>

              {/* "AI analysis": planner វិភាគ shot នីមួយៗ — នេះជាហេតុដែល Podcast និង Interview រួមគ្នា */}
              <p className="-mt-3 type-hint text-text-4">
                Layout: AI វិភាគ shot នីមួយៗ — មុខម្នាក់ → Fill, មនុស្ស ២–៤ → Split / ៣ / ៤, slide → Fit, គ្មានមុខ →
                តាមមនុស្ស សត្វ ឬចលនា
              </p>

              <Genres />

              <Block title="រកពេលជាក់លាក់" note="ជំហានបន្ទាប់">
                <TextField
                  disabled
                  placeholder="💡 ឧ. រកពេលដែលយើងនិយាយពី AI agents"
                  aria-label="រកពេលជាក់លាក់"
                  className="w-full disabled:opacity-60"
                />
              </Block>

              <Block title="ចន្លោះពេលដែល AI រក" note="ជំហានបន្ទាប់">
                <Timeframe seconds={format?.seconds ?? null} />
              </Block>

              <Block title="Quick presets · Caption">
                {/* preset = style caption ពិតពេល render (--caption-color, --caption-case ...) */}
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                  {STYLE_PRESETS.map((item) => (
                    <PresetCard
                      key={item.id}
                      preset={item}
                      on={item.id === currentPreset}
                      onPick={() => item.style && onCaptionStyle({ ...captionStyle, ...item.style })}
                    />
                  ))}
                </div>
                <p className="type-hint text-text-4">
                  Style នេះដុតចូល clips ពេល render · កែលម្អិតបន្តនៅ Subtitles
                  {currentPreset === null && ' · style ផ្ទាល់ខ្លួន'}
                </p>
              </Block>

              {/* "Save settings above as default" + "Last edited" ក្នុងរូប */}
              <div className="flex flex-col items-center gap-2.5">
                <Button
                  onClick={() => setSaveFailed(!onSaveDefaults())}
                  title="AI model · ចំនួន Clips · style caption — ប្រើពេលបើក app លើកក្រោយ"
                >
                  រក្សាទុកការកំណត់ខាងលើជាលំនាំដើម
                </Button>
                <span className="type-hint text-text-4">
                  {saveFailed
                    ? 'រក្សាទុកមិនបាន (storage បិទ)'
                    : savedAt
                      ? `រក្សាទុកចុងក្រោយ: ${new Date(savedAt).toLocaleString()}`
                      : 'មិនទាន់រក្សាទុក · ប្រើលំនាំដើមរបស់ app'}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

/** រូបពិតពីវីដេអូ + ស្លាក "720p" (ដូចរូប OpusClip). */
function Frame({ chosen, format }: { chosen: Video; format: VideoFormat | null }) {
  const lines = format?.width && format?.height ? `${Math.min(format.width, format.height)}p` : null
  return (
    <div className="relative aspect-video w-[240px] shrink-0 overflow-hidden rounded-card bg-raised-2">
      {chosen.path ? (
        <img
          src={sourceFrameUrl(chosen.path, format?.seconds ? Math.min(60, format.seconds * 0.1) : 5)}
          alt=""
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center type-hint text-text-4">គ្មាន path វីដេអូដើម</span>
      )}
      {lines && (
        <span className="absolute top-2 left-2 rounded-[6px] bg-black/65 px-2 py-0.5 text-[12px] font-bold text-white">
          {lines}
        </span>
      )}
    </div>
  )
}

// ---------- ផ្នែកតូចៗ ----------

/** "Clip model ClipAnything ▾" ក្នុងរូប: ស្លាកស្រាល + តម្លៃដិត + ព្រួញ — `<select>` ពិតនៅពីក្រោម
 *  (keyboard និង screen reader ដំណើរការដូច select ធម្មតា). */
function InlineSelect({
  label,
  value,
  onChange,
  options,
  title,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; disabled?: boolean }[]
  title?: string
}) {
  return (
    <label className="inline-flex items-center gap-2" title={title}>
      <span>{label}</span>
      <span className="relative inline-flex items-center">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          // field-sizing: ទទឹងតាមតម្លៃដែលជ្រើស មិនមែនជម្រើសវែងបំផុត ("ខ្មែរ · PHASE 2")
          className={`cursor-pointer appearance-none rounded-field border-0 bg-transparent py-1 pr-6 pl-1 font-bold text-text [field-sizing:content] hover:bg-field ${focusRing}`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled} className="bg-raised text-text">
              {option.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className="pointer-events-none absolute right-1 text-text-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </span>
    </label>
  )
}

/** ផ្នែកមួយ: ចំណងជើងស្រាល (+ ស្លាក "ជំហានបន្ទាប់" បើវាមិនទាន់រត់). */
function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 type-body text-text-3">
        {title}
        {note && (
          <span className="rounded-[6px] bg-raised-2 px-2 py-0.5 text-[11.5px] font-semibold text-text-3">{note}</span>
        )}
      </p>
      {children}
    </div>
  )
}

/** genre ដូចរូប. "ឲ្យ AI រកឃើញ" ជាអ្វីដែល pipeline ធ្វើឥឡូវ; genre ផ្សេងចូល prompt LLM ជំហានបន្ទាប់. */
function Genres() {
  const genres = [
    ['🎙️', 'Podcast'],
    ['🏡', 'ជីវិតប្រចាំថ្ងៃ'],
    ['🏅', 'កីឡា'],
    ['📈', 'Marketing & Webinar'],
    ['🎭', 'កម្សាន្ត'],
    ['📰', 'ព័ត៌មាន'],
    ['📚', 'អប់រំ'],
  ]
  return (
    <Block title="ជ្រើសប្រភេទដែលត្រូវនឹងវីដេអូ ដើម្បីលទ្ធផលល្អជាង" note="ជំហានបន្ទាប់">
      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          aria-pressed="true"
          className={`inline-flex min-h-11 cursor-default items-center gap-2 rounded-button border-0 bg-segment px-4 type-body font-semibold text-bg ${focusRing}`}
        >
          ✓ ឲ្យ AI រកឃើញ
        </button>
        {genres.map(([icon, name]) => (
          <button
            key={name}
            type="button"
            disabled
            title="ជំហានបន្ទាប់: genre ចូល prompt របស់ AI"
            className="inline-flex min-h-11 cursor-default items-center gap-2 rounded-button border-0 bg-raised px-4 type-body text-text-3 opacity-60"
          >
            <span aria-hidden="true">{icon}</span>
            {name}
          </button>
        ))}
      </div>
    </Block>
  )
}

/** ចន្លោះពេល (រូប: "Processing timeframe" ដៃពីរ + 0:00:00 / 0:01:42) — គូរពេញវីដេអូ, បិទ. */
function Timeframe({ seconds }: { seconds: number | null }) {
  const end = seconds ? fullClock(seconds) : '—'
  return (
    <div className="flex flex-col gap-3 opacity-60" aria-disabled="true">
      <div className="relative h-2 rounded-full bg-raised-2">
        <span className="absolute inset-y-0 right-0 left-0 rounded-full bg-raised-4" />
        <span className="absolute top-1/2 left-0 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-raised-4 bg-bg" />
        <span className="absolute top-1/2 right-0 size-5 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-raised-4 bg-bg" />
      </div>
      <div className="flex justify-between">
        <span className="rounded-field bg-field px-4 py-2 type-body text-text-3 tabular-nums">0:00:00</span>
        <span className="rounded-field bg-field px-4 py-2 type-body text-text-3 tabular-nums">{end}</span>
      </div>
    </div>
  )
}

/** 102 -> "0:01:42" (ម៉ោងជានិច្ច ដូចរូប). */
function fullClock(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
