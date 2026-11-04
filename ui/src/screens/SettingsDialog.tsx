import { useState, type ReactNode } from 'react'
import type { Env, Health } from '../api'
import { presetOf, STYLE_PRESETS, type CaptionStyle } from '../captionStyle'
import type { PackChoice } from '../defaults'
import { useLang, useT, type Lang } from '../i18n'
import { Button, Segmented, Select, Switch } from '../kit/controls'
import { Dialog } from '../kit/Dialog'
import { focusRing } from '../kit/styles'
import { PACKS, fits, type Pack } from '../packs'
import { applyUiScale, readUiScale, saveUiScale, UI_SCALES } from '../uiScale'
import { khmerNumber } from './khmer'

/** Dialog "Settings" (design/screens/Settings.html) — ផ្នែកបួនរបស់ design ជា tab បួន (អ្នកអភិវឌ្ឍ
 *  2026-10-23): ទូទៅ · Processing · Default project · ការជូនដំណឹង និងអំពី app. បើកពីប៊ូតុង
 *  Settings នៅជ្រុងស្តាំខាងលើ (ជំនួសប៊ូតុង Menu), មិនមែនពី sidebar ទៀតទេ.
 *
 *  ពិតឥឡូវ: **ភាសា app** (ខ្មែរ / English, i18n.ts — ប្តូរភ្លាម រក្សាទុកលើកុំព្យូទ័រនេះ), folder
 *  output, ឧបករណ៍ដែលដំណើរការ (GPU/CPU ពិតពី /env), AI model, ចំនួន clips និង caption style
 *  លំនាំដើម (រក្សាទុកភ្លាមៗ ដូច "រក្សាទុកការកំណត់ខាងលើជាលំនាំដើម"), version របស់ sidecar.
 *  គូរ តែបិទ ហើយប្រាប់មូលហេតុ: ប្តូរ folder (គ្មាន flag), បើកពេល Windows ចាប់ផ្តើម, model សំឡេង
 *  ខ្មែរ (Phase 2), cloud (app មិន upload អ្វីទេ), ភាសាក្នុងវីដេអូ/subtitles ខ្មែរ (Phase 2),
 *  ប្រវែង clip (ជំហានបន្ទាប់), ជំនួយ Telegram (គ្មាន). */
export function SettingsDialog({
  health,
  env,
  pack,
  packChoice,
  autoPack,
  onPackChoice,
  maxClips,
  onMaxClips,
  captionStyle,
  onCaptionStyle,
  onSaveDefaults,
  onOpenModels,
  initialTab = 'general',
  onClose,
}: {
  health: Health | null
  env: Env | null
  pack: Pack
  packChoice: PackChoice
  autoPack: Pack
  onPackChoice: (choice: PackChoice) => void
  maxClips: number
  onMaxClips: (count: number) => void
  captionStyle: CaptionStyle
  onCaptionStyle: (style: CaptionStyle) => void
  onSaveDefaults: (next: { pack?: PackChoice; maxClips?: number; captionStyle?: CaptionStyle }) => void
  onOpenModels: () => void // បិទ dialog រួចបើកទំព័រ Models ចាស់
  initialTab?: Tab
  onClose: () => void
}) {
  const t = useT()
  const { lang, setLang } = useLang()
  // ការកែទាំងអស់ក្នុង dialog ជា **ព្រាង**: OK ប្រើ និងរក្សាទុក, បោះបង់ / ✕ / Escape បោះចោល
  // (អ្នកអភិវឌ្ឍស្នើ). អក្សរក្នុង dialog នៅតាមភាសាបច្ចុប្បន្នរហូតដល់ OK.
  // ទំហំ UI: ចុច = មើលភ្លាម (preview), OK = រក្សាទុក, បោះបង់ / ✕ / Escape = ត្រឡប់ទំហំដែលបានរក្សាទុក
  const [savedScale] = useState(readUiScale)
  const [draft, setDraft] = useState({ lang, packChoice, maxClips, captionStyle, uiScale: savedScale })
  const draftPack = draft.packChoice === 'auto' ? autoPack : (PACKS.find((item) => item.id === draft.packChoice) ?? pack)
  const changed =
    draft.lang !== lang || draft.packChoice !== packChoice || draft.maxClips !== maxClips || draft.captionStyle !== captionStyle ||
    draft.uiScale !== savedScale
  const apply = () => {
    if (draft.lang !== lang) setLang(draft.lang)
    onPackChoice(draft.packChoice)
    onMaxClips(draft.maxClips)
    onCaptionStyle(draft.captionStyle)
    // ប្តូរនៅ Settings = លំនាំដើមសម្រាប់ project ថ្មី (localStorage ដូច "រក្សាទុកជាលំនាំដើម")
    onSaveDefaults({ pack: draft.packChoice, maxClips: draft.maxClips, captionStyle: draft.captionStyle })
    void saveUiScale(draft.uiScale)
    onClose()
  }
  const cancel = () => {
    if (draft.uiScale !== savedScale) void applyUiScale(savedScale)
    onClose()
  }
  const vramMb = env ? (env.gpu?.vram_mb ?? null) : undefined
  const device = env?.gpu ? `GPU · ${env.gpu.name}` : health?.device === 'cuda' ? 'GPU · NVIDIA' : 'CPU'
  const current = presetOf(draft.captionStyle)
  const soon = t('មិនទាន់មាន', 'Not available yet')

  const [tab, setTab] = useState<Tab>(initialTab)
  const tabs: { value: Tab; label: string }[] = [
    { value: 'general', label: t('ទូទៅ', 'General') },
    { value: 'processing', label: t('Processing', 'Processing') },
    { value: 'defaults', label: t('Default project', 'Default project') },
    { value: 'about', label: t('ការជូនដំណឹង និងអំពី app', 'Notifications & about') },
  ]

  return (
    <Dialog
      title={t('Settings', 'Settings')}
      onClose={cancel}
      width={720}
      footer={
        <div className="flex items-center justify-end gap-2.5">
          {/* OK នៅឆ្វេង បោះបង់នៅស្តាំ (អ្នកអភិវឌ្ឍស្នើ — លំដាប់ Windows) */}
          <Button variant="primary" onClick={apply} title={changed ? undefined : t('គ្មានអ្វីប្តូរ', 'Nothing changed')}>
            OK
          </Button>
          <Button variant="ghost" onClick={cancel}>
            {t('បោះបង់', 'Cancel')}
          </Button>
        </div>
      }
    >
      {/* tab មានបន្ទាត់ក្រោម ដូចទំព័រ ឧបករណ៍ទាំងអស់ និង Projects របស់ខ្ញុំ */}
      <div role="tablist" aria-label="Settings" className="-mt-1 flex flex-wrap gap-6 border-b border-line">
        {tabs.map((item) => {
          const here = tab === item.value
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={here}
              onClick={() => setTab(item.value)}
              className={`relative cursor-pointer border-0 bg-transparent px-0 pt-1 pb-2.5 type-body ${
                here ? 'font-bold text-text' : 'text-text-3 hover:text-text-2'
              } ${focusRing}`}
            >
              {item.label}
              {here && <span className="absolute right-0 -bottom-px left-0 h-[3px] rounded-full bg-gold" />}
            </button>
          )
        })}
      </div>

      {/* កម្ពស់អប្បបរមាថេរ: dialog មិនលោតឡើងចុះពេលប្តូរ tab (tab ខ្លី និងវែងខុសគ្នា) */}
      <div role="tabpanel" className="min-h-[370px]">
      {tab === 'general' && (
        <Rows>
        <Row label={t('ភាសា app', 'App language')} htmlFor="ui-lang">
          <Select
            id="ui-lang"
            value={draft.lang}
            onChange={(event) => setDraft({ ...draft, lang: event.target.value as Lang })}
          >
            <option value="km">ខ្មែរ</option>
            <option value="en">English</option>
          </Select>
        </Row>
        <Row
          label={t('ទំហំ UI', 'UI size')}
          hint={t('អក្សរ ប៊ូតុង និង panel ទាំងអស់ — ចុចដើម្បីមើលភ្លាម', 'Text, buttons and panels — click to preview')}
        >
          <Segmented
            label={t('ទំហំ UI', 'UI size')}
            size="sm"
            value={String(draft.uiScale)}
            options={UI_SCALES.map((scale) => ({ value: String(scale), label: `${Math.round(scale * 100)}%` }))}
            onChange={(value) => {
              setDraft({ ...draft, uiScale: Number(value) })
              void applyUiScale(Number(value))
            }}
          />
        </Row>
        <Row
          label={t('Folder រក្សាទុក clips', 'Folder for clips')}
          hint={health?.output_dir ?? '…'}
          note={t('ប្ដូរមិនទាន់បាន — pipeline សរសេរក្នុង output/ ជានិច្ច', 'Cannot be changed yet — the pipeline always writes to output/')}
        >
          <DisabledButton title={soon}>{t('ប្ដូរ', 'Change')}</DisabledButton>
        </Row>
        <Row label={t('បើក app ពេល Windows ចាប់ផ្ដើម', 'Open the app when Windows starts')} note={soon}>
          <Switch label={t('បើក app ពេល Windows ចាប់ផ្ដើម', 'Open the app when Windows starts')} checked={false} disabled onChange={() => {}} />
        </Row>
        </Rows>
      )}
      {tab === 'processing' && (
        <Rows>
        <Row
          label={t('ដំណើរការលើ', 'Runs on')}
          hint={device}
          note={t('ជ្រើសដោយស្វ័យប្រវត្តិ: GPU បើ Whisper ប្រើវាបាន បើមិនដូច្នោះ CPU', 'Chosen automatically: the GPU when Whisper can use it, otherwise the CPU')}
        >
          <span className="rounded-field bg-raised-2 px-3 py-2 type-label font-semibold">
            {health?.device === 'cuda' ? 'GPU' : 'CPU'}
          </span>
        </Row>
        <Row label="AI model" htmlFor="set-pack" hint={`${draftPack.options.whisper_model} + ${draftPack.options.model}`}>
          <Select
            id="set-pack"
            value={draft.packChoice}
            onChange={(event) => {
              const next = event.target.value as PackChoice
              setDraft({ ...draft, packChoice: next })
            }}
          >
            <option value="auto">Auto ({autoPack.label})</option>
            {PACKS.map((item) => (
              // Pro ត្រូវការ VRAM 10 GB — បិទពេលមិនគ្រប់
              <option key={item.id} value={item.id} disabled={vramMb !== undefined && !fits(item, vramMb)}>
                {item.label}
              </option>
            ))}
          </Select>
        </Row>
        <Row label={t('Models ដែលមានលើកុំព្យូទ័រនេះ', 'Models on this computer')}>
          <button
            type="button"
            onClick={() => {
              onClose() // dialog បិទមុន — បើមិនដូច្នោះវាគ្របទំព័រ Models
              onOpenModels()
            }}
            className={`min-h-10 cursor-pointer rounded-field border-0 bg-raised-2 px-3.5 type-label font-semibold text-text hover:bg-raised-3 ${focusRing}`}
          >
            {t('មើល', 'View')} ›
          </button>
        </Row>
        <Row label={t('Model សំឡេងខ្មែរ', 'Khmer speech model')} note="PHASE 2">
          <DisabledButton title="PHASE 2">{t('ពិនិត្យ update', 'Check for update')}</DisabledButton>
        </Row>
        <Row
          label={t('ប្រើ cloud ពេលកុំព្យូទ័រយឺត', 'Use the cloud when this computer is slow')}
          note={t('គ្មាន — app នេះដំណើរការលើកុំព្យូទ័ររបស់អ្នកទាំងស្រុង មិន upload អ្វីទេ', 'None — this app runs fully on your computer and uploads nothing')}
        >
          <Switch label={t('ប្រើ cloud', 'Use the cloud')} checked={false} disabled onChange={() => {}} />
        </Row>
        </Rows>
      )}
      {tab === 'defaults' && (
        <Rows>
        <Row label={t('ភាសាក្នុងវីដេអូ', 'Language in the video')} htmlFor="d-lang" note={t('ខ្មែរ · PHASE 2', 'Khmer · PHASE 2')}>
          <Select id="d-lang" value="en" onChange={() => {}}>
            <option value="km" disabled>ខ្មែរ · PHASE 2</option>
            <option value="en">English</option>
            <option value="mix" disabled>{t('លាយពីរភាសា', 'Mixed')} · PHASE 2</option>
          </Select>
        </Row>
        <Row label="Subtitles" htmlFor="d-sub">
          <Select id="d-sub" value="en" onChange={() => {}}>
            <option value="en">English</option>
            <option value="km" disabled>ខ្មែរ · PHASE 2</option>
            <option value="km-en" disabled>ខ្មែរ + English · PHASE 2</option>
          </Select>
        </Row>
        <Row label={t('ចំនួន Clips', 'Number of clips')} htmlFor="d-clips">
          <Select
            id="d-clips"
            value={String(draft.maxClips)}
            onChange={(event) => {
              setDraft({ ...draft, maxClips: Number(event.target.value) })
            }}
          >
            {[5, 10, 15].map((count) => (
              <option key={count} value={count}>
                {lang === 'km' ? khmerNumber(count) : count}
              </option>
            ))}
          </Select>
        </Row>
        <Row
          label={t('ប្រវែង Clip', 'Clip length')}
          htmlFor="d-len"
          note={t('ជំហានបន្ទាប់ — ឥឡូវ AI ជ្រើស 15–90 វិ', 'Next step — the AI picks 15–90 s for now')}
        >
          <Select id="d-len" value="auto" disabled onChange={() => {}}>
            <option value="auto">Auto (15–90 {t('វិ', 's')})</option>
          </Select>
        </Row>
        <Row label="Caption style" htmlFor="d-style" hint={current === null ? t('style ផ្ទាល់ខ្លួន', 'custom style') : undefined}>
          <Select
            id="d-style"
            value={current ?? ''}
            onChange={(event) => {
              const preset = STYLE_PRESETS.find((item) => item.id === event.target.value)
              if (!preset?.style) return
              setDraft({ ...draft, captionStyle: { ...draft.captionStyle, ...preset.style } })
            }}
          >
            {current === null && <option value="">{t('style ផ្ទាល់ខ្លួន', 'Custom style')}</option>}
            {STYLE_PRESETS.map((item) => (
              // Box និង Neon: renderer មិនទាន់គូរបាន
              <option key={item.id} value={item.id} disabled={!item.style}>
                {t(item.name, item.en)}
              </option>
            ))}
          </Select>
        </Row>
        </Rows>
      )}
      {tab === 'about' && (
        <Rows>
        <Row
          label={t('ជូនដំណឹងពេល clips រួចរាល់', 'Notify when clips are ready')}
          note={t('សារនៅជ្រុងខាងក្រោមនៃ app · ការជូនដំណឹង Windows មិនទាន់មាន', 'A note in the corner of the app · Windows notifications not yet')}
        >
          <Switch label={t('ជូនដំណឹងពេល clips រួចរាល់', 'Notify when clips are ready')} checked disabled onChange={() => {}} />
        </Row>
        <Row label={`Version ${health?.version ?? '…'}`} hint={t('Sidecar ក្នុងកុំព្យូទ័រនេះ', 'Sidecar on this computer')}>
          <span />
        </Row>
        </Rows>
      )}
      </div>
    </Dialog>
  )
}

type Tab = 'general' | 'processing' | 'defaults' | 'about'

/** បញ្ជីជួរនៃ tab មួយ: បន្ទាត់ខាងលើ លើកលែងជួរទីមួយ (Settings.html `border-top: #232936`). */
function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-line">{children}</div>
}

/** ជួរ: ស្លាក (+ ព័ត៌មាន `hint`, + ហេតុដែលបិទ `note`) នៅឆ្វេង, control នៅស្តាំ. */
function Row({
  label,
  hint,
  note,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  note?: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="min-w-0">
        <label htmlFor={htmlFor} className="block type-body">
          {label}
        </label>
        {hint && <span className="block text-[12.5px] break-all text-text-3">{hint}</span>}
        {note && <span className="block text-[12px] text-text-4">{note}</span>}
      </span>
      {children}
    </div>
  )
}

function DisabledButton({ title, children }: { title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      title={title}
      className="min-h-10 shrink-0 cursor-default rounded-field border-0 bg-raised-2 px-3.5 type-label font-semibold text-text opacity-40"
    >
      {children}
    </button>
  )
}
