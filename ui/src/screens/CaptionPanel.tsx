import { useState, type ReactNode } from 'react'
import { useCaptionFonts } from '../captionLook'
import { ANIMATION_GROUPS, CAPTION_COLORS, presetOf, STYLE_PRESETS, type CaptionAnimation, type CaptionStyle } from '../captionStyle'
import { Chip, Segmented, Select, Switch } from '../kit/controls'
import { focusRing } from '../kit/styles'
import { khmerNumber } from './khmer'
import { PresetCard } from './PresetCard'

type Tab = 'presets' | 'font' | 'effects'

/** ផ្ទាំង Captions ៣ tab (Presets / Font / Effects) — រចនាតាមរូប OpusClip (អ្នកអភិវឌ្ឍ 2026-10-26).
 *
 *  ប្រើរួមដោយ Edit Video (aside ខាងស្តាំ) និង screen Subtitles. ការកំណត់នីមួយៗជា flag ពិត
 *  (`styleOptions` ក្នុង captionStyle.ts) — គ្មានការកំណត់ណាសម្រាប់តែមើលទេ. */
export function CaptionPanel({
  style,
  onStyle,
  footer,
}: {
  style: CaptionStyle
  onStyle: (style: CaptionStyle) => void
  footer?: ReactNode
}) {
  const [tab, setTab] = useState<Tab>('presets')
  const change = (part: Partial<CaptionStyle>) => onStyle({ ...style, ...part })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Caption style" className="grid shrink-0 grid-cols-3 border-b border-raised px-3 pt-1.5">
        {(
          [
            ['presets', 'Presets'],
            ['font', 'Font'],
            ['effects', 'Effects'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-11.5 cursor-pointer border-0 border-b-2 bg-transparent text-[15px] ${
              tab === id ? 'border-gold font-bold text-text' : 'border-transparent font-medium text-text-4'
            } ${focusRing}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4.5">
        {tab === 'presets' && <PresetsTab style={style} onStyle={onStyle} />}
        {tab === 'font' && <FontTab style={style} change={change} />}
        {tab === 'effects' && <EffectsTab style={style} change={change} />}
      </div>
      {footer}
    </div>
  )
}

function PresetsTab({ style, onStyle }: { style: CaptionStyle; onStyle: (style: CaptionStyle) => void }) {
  const fonts = useCaptionFonts()
  const current = presetOf(style)
  const installed = (face: string | undefined) => !face || fonts.length === 0 || fonts.some((font) => font.face === face)
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {STYLE_PRESETS.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={installed(preset.style?.font) ? preset : { ...preset, style: null }}
            on={preset.id === current}
            onPick={() => preset.style && onStyle({ ...style, ...preset.style })}
          />
        ))}
      </div>
      <p className="m-0 type-hint text-text-4">
        Preset នីមួយៗជាបណ្តុំការកំណត់ពិត ហើយអាចកែបន្តនៅ Font និង Effects។ Box ខ្មៅ និង Neon មិនទាន់មានក្នុង renderer ទេ។
        {current === null && ' · style ផ្ទាល់ខ្លួន'}
      </p>
    </>
  )
}

function FontTab({ style, change }: { style: CaptionStyle; change: (part: Partial<CaptionStyle>) => void }) {
  const fonts = useCaptionFonts()
  const current = fonts.find((font) => font.face === style.font)
  const families = [...new Set(fonts.map((font) => font.family))]
  const family = current?.family ?? 'Montserrat'
  const weights = fonts.filter((font) => font.family === family)
  return (
    <>
      <Heading>Font settings</Heading>
      <div className="flex gap-2">
        <Select
          aria-label="Font"
          value={family}
          onChange={(event) => {
            // family ថ្មី: កម្រាស់ដែលក្រាស់ជាងគេរបស់វា (caption ត្រូវក្រាស់)
            const options = fonts.filter((font) => font.family === event.target.value)
            if (options.length) change({ font: options[options.length - 1].face })
          }}
          className="min-w-0 flex-1"
        >
          {(families.length ? families : ['Montserrat']).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </Select>
        <Select aria-label="កម្រាស់" value={style.font} onChange={(event) => change({ font: event.target.value })}>
          {(weights.length ? weights : [{ face: style.font, weight: 'ExtraBold' }]).map((font) => (
            <option key={font.face} value={font.face}>
              {font.weight}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <ColourInput label="ពណ៌អក្សរ" value={style.textColor} onChange={(textColor) => change({ textColor })} />
        <label className="flex min-w-0 flex-1 items-center gap-2 type-hint text-text-3">
          ទំហំ
          <input
            type="range"
            min={70}
            max={120}
            step={5}
            value={style.size}
            onChange={(event) => change({ size: Number(event.target.value) })}
            aria-label="ទំហំអក្សរ"
            className={`min-w-0 flex-1 cursor-pointer accent-gold ${focusRing}`}
          />
          <span className="w-10 text-right tabular-nums text-text">{style.size}%</span>
        </label>
      </div>

      <Row label="Decoration">
        <span className="flex gap-1">
          <Toggle label="Italic" on={style.italic} onClick={() => change({ italic: !style.italic })}>
            <span className="font-serif italic">I</span>
          </Toggle>
          <Toggle label="Underline" on={style.underline} onClick={() => change({ underline: !style.underline })}>
            <span className="underline">U</span>
          </Toggle>
        </span>
      </Row>
      {style.italic && current && !current.italic_face && (
        <p className="-mt-2 m-0 type-hint text-text-4">{current.face} គ្មាន italic ពិត — libass ទ្រេតវាខ្លួនឯង</p>
      )}
      <Row label="Uppercase">
        <Switch label="Uppercase" checked={style.uppercase} onChange={(uppercase) => change({ uppercase })} />
      </Row>
      <Row label="Font stroke">
        <span className="flex items-center gap-2">
          <ColourInput label="ពណ៌ stroke" value={style.outlineColor} onChange={(outlineColor) => change({ outlineColor })} />
          <NumberField label="កម្រាស់ stroke" unit="px" value={style.outline} min={0} max={12} onChange={(outline) => change({ outline })} />
        </span>
      </Row>
      <Row label="Font shadows">
        <Switch label="Font shadows" checked={style.shadow.on} onChange={(on) => change({ shadow: { ...style.shadow, on } })} />
      </Row>
      {style.shadow.on && (
        <div className="-mt-1 flex items-center gap-2">
          <ColourInput label="ពណ៌ shadow" value={style.shadow.color} onChange={(color) => change({ shadow: { ...style.shadow, color } })} />
          <NumberField label="Shadow x" unit="x" value={style.shadow.x} min={-20} max={20} onChange={(x) => change({ shadow: { ...style.shadow, x } })} />
          <NumberField label="Shadow y" unit="y" value={style.shadow.y} min={-20} max={20} onChange={(y) => change({ shadow: { ...style.shadow, y } })} />
          <NumberField label="Shadow blur" unit="blur" value={style.shadow.blur} min={0} max={20} onChange={(blur) => change({ shadow: { ...style.shadow, blur } })} />
        </div>
      )}
      <Row label="AI keywords highlighter">
        <Switch label="AI keywords highlighter" checked={style.keywords} onChange={(keywords) => change({ keywords })} />
      </Row>
      {/* ពណ៌ទាំងពីរនៅជានិច្ច (អ្នកអភិវឌ្ឍ: "close must still show 2 colour") — ពេលបិទ គ្រាន់តែស្រអាប់;
          ពណ៌នៅតែប្តូរបាន ហើយត្រូវរក្សាទុក សម្រាប់ពេលបើកម្តងទៀត */}
      <div className={`-mt-1 flex flex-col gap-2 ${style.keywords ? '' : 'opacity-50'}`}>
        {style.keywordColors.map((colour, at) => (
          <label key={at} className="flex items-center gap-2 rounded-field bg-raised px-2.5 py-1.5 type-hint text-text-3">
            <ColourInput
              label={`ពណ៌ពាក្យសំខាន់ ${at + 1}`}
              value={colour}
              onChange={(value) => {
                const next: [string, string] = [...style.keywordColors]
                next[at] = value
                change({ keywordColors: next })
              }}
            />
            <span className="tabular-nums">{colour.toUpperCase()}</span>
          </label>
        ))}
        <p className="m-0 type-hint text-text-4">
          {/* អត្ថបទដដែលទាំងបើក និងបិទ: អត្ថបទបន្ថែម " (បិទ...)" រុំជាពីរបន្ទាត់ ហើយរុញ panel (ញាក់) */}
          ពាក្យវែងបំផុតក្នុង cue នីមួយៗ — ពណ៌ទី ១ និងទី ២ ឆ្លាស់គ្នាតាម cue
        </p>
      </div>
      <p className="m-0 flex items-center gap-2 type-hint text-text-4">
        Font ខ្មែរ (Battambang) <Chip>PHASE 2</Chip>
      </p>
    </>
  )
}

function EffectsTab({ style, change }: { style: CaptionStyle; change: (part: Partial<CaptionStyle>) => void }) {
  return (
    <>
      <Heading>Position</Heading>
      <div role="group" aria-label="Position" className="grid grid-cols-4 gap-1.5">
        {(
          [
            ['auto', 'Auto'],
            ['top', 'Top'],
            ['middle', 'Middle'],
            ['bottom', 'Bottom'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={style.position === value}
            onClick={() => change({ position: value })}
            className={`min-h-10 cursor-pointer rounded-button border-0 text-[13px] font-bold ${
              style.position === value ? 'bg-segment text-bg' : 'bg-raised text-text-2'
            } ${focusRing}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="-mt-2 m-0 type-hint text-text-4">Auto: មួយភាគបីខាងក្រោម ហើយលើស្នាមកណ្ដាល ពេលអេក្រង់ចែកជាផ្ទាំង</p>

      <Heading>Animation</Heading>
      <Select aria-label="Animation" value={style.animation} onChange={(event) => change({ animation: event.target.value as CaptionAnimation })}>
        {ANIMATION_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.items.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>

      <Row label="Lines">
        <Segmented
          label="Lines"
          size="sm"
          value={String(style.lines)}
          options={[
            { value: '3', label: 'Three lines' },
            { value: '1', label: 'One line' },
          ]}
          onChange={(value) => change({ lines: value === '1' ? 1 : 3 })}
        />
      </Row>

      <Heading>ពាក្យក្នុងមួយ cue</Heading>
      <Segmented
        label="ពាក្យក្នុងមួយ cue"
        size="sm"
        tone="gold"
        value={String(style.words)}
        options={['2', '3', '4', '5', '6', '7', '8'].map((count) => ({ value: count, label: khmerNumber(count) }))}
        onChange={(value) => change({ words: Number(value) })}
      />

      <Row label="Highlighted word color">
        <ColourInput label="Highlighted word color" value={style.color} onChange={(color) => change({ color })} />
      </Row>
      <div role="group" aria-label="ពណ៌រហ័ស" className="-mt-2 flex flex-wrap gap-2">
        {CAPTION_COLORS.map((option) => {
          const on = option.hex.toLowerCase() === style.color.toLowerCase()
          return (
            <button
              key={option.hex}
              type="button"
              aria-pressed={on}
              aria-label={option.name}
              title={option.name}
              onClick={() => change({ color: option.hex })}
              className={`size-8 cursor-pointer rounded-full border-2 ${on ? 'border-text' : 'border-raised-3'} ${focusRing}`}
              style={{ background: option.hex }}
            />
          )
        })}
      </div>
    </>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <span className="type-label font-semibold text-text-2">{children}</span>
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="type-label text-text-2">{label}</span>
      {children}
    </div>
  )
}

function Toggle({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-field border-0 text-[16px] font-bold ${
        on ? 'bg-segment text-bg' : 'bg-raised text-text-2 hover:bg-raised-2'
      } ${focusRing}`}
    >
      {children}
    </button>
  )
}

function ColourInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="color"
      aria-label={label}
      title={label}
      value={value}
      onChange={(event) => onChange(event.target.value.toUpperCase())}
      className={`size-8 shrink-0 cursor-pointer rounded-full border-2 border-raised-3 bg-transparent p-0 ${focusRing}`}
    />
  )
}

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  unit: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex h-9 min-w-0 items-center gap-1 rounded-field bg-raised px-2 type-hint text-text-3">
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || 0)))}
        className={`w-9 min-w-0 border-0 bg-transparent text-right type-body text-text tabular-nums ${focusRing}`}
      />
      {unit}
    </label>
  )
}
