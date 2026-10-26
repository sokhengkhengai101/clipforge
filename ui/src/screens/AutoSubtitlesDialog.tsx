import { useEffect, useState } from 'react'
import { api, sourceFrameUrl, type Video, type VideoFormat } from '../api'
import { presetOf, STYLE_PRESETS, type CaptionStyle } from '../captionStyle'
import { Chip } from '../kit/controls'
import { Dialog } from '../kit/Dialog'
import { focusRing } from '../kit/styles'
import { clock, khmerNumber } from './khmer'
import { PresetCard } from './PresetCard'
import type { ReframeSettings } from './ReframeSetup'
import { Illustration, Source } from './VideoPicker'
import { AspectGlyph, MenuButton, MenuItem } from './Menu'

type Aspect = ReframeSettings['aspect']

/** អ្វីដែល dialog ផ្ញើទៅ App ដើម្បីចាប់ផ្តើម `--full` (វីដេអូទាំងមូល + captions). */
export type SubtitleSettings = {
  aspect: Aspect
  reframe: boolean // false = ទំហំដូចវីដេអូ (`--layout center` = frame ទាំងមូល គ្មានកាត់)
  style: CaptionStyle
  language: string // auto / en / fr ... (`--language`)
}

const RATIO: Record<Aspect, number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9, '4:5': 4 / 5 }
const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9', '4:5'] // លំដាប់ដូចរូប OpusClip

/** ភាសាដូច `config.WHISPER_LANGUAGES` — តែអក្សរ Latin, ព្រោះ caption ដុតដោយ Montserrat
 *  ដែលគ្មានអក្សរខ្មែរ ចិន ថៃ... (ខ្មែរ = Phase 2 ជាមួយ font Battambang). */
const LANGUAGES: [string, string][] = [
  ['en', 'English'], ['fr', 'French'], ['es', 'Spanish'], ['de', 'German'], ['pt', 'Portuguese'],
  ['it', 'Italian'], ['nl', 'Dutch'], ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['pl', 'Polish'],
  ['sv', 'Swedish'], ['da', 'Danish'], ['fi', 'Finnish'], ['cs', 'Czech'], ['hr', 'Croatian'],
  ['et', 'Estonian'], ['tr', 'Turkish'], ['ms', 'Malay'], ['tl', 'Tagalog'], ['ro', 'Romanian'],
]

/** ល្បឿនដែលបានវាស់: interview 47 នាទី `--full` = 15½ នាទីលើ GPU (ដូច AI Reframe). */
const MEASURED_RATIO = 15.5 / 47

/** aspect ដែលជិតបំផុតនឹងវីដេអូ (1280x720 -> 16:9) = "ដូចវីដេអូ" (គ្មានការកាត់). */
function nearestAspect(ratio: number): Aspect {
  return ASPECTS.reduce((best, item) => (Math.abs(RATIO[item] - ratio) < Math.abs(RATIO[best] - ratio) ? item : best))
}

/** Dialog "Auto Subtitles" — រចនាតាមរូប "AI Captions" របស់ OpusClip (អ្នកអភិវឌ្ឍ 2026-10-24).
 *
 *  ពិត: preset caption ដែល renderer គូរបាន (+ style លំនាំដើមរបស់អ្នកជា "My templates"),
 *  aspect (ដូចវីដេអូ = captions តែប៉ុណ្ណោះ; ផ្សេងពីនេះ = AI reframe តាមមុខ), និងភាសានិយាយ
 *  (`--language`). មិនទាន់មាន (បង្ហាញ តែចុចមិនបាន): បកប្រែទៅ English (ជំហានបន្ទាប់) និងខ្មែរ
 *  (Phase 2). គ្មាន "Credit usage" — app មិនរាប់អ្វីទេ (local-first). */
export function AutoSubtitlesDialog({
  video,
  videos,
  device,
  savedStyle,
  busy,
  error,
  dropOver,
  onChoose,
  onChoosePath,
  onClear,
  onStart,
  onClose,
}: {
  video: Video | null
  videos: Video[] // samples/
  device: string // cuda / cpu
  savedStyle: CaptionStyle // style លំនាំដើម (Settings → Default project) = "My templates"
  busy: boolean
  error: string
  onChoose: (video: Video) => void
  onChoosePath: (path: string) => void
  dropOver: boolean // file កំពុងអូសលើ window (Tauri)
  onClear: () => void // "ប្ដូរ": ត្រឡប់ទៅជំហាន ១
  onStart: (settings: SubtitleSettings) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'presets' | 'mine'>('presets')
  const [style, setStyle] = useState<CaptionStyle>(savedStyle)
  const [aspectChoice, setAspectChoice] = useState<Aspect | null>(null) // null = ដូចវីដេអូ
  const [language, setLanguage] = useState('auto')

  // ទំហំ/រយៈពេលពិត (ffprobe) — "ដូចវីដេអូ", ស្លាក 360p និងពេលប៉ាន់
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

  const sourceRatio = format?.width && format?.height ? format.width / format.height : 16 / 9
  const own = nearestAspect(sourceRatio)
  const aspect = aspectChoice ?? own
  const reframe = aspect !== own
  // ផ្ទៃដែល aspect យកពី frame (ដូចវីដេអូ = 100%)
  const target = RATIO[aspect]
  const box = !reframe
    ? { w: 100, h: 100 }
    : target < sourceRatio
      ? { w: (target / sourceRatio) * 100, h: 100 }
      : { w: 100, h: (sourceRatio / target) * 100 }
  const minutes = format?.seconds ? Math.max(1, Math.ceil((format.seconds / 60) * MEASURED_RATIO)) : null
  const currentPreset = presetOf(style)
  const languageName = language === 'auto' ? 'Auto' : (LANGUAGES.find(([code]) => code === language)?.[1] ?? language)


  const title = (
    <span className="flex items-center gap-2">
      Auto Subtitles <Chip tone="gold">AI</Chip>
    </span>
  )

  // ជំហាន ១ ដូច Long to Short: ជ្រើសវីដេអូ (path, ជ្រើសឯកសារ, វីដេអូគំរូ, drop) មុនការកំណត់
  if (!video) {
    return (
      <Dialog width={640} onClose={onClose} title={title}>
        <p className="-mt-2.5 type-body-lg text-text-3">ដាក់ subtitles ស្អាតលើវីដេអូទាំងមូល ក្នុង ១ ចុច។</p>
        <Illustration variant="subtitles" video={[...videos].sort((a, b) => b.mb - a.mb)[0] ?? null} />
        <Source videos={videos} dropOver={dropOver} onChoose={onChoose} onChoosePath={onChoosePath} />
      </Dialog>
    )
  }

  return (
    <Dialog
      width={640}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          Auto Subtitles <Chip tone="gold">AI</Chip>
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-[13px] text-text-3">
            {minutes ? (
              <>
                ប្រហែល <strong className="text-text">{khmerNumber(minutes)} នាទី</strong> លើ {device === 'cuda' ? 'GPU' : 'CPU'} ·
                វីដេអូនៅលើកុំព្យូទ័ររបស់អ្នក
              </>
            ) : (
              'វីដេអូនៅលើកុំព្យូទ័ររបស់អ្នក — គ្មានអ្វី upload'
            )}
          </p>
          <button
            type="button"
            disabled={!video?.path || busy}
            onClick={() => onStart({ aspect, reframe, style, language })}
            title={busy ? 'មាន job កំពុងរត់' : !video?.path ? 'ជ្រើសវីដេអូមុន' : undefined}
            className={`inline-flex min-h-12 cursor-pointer items-center rounded-[12px] border-0 bg-gold px-6 text-[16px] font-bold text-on-gold disabled:cursor-default disabled:opacity-40 ${focusRing}`}
          >
            {busy ? 'មាន job កំពុងរត់...' : 'ដាក់ Subtitles'}
          </button>
        </div>
      }
    >
      <p className="-mt-2 pr-8 text-[14.5px] leading-[1.7] text-text-2-dim">
        ដាក់ subtitles ស្អាតលើវីដេអូទាំងមូល ក្នុង ១ ចុច — ក្នុងទំហំដើម ឬបម្លែងទៅ 9:16។
      </p>

      {/* ---- frame ពិត + caption គំរូក្នុង style ដែលជ្រើស ---- */}
      <div className="flex justify-center">
        <div
          role="img"
          aria-label={`Preview: captions លើ ${aspect}`}
          className="relative h-[190px] w-[338px] overflow-hidden rounded-[12px] bg-raised-2"
        >
          {video?.path ? (
            <img
              src={sourceFrameUrl(video.path, format?.seconds ? Math.min(60, format.seconds * 0.1) : 5)}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center type-hint text-text-4">មិនទាន់ជ្រើសវីដេអូ</span>
          )}
          {format?.width && format.height && (
            <span className="absolute top-2.5 left-2.5 z-[3] rounded-[6px] bg-black/65 px-2 py-0.5 text-[12px] font-bold">
              {Math.min(format.width, format.height)}p
            </span>
          )}
          {/* ផ្ទៃដែលនៅសល់ក្រោយ reframe; caption គំរូអង្គុយនៅខាងក្រោមផ្ទៃនោះ */}
          <div
            className={`absolute top-1/2 left-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 ${
              reframe ? 'border-2 border-gold shadow-[0_0_0_999px_rgba(0,0,0,0.5)]' : ''
            }`}
            style={{ width: `${box.w}%`, height: `${box.h}%` }}
          >
            <SampleCaption style={style} narrow={box.w < 60} />
          </div>
        </div>
      </div>

      {/* ---- វីដេអូ ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-label text-text-3">វីដេអូ:</span>
        <span className="min-w-0 flex-1 truncate type-body font-semibold">{video?.name ?? '—'}</span>
        {format?.seconds ? <span className="type-hint text-text-4 tabular-nums">{clock(format.seconds)}</span> : null}
        <button
          type="button"
          onClick={onClear}
          className={`min-h-9 cursor-pointer rounded-field border-0 bg-raised-2 px-3 type-label text-text hover:bg-raised-3 ${focusRing}`}
        >
          ប្ដូរ
        </button>
      </div>

      {/* ---- Quick presets / My templates (រូបទី ១) ---- */}
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
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`min-h-11 cursor-pointer rounded-t-[12px] border-0 px-5 type-body font-semibold ${
                tab === value ? 'bg-field text-text' : 'bg-transparent text-text-3 hover:text-text'
              } ${focusRing}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-col gap-3 rounded-b-[12px] rounded-tr-[12px] bg-field p-4">
          <span className="type-label text-text-3">Caption</span>
          {tab === 'presets' ? (
            // តែ preset ដែល renderer គូរបានពិត (Box ខ្មៅ / Neon នៅមិនទាន់មាន — មិនគូរ)
            <div className="grid grid-cols-4 gap-3">
              {STYLE_PRESETS.filter((item) => item.style).map((item) => (
                <PresetCard
                  key={item.id}
                  preset={item}
                  on={item.id === currentPreset}
                  onPick={() => item.style && setStyle({ ...style, ...item.style })}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <button
                type="button"
                aria-pressed={JSON.stringify(style) === JSON.stringify(savedStyle)}
                onClick={() => setStyle(savedStyle)}
                className={`relative flex h-21 w-[150px] shrink-0 cursor-pointer items-end justify-center overflow-hidden rounded-button border-2 bg-raised pb-3 ${
                  JSON.stringify(style) === JSON.stringify(savedStyle) ? 'border-white' : 'border-transparent'
                } ${focusRing}`}
              >
                <SampleCaption style={savedStyle} narrow />
              </button>
              <p className="m-0 type-hint leading-[1.7] text-text-3">
                <strong className="text-text">Style លំនាំដើមរបស់ខ្ញុំ</strong>
                <br />
                {savedStyle.off ? 'គ្មាន captions' : `${savedStyle.words} ពាក្យ · ${savedStyle.color} · ${savedStyle.size}%`}
                <br />
                កែវានៅ Settings → Default project
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="type-body text-text-3">ទំហំ (aspect ratio)</span>
            <MenuButton label={aspect} icon={<AspectGlyph aspect={aspect} />} menuLabel="ទំហំ (aspect ratio)">
              {(close) =>
                ASPECTS.map((item) => (
                  <MenuItem
                    key={item}
                    checked={item === aspect}
                    onClick={() => {
                      setAspectChoice(item)
                      close()
                    }}
                  >
                    <AspectGlyph aspect={item} /> {item}
                    {item === own && <span className="ml-1 text-[12px] font-normal text-text-4">ដូចវីដេអូ</span>}
                  </MenuItem>
                ))
              }
            </MenuButton>
          </div>
          <p className="-mt-1 type-hint text-text-4">
            {reframe
              ? `AI reframe ទៅ ${aspect}: តាមមុខ មនុស្ស សត្វ ក្នុង shot នីមួយៗ (ដូច AI Reframe)`
              : 'ទំហំដើម — គ្មានការកាត់ frame, បន្ថែមតែ subtitles'}
          </p>
        </div>
      </div>

      {/* ---- Translation (រូបទី ២, ៤) ---- */}
      <div>
        <span className="inline-flex min-h-11 items-center rounded-t-[12px] bg-field px-5 type-body font-semibold">Translation</span>
        <div className="flex flex-wrap items-center gap-2 rounded-b-[12px] rounded-tr-[12px] bg-field p-4">
          <span className="type-body text-text-3">ភាសានិយាយ & ការបកប្រែ:</span>
          {/* បើកឡើងលើ: Translation នៅបាត dialog — បើកចុះក្រោមត្រូវបាត់ក្រោម footer */}
          <MenuButton label={languageName} menuLabel="ភាសានិយាយ & ការបកប្រែ" wide up>
            {(close) => (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col">
                  <span className="px-3 pb-1.5 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">ភាសាដើម</span>
                  <div className="flex max-h-[260px] flex-col overflow-y-auto pr-1">
                    {[['auto', 'Auto'] as [string, string], ...LANGUAGES].map(([code, name]) => (
                      <MenuItem
                        key={code}
                        checked={code === language}
                        onClick={() => {
                          setLanguage(code)
                          close()
                        }}
                      >
                        {name}
                      </MenuItem>
                    ))}
                    <MenuItem checked={false} disabled title="Subtitles ខ្មែរ = Phase 2 (Whisper ខ្មែរ + font Battambang)">
                      ខ្មែរ <span className="text-[11px] text-text-4">Phase 2</span>
                    </MenuItem>
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className="px-3 pb-1.5 text-[11.5px] font-semibold tracking-wide text-text-3 uppercase">បកប្រែទៅ</span>
                  <MenuItem checked onClick={close}>
                    គ្មានការបកប្រែ
                  </MenuItem>
                  <MenuItem checked={false} disabled title="Whisper translate → English: ជំហានបន្ទាប់">
                    English <span className="text-[11px] text-text-4">ជំហានបន្ទាប់</span>
                  </MenuItem>
                  <MenuItem checked={false} disabled title="បកប្រែទៅខ្មែរ = Phase 2">
                    ខ្មែរ <span className="text-[11px] text-text-4">Phase 2</span>
                  </MenuItem>
                </div>
              </div>
            )}
          </MenuButton>
        </div>
        <p className="mt-2 type-hint text-text-4">
          Auto = Whisper រកភាសាខ្លួនឯង · ជ្រើសភាសាពិត បើវីដេអូលាយភាសា ឬ Auto ទាយខុស
        </p>
      </div>

      {error && <p className="type-hint text-danger">{error}</p>}
    </Dialog>
  )
}

/** caption គំរូលើ frame — ពាក្យ "using" ជាពាក្យកំពុងនិយាយ (ពណ៌ style). */
function SampleCaption({ style, narrow }: { style: CaptionStyle; narrow: boolean }) {
  if (style.off) return null
  const words = ['How', 'you', 'can', 'use', 'the', 'agents']
  const top = style.position === 'top' ? '14%' : style.position === 'middle' ? '50%' : '78%'
  const size = (narrow ? 13 : 17) * (style.size / 100)
  return (
    <p
      aria-hidden="true"
      className="absolute inset-x-1 m-0 text-center leading-[1.15] text-white"
      style={{
        top,
        transform: 'translateY(-50%)',
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 800,
        fontSize: size,
        WebkitTextStroke: style.outline > 0 ? `${Math.max(1, style.outline / 2)}px #000` : undefined,
        paintOrder: 'stroke fill',
      }}
    >
      {words.slice(0, Math.max(2, Math.min(style.words, words.length))).map((word, index) => (
        <span key={word} style={index === 3 ? { color: style.color } : undefined}>
          {index > 0 && ' '}
          {style.uppercase ? word.toUpperCase() : word}
        </span>
      ))}
    </p>
  )
}
