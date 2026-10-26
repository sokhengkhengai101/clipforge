import type { Motion } from '../api'
import { Segmented, Switch } from '../kit/controls'
import { focusRing } from '../kit/styles'

type Transition = 'punch' | 'hard'

/** ផ្ទាំង Motion (sidebar ខាងស្តាំរបស់ Edit Video) — ៥ ផ្នែក: zoom កាមេរ៉ា, zoom លើពាក្យសំខាន់,
 *  camera shake និង Transition (ផ្លាស់មកពី toolbar). Caption animation នៅ Captions › Effects. ប្រើលើវីដេអូទាំងមូល;
 *  preview បង្ហាញភ្លាមៗ (motionPreview.ts), render ធ្វើពេល Export (`--motion-*`). */
export function MotionPanel({
  motion,
  onChange,
  transition,
  onTransition,
  cutCount,
}: {
  motion: Motion
  onChange: (patch: Partial<Motion>) => void
  transition: Transition
  onTransition: (value: Transition) => void
  cutCount: number
}) {
  return (
    <div className="flex flex-col gap-5">
      <span className="type-label font-semibold">Motion</span>

      <Section title="Camera zoom" hint="zoom យឺតៗក្នុង scene នីមួយៗ — ចាប់ផ្តើមឡើងវិញរាល់ scene">
        <Segmented
          label="Camera zoom"
          size="sm"
          value={motion.zoom}
          onChange={(zoom) => onChange({ zoom })}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'in', label: 'ពង្រីក' },
            { value: 'out', label: 'បង្រួម' },
          ]}
        />
        {motion.zoom !== 'off' && (
          <Slider label="កម្លាំង" value={motion.zoom_amount} min={1} max={20} unit="%" onChange={(zoom_amount) => onChange({ zoom_amount })} />
        )}
      </Section>

      <Section title="Zoom លើពាក្យសំខាន់" hint="zoom ភ្លាមពេលពាក្យសំខាន់ (ពាក្យវែងក្នុង caption) — ឃ្លាតគ្នា ≥ 3 s">
        <div className="flex items-center justify-between">
          <span className="type-body text-text-2">{motion.keywords > 0 ? 'បើក' : 'បិទ'}</span>
          <Switch checked={motion.keywords > 0} onChange={(on) => onChange({ keywords: on ? 8 : 0 })} label="Zoom លើពាក្យសំខាន់" />
        </div>
        {motion.keywords > 0 && (
          <Slider label="កម្លាំង" value={motion.keywords} min={1} max={20} unit="%" onChange={(keywords) => onChange({ keywords })} />
        )}
      </Section>

      <Section title="Camera shake" hint="ញ័រ 0.6% ដូចកាន់កាមេរ៉ាដោយដៃ — គែមរូបត្រូវកាត់ 1.5%">
        <Segmented
          label="Camera shake"
          size="sm"
          value={motion.shake}
          onChange={(shake) => onChange({ shake })}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'loud', label: 'សំឡេងខ្លាំង' },
            { value: 'all', label: 'ពេញវីដេអូ' },
          ]}
        />
      </Section>


      <Section
        title="Transition"
        hint={cutCount ? `នៅកន្លែងកាត់ ${cutCount} កន្លែង` : 'ប្រើពេលអ្នកកាត់ពាក្យ ឬ pause (មិនទាន់មានការកាត់)'}
      >
        <Segmented
          label="Transition"
          size="sm"
          value={transition}
          onChange={onTransition}
          options={[
            { value: 'punch', label: 'Zoom punch-in' },
            { value: 'hard', label: 'Hard cut' },
          ]}
        />
      </Section>
      <p className="m-0 type-hint text-text-4">Preview ប្រហាក់ប្រហែល — Export render ពិតលើវីដេអូទាំងមូល</p>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <span className="type-body font-semibold">{title}</span>
      {children}
      <span className="type-hint text-text-4">{hint}</span>
    </section>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center gap-3 type-hint text-text-3">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className={`min-w-0 flex-1 cursor-pointer accent-gold ${focusRing}`}
      />
      <span className="w-10 text-right tabular-nums text-text">
        {value}
        {unit}
      </span>
    </label>
  )
}
