import { useEffect, useState, type ReactNode } from 'react'
import { api, sourceFrameUrl, type Health, type Video, type VideoFormat } from '../api'
import { presetOf, STYLE_PRESETS, type CaptionStyle } from '../captionStyle'
import { captionTextStyle } from '../captionLook'
import { loadDefaults, type PackChoice } from '../defaults'
import { PACKS, fits, type Pack } from '../packs'
import { type Preset } from '../presets'
import { Button, Chip, Switch, TextField } from '../kit/controls'
import { ArrowRightIcon, CpuIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { useT } from '../i18n'
import { stepSeconds } from '../eta'
import { ASPECTS, type Aspect } from './aspects'
import { clock, khmerNumber } from './khmer'
import { LANGUAGES } from './languages'
import { AspectGlyph, MenuButton, MenuItem } from './Menu'
import { PresetCard } from './PresetCard'

type Mode = 'clip' | 'full'

/** ទំព័រ "វីដេអូវែង → clips ខ្លី" ក្នុងផ្ទៃមាតិកា (sidebar នៅដដែល) — ធ្លាប់ជា dialog (អ្នកអភិវឌ្ឍសម្រេច).
 *
 *  ការជ្រើសវីដេអូនៅក្នុង `ClipPickDialog`; ទំព័រនេះបើកក្រោយមានវីដេអូ: រូបតូច + ការកំណត់ រចនាតាម
 *  OpusClip (ភាសា, tab "AI កាត់ clips / មិនកាត់", AI model · ប្រវែង · ចំនួន, genre, ពេលជាក់លាក់,
 *  ចន្លោះពេល, Quick presets). ប៊ូតុងចាប់ផ្តើមនៅ footer ដែលមិនរំកិល.
 *
 *  រត់ពិតឥឡូវ: AI model, ចំនួន clips, style caption, ចន្លោះពេល. គូរ តែមិនទាន់រត់ (ជំហានបន្ទាប់ — flag ថ្មីក្នុង
 *  pipeline): ប្រវែង clip, genre, ពេលជាក់លាក់. ភាសា/subtitles ខ្មែរ = Phase 2.
 *  "មិនកាត់" = វីដេអូទាំងមូលបញ្ឈរ = AI Reframe (App បិទ dialog នេះ ហើយបើក dialog Reframe). */
export function ClipSettingsPage({
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
  queueing,
  clips,
  maxClips,
  onMaxClips,
  onClear,
  onStart,
  onReframe,
  onReview,
  onRetry,
  onShowJob,
  onEditTemplate,
  onClose,
}: {
  chosen: Video
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
  queueing: boolean // មាន job រត់ ឬជួរមិនទទេ: Start ដាក់វីដេអូនេះក្នុងជួរ
  clips: number // clip ដែលវីដេអូដែលជ្រើសមានរួចហើយ
  maxClips: number
  onMaxClips: (count: number) => void
  onClear: () => void // "ប្ដូរ": បើកផ្ទាំងជ្រើស file
  onStart: (timeframe: string | undefined, aiSeconds: number | undefined, language: string, aspect: Aspect) => void
  // "មិនកាត់": dialog AI Reframe ជាមួយវីដេអូនេះ + style ខាងលើ (range = null ពេលយកទាំងមូល)
  onReframe: (range: { timeframe: string; seconds: number } | null) => void
  onReview: () => void
  onRetry: () => void
  onShowJob: () => void // job កំពុងរត់: ប៊ូតុងចាប់ផ្តើមនាំទៅមើលវា
  onEditTemplate: () => void // My templates → Edit: Settings → Default project
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('clip')
  const [saveFailed, setSaveFailed] = useState(false)

  // "720p · 1:09:51 · 29.97 fps" — ffprobe ពិត
  const [probed, setProbed] = useState<{ path: string; format: VideoFormat | null } | null>(null)
  const chosenPath = chosen.path
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

  // ចន្លោះពេល: null = វីដេអូទាំងមូល (មិនទាន់ប៉ះ slider). ទំព័រចាប់ផ្តើមថ្មីរាល់ពេលប្តូរវីដេអូ.
  const [range, setRange] = useState<[number, number] | null>(null)
  const seconds = format?.seconds ?? null
  const [rangeStart, rangeEnd] = range ?? [0, seconds ?? 0]
  // ប្រវែងវីដេអូមិនទាន់ដឹង = មិនទាន់អាចវិនិច្ឆ័យ (កុំបិទប៊ូតុង)
  const tooShort = seconds !== null && rangeEnd - rangeStart < MIN_CLIP_RANGE
  const whole = seconds === null || (rangeStart === 0 && rangeEnd === seconds)

  const [language, setLanguage] = useState('auto')
  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [styleTab, setStyleTab] = useState<'presets' | 'mine'>('presets')
  const template = loadDefaults().captionStyle // អានរាល់ render: Save និង Settings សរសេរទៅកន្លែងនេះ

  const t = useT()
  const minutes =
    seconds === null
      ? null
      : Math.max(1, Math.round(totalSeconds(pack, health, seconds, maxClips, whole ? undefined : rangeEnd - rangeStart) / 60))
  const estimate = minutes === null ? null : `~${t(khmerNumber(minutes), String(minutes))} ${t('នាទី', 'min')}`
  const ready = !!chosen.path && connected && (mode === 'full' || !tooShort)
  const currentPreset = presetOf(captionStyle)

  const timeframeBlock = (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 type-body text-text-3">
        {t('ចន្លោះពេល', 'Processing timeframe')}
        {/* "Credit saver" ក្នុងរូប: app នេះគ្មាន credit — អ្វីដែលចំណេញពិតគឺពេល AI ឬ render */}
        <span className="rounded-[6px] bg-ok-bg px-2 py-0.5 text-[11.5px] font-semibold text-ok">
          {t('ចំណេញពេល', 'Time saver')}
        </span>
      </p>
      {mode === 'clip' && tooShort && (
        <p className="type-body text-warn">
          {t(
            'ខ្លីជាង ១ នាទី: អាចដាក់ subtitles និង reframe វីដេអូបាន តែមិនអាចកាត់ clips ទេ។',
            'With less than 1 min, the video can be captioned and reframed, but not clipped.',
          )}
        </p>
      )}
      <Timeframe seconds={seconds} start={rangeStart} end={rangeEnd} onChange={(a, b) => setRange([a, b])} />
    </div>
  )

  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-[13px] text-text-3">
        <CpuIcon />
        {health ? (health.device === 'cuda' ? 'NVIDIA GPU' : 'CPU') : '…'} · {pack.label} ({pack.options.whisper_model} +{' '}
        {pack.options.model})
      </p>
      <div className="flex items-center gap-2.5">
        {clips > 0 && <Button onClick={onReview}>មើល {khmerNumber(clips)} clips</Button>}
        {busy && <Button onClick={onShowJob}>មើលការដំណើរការ</Button>}
        <button
          type="button"
          onClick={
            mode === 'full'
                ? () => onReframe(whole ? null : { timeframe: `${rangeStart},${rangeEnd}`, seconds: rangeEnd - rangeStart })
                : () =>
                    // "all" មិនមែនគ្មាន flag: ជម្រើសពីចន្លោះមុនត្រូវជំនួសដោយវីដេអូទាំងមូល
                    onStart(
                      seconds === null ? undefined : whole ? 'all' : `${rangeStart},${rangeEnd}`,
                      whole ? undefined : rangeEnd - rangeStart,
                      language,
                      aspect,
                    )
          }
          disabled={!ready}
          title={
            !chosen.path
              ? 'គ្មាន path វីដេអូដើម'
              : tooShort && mode === 'clip'
                ? t('ត្រូវការយ៉ាងតិច ១ នាទី ដើម្បីកាត់ clips', 'Clipping needs at least 1 minute')
                : undefined
          }
          className={`inline-flex min-h-12 cursor-pointer items-center gap-2.5 rounded-[12px] border-0 bg-gold px-6 text-[16px] font-bold text-on-gold disabled:cursor-default disabled:opacity-40 ${focusRing}`}
        >
          {mode === 'full' ? 'បើក AI Reframe' : queueing ? 'បន្ថែមក្នុងជួរ' : 'ចាប់ផ្ដើមបង្កើត Clips'}
          <ArrowRightIcon size={16} />
        </button>
      </div>
    </div>
  )

  return (
    <div data-settings-page className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      {/* footer នៅក្រៅផ្ទៃរំកិល ដូច្នេះប៊ូតុងចាប់ផ្តើមនៅលើអេក្រង់ជានិច្ច */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 [scrollbar-gutter:stable]">
        <div className="mx-auto flex w-full max-w-[780px] flex-col gap-4.5">
          <button
            type="button"
            onClick={onClose}
            className={`cursor-pointer self-start rounded-field border-0 bg-transparent px-1 type-body text-text-3 hover:text-text ${focusRing}`}
          >
            ‹ {t('ត្រឡប់', 'Back')}
          </button>
          <h1 className="flex flex-wrap items-center gap-2 type-dialog">
            Long to Short
            {/* chip តែពេល preset ផ្សេង (ឧ. Caption Studio) — Long to Short ខ្លួនឯងគ្មានចាំបាច់ទេ */}
            {preset.id !== 'shorts' && <Chip tone="gold">{preset.title}</Chip>}
          </h1>
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

        <div className="flex flex-col gap-7">
          {/* វីដេអូដែលជ្រើស (រូប OpusClip: រូបតូច + 1080p) */}
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 type-body text-text-3">
              <InlineSelect
                label={t('ភាសាសំឡេង:', 'Speech language:')}
                value={language}
                onChange={setLanguage}
                options={[
                  { value: 'auto', label: 'Auto' },
                  ...LANGUAGES.map(([value, label]) => ({ value, label })),
                  { value: 'km', label: 'ខ្មែរ · PHASE 2', disabled: true },
                ]}
              />
              {/* ដូចរូប តែមិនទាន់រត់: pipeline មិនទាន់អាន .srt ជំនួស Whisper */}
              <button
                type="button"
                disabled
                title={t('មិនទាន់បានធ្វើ: pipeline មិនទាន់អាន .srt', 'Not built yet: the pipeline cannot read an .srt')}
                className="cursor-default border-0 bg-transparent p-0 text-inherit underline opacity-60"
              >
                {t('Upload .SRT (ជម្រើស)', 'Upload .SRT (optional)')}
              </button>
              {/* "Credit usage" ក្នុងរូប: app នេះគ្មាន credit — អ្វីដែលអ្នកចំណាយគឺពេល */}
              <span
                title={t(
                  'ប៉ាន់ពីល្បឿនដែលបានវាស់ បើគ្មាន cache · AI អាចយឺតជាងនេះពេល RAM ខ្វះ',
                  'Estimated from measured speeds, with nothing cached · AI can be slower when RAM is short',
                )}
              >
                {t('ពេលប៉ាន់ស្មាន:', 'Estimated time:')}{' '}
                <span className="font-bold text-text">{estimate ?? '…'}</span>
              </span>
            </div>
            <div className="relative">
              <Frame chosen={chosen} format={format} />
              <button
                type="button"
                onClick={onClear}
                className={`absolute top-2 right-2 min-h-7 cursor-pointer rounded-[6px] border-0 bg-black/65 px-2.5 text-[12px] font-semibold text-white hover:bg-black/85 ${focusRing}`}
              >
                {t('ប្ដូរវីដេអូ', 'Change video')}
              </button>
            </div>
            <p className="max-w-full truncate type-hint text-text-3">
              {[chosen.name, format?.seconds ? clock(format.seconds) : null, format?.fps ? `${format.fps} fps` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>

          {/* tab ដូចរូប: "AI clipping / Don't clip" — tab សកម្មភ្ជាប់នឹងផ្ទាំងការកំណត់ខាងក្រោម */}
          <div>
          <div role="tablist" aria-label={t('របៀប', 'Mode')} className="flex">
            {(
              [
                ['clip', t('AI កាត់ clips', 'AI clipping')],
                ['full', t('មិនកាត់', "Don't clip")],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={`min-h-11 cursor-pointer rounded-t-[12px] border-0 px-5 type-body ${
                  mode === value ? 'bg-raised font-bold text-text' : 'bg-transparent text-text-4 hover:text-text-3'
                } ${focusRing}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'full' ? (
            <div className="flex flex-col gap-6 rounded-card rounded-tl-none bg-raised p-5">
              <p className="type-body text-text-3">
                {t(
                  'យើងនឹងមិនកាត់វីដេអូរបស់អ្នកទេ ហើយរក្សាប្រវែងដើមរបស់វា។',
                  'We will not clip your videos and will preserve their original length.',
                )}
              </p>
              {timeframeBlock}
            </div>
          ) : (
            <div className="flex flex-col gap-6 rounded-card rounded-tl-none bg-raised p-5">
              {/* ការកំណត់មួយជួរ (រូប: "Clip model · Clip length · Auto headline") */}
              <div className="flex flex-wrap items-center gap-x-9 gap-y-4 type-body text-text-3">
                <GenreMenu />
                <ClipModelMenu
                  choice={packChoice}
                  autoPack={autoPack}
                  pack={pack}
                  vramMb={vramMb}
                  onChoice={onPackChoice}
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

              {/* ដូចរូប តែមិនទាន់រត់: pipeline គ្មាន flag សម្រាប់ចំណងជើង និងពណ៌; Auto zoom មានតែក្នុង Edit Video */}
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 type-body text-text-3">
                {[
                  t('ចំណងជើងស្វ័យប្រវត្តិ', 'Auto headline'),
                  'Auto zoom',
                  t('កែពណ៌ស្វ័យប្រវត្តិ', 'Auto color correction'),
                ].map((label) => (
                  <span key={label} className="inline-flex items-center gap-2" title={t('ជំហានបន្ទាប់', 'Next step')}>
                    {label}
                    <Switch checked={false} disabled label={label} onChange={() => {}} />
                  </span>
                ))}
              </div>

              <Block title="រកពេលជាក់លាក់" note="ជំហានបន្ទាប់">
                <TextField
                  disabled
                  placeholder="💡 ឧ. រកពេលដែលយើងនិយាយពី AI agents"
                  aria-label="រកពេលជាក់លាក់"
                  className="w-full disabled:opacity-60"
                />
              </Block>

              {timeframeBlock}
            </div>
          )}
          </div>

          {/* tab ទាំងពីរ: "មិនកាត់" ដុត style នេះចូលវីដេអូដូចគ្នា */}
          <>
              {/* tab ដូចរូប: "Quick presets / My templates" (preset = style caption ពិតពេល render) */}
              <div>
                <div role="tablist" aria-label="Caption" className="flex">
                  {(
                    [
                      ['presets', 'Quick presets'],
                      ['mine', 'My templates'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={styleTab === value}
                      onClick={() => setStyleTab(value)}
                      className={`min-h-11 cursor-pointer rounded-t-[12px] border-0 px-5 type-body ${
                        styleTab === value ? 'bg-raised font-bold text-text' : 'bg-transparent text-text-4 hover:text-text-3'
                      } ${focusRing}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {styleTab === 'presets' ? (
                  <div className="flex flex-col gap-4 rounded-card rounded-tl-none bg-raised p-5">
                    <p className="type-body text-text-3">
                      Caption
                      {currentPreset === null && ` · ${t('style ផ្ទាល់ខ្លួន', 'custom style')}`}
                    </p>
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                      {STYLE_PRESETS.map((item) => (
                        <PresetCard
                          key={item.id}
                          preset={item}
                          surface="bg-raised-2"
                          on={item.id === currentPreset}
                          onPick={() => item.style && onCaptionStyle({ ...captionStyle, ...item.style })}
                        />
                      ))}
                    </div>
                    {mode === 'clip' && <AspectMenu aspect={aspect} onAspect={setAspect} />}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-8 rounded-card rounded-tl-none bg-raised p-5">
                    <TemplateCard
                      style={template}
                      on={JSON.stringify(captionStyle) === JSON.stringify(template)}
                      onPick={() => onCaptionStyle(template)}
                      onEdit={onEditTemplate}
                    />
                    <p className="min-w-[200px] flex-1 type-body text-text-3">
                      {t(
                        'នេះជា style ដែលអ្នករក្សាទុកជាលំនាំដើម។ ជ្រើស preset រួចចុចប៊ូតុងខាងក្រោម ដើម្បីប្តូរវា។',
                        'This is the style you saved as default. Pick a preset and use the button below to change it.',
                      )}
                    </p>
                  </div>
                )}
              </div>

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
        </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-line px-6 py-4">
        <div className="mx-auto w-full max-w-[780px]">{footer}</div>
      </div>
    </div>
  )
}

/** វិនាទីសរុបប៉ាន់ស្មាន សម្រាប់ run មួយដែលគ្មាន cache (ល្បឿនដូចកាត Projects). */
function totalSeconds(pack: Pack, health: Health | null, seconds: number, clips: number, aiSeconds?: number): number {
  const each = stepSeconds({
    seconds,
    device: health?.device ?? 'cuda',
    whisperModel: String(pack.options.whisper_model ?? 'medium'),
    llm: String(pack.options.model ?? ''),
    clips,
    aiSeconds,
  })
  return Object.values(each).reduce((sum, value) => sum + value, 0)
}

/** រូបពិតពីវីដេអូ + ស្លាក "720p" (ដូចរូប OpusClip). */
function Frame({ chosen, format }: { chosen: Video; format: VideoFormat | null }) {
  const lines = format?.width && format?.height ? `${Math.min(format.width, format.height)}p` : null
  return (
    <div className="relative aspect-video w-[335px] max-w-full shrink-0 overflow-hidden rounded-card bg-raised-2">
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

/** "Choose aspect ratio" ដូចរូប. ទំហំក្រៅពី 9:16 render ពីរដង: Review និង Subtitles ត្រូវការ 9:16 ក្នុង `clips/`. */
function AspectMenu({ aspect, onAspect }: { aspect: Aspect; onAspect: (aspect: Aspect) => void }) {
  const t = useT()
  return (
    <div className="flex items-center gap-1 type-body text-text-3">
      <span>{t('ជ្រើសទំហំ', 'Choose aspect ratio')}</span>
      <MenuButton label={aspect} icon={<AspectGlyph aspect={aspect} />} menuLabel={t('ទំហំ', 'Aspect ratio')} width={150}>
        {(close) =>
          ASPECTS.map((item) => (
            <MenuItem
              key={item}
              checked={item === aspect}
              plainTick
              onClick={() => {
                onAspect(item)
                close()
              }}
            >
              <AspectGlyph aspect={item} />
              {item}
            </MenuItem>
          ))
        }
      </MenuButton>
    </div>
  )
}

/** "Preset template 1" ដូចរូប: ស៊ុម 9:16 + caption តាម style ដែលរក្សាទុក + ប៊ូតុង Edit (Settings → Default project). */
function TemplateCard({
  style,
  on,
  onPick,
  onEdit,
}: {
  style: CaptionStyle
  on: boolean
  onPick: () => void
  onEdit: () => void
}) {
  const t = useT()
  return (
    <div className="flex w-[150px] shrink-0 flex-col items-center gap-2">
      {/* ប៊ូតុងពីរមិនអាចនៅខាងក្នុងគ្នាបានទេ ដូច្នេះ Edit ជាបងប្អូនរបស់ប៊ូតុងជ្រើស */}
      <div className="relative w-full">
        <button
          type="button"
          aria-pressed={on}
          aria-label={t('ប្រើ style លំនាំដើមរបស់ខ្ញុំ', 'Use my default style')}
          onClick={onPick}
          className={`flex aspect-[4/5] w-full cursor-pointer items-end justify-center rounded-button border-2 bg-bg p-2 pb-6 ${
            on ? 'border-white' : 'border-transparent'
          } ${focusRing}`}
        >
          {style.off ? (
            <span className="type-hint text-text-4">{t('គ្មាន captions', 'No captions')}</span>
          ) : (
            <span className="text-center leading-[1.1]" style={captionTextStyle(style, 16 * (style.size / 100), 0.2)}>
              {style.uppercase ? 'TO GET' : 'To get'}
              <br />
              <span style={{ color: style.color }}>{style.uppercase ? 'STARTED' : 'started'}</span>
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className={`absolute top-2 right-2 min-h-7 cursor-pointer rounded-[6px] border-0 bg-black/70 px-2.5 text-[12px] font-semibold text-white hover:bg-black ${focusRing}`}
        >
          ✎ Edit
        </button>
      </div>
      <span className="text-center text-[13px] font-semibold text-text-3">{t('Style លំនាំដើមរបស់ខ្ញុំ', 'My default style')}</span>
    </div>
  )
}

/** Clip model ដូចរូប OpusClip: ជួរពីរបន្ទាត់ + ✓ ខាងស្ដាំ. Pack ខុសគ្នាត្រឹមទំហំ model, AI អានតែ transcript
 *  ទាំងអស់ ដូច្នេះមិនប្រើឈ្មោះ "ClipAnything" ទេ. */
function ClipModelMenu({
  choice,
  autoPack,
  pack,
  vramMb,
  onChoice,
}: {
  choice: PackChoice
  autoPack: Pack
  pack: Pack
  vramMb: number | null | undefined
  onChoice: (choice: PackChoice) => void
}) {
  const t = useT()
  const notes: Record<Pack['id'], string> = {
    lite: t('លឿន តែ clips ខ្លីពេក។ ល្អសម្រាប់សាកល្បង', 'Fast, but clips come out short. Good for testing'),
    standard: t('ល្អសម្រាប់វីដេអូនិយាយ', 'Great for talking videos'),
    pro: t('ច្បាស់បំផុត។ ត្រូវការ GPU 10 GB+', 'Most accurate. Needs a GPU with 10 GB+'),
  }
  const rows: { id: PackChoice; label: string; note: string; disabled?: boolean }[] = [
    {
      id: 'auto',
      label: 'Auto',
      note: t(
        `ជ្រើស model សមនឹងកុំព្យូទ័រនេះ · ឥឡូវ ${autoPack.label}`,
        `Picks the model that fits this computer · now ${autoPack.label}`,
      ),
    },
    ...PACKS.map((item) => ({
      id: item.id,
      label: item.label,
      note: notes[item.id],
      // Pro ត្រូវការ VRAM 10 GB — បិទពេលមិនគ្រប់ (មុន /env ឆ្លើយ មិនទាន់ដឹង -> បើក)
      disabled: vramMb !== undefined && !fits(item, vramMb),
    })),
  ]
  const current = rows.find((row) => row.id === choice) ?? rows[0]
  return (
    <div
      className="inline-flex items-center gap-1"
      title={`${current.label} = ${pack.options.whisper_model} + ${pack.options.model}`}
    >
      <span>Clip model</span>
      <MenuButton label={current.label} menuLabel="Clip model" width={350} flipBelow={330}>
        {(close) =>
          rows.map((row) => (
            <button
              key={row.id}
              type="button"
              role="menuitemradio"
              aria-checked={row.id === choice}
              disabled={row.disabled}
              title={row.disabled ? t('GPU នេះមិនគ្រប់', 'This GPU is too small') : undefined}
              onClick={() => {
                onChoice(row.id)
                close()
              }}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-field border-0 bg-transparent px-3 py-1.5 text-left hover:bg-raised disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent ${focusRing}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block type-body font-semibold text-text">{row.label}</span>
                <span className="block type-hint text-text-3">{row.note}</span>
              </span>
              <span className="w-4 shrink-0 text-text">{row.id === choice ? '✓' : ''}</span>
            </button>
          ))
        }
      </MenuButton>
    </div>
  )
}

/** Genre ដូចរូប OpusClip. Auto ជាអ្វីដែល pipeline ធ្វើឥឡូវ; genre ផ្សេងចូល prompt LLM ជំហានបន្ទាប់. */
function GenreMenu() {
  const t = useT()
  const genres = ['Q&A', 'Commentary', 'Marketing', 'Webinar', 'Motivational speech', 'Podcast', 'Academic']
  return (
    <div className="inline-flex items-center gap-1">
      <span>Genre</span>
      <MenuButton label="Auto" menuLabel="Genre" width={240}>
        {() => (
          // ខ្លីល្មមមិនឲ្យចុងបញ្ជីធ្លាក់ក្រោម footer; នៅសល់រំកិលក្នុងបញ្ជី
          <div className="max-h-[220px] overflow-y-auto">
            <MenuItem checked>Auto</MenuItem>
            {genres.map((name) => (
              <MenuItem
                key={name}
                checked={false}
                disabled
                title={t('ជំហានបន្ទាប់: genre ចូល prompt របស់ AI', 'Next step: the genre goes into the AI prompt')}
              >
                {name}
              </MenuItem>
            ))}
          </div>
        )}
      </MenuButton>
    </div>
  )
}

/** `--timeframe` ខ្លីបំផុត (config.TIMEFRAME_MIN_SEC). */
const MIN_CLIP_RANGE = 60

/** ចន្លោះពេល (រូប: "Processing timeframe" ដៃពីរ + 0:00:00 / 0:00:56): input range ពីរ ត្រួតគ្នា,
 *  ដូច្នេះ keyboard (←/→) ដំណើរការស្រាប់; ប្រអប់ពេលវាយបាន. */
function Timeframe({
  seconds,
  start,
  end,
  onChange,
}: {
  seconds: number | null
  start: number
  end: number
  onChange: (start: number, end: number) => void
}) {
  const t = useT()
  if (seconds === null) return <div className="h-6 rounded-full bg-raised-2" aria-hidden="true" />
  const top = Math.ceil(seconds) // range ដើរតាមលេខគត់: 55.7 s នឹងឈប់នៅ 55 បើគ្មានវា
  const left = (start / seconds) * 100
  const right = (end / seconds) * 100
  const thumb = 'range-thumb absolute inset-x-0 top-0 m-0 h-6 w-full'
  return (
    <div className="flex flex-col gap-3">
      <div className="relative h-6">
        <span className="absolute inset-x-3 top-1/2 h-2 -translate-y-1/2 rounded-full bg-raised-3" />
        {/* ផ្នែកដែលជ្រើស: 24 px = ទទឹងដៃ (កណ្តាលដៃដើរពី 12 px ដល់ ទទឹង − 12 px) */}
        <span
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-text"
          style={{
            left: `calc(12px + (100% - 24px) * ${left / 100})`,
            right: `calc(12px + (100% - 24px) * ${(100 - right) / 100})`,
          }}
        />
        <input
          type="range"
          aria-label={t('ចាប់ផ្តើម', 'Start')}
          min={0}
          max={top}
          step={1}
          value={start}
          onChange={(event) => onChange(Math.min(Number(event.target.value), end - 1), end)}
          className={thumb}
        />
        <input
          type="range"
          aria-label={t('ចប់', 'End')}
          min={0}
          max={top}
          step={1}
          value={end >= seconds ? top : end}
          // ដៃស្តាំនៅចុង = ប្រវែងពិត (មិនមែនលេខគត់ខាងលើ) ដូច្នេះ "វីដេអូទាំងមូល" នៅតែដឹងបាន
          onChange={(event) => {
            const value = Number(event.target.value)
            onChange(start, Math.max(value >= seconds ? seconds : value, start + 1))
          }}
          className={thumb}
        />
      </div>
      <div className="flex justify-between">
        {/* key: ប្រអប់ចាប់ផ្តើមថ្មីពីតម្លៃ slider រាល់ពេលវាប្តូរ */}
        <TimeBox
          key={`start-${start}`}
          label={t('ពេលចាប់ផ្តើម', 'Start time')}
          value={start}
          onCommit={(value) => onChange(Math.min(Math.max(0, value), end - 1), end)}
        />
        <TimeBox
          key={`end-${end}`}
          label={t('ពេលចប់', 'End time')}
          value={end}
          onCommit={(value) => onChange(start, Math.max(Math.min(seconds, value), start + 1))}
        />
      </div>
    </div>
  )
}

/** ប្រអប់ "0:00:56": Enter ឬចេញពីប្រអប់ = យក; អក្សរខុស = ត្រឡប់ទៅតម្លៃចាស់. */
function TimeBox({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const shown = fullClock(value)
  const [text, setText] = useState(shown)
  const commit = () => {
    const parsed = parseClock(text)
    if (parsed !== null && parsed !== Math.round(value)) onCommit(parsed)
    setText(shown) // តម្លៃថ្មីមកតាម key; តម្លៃដែលកាត់មកនៅដដែល ឬអក្សរខុស = បង្ហាញតម្លៃចាស់
  }
  return (
    <input
      type="text"
      aria-label={label}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && commit()}
      className={`w-[120px] rounded-field border-0 bg-field px-4 py-2 text-center type-body text-text-3 tabular-nums ${focusRing}`}
    />
  )
}

/** "1:02:03" / "02:03" / "45" -> វិនាទី; ខុសទម្រង់ = null. */
function parseClock(text: string): number | null {
  const parts = text.trim().split(':')
  if (parts.length > 3 || !parts.every((part) => /^\d+$/.test(part))) return null
  return parts.reduce((total, part) => total * 60 + Number(part), 0)
}

/** 102 -> "0:01:42" (ម៉ោងជានិច្ច ដូចរូប). */
function fullClock(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
