import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { imageUrl, type Look } from '../api'
import { focusRing } from '../kit/styles'
import { MenuButton, MenuItem } from './Menu'
import { pickImage } from './pickFile'
import { useT } from '../i18n'

/* menu Background និង Tracker របស់ Edit Video — រចនាតាមរូប OpusClip (អ្នកអភិវឌ្ឍ 2026-10-26).
 * ការកំណត់ទាំងអស់ជា `Look` មួយ (api.ts), ហើយ Export ផ្ញើវាទៅ sidecar ជា flag `--fit-*` / `--no-tracking`. */

type Change = (patch: Partial<Look>) => void

/** ផ្ទាំង Background: Blur (កម្លាំង), Color, Image, Video (Phase 3), ជ្រុងមូល, spacing. */
export function BackgroundMenu({ look, onChange }: { look: Look; onChange: Change }) {
  const t = useT()
  const [typing, setTyping] = useState(false) // browser: គ្មានផ្ទាំងជ្រើស -> វាយ path
  const [path, setPath] = useState('')
  const label = { blur: 'Blur', color: 'Color', image: 'Image' }[look.background]
  const chooseImage = async () => {
    const picked = await pickImage().catch(() => 'browser' as const)
    if (picked === 'browser') setTyping(true)
    else if (picked) onChange({ background: 'image', image: picked })
  }
  return (
    <MenuButton label={`Background: ${label}`} icon={<BackgroundIcon />} menuLabel="Background" width={290}>
      {() => (
        <div className="flex flex-col gap-1">
          <Heading>{t('ជ្រើសរចនាផ្ទៃខាងក្រោយ', 'Choose a background')}</Heading>
          <MenuItem checked={look.background === 'blur'} onClick={() => onChange({ background: 'blur' })}>
            Blur
          </MenuItem>
          {look.background === 'blur' && (
            <Slider label={t('កម្លាំង blur', 'Blur strength')} value={look.blur} max={100} onChange={(blur) => onChange({ blur })} />
          )}
          <MenuItem checked={look.background === 'color'} onClick={() => onChange({ background: 'color' })}>
            Color
          </MenuItem>
          {look.background === 'color' && (
            <label className="flex items-center gap-2 px-3 pb-1 type-hint text-text-3">
              <input
                type="color"
                value={look.color}
                onChange={(event) => onChange({ color: event.target.value.toUpperCase() })}
                aria-label={t('ពណ៌ផ្ទៃ', 'Background colour')}
                className={`h-8 w-12 cursor-pointer rounded-field border-0 bg-transparent p-0 ${focusRing}`}
              />
              <span className="tabular-nums">{look.color}</span>
            </label>
          )}
          <MenuItem
            checked={look.background === 'image'}
            onClick={() => (look.image ? onChange({ background: 'image' }) : void chooseImage())}
          >
            Image
          </MenuItem>
          {(look.background === 'image' || typing) && (
            <div className="flex flex-col gap-1.5 px-3 pb-1">
              {look.image && (
                <span className="flex items-center gap-2">
                  <img src={imageUrl(look.image)} alt="" className="h-9 w-14 rounded-[6px] object-cover" />
                  <span className="min-w-0 flex-1 truncate type-hint text-text-3">{look.image.split(/[\\/]/).pop()}</span>
                </span>
              )}
              {typing ? (
                <form
                  className="flex gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!path.trim()) return
                    onChange({ background: 'image', image: path.trim() })
                    setTyping(false)
                  }}
                >
                  <input
                    value={path}
                    onChange={(event) => setPath(event.target.value)}
                    placeholder="D:\Pictures\bg.jpg"
                    aria-label={t('path រូប', 'Image path')}
                    className={`min-w-0 flex-1 rounded-field border-0 bg-field px-2 py-1.5 type-hint text-text ${focusRing}`}
                  />
                  <button type="submit" className={`cursor-pointer rounded-field border-0 bg-raised-2 px-2 type-hint text-text ${focusRing}`}>
                    {t('ប្រើ', 'Use')}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => void chooseImage()}
                  className={`self-start cursor-pointer rounded-field border-0 bg-raised-2 px-2.5 py-1 type-hint text-text hover:bg-raised-3 ${focusRing}`}
                >
                  {t('ជ្រើសរូប…', 'Choose image…')}
                </button>
              )}
            </div>
          )}
          <MenuItem checked={false} disabled title={t('វីដេអូជាផ្ទៃខាងក្រោយ — Phase 3 (brand kits)', 'A video as the background — Phase 3 (brand kits)')}>
            Video <span className="ml-auto text-[11px] font-bold text-text-4">PHASE 3</span>
          </MenuItem>

          <Heading>{t('កែតម្រូវ', 'Adjust')}</Heading>
          <Slider label="Corner radius" value={look.radius} max={200} onChange={(radius) => onChange({ radius })} />
          <Slider label="Spacing" unit="%" value={look.spacing} max={20} onChange={(spacing) => onChange({ spacing })} />

          <div className="my-1 border-t border-line" />
          {/* render មួយប្រើ look មួយលើគ្រប់ shot Fit — ធីក និងចាក់សោ (ដូច "ប្រើ style លើ clips ទាំងអស់") */}
          <label className="flex items-center gap-2 px-3 py-1 type-body text-text-3" title={t('render មួយប្រើការកំណត់មួយលើគ្រប់ shot Fit', 'One render uses one setting on every Fit shot')}>
            <input type="checkbox" checked disabled className="size-4 accent-gold" />
            Apply to all same layout
          </label>
          <p className="m-0 px-3 pb-1 type-hint text-text-4">{t('មានឥទ្ធិពលលើ shot Fit (slide / រូបស្ងៀម) ពេល reframe', 'Affects Fit shots (slides / still pictures) when reframing')}</p>
        </div>
      )}
    </MenuButton>
  )
}

/** ផ្ទាំង Tracker: manual (ជំហានបន្ទាប់), បិទ scene នេះ, បិទទាំងអស់. */
export function TrackerMenu({
  look,
  scene,
  onChange,
  onManual,
}: {
  look: Look
  scene: [number, number] | null // scene នៅ playhead (ពី /scenes)
  onChange: Change
  onManual: () => void // បើក dialog Manual subject tracking
}) {
  const t = useT()
  const overlaps = (range: [number, number]) => scene !== null && range[0] < scene[1] && range[1] > scene[0]
  const sceneOff = look.no_track.some(overlaps)
  const manual = look.subjects.length ? ` · ${t('ដោយដៃ', 'manual')} ${look.subjects.length}` : ''
  const label = (!look.tracking ? 'OFF' : look.no_track.length ? `ON · ${t('បិទ', 'off')} ${look.no_track.length}` : 'ON') + manual
  return (
    <MenuButton label={`Tracker: ${label}`} icon={<TrackerIcon />} menuLabel="Tracker" width={290}>
      {(close) => (
        <div className="flex flex-col gap-1">
          <MenuItem checked={look.subjects.length > 0} onClick={() => (onManual(), close())}>
            Manual subject tracking
          </MenuItem>
          <MenuItem
            checked={sceneOff}
            disabled={!look.tracking || scene === null}
            title={scene ? `scene ${scene[0].toFixed(1)}-${scene[1].toFixed(1)} s` : t('កំពុងរក scene…', 'Finding scenes…')}
            onClick={() => {
              if (!scene) return
              onChange({
                no_track: sceneOff
                  ? look.no_track.filter((range) => !overlaps(range))
                  : [...look.no_track, scene].sort((a, b) => a[0] - b[0]),
              })
              close()
            }}
          >
            {sceneOff ? t('បើក tracking scene នេះវិញ', 'Turn tracking back on for this scene') : t('បិទ tracking សម្រាប់ scene នេះ', 'Turn tracking off for this scene')}
          </MenuItem>
          <MenuItem checked={!look.tracking} onClick={() => (onChange({ tracking: !look.tracking }), close())}>
            {look.tracking ? t('បិទ tracking ទាំងអស់', 'Turn all tracking off') : t('បើក tracking វិញ', 'Turn tracking back on')}
          </MenuItem>
          <p className="m-0 px-3 pt-1 type-hint text-text-4">
            {t(
              'Tracking = crop រំកិលតាមមុខក្នុង shot. បិទ = crop នៅស្ងៀម. ដោយដៃ = តាមអ្វីដែលអ្នកចុច (ឈ្នះ AI)',
              'Tracking = the crop follows the face in a shot. Off = the crop stays still. Manual = follows what you clicked (wins over the AI)',
            )}
          </p>
        </div>
      )}
    </MenuButton>
  )
}

/** ផ្ទៃខាងក្រោយក្នុង preview (Fit): blur = វីដេអូគូរលើ canvas តូច + CSS blur, color, image.
 *
 *  canvas គូររាល់ frame ពី `<video>` ដដែល (មិនមែនវីដេអូទីពីរ) ដូច្នេះវាតាមពេលជានិច្ច. ការគូរ
 *  វីដេអូពី origin ផ្សេង (127.0.0.1:8765 ក្នុង app) អនុញ្ញាត — អានតែ pixel ទេដែលហាម. */
export function FitBackdrop({
  look,
  player,
  scale,
}: {
  look: Look
  player: RefObject<HTMLVideoElement | null>
  scale: number // px preview ក្នុង 1 px output
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const blurring = look.background === 'blur' || (look.background === 'image' && !look.image)
  useEffect(() => {
    if (!blurring) return
    let frame = 0
    const draw = () => {
      const video = player.current
      const target = canvas.current
      const context = target?.getContext('2d')
      if (video && target && context && video.videoWidth) {
        // scale ឲ្យគ្រប (cover) រួច crop កណ្តាល — ដូច `scale=...:increase,crop` ក្នុង render
        const k = Math.max(target.width / video.videoWidth, target.height / video.videoHeight)
        const w = video.videoWidth * k
        const h = video.videoHeight * k
        context.drawImage(video, (target.width - w) / 2, (target.height - h) / 2, w, h)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [blurring, player])

  if (look.background === 'color') return <div aria-hidden="true" className="absolute inset-0" style={{ background: look.color }} />
  if (look.background === 'image' && look.image)
    return <img aria-hidden="true" alt="" src={imageUrl(look.image)} className="absolute inset-0 size-full object-cover" />
  // boxblur កាំ r (5 ដង) ≈ CSS blur r x 1.2 px នៃ output; scale ទៅ px របស់ preview
  const radius = Math.round(look.blur * 0.6)
  return (
    <canvas
      ref={canvas}
      width={160}
      height={284}
      aria-hidden="true"
      className="absolute inset-0 size-full"
      style={{ filter: radius ? `blur(${(radius * 1.2 * scale).toFixed(1)}px)` : undefined, transform: 'scale(1.06)' }}
    />
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <span className="px-3 pt-1.5 pb-0.5 type-hint text-text-4">{children}</span>
}

function Slider({
  label,
  value,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  max: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-1 px-3 pb-1">
      <span className="type-body font-semibold">{label}</span>
      <span className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={label}
          className={`min-w-0 flex-1 cursor-pointer accent-white ${focusRing}`}
        />
        <span className="flex h-9 w-[74px] items-center justify-center rounded-field bg-raised type-body tabular-nums">
          {value}
          {unit && <span className="ml-1.5 text-text-3">{unit}</span>}
        </span>
      </span>
    </div>
  )
}

function BackgroundIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M2.5 11.5l3.5-3.5 3 3 2-2 2.5 2.5" />
      <circle cx="10.5" cy="5.5" r="1.2" />
    </svg>
  )
}

function TrackerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
    </svg>
  )
}
