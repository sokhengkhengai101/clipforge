import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Dialog } from '../kit/Dialog'
import { focusRing } from '../kit/styles'
import { useT } from '../i18n'
import { cropToRatio, dragCrop, type Crop, type CropHandle } from '../transformBox'

const HANDLES: { handle: CropHandle; left: number; top: number; cursor: string }[] = [
  { handle: 'nw', left: 0, top: 0, cursor: 'nwse-resize' },
  { handle: 'n', left: 0.5, top: 0, cursor: 'ns-resize' },
  { handle: 'ne', left: 1, top: 0, cursor: 'nesw-resize' },
  { handle: 'e', left: 1, top: 0.5, cursor: 'ew-resize' },
  { handle: 'se', left: 1, top: 1, cursor: 'nwse-resize' },
  { handle: 's', left: 0.5, top: 1, cursor: 'ns-resize' },
  { handle: 'sw', left: 0, top: 1, cursor: 'nesw-resize' },
  { handle: 'w', left: 0, top: 0.5, cursor: 'ew-resize' },
]
const pct = (value: number) => `${value * 100}%`

/** Dialog "Crop" (រូប OpusClip): frame ពិតនៃវីដេអូដើម, ប្រអប់ crop ដែលមានជ្រុង ៤ + គែម ៤,
 *  Aspect ratio (Custom = សេរី, ឬជាប់សមាមាត្រ), Reset / Apply. Apply ប្តូរតែ `crop` នៃ Transform —
 *  ប្រអប់នៅលើអេក្រង់រក្សាទីតាំង និងទទឹង. */
export function CropDialog({
  frameUrl,
  sourceRatio,
  initial,
  onEnableLayouts,
  onApply,
  onClose,
}: {
  frameUrl: string // រូបនៃវីដេអូដើមនៅពេលបច្ចុប្បន្ន (/probe/frame)
  sourceRatio: number
  initial: Crop
  onEnableLayouts: () => void // បើក split / three / four ហើយត្រឡប់ទៅ AI layout (Transform បោះចោល)
  onApply: (crop: Crop) => void
  onClose: () => void
}) {
  const t = useT()
  const [crop, setCrop] = useState<Crop>(initial)
  const [ratio, setRatio] = useState<string>('custom')
  const image = useRef<HTMLDivElement>(null)
  const drag = useRef<CropHandle | 'move' | null>(null)
  const from = useRef<{ crop: Crop; u: number; v: number }>({ crop: initial, u: 0, v: 0 })

  // បញ្ជីដូចរូប OpusClip: Custom = សេរី, Original = សមាមាត្រវីដេអូដើម
  const ratios: { value: string; label: string; ratio: number | null }[] = [
    { value: 'custom', label: 'Custom', ratio: null },
    { value: 'original', label: 'Original', ratio: sourceRatio },
    { value: '9:16', label: '9:16', ratio: 9 / 16 },
    { value: '1:1', label: '1:1', ratio: 1 },
    { value: '16:9', label: '16:9', ratio: 16 / 9 },
    { value: '4:3', label: '4:3', ratio: 4 / 3 },
    { value: '9:8', label: '9:8', ratio: 9 / 8 },
    { value: '4:5', label: '4:5', ratio: 4 / 5 },
  ]
  const locked = ratios.find((item) => item.value === ratio)?.ratio ?? null
  // ជ្រើសសមាមាត្រថ្មី = reset: crop ធំបំផុតនៃសមាមាត្រនោះ នៅកណ្តាលរូប (Custom = frame ទាំងមូល).
  // ជ្រើសដដែល = មិនប្តូរ ដើម្បីកុំឲ្យការកែបាត់.
  const choose = (next: string) => {
    if (next === ratio) return
    setRatio(next)
    const value = ratios.find((item) => item.value === next)?.ratio
    setCrop(value ? cropToRatio([0, 0, 1, 1], value, sourceRatio) : [0, 0, 1, 1])
  }

  const at = (event: PointerEvent) => {
    const rect = image.current!.getBoundingClientRect()
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
  }
  const begin = (event: PointerEvent<HTMLElement>, what: CropHandle | 'move') => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = what
    const [u, v] = at(event)
    from.current = { crop, u, v }
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const what = drag.current
    if (!what) return
    const [u, v] = at(event)
    if (what === 'move') {
      const [cx, cy, cw, ch] = from.current.crop
      const x = Math.min(Math.max(0, cx + u - from.current.u), 1 - cw)
      const y = Math.min(Math.max(0, cy + v - from.current.v), 1 - ch)
      setCrop([x, y, cw, ch])
    } else {
      setCrop(dragCrop(from.current.crop, what, u, v, locked, sourceRatio))
    }
  }
  const end = () => {
    drag.current = null
  }

  return (
    <Dialog
      title="Crop"
      width={760}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => {
              setRatio('custom')
              setCrop([0, 0, 1, 1])
            }}
            className={`min-h-10 cursor-pointer rounded-button border-0 bg-raised-2 px-5 type-body font-bold text-text hover:bg-raised-3 ${focusRing}`}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => onApply(crop.map((v) => Math.round(v * 10000) / 10000) as Crop)}
            className={`min-h-10 cursor-pointer rounded-button border-0 bg-white px-5 type-body font-bold text-bg ${focusRing}`}
          >
            Apply
          </button>
        </div>
      }
    >
      {/* បង្ហាញជានិច្ច (រូប OpusClip): Crop = Transform ដោយដៃ ដែលជំនួស AI layout ទាំងមូល ដូច្នេះ
          split / three / four មិនដំណើរការពេល crop ទេ */}
      <p className="-mt-2 m-0 type-body text-text-3">
        {t(
          'ដើម្បីបង្ហាញអ្នកនិយាយច្រើននាក់ សូមបើក layout អ្នកនិយាយច្រើន (split, three, four) ក្នុង editor.',
          'To accommodate multiple speakers, please enable multiple speaker layouts in the editor (split, three, four).',
        )}{' '}
        <button type="button" onClick={onEnableLayouts} className={`cursor-pointer border-0 bg-transparent p-0 type-body font-semibold text-text underline ${focusRing}`}>
          {t('បើក layout', 'Enable layout')}
        </button>
        .
      </p>
      <div className="flex items-center justify-between gap-3">
        <span className="type-body font-bold text-text">Aspect ratio:</span>
        <RatioMenu items={ratios} value={ratio} onChange={choose} />
      </div>
      <div className="flex justify-center px-3 py-3">
        <div
          ref={image}
          className="relative max-h-[52vh] w-full select-none"
          style={{ aspectRatio: sourceRatio }}
        >
          {/* រូប + ផ្នែកស្រអាប់ក្រៅ crop: មានតែស្រទាប់នេះទេដែលកាត់ (overflow-hidden). មុននេះប្រអប់ទាំងមូល
              កាត់ ហើយ crop ដែលប៉ះគែមរូបបានកាត់ជ្រុងពាក់កណ្តាល */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[6px]">
            <img src={frameUrl} alt="" draggable={false} className="size-full object-fill" />
            <div
              className="absolute"
              style={{ left: pct(crop[0]), top: pct(crop[1]), width: pct(crop[2]), height: pct(crop[3]), boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)' }}
            />
          </div>
          {/* ប្រអប់ crop (ស៊ុម + handles) មិនកាត់; អូសកណ្តាល = រំកិល */}
          <div
            role="group"
            aria-label={`Crop ${crop.map((v) => v.toFixed(2)).join(', ')}`}
            onPointerDown={(event) => begin(event, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            className="absolute cursor-move touch-none border-2 border-white"
            style={{ left: pct(crop[0]), top: pct(crop[1]), width: pct(crop[2]), height: pct(crop[3]) }}
          >
            {/* Custom (សេរី) = ៨ ចំណុច; សមាមាត្រជាប់ = តែជ្រុង ៤ (គែមមួយម្ខាងមិនអាចរក្សាសមាមាត្របាន) */}
            {HANDLES.filter(({ handle }) => locked === null || handle.length === 2).map(({ handle, left, top, cursor }) => (
              <span
                key={handle}
                role="slider"
                aria-label={`Crop ${handle}`}
                aria-valuenow={Math.round((handle === 'n' || handle === 's' ? crop[3] : crop[2]) * 100)}
                onPointerDown={(event) => begin(event, handle)}
                onPointerMove={move}
                onPointerUp={end}
                className={`absolute -translate-x-1/2 -translate-y-1/2 touch-none border-2 border-black/50 bg-white ${
                  handle.length === 2 ? 'size-4 rounded-full' : handle === 'n' || handle === 's' ? 'h-2 w-7 rounded-full' : 'h-7 w-2 rounded-full'
                }`}
                style={{ left: pct(left), top: pct(top), cursor }}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

/** dropdown Aspect ratio (រូប OpusClip): ប៊ូតុងមានស៊ុម + បញ្ជីមានរូបរាង និង ✓.
 *  បិទពេលចុចខាងក្រៅ ឬ Escape (Escape បិទតែបញ្ជី មិនមែន dialog). */
function RatioMenu({
  items,
  value,
  onChange,
}: {
  items: { value: string; label: string; ratio: number | null }[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  const current = items.find((item) => item.value === value) ?? items[0]
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Aspect ratio"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
        className={`flex min-h-10 w-[180px] cursor-pointer items-center gap-2.5 rounded-field border border-line bg-raised px-3 type-body font-bold text-text hover:bg-raised-2 ${focusRing}`}
      >
        <RatioIcon item={current} />
        <span className="flex-1 text-left">{current.label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="text-text-3">
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div role="menu" aria-label="Aspect ratio" className="absolute top-full right-0 z-20 mt-1 w-[180px] rounded-card border border-line bg-chrome p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={item.value === value}
              onClick={() => {
                onChange(item.value)
                setOpen(false)
              }}
              className={`flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-field border-0 px-2.5 text-left type-body font-bold text-text ${
                item.value === value ? 'bg-raised-2' : 'bg-transparent hover:bg-raised'
              } ${focusRing}`}
            >
              <RatioIcon item={item} />
              <span className="flex-1">{item.label}</span>
              {item.value === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** រូបតូចនៃសមាមាត្រ: ចតុកោណតាមសមាមាត្រពិត; Custom = ស៊ុមដាច់ៗ + ប្រអប់ក្នុង, Original = ស៊ុមដាច់ៗ. */
function RatioIcon({ item }: { item: { value: string; ratio: number | null } }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true } as const
  if (item.value === 'custom')
    return (
      <svg {...common}>
        <rect x="2" y="2" width="14" height="14" rx="1" strokeDasharray="2 2" />
        <rect x="6" y="6" width="6" height="6" />
      </svg>
    )
  if (item.value === 'original')
    return (
      <svg {...common}>
        <rect x="2" y="2" width="14" height="14" rx="1" strokeDasharray="2.5 2" />
      </svg>
    )
  // ចតុកោណធំបំផុតក្នុង 14x12 ដែលមានសមាមាត្រនេះ
  const ratio = item.ratio ?? 1
  const w = ratio >= 14 / 14 ? 14 : 14 * ratio
  const h = ratio >= 1 ? 14 / ratio : 14
  return (
    <svg {...common}>
      <rect x={9 - w / 2} y={9 - h / 2} width={w} height={h} rx="1" />
    </svg>
  )
}
