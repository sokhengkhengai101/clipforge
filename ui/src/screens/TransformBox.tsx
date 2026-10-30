import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { focusRing } from '../kit/styles'
import { useT } from '../i18n'
import { SNAP_PX, boxRect, moveBy, scaleSnapped, type Rect, type Transform } from '../transformBox'

const CORNERS: [0 | 1, 0 | 1][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
]
const pct = (value: number) => `${value * 100}%`
const place = (rect: Rect) => ({ left: pct(rect.left), top: pct(rect.top), width: pct(rect.width), height: pct(rect.height) })
const WHOLE: Rect = { left: 0, top: 0, width: 1, height: 1 }

type Drag =
  | { kind: 'move'; start: Transform; from: [number, number] }
  | { kind: 'scale'; start: Transform; corner: [0 | 1, 0 | 1] }

/** Transform video លើ preview (រូប OpusClip):
 *  - ដាក់មេម៉ៅលើវីដេអូ = ស៊ុម + ជ្រុង ៤ ហើយអូសរំកិល / អូសជ្រុងបានភ្លាម — ក្នុង layout ណាក៏ដោយ;
 *  - ជ្រើស (តាំងពីបើក editor ឬចុច) = toolbar តូចពីលើប្រអប់ (✂ Crop / 🖼⌄ Logo, Image);
 *    ចុចកន្លែងណាក៏ដោយក្រៅវីដេអូ = ដកការជ្រើស;
 *  - អូសកណ្តាល = រំកិល (ទាញចូលបន្ទាត់កណ្តាល), អូសជ្រុង = ពង្រីក/បង្រួម (ជ្រុងទល់មុខនៅនឹងកន្លែង).
 *  ក្នុង AI layout (`transform` null) ការអូសដំបូងចាប់ពី `startFrom` (រូបដូច preview បច្ចុប្បន្ន) ហើយ
 *  ក្លាយជា Custom. <video> នៅកន្លែងដដែលក្នុង tree ជានិច្ច (ប្តូរ mode មិនបង្កើតវាថ្មី).
 *  handles / toolbar នៅក្នុង `overlay` (createPortal) ដែលមិនកាត់គែម. */
export function TransformBox({
  transform,
  startFrom,
  sourceRatio,
  stageRatio,
  stage,
  radius,
  selected,
  onSelect,
  onChange,
  onCrop,
  overlay,
  children,
}: {
  transform: Transform | null
  startFrom: Transform // ចំណុចចាប់ផ្តើមពេលកែក្នុង AI layout (ដូចរូបដែលឃើញ)
  sourceRatio: number
  stageRatio: number
  stage: RefObject<HTMLDivElement | null>
  radius: number // ជ្រុងមូល px preview
  selected: boolean
  onSelect: (on: boolean) => void
  onChange: (next: Transform | null) => void
  onCrop: () => void // ✂ — បើក dialog Crop
  overlay: HTMLElement | null
  children: ReactNode
}) {
  const t = useT()
  // menu Logo / Image របស់ប៊ូតុង 🖼
  const [mediaOpen, setMediaOpen] = useState(false)
  const [snapped, setSnapped] = useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  // hover = ស៊ុម + ជ្រុង ៤ ហើយជ្រុងអូសបានភ្លាម (ដូច OpusClip)
  const [hovered, setHovered] = useState(false)
  const leaveTimer = useRef<number | undefined>(undefined)
  // ពេលអូស ទីតាំងថ្មីនៅតែក្នុង component នេះ (draft): EditorScreen ទាំងមូល (transcript, timeline)
  // render ឡើងវិញតែម្តងពេលលែងមេម៉ៅ. មុននេះរាល់ pointermove render វាទាំងមូល: frame យឺតដល់ 417 ms (p95, វាស់)
  const [draft, setDraft] = useState<Transform | null>(null)
  const drag = useRef<Drag | null>(null)
  // បន្ទាត់ណែនាំបង្ហាញតែពេលប្រអប់ "មកស៊ីគ្នា" នឹងបន្ទាត់ — មិនមែនពេលវានៅលើបន្ទាត់នោះតាំងពីចាប់ផ្តើមអូស
  // (ឧ. ប្រអប់នៅកណ្តាល អូសផ្ដេក = បន្ទាត់កណ្តាលផ្ដេកលេចជាប់រហូត). true = បានចាកចេញពីបន្ទាត់ម្តងហើយ
  const leftLine = useRef({ x: false, y: false })
  const shown = draft ?? transform
  const on = shown !== null
  const current = shown ?? startFrom
  const box = on ? boxRect(shown, sourceRatio, stageRatio) : WHOLE

  const at = (event: PointerEvent): [number, number] => {
    const rect = stage.current?.getBoundingClientRect()
    if (!rect) return [0, 0]
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
  }
  const begin = (event: PointerEvent<HTMLElement>, next: Drag) => {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = next
    leftLine.current = { x: false, y: false }
    setMediaOpen(false)
    onSelect(true)
  }
  const onMove = (event: PointerEvent<HTMLElement>) => {
    const now = drag.current
    if (!now) return
    const pointer = at(event)
    if (now.kind === 'move') {
      const dx = pointer[0] - now.from[0]
      const dy = pointer[1] - now.from[1]
      if (!transform && !draft && Math.hypot(dx, dy) < 0.01) return // ចុចធម្មតា (មិនអូស) ក្នុង AI layout = ជ្រើសតែប៉ុណ្ណោះ
      const rect = stage.current?.getBoundingClientRect()
      const within = rect ? { x: SNAP_PX / rect.width, y: SNAP_PX / rect.height } : undefined
      const snappedMove = moveBy(now.start, dx, dy, boxRect(now.start, sourceRatio, stageRatio), within)
      const free = moveBy(now.start, dx, dy, null)
      if (snappedMove.snapped.x === null) leftLine.current.x = true
      if (snappedMove.snapped.y === null) leftLine.current.y = true
      // មិនទាញចូលបន្ទាត់ដែលប្រអប់នៅលើតាំងពីចាប់អូស — មុននេះវាជាប់នៅកណ្តាលរហូតមេម៉ៅរំកិល 20 px ហើយលោត
      const x = leftLine.current.x ? snappedMove : free
      const y = leftLine.current.y ? snappedMove : free
      setSnapped({ x: leftLine.current.x ? snappedMove.snapped.x : null, y: leftLine.current.y ? snappedMove.snapped.y : null })
      setDraft({ ...now.start, x: x.t.x, y: y.t.y })
    } else {
      // អូសជ្រុង: គែមដែលអូសប៉ះគែម frame = ទាញចូល + បន្ទាត់លឿងពេញ
      const rect = stage.current?.getBoundingClientRect()
      const within = rect ? { x: SNAP_PX / rect.width, y: SNAP_PX / rect.height } : { x: 0, y: 0 }
      const result = scaleSnapped(now.start, now.corner, pointer, sourceRatio, stageRatio, within)
      setSnapped(result.snapped)
      setDraft(result.t)
    }
  }
  const onUp = () => {
    drag.current = null
    setSnapped({ x: null, y: null })
    // រក្សាទុកតែម្តង (autosave / undo មួយ). onChange និង setDraft(null) render ជាមួយគ្នា ដូច្នេះមិនលោត
    if (draft) onChange(draft)
    setDraft(null)
  }

  // ពីស៊ុមទៅជ្រុង = leave រួច enter: រង់ចាំ 80 ms មុនលាក់ ដើម្បីកុំឲ្យជ្រុងបាត់ពេលមេម៉ៅឆ្លង
  const enter = () => {
    window.clearTimeout(leaveTimer.current)
    setHovered(true)
  }
  const leave = () => {
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => setHovered(false), 80)
  }
  useEffect(() => () => window.clearTimeout(leaveTimer.current), [])

  // ចុចកន្លែងណាក៏ដោយក្រៅវីដេអូ (transcript, timeline, menu ...) = ដកការជ្រើស.
  // dialog (Crop) មិនរាប់ ព្រោះវាបើកពីប្រអប់នេះ.
  useEffect(() => {
    if (!selected) return
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target as Element | null
      if (target?.closest('[data-transform-ui], [role="dialog"]')) return
      setMediaOpen(false)
      onSelect(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [selected, onSelect])

  const onKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.02 : 0.004
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    if (selected && moves[event.key]) {
      event.preventDefault()
      event.stopPropagation() // កុំឲ្យ timeline / transcript ទទួល
      onChange(moveBy(current, ...moves[event.key], null).t)
    } else if (event.key === 'Escape' && selected) {
      event.stopPropagation()
      setMediaOpen(false)
      onSelect(false)
    }
  }

  // wrapper = ផ្នែកដែលឃើញ; inner = វីដេអូទាំងមូល រំកិលតាម crop
  const wrapperStyle = !on ? { inset: 0 } : { ...place(box), borderRadius: radius, overflow: 'hidden' as const }
  const [cx, cy, cw, ch] = on ? shown.crop : [0, 0, 1, 1]
  const innerStyle = !on
    ? { left: 0, top: 0, width: '100%', height: '100%' }
    : { left: pct(-cx / cw), top: pct(-cy / ch), width: pct(1 / cw), height: pct(1 / ch) }

  return (
    <>
      <div className="absolute" style={wrapperStyle}>
        <div className="absolute" style={innerStyle}>
          {children}
        </div>
      </div>

      {overlay &&
        createPortal(
          <>
            {/* ផ្ទៃចុច / អូសរបស់ប្រអប់ */}
            <div
              data-transform-ui
              role="button"
              tabIndex={0}
              aria-label={t('វីដេអូ (Transform) — អូសដើម្បីរំកិល', 'Video (Transform) — drag to move')}
              aria-pressed={selected}
              onKeyDown={onKey}
              onPointerDown={(event) => begin(event, { kind: 'move', start: current, from: at(event) })}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerEnter={enter}
              onPointerLeave={leave}
              title={selected ? undefined : t('Transform · អូសដើម្បីកែ', 'Transform · drag to edit')}
              className={`pointer-events-auto absolute cursor-move touch-none ${
                selected || hovered || draft ? 'outline-2 outline-white outline-solid' : ''
              } ${focusRing}`}
              style={{ ...place(box), borderRadius: on ? radius : 10 }}
            />

            {/* ជ្រុងទាំង ៤: ឃើញ និងអូសបានពេល hover ឬជ្រើស */}
            {(selected || hovered || draft) &&
              CORNERS.map((corner) => (
                <span
                  key={corner.join('')}
                  data-transform-ui
                  role="slider"
                  aria-label={t(`ទំហំ ${corner[1] ? 'ក្រោម' : 'លើ'}${corner[0] ? 'ស្តាំ' : 'ឆ្វេង'}`, `Resize ${corner[1] ? 'bottom' : 'top'} ${corner[0] ? 'right' : 'left'}`)}
                  aria-valuenow={Math.round(current.scale * 100)}
                  onPointerDown={(event) => begin(event, { kind: 'scale', start: current, corner })}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerEnter={enter}
                  onPointerLeave={leave}
                  className={`pointer-events-auto absolute z-[3] size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-black/40 bg-white shadow ${
                    corner[0] === corner[1] ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
                  }`}
                  style={{ left: pct(box.left + corner[0] * box.width), top: pct(box.top + corner[1] * box.height) }}
                />
              ))}

            {/* បន្ទាត់ណែនាំ: កណ្តាល = ដាច់ៗ; ប៉ះគែម frame (0 / 1) = លឿងពេញ 2 px — ឃើញទាំងពេលប្រអប់នៅក្រៅ frame */}
            {snapped.x !== null && (
              <span aria-hidden="true" data-snap-guide="x" className={`pointer-events-none absolute inset-y-0 z-[2] border-gold ${snapped.x === 0.5 ? 'border-l border-dashed' : 'border-l-2 border-solid'}`} style={{ left: `calc(${pct(snapped.x)} - ${snapped.x === 1 ? 2 : 0}px)` }} />
            )}
            {snapped.y !== null && (
              <span aria-hidden="true" data-snap-guide="y" className={`pointer-events-none absolute inset-x-0 z-[2] border-gold ${snapped.y === 0.5 ? 'border-t border-dashed' : 'border-t-2 border-solid'}`} style={{ top: `calc(${pct(snapped.y)} - ${snapped.y === 1 ? 2 : 0}px)` }} />
            )}

            {/* toolbar តូចពីលើប្រអប់ (រូប OpusClip): ✂ Crop · 🖼⌄ Logo / Image.
                menu នៅ absolute ក្រោម toolbar: មុននេះវានៅក្នុង toolbar ដូច្នេះបើក menu ធ្វើឲ្យ toolbar
                ធំ ហើយលោតកន្លែង. ប្រអប់នៅជិតលើពេក = toolbar នៅក្នុងផ្ទៃ 8 px ពីលើ */}
            {selected && !draft && (
              <div
                data-transform-ui
                role="toolbar"
                aria-label="Transform"
                onPointerDown={(event) => event.stopPropagation()}
                className="pointer-events-auto absolute z-[4] -translate-x-1/2"
                style={{
                  left: `clamp(70px, ${pct(box.left + box.width / 2)}, calc(100% - 70px))`,
                  top: `max(8px, calc(${pct(box.top)} - 54px))`,
                }}
              >
                <div className="flex items-center gap-0.5 rounded-[10px] border border-line bg-chrome/95 p-1 shadow-lg">
                  <IconButton label="Crop" onClick={onCrop}>
                    <CropIcon />
                  </IconButton>
                  {/* 🖼 ⌄ = ប៊ូតុងតែមួយ (ព្រួញជាផ្នែករបស់វា) បើក Logo / Image */}
                  <IconButton label={t('បន្ថែមរូប (Logo / Image)', 'Add image (Logo / Image)')} wide pressed={mediaOpen} onClick={() => setMediaOpen((value) => !value)}>
                    <MediaIcon />
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <path d="M3 4.5l3 3 3-3" />
                    </svg>
                  </IconButton>
                </div>
                {mediaOpen && (
                  <div role="menu" aria-label={t('បន្ថែមរូប', 'Add image')} className="absolute top-full left-1/2 mt-1 w-[180px] -translate-x-1/2 rounded-card border border-line bg-chrome p-1.5 shadow-lg">
                    {/* overlay រូបពិតក្នុង render = ជំហានបន្ទាប់ */}
                    <MoreItem disabled note={t('ជំហានបន្ទាប់', 'Next step')}>
                      Logo
                    </MoreItem>
                    <MoreItem disabled note={t('ជំហានបន្ទាប់', 'Next step')}>
                      Image
                    </MoreItem>
                  </div>
                )}
              </div>
            )}
          </>,
          overlay,
        )}
    </>
  )
}

function IconButton({
  label,
  pressed,
  disabled = false,
  wide = false,
  onClick,
  children,
}: {
  label: string
  pressed?: boolean
  disabled?: boolean
  wide?: boolean // រូប + ព្រួញ (🖼⌄)
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      aria-haspopup={wide ? 'menu' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 ${wide ? 'gap-1 px-2' : 'w-9'} cursor-pointer items-center justify-center rounded-[7px] border-0 disabled:cursor-default disabled:opacity-35 ${
        pressed ? 'bg-raised-2 text-text' : 'bg-transparent text-text hover:bg-field'
      } ${focusRing}`}
    >
      {children}
    </button>
  )
}

function MoreItem({
  onClick,
  disabled = false,
  note,
  children,
}: {
  onClick?: () => void
  disabled?: boolean
  note?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={note}
      onClick={onClick}
      className={`flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-field border-0 bg-transparent px-2.5 text-left type-label font-semibold whitespace-nowrap text-text hover:bg-raised disabled:cursor-default disabled:text-text-4 disabled:hover:bg-transparent ${focusRing}`}
    >
      {children}
      {note && <span className="rounded-[4px] bg-raised-2 px-1.5 text-[10px] font-bold text-text-4">{note}</span>}
    </button>
  )
}

function CropIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 1v11h11M1 4h11v11" />
    </svg>
  )
}

function MediaIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="1.5" y="3" width="12" height="11" rx="2" />
      <path d="M1.5 12l3.5-3.5 3 3 2-2 3.5 3.5M15 1v5M12.5 3.5h5" />
      <circle cx="9.5" cy="6.5" r="1" />
    </svg>
  )
}
