import type { Motion } from '../api'
import { Segmented, Switch } from '../kit/controls'
import { focusRing } from '../kit/styles'
import { useT } from '../i18n'

type Transition = 'punch' | 'hard'

/** ផ្ទាំង Motion (sidebar ខាងស្តាំរបស់ Edit Video) — ៥ ផ្នែក: zoom កាមេរ៉ា, zoom លើពាក្យសំខាន់,
 *  camera shake និង Transition (ផ្លាស់មកពី toolbar). Caption animation នៅ Captions › Effects. ប្រើលើវីដេអូទាំងមូល;
 *  preview បង្ហាញភ្លាមៗ (motionPreview.ts), render ធ្វើពេល Export (`--motion-*`). */
export function MotionPanel({
  motion,
  onChange,
  transition,
  onTransition,
  joinCount,
}: {
  motion: Motion
  onChange: (patch: Partial<Motion>) => void
  transition: Transition
  onTransition: (value: Transition) => void
  joinCount: number
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-5">
      <span className="type-label font-semibold">Motion</span>

      <Section title="Camera zoom" hint={t('zoom យឺតៗក្នុង scene នីមួយៗ — ចាប់ផ្តើមឡើងវិញរាល់ scene', 'a slow zoom in each scene — starts again at every scene')}>
        <Segmented
          label="Camera zoom"
          size="sm"
          value={motion.zoom}
          onChange={(zoom) => onChange({ zoom })}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'in', label: t('ពង្រីក', 'In') },
            { value: 'out', label: t('បង្រួម', 'Out') },
          ]}
        />
        {motion.zoom !== 'off' && (
          <Slider label={t('កម្លាំង', 'Strength')} value={motion.zoom_amount} min={1} max={20} unit="%" onChange={(zoom_amount) => onChange({ zoom_amount })} />
        )}
      </Section>

      <Section title={t('Zoom លើពាក្យសំខាន់', 'Keyword zoom')} hint={t('zoom ភ្លាមពេលពាក្យសំខាន់ (ពាក្យវែងក្នុង caption) — ឃ្លាតគ្នា ≥ 3 s', 'a quick zoom on keywords (long words in a caption) — at least 3 s apart')}>
        <div className="flex items-center justify-between">
          <span className="type-body text-text-2">{motion.keywords > 0 ? t('បើក', 'On') : t('បិទ', 'Off')}</span>
          <Switch checked={motion.keywords > 0} onChange={(on) => onChange({ keywords: on ? 8 : 0 })} label={t('Zoom លើពាក្យសំខាន់', 'Keyword zoom')} />
        </div>
        {motion.keywords > 0 && (
          <Slider label={t('កម្លាំង', 'Strength')} value={motion.keywords} min={1} max={20} unit="%" onChange={(keywords) => onChange({ keywords })} />
        )}
      </Section>

      <Section title="Camera shake" hint={t('ញ័រ 0.6% ដូចកាន់កាមេរ៉ាដោយដៃ — គែមរូបត្រូវកាត់ 1.5%', 'a 0.6% shake like a handheld camera — the edges are cropped 1.5%')}>
        <Segmented
          label="Camera shake"
          size="sm"
          value={motion.shake}
          onChange={(shake) => onChange({ shake })}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'loud', label: t('សំឡេងខ្លាំង', 'Loud moments') },
            { value: 'all', label: t('ពេញវីដេអូ', 'Whole video') },
          ]}
        />
      </Section>


      <TransitionSection transition={transition} onTransition={onTransition} joinCount={joinCount} />
      <p className="m-0 type-hint text-text-4">{t('Preview ប្រហាក់ប្រហែល — Export render ពិតលើវីដេអូទាំងមូល', 'An approximate preview — Export renders the real thing over the whole video')}</p>
    </div>
  )
}

/** ផ្ទាំង Transition: បើកពីប៊ូតុងនៅចន្លោះប្លុកលើ timeline. `continuous` = ប្លុកទាំងពីរបន្តពីគ្នាតាមពេល
 *  (Split ប៉ុណ្ណោះ): pipeline ភ្ជាប់វាវិញ ដូច្នេះគ្មាន transition នៅទីនោះទេ. */
export function TransitionPanel({
  transition,
  onTransition,
  joinCount,
  continuous,
  onClose,
}: {
  transition: Transition
  onTransition: (value: Transition) => void
  joinCount: number
  continuous: boolean
  onClose: () => void
}) {
  const t = useT()
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="type-label font-semibold">Transition</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('បិទ', 'Close')}
          className={`flex size-7 cursor-pointer items-center justify-center rounded-field border-0 bg-transparent text-text-3 hover:bg-field hover:text-text ${focusRing}`}
        >
          ✕
        </button>
      </div>
      <TransitionSection transition={transition} onTransition={onTransition} joinCount={joinCount} heading={false} />
      {continuous && (
        <p className="m-0 type-hint text-warn">
          {t('ប្លុកទាំងពីរនេះបន្តពីគ្នាតាមពេល ដូច្នេះគ្មាន transition នៅទីនេះទេ — កាត់ ឬប្តូរលំដាប់ប្លុកជាមុនសិន', 'These two blocks continue in time, so there is no transition here — trim or reorder a block first')}
        </p>
      )}
    </div>
  )
}

/** Transition មួយសម្រាប់វីដេអូទាំងមូល (`--transition`): មិនទាន់ជ្រើសដាច់ដោយឡែកតាមកន្លែងភ្ជាប់ទេ. */
function TransitionSection({ transition, onTransition, joinCount, heading = true }: { transition: Transition; onTransition: (value: Transition) => void; joinCount: number; heading?: boolean }) {
  const t = useT()
  return (
    <Section
      title="Transition"
      heading={heading}
      hint={joinCount ? t(`ប្រើលើកន្លែងភ្ជាប់ទាំង ${joinCount} ក្នុងវីដេអូ`, joinCount === 1 ? 'applies to the 1 join in the video' : `applies to all ${joinCount} joins in the video`) : t('ប្រើពេលអ្នកកាត់ ឬប្តូរលំដាប់ប្លុក (មិនទាន់មានកន្លែងភ្ជាប់)', 'used where you trim or reorder blocks (no joins yet)')}
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
  )
}

function Section({ title, hint, heading = true, children }: { title: string; hint: string; heading?: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      {heading && <span className="type-body font-semibold">{title}</span>}
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
