import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { sourceFrameUrl, type Video } from '../api'
import { Button } from '../kit/controls'
import { ArrowRightIcon, UploadIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { useNum, useT } from '../i18n'
import { pickVideo } from './pickFile'

/* ជំហាន ១ "ជ្រើសវីដេអូ" ដែល dialog Long to Short, Auto Subtitles និង Auto Reframe ប្រើរួមគ្នា
 * (workflow តែមួយ: ជ្រើសវីដេអូ -> ការកំណត់ -> Start -> កាតវឌ្ឍនភាពលើ Home). */

// ---------- វីដេអូ ----------

/** រូបដូច OpusClip "Long to shorts": វីដេអូផ្ដេក -> ព្រួញ -> clips បញ្ឈរជាន់គ្នា.
 *  ប្រើ frame **ពិត**ពីវីដេអូគំរូធំជាងគេ (`/probe/frame`) — clips បញ្ឈរជាផ្នែកកាត់នៃ frame ដដែល
 *  (`object-position`) ដែលបង្ហាញអ្វីដែល app ធ្វើពិត. គ្មានវីដេអូគំរូ = រាងពណ៌ token. */
export function Illustration({
  video,
  variant = 'clips',
}: {
  video: Video | null
  // clips = clips បញ្ឈរ ៣ (Long to Short); reframe = បញ្ឈរ ១ (Auto Reframe);
  // subtitles = frame ដដែល ជាមួយ caption (Auto Subtitles)
  variant?: 'clips' | 'reframe' | 'subtitles'
}) {
  // 60 វិ: ក្រោយ intro/logo ដែលវីដេអូវែងភាគច្រើនមាននៅដើម
  const src = video ? sourceFrameUrl(video.path, 60) : null
  const crop = (position: string, className: string) => (
    <span className={`absolute overflow-hidden rounded-[10px] border-2 border-bg bg-raised-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)] ${className}`}>
      {src && <img src={src} alt="" className="size-full object-cover" style={{ objectPosition: position }} />}
    </span>
  )
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-5 py-3">
      <span className="h-[124px] w-[220px] shrink-0 overflow-hidden rounded-[12px] bg-raised-3">
        {src && <img src={src} alt="" className="size-full object-cover" />}
      </span>
      <span className="text-text-4">
        <ArrowRightIcon size={34} />
      </span>
      {variant === 'clips' && (
        <span className="relative h-[176px] w-[190px] shrink-0">
          {crop('85% 50%', 'top-6 right-0 h-[140px] w-[80px]')}
          {crop('76% 50%', 'top-3 right-10 h-[152px] w-[86px]')}
          {crop('25% 50%', 'top-0 left-0 h-[176px] w-[100px]')}
        </span>
      )}
      {variant === 'reframe' && (
        <span className="relative h-[176px] w-[100px] shrink-0">{crop('30% 50%', 'inset-0')}</span>
      )}
      {variant === 'subtitles' && (
        <span className="relative h-[124px] w-[220px] shrink-0 overflow-hidden rounded-[12px] bg-raised-3">
          {src && <img src={src} alt="" className="size-full object-cover" />}
          {/* caption គំរូ: ពាក្យកំពុងនិយាយពណ៌ gold ដូច render */}
          <span className="absolute inset-x-0 bottom-3 text-center text-[13px] leading-tight font-extrabold text-white [-webkit-text-stroke:3px_#000] [paint-order:stroke_fill]">
            HOW YOU CAN <span className="text-gold">USE</span> THE
          </span>
        </span>
      )}
    </div>
  )
}

/** ជំហាន ១ (រូប: "Drop a Twitch link / Upload / Google Drive"): ផ្ទាំងមួយ — ប្រអប់ path ជំនួស link
 *  (app មិនទាញពី internet), "ជ្រើសឯកសារ" = Upload, "វីដេអូគំរូ" ជំនួស Google Drive (គ្មាន upload).
 *  Drop: ផ្ទាំងនេះ (browser) ឬ window ទាំងមូល (app desktop, `dropOver`). */
export function Source({
  videos,
  dropOver,
  onChoose,
  onChoosePath,
  stage,
}: {
  videos: Video[]
  dropOver: boolean
  onChoose: (video: Video) => void
  onChoosePath: (path: string) => void
  stage?: ReactNode // មាន = ប្រអប់ drop ធំពេញកន្លែង (ផ្ទាំង Long to Short) ដែលមានរូប + ចំណងជើងនេះនៅលើ
}) {
  const t = useT()
  const num = useNum()
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState('')
  const [over, setOver] = useState(false)
  const [showSamples, setShowSamples] = useState(false)
  const pathInput = useRef<HTMLInputElement>(null)

  /** ផ្ទាំងជ្រើស file ពិតក្នុង app; browser មិនអាចឲ្យ path ពេញទេ. */
  const pick = async () => {
    try {
      const picked = await pickVideo()
      if (picked === 'browser') {
        setNote(t('Browser មិនអាចអានផ្លូវពេញរបស់ file បានទេ — បិទភ្ជាប់ path ក្នុងប្រអប់។', 'A browser cannot read the full path of a file. Paste the path into the box.'))
        pathInput.current?.focus()
      } else if (picked) {
        setNote('')
        onChoosePath(picked)
      }
    } catch (e) {
      setNote(`${t('បើកផ្ទាំងជ្រើស file មិនបាន', 'Could not open the file picker')}: ${(e as Error).message}`)
    }
  }

  /** drop ក្នុង browser ផ្តល់តែឈ្មោះ file — ប្រៀបនឹង samples/, បើមិនមាន សុំ path. */
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    const match = videos.find((video) => video.name === file.name)
    if (match) {
      setNote('')
      onChoose(match)
    } else {
      setTyped(file.name)
      setNote(t(`${file.name} មិននៅក្នុង samples/ ទេ — browser មិនអាចអានផ្លូវពេញបាន ដូច្នេះបិទភ្ជាប់ path ក្នុងប្រអប់។`, `${file.name} is not in samples/. A browser cannot read its full path, so paste the path into the box.`))
      pathInput.current?.focus()
    }
  }

  const applyPath = () => {
    if (!typed.trim()) return
    setNote('')
    onChoosePath(typed.trim())
  }

  const link = `inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-field border-0 bg-transparent px-2 type-body-lg font-semibold text-text-2 hover:bg-raised-2 hover:text-text ${focusRing}`
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`flex flex-col gap-4 rounded-card border-2 px-7 py-7 ${
        stage
          ? `size-full justify-center overflow-y-auto border-dashed ${over || dropOver ? 'border-gold bg-gold-tint' : 'border-raised-4'}`
          : over || dropOver
            ? 'border-dashed border-gold bg-gold-tint'
            : 'border-transparent bg-raised'
      }`}
    >
      {stage}
      <label className="flex min-h-12 items-center gap-3 rounded-button border border-line bg-bg px-4 text-text-3 focus-within:outline-2 focus-within:outline-solid focus-within:outline-gold">
        <LinkGlyph />
        <input
          id="video-path"
          ref={pathInput}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && applyPath()}
          placeholder={over || dropOver ? t('ទម្លាក់វីដេអូនៅទីនេះ', 'Drop the video here') : t('ទម្លាក់វីដេអូ ឬបិទភ្ជាប់ផ្លូវ file (D:\\videos\\podcast.mp4)', 'Drop a video or paste a file path (D:\\videos\\podcast.mp4)')}
          aria-label={t('ផ្លូវឯកសារវីដេអូ (path)', 'Video file path')}
          spellCheck={false}
          className="min-w-0 flex-1 border-0 bg-transparent type-body-lg text-text outline-none placeholder:text-text-4"
        />
        {typed.trim() && (
          <Button size="sm" variant="primary" onClick={applyPath}>
            {t('ប្រើ', 'Use')}
          </Button>
        )}
      </label>
      <div className={`flex flex-wrap items-center gap-4 ${stage ? 'justify-center' : ''}`}>
        <button type="button" onClick={pick} className={link}>
          <UploadIcon size={18} /> {t('ជ្រើសឯកសារ', 'Choose a file')}
        </button>
        {videos.length > 0 && (
          <button type="button" aria-expanded={showSamples} onClick={() => setShowSamples((value) => !value)} className={link}>
            <FilmGlyph /> {t('វីដេអូគំរូ', 'Sample videos')} ({num(videos.length)})
          </button>
        )}
      </div>
      {showSamples && (
        <div className={`flex flex-wrap gap-1.5 ${stage ? 'justify-center' : ''}`}>
          {videos.map((video) => (
            <button
              key={video.path}
              type="button"
              onClick={() => onChoose(video)}
              className={`min-h-8 cursor-pointer rounded-full border-0 bg-raised-2 px-3 type-hint text-text-2 hover:bg-raised-3 hover:text-text ${focusRing}`}
            >
              {video.name}
            </button>
          ))}
        </div>
      )}
      {note && <p className="type-hint text-warn-text">{note}</p>}
    </div>
  )
}

function LinkGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  )
}

function FilmGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" />
    </svg>
  )
}
