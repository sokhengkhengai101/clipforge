import type { ButtonHTMLAttributes, ComponentProps, ReactNode, SelectHTMLAttributes } from 'react'
import { focusRing } from './styles'

/** Control មូលដ្ឋានរបស់ UI ថ្មី (design/TOKENS.md "Components").
 *  តម្លៃនីមួយៗមកពី screens/*.html — ឧ. ប៊ូតុងចម្បងក្នុង Review.html គឺ
 *  `min-height: 44px; padding: 0 22px; border-radius: 10px`.
 *  ច្បាប់ពីរដែលអនុវត្តគ្រប់កន្លែង: **គ្មានស៊ុមលើ form control** (ផ្ទៃពេញជំនួស),
 *  ហើយ focus ពី keyboard តែងមើលឃើញ (outline ពណ៌ gold). */

// ---------- Button ----------

const BUTTON_VARIANT = {
  primary: 'bg-gold text-on-gold font-bold hover:brightness-105',
  secondary: 'bg-field text-text font-semibold hover:bg-raised-2',
  ghost: 'bg-transparent text-text-2 font-semibold hover:bg-field',
  danger: 'bg-danger text-white font-bold hover:brightness-110', // សកម្មភាពលុប (មិនមែន design)
}

/** កម្ពស់: TOKENS.md "36-40 (small), 42-46 (default), 50-56 (primary CTA)". */
const BUTTON_SIZE = {
  sm: 'min-h-10 px-3.5 type-label',
  md: 'min-h-11 px-5.5 type-body',
  lg: 'min-h-13 px-7 type-body-lg',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANT
  size?: keyof typeof BUTTON_SIZE
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-button border-0 disabled:cursor-default disabled:opacity-40 ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${focusRing} ${className}`}
    />
  )
}

// ---------- Field / Select ----------

/** ប្រអប់បញ្ចូល: ផ្ទៃ `field`, គ្មានស៊ុម, 46px (Main.html: `min-height: 46px; padding: 0 14px`). */
// ComponentProps<'input'> រួមមាន `ref` (React 19) — screen Import ត្រូវ focus ប្រអប់នេះ
export function TextField({ className = '', ...rest }: ComponentProps<'input'>) {
  return (
    <input
      {...rest}
      className={`min-h-11.5 rounded-button border-0 bg-field px-3.5 type-body-lg text-text placeholder:text-text-4 ${focusRing} ${className}`}
    />
  )
}

/** `sm` = ប្រអប់តម្រៀបក្នុង Review.html (32px); `md` = កម្ពស់ធម្មតា 44px. */
export function Select({
  size = 'md',
  className = '',
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'sm' | 'md' }) {
  const shape = size === 'sm' ? 'min-h-8 rounded-chip px-1.5 type-hint' : 'min-h-11 rounded-button px-3 type-body'
  return (
    <select
      {...rest}
      className={`cursor-pointer border-0 bg-field text-text ${shape} ${focusRing} ${className}`}
    />
  )
}

// ---------- Segmented ----------

export type Segment<T extends string> = {
  value: T
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean // មិនទាន់រត់បាន (ឧ. ខ្មែរ = Phase 2) — នៅលើអេក្រង់ តែចុចមិនបាន
}

/** ក្រុមប៊ូតុងជ្រើសមួយ (ReframeSetup.html: 42px, gap 8px).
 *  `tone="light"`: ដែលជ្រើស = ផ្ទៃស + អក្សរងងឹត (លំនាំដើមរបស់ TOKENS.md);
 *  `tone="gold"`: ដែលជ្រើស = gold (ការកំណត់ក្នុង Import);
 *  `shape="pill"`: tab ជាគ្រាប់មូល 40px (Projects.html filter);
 *  `size="sm"`: 40px radius 8 — ប៊ូតុងក្នុង fieldset របស់ Main.html (Import). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = 'light',
  shape = 'rounded',
  size = 'md',
  label,
}: {
  options: Segment<T>[]
  value: T
  onChange: (value: T) => void
  tone?: 'light' | 'gold'
  shape?: 'rounded' | 'pill'
  size?: 'md' | 'sm'
  label: string // សម្រាប់ screen reader: ក្រុមនេះជាអ្វី
}) {
  const picked = tone === 'gold' ? 'bg-gold text-on-gold font-bold' : 'bg-segment text-bg font-bold'
  const form =
    shape === 'pill'
      ? 'min-h-10 rounded-full px-4'
      : size === 'sm'
        ? 'min-h-10 rounded-field px-3.5'
        : 'min-h-10.5 rounded-button px-3.5'
  return (
    <div role="group" aria-label={label} className={`flex flex-wrap ${size === 'sm' ? 'gap-1.5' : 'gap-2'}`}>
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            // TOKENS.md: segment ដែលមិនជ្រើស = `raised` (#232936) — Home.html ប្រើដូចគ្នាលើ pill
            className={`inline-flex cursor-pointer items-center gap-1.5 border-0 type-body disabled:cursor-default disabled:opacity-40 ${form} ${
              on ? picked : 'bg-raised text-text-2'
            } ${focusRing}`}
          >
            {option.label}
            {option.hint && <span className="text-[12px] font-normal opacity-80">{option.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}

// ---------- Switch ----------

/** 46×26 (Subtitles.html): បើក = ផ្ទៃស ហើយគ្រាប់ងងឹតនៅខាងស្តាំ.
 *  Design គ្មានស្ថានភាពបិទទេ — រចនាពី token: ផ្ទៃ `raised-3`, គ្រាប់ `text-4` ខាងឆ្វេង. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[26px] w-[46px] shrink-0 cursor-pointer rounded-full border-0 transition-colors disabled:cursor-default disabled:opacity-40 ${
        checked ? 'bg-segment' : 'bg-raised-3'
      } ${focusRing}`}
    >
      <span
        className={`absolute top-[3px] size-5 rounded-full transition-all ${
          checked ? 'right-[3px] bg-bg' : 'right-[23px] bg-text-4'
        }`}
      />
    </button>
  )
}

// ---------- Chip ----------

const CHIP_TONE = {
  neutral: 'bg-raised text-text-2',
  gold: 'bg-gold text-on-gold', // ស្លាក "AI" លើ Home
  info: 'bg-info text-info-ink', // ស្លាក "Agency"
  ok: 'bg-ok-bg text-ok-text', // រួចរាល់
  warn: 'bg-warn-bg text-warn-text', // នាទីតិច, ពាក្យមិនប្រាកដ
}

/** ស្លាកគ្រាប់មូល: ផ្ទៃពណ៌ស្រាល + អក្សរពណ៌ដូចគ្នាតែភ្លឺ (TOKENS.md "Status chips"). */
export function Chip({ tone = 'neutral', children }: { tone?: keyof typeof CHIP_TONE; children: ReactNode }) {
  return (
    // w-fit: ក្នុង flex column ធាតុកូនលាតពេញទទឹង — chip ត្រូវនៅតូចជានិច្ច
    // nowrap: "PHASE 2" ធ្លាប់បែកជាពីរបន្ទាត់ក្នុងកន្លែងតូច (Home hero)
    <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 type-chip whitespace-nowrap ${CHIP_TONE[tone]}`}>
      {children}
    </span>
  )
}

// ---------- Progress ----------

/** របារវឌ្ឍនភាព: track `field`, ផ្ទៃពេញ gold, 10px (Processing.html) ឬ 6px `thin`. */
export function Progress({ value, label, thin }: { value: number; label: string; thin?: boolean }) {
  const percent = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`w-full overflow-hidden rounded-full bg-field ${thin ? 'h-1.5' : 'h-2.5'}`}
    >
      <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  )
}
