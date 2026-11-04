import { useEffect, useRef, useState, type ReactNode } from 'react'
import { focusRing } from '../kit/styles'

/* menu តូចៗ (ប៊ូតុង + បញ្ជី) — Auto Subtitles និង Edit Video ប្រើរួមគ្នា. */

/** ប៊ូតុង + ផ្ទាំងបញ្ជីតូច (រូបទី ៣, ៤): បិទពេលចុចខាងក្រៅ ឬ Escape. */
export function MenuButton({
  label,
  icon,
  menuLabel,
  wide = false,
  width,
  up = false,
  flipBelow,
  children,
}: {
  label: string
  icon?: ReactNode
  menuLabel: string
  wide?: boolean
  width?: number // px — ផ្ទាំងធំ (Background) ដែលមានរបាររំកិល
  up?: boolean // បើកឡើងលើប៊ូតុង (drop-up) ជំនួសចុះក្រោម
  flipBelow?: number // px ត្រូវការក្រោមប៊ូតុង: មិនគ្រប់ពេលបើក -> បើកឡើងលើ (footer មិនបាំងបញ្ជី)
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation() // បិទតែបញ្ជី មិនមែន dialog ទាំងមូល
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
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          if (flipBelow) {
            const rect = event.currentTarget.getBoundingClientRect()
            setFlipped(window.innerHeight - rect.bottom < flipBelow && rect.top >= flipBelow)
          }
          setOpen((value) => !value)
        }}
        className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-field border-0 bg-transparent px-2 type-body font-bold text-text hover:bg-raised ${focusRing}`}
      >
        {icon}
        {label}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={menuLabel}
          className={`absolute left-0 z-20 ${up || flipped ? 'bottom-full mb-1' : 'top-full mt-1'} rounded-card border border-line bg-chrome p-2 shadow-[0_16px_40px_rgba(0,0,0,0.5)] ${
            width ? '' : wide ? 'w-[400px]' : 'w-[170px]'
          }`}
          style={width ? { width } : undefined}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  checked,
  disabled = false,
  plainTick = false,
  title,
  onClick,
  children,
}: {
  checked: boolean
  disabled?: boolean
  plainTick?: boolean // ✓ ពណ៌អក្សរ ជំនួសពណ៌មាស
  title?: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-field border-0 bg-transparent px-3 text-left type-body font-semibold text-text hover:bg-raised disabled:cursor-default disabled:text-text-4 disabled:hover:bg-transparent ${focusRing}`}
    >
      <span className={`w-4 shrink-0 ${plainTick ? 'text-text' : 'text-gold'}`}>{checked ? '✓' : ''}</span>
      {children}
    </button>
  )
}

/** ចតុកោណតូចតាម aspect (▯ ▭ □) ដូចរូបទី ៣. */
export function AspectGlyph({ aspect }: { aspect: '9:16' | '1:1' | '16:9' | '4:5' }) {
  const [w, h] = { '9:16': [8, 14], '1:1': [12, 12], '16:9': [15, 9], '4:5': [10, 13] }[aspect]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x={(16 - w) / 2} y={(16 - h) / 2} width={w} height={h} rx="1.5" />
    </svg>
  )
}
