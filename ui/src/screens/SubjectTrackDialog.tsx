import { useRef, useState } from 'react'
import { api, sourceFrameUrl, sourceUrl, type Look, type PickAnswer, type Video } from '../api'
import { Dialog } from '../kit/Dialog'
import { focusRing } from '../kit/styles'
import { pathAt, trackAt } from '../subjectPath'
import { useNum, useT } from '../i18n'

type Box = [number, number, number, number]

/** "Manual subject tracking" — រចនាតាមរូប OpusClip (អ្នកអភិវឌ្ឍ 2026-10-26).
 *
 *  ចុចលើប្រធានបទក្នុង frame -> sidecar ត្រឡប់ប្រអប់ **Subject** (YOLOX) និង **Area** (ការ៉េជុំវិញ
 *  ចំណុច); អ្នកជ្រើសមួយ, Apply = តាមពេញ scene នោះ (ViT, ~4 s ក្នុង scene 12 s) ហើយប្រអប់
 *  រំកិលតាមផ្លូវពេលចាក់ ដើម្បីឲ្យឃើញថាវាតាមត្រូវ. Scene ដែលមានផ្លូវ = គូសបន្ទាត់ពីក្រោម.
 *  "Whole clip" (រកប្រធានបទដដែលគ្រប់ scene) = ជំហានក្រោយ. */
export function SubjectTrackDialog({
  project,
  video,
  scenes,
  initialTime,
  look,
  onLook,
  onClose,
}: {
  project: string
  video: Video
  scenes: [number, number][]
  initialTime: number
  look: Look
  onLook: (look: Look) => void
  onClose: () => void
}) {
  const t = useT()
  const num = useNum()
  const player = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(initialTime)
  const [playing, setPlaying] = useState(false)
  const [size, setSize] = useState<[number, number] | null>(null)
  const [click, setClick] = useState<{ time: number; x: number; y: number } | null>(null)
  const [pick, setPick] = useState<PickAnswer | null>(null)
  const [mode, setMode] = useState<'subject' | 'area'>('subject')
  const [state, setState] = useState<'idle' | 'picking' | 'tracking'>('idle')
  const [message, setMessage] = useState('')

  const scene = scenes.find(([start, end]) => time >= start && time < end) ?? null
  const track = trackAt(look.subjects, time)

  const seek = (seconds: number) => {
    const node = player.current
    if (node) node.currentTime = seconds
    setTime(seconds)
  }

  // ចុចលើ frame: ចំណុចជាប្រភាគ 0-1 (preview តូចជាងវីដេអូពិត), ផ្អាកវីដេអូ, សួរប្រអប់ពីរ
  const onFrameClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    player.current?.pause()
    // វីដេអូមិនទាន់ផ្ទុក metadata = currentTime នៅ 0 ទោះយើងចង់បាន 36 s -> ប្រើពេលដែលបានបើក
    const node = player.current
    const at = node && node.readyState >= 1 ? node.currentTime : time
    setClick({ time: at, x, y })
    // កុំ setPick(null) នៅទីនេះ: ជួរ Subject/Area បាត់ ហើយលេចវិញ = dialog ញាក់ (អ្នកអភិវឌ្ឍ)
    setMessage('')
    setState('picking')
    api
      .pick(project, { video: video.path, time: at, x, y })
      .then((answer) => {
        setPick(answer)
        setSize(answer.size)
        setMode(answer.subject ? 'subject' : 'area')
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setState('idle'))
  }

  const apply = () => {
    if (!click) return
    setState('tracking')
    setMessage('')
    api
      .track(project, { video: video.path, time: click.time, x: click.x, y: click.y, mode })
      .then((answer) => {
        onLook(answer.look)
        setSize(answer.size)
        const { track: found } = answer
        const covered = found.good_until - found.good_from
        const whole = answer.scene[1] - answer.scene[0]
        setMessage(
          t(
            `តាមបាន ${found.good_from.toFixed(1)}–${found.good_until.toFixed(1)} s ក្នុង scene ${answer.scene[0].toFixed(1)}–${answer.scene[1].toFixed(1)} s `,
            `Followed ${found.good_from.toFixed(1)}–${found.good_until.toFixed(1)} s in the scene ${answer.scene[0].toFixed(1)}–${answer.scene[1].toFixed(1)} s `,
          ) +
            `(${num(found.points.length)} ${t('ចំណុច', 'points')}, ${answer.seconds} s)` +
            (covered < whole * 0.6
              ? t(' — ប្រធានបទត្រូវបាំង ឬរត់ចេញ: crop នៅស្ងៀមក្រៅចន្លោះនោះ', ' — the subject was hidden or left the frame: the crop stays still outside that range')
              : ''),
        )
        setClick(null)
        setPick(null)
        seek(found.good_from)
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setState('idle'))
  }

  const reset = () => {
    if (!scene) return
    api
      .resetTrack(project, scene[0], scene[1])
      .then((saved) => {
        onLook({ ...look, ...saved })
        setClick(null)
        setPick(null)
        setMessage(t('AI នឹងសម្រេច crop សម្រាប់ scene នេះម្តងទៀត', 'The AI will decide the crop for this scene again'))
      })
      .catch((error: Error) => setMessage(error.message))
  }

  // ប្រអប់ក្នុង preview: ភាគរយនៃទំហំវីដេអូ
  const percent = ([x, y, w, h]: Box) =>
    size ? { left: `${(x / size[0]) * 100}%`, top: `${(y / size[1]) * 100}%`, width: `${(w / size[0]) * 100}%`, height: `${(h / size[1]) * 100}%` } : {}
  // ពេលកំពុងរក ចម្លើយចាស់ (ចុចមុន) មិនត្រូវបង្ហាញជាប្រអប់ ឬ Apply ទេ
  const fresh = state === 'picking' ? null : pick
  const chosen: Box | null = fresh ? (mode === 'subject' && fresh.subject ? fresh.subject : fresh.area) : null
  // ផ្លូវដែលរក្សាទុក: ប្រអប់ទំហំពេលចុច រំកិលតាមពេល
  const followed: Box | null = track
    ? (() => {
        const [cx, cy] = pathAt(track, time)
        return [cx - track.box[2] / 2, cy - track.box[3] / 2, track.box[2], track.box[3]]
      })()
    : null
  const total = scenes.length ? scenes[scenes.length - 1][1] : 0

  return (
    <Dialog
      width={1000}
      onClose={onClose}
      title="Manual subject tracking"
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <span className="type-label text-text-3">Track:</span>
          <div role="group" aria-label="Track" className="flex rounded-field border border-line p-0.5">
            <button type="button" aria-pressed="true" className={`min-h-8 rounded-[6px] border-0 bg-raised-2 px-3 type-label font-semibold text-text ${focusRing}`}>
              This scene
            </button>
            <button
              type="button"
              disabled
              title={t('រកប្រធានបទដដែលនៅគ្រប់ scene — ជំហានក្រោយ', 'Find the same subject in every scene — a later step')}
              className="min-h-8 rounded-[6px] border-0 bg-transparent px-3 type-label text-text-4"
            >
              Whole clip
            </button>
          </div>
          <span className="min-w-0 flex-1 type-hint text-text-3">{t('Tips: ប្រធានបទនីមួយៗត្រូវតាមតែក្នុង scene ដែលមានបន្ទាត់ពីក្រោម។', 'Tip: each subject is followed only in the scenes underlined below.')}</span>
          <button
            type="button"
            disabled={!track || state !== 'idle'}
            onClick={reset}
            className={`min-h-10 cursor-pointer rounded-button border-0 bg-raised-2 px-4 type-body font-bold text-text disabled:cursor-default disabled:opacity-40 ${focusRing}`}
          >
            Reset
          </button>
          <button
            type="button"
            disabled={!chosen || state !== 'idle'}
            onClick={apply}
            className={`min-h-10 cursor-pointer rounded-button border-0 bg-white px-5 type-body font-bold text-bg disabled:cursor-default disabled:opacity-40 ${focusRing}`}
          >
            {state === 'tracking' ? t('កំពុងតាម…', 'Tracking…') : 'Apply'}
          </button>
        </div>
      }
    >
      <p className="-mt-2 type-body text-text-3">
        {t('ជ្រើសប្រធានបទ ឬតំបន់ដែលចង់ឲ្យ AI តាម។ ការតាមដានប្រើលើ scene ទាំងមូល។', 'Choose a subject or an area for the AI to follow. Tracking applies to the whole scene.')}
      </p>

      {/* ---- frame ធំ: ចុចលើប្រធានបទ ---- */}
      <div className="flex justify-center">
        <div
          role="button"
          tabIndex={0}
          aria-label={t('ចុចលើប្រធានបទ', 'Click the subject')}
          onClick={onFrameClick}
          onKeyDown={(event) => event.key === ' ' && (event.preventDefault(), playing ? player.current?.pause() : void player.current?.play())}
          className={`relative max-h-[52vh] w-full cursor-crosshair overflow-hidden rounded-[10px] bg-black ${focusRing}`}
          style={{ aspectRatio: size ? `${size[0]} / ${size[1]}` : '16 / 9' }}
        >
          <video
            ref={player}
            src={sourceUrl(video.path)}
            muted
            preload="auto"
            onLoadedMetadata={(event) => {
              // ការកំណត់ពេលមុន metadata មក ត្រូវបានបោះចោល (វាស់: dialog បើកនៅ 0 s ជំនួស 36 s)
              const node = event.currentTarget
              node.currentTime = initialTime
              setSize((current) => current ?? [node.videoWidth, node.videoHeight])
            }}
            onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className="pointer-events-none size-full object-fill"
          />
          {chosen && <span aria-hidden="true" className="absolute rounded-[4px] border-2 border-gold shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" style={percent(chosen)} />}
          {!chosen && followed && (
            <span aria-label={t('ផ្លូវដែលតាមបាន', 'Followed path')} className="absolute rounded-[4px] border-2 border-ok" style={percent(followed as Box)} />
          )}
          {click && (
            <span
              aria-hidden="true"
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-gold"
              style={{ left: `${click.x * 100}%`, top: `${click.y * 100}%` }}
            />
          )}
          {!click && !track && (
            <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[10px] bg-white px-4 py-2.5 type-body text-bg shadow-lg">
              {t('ចុចលើប្រធានបទក្នុង scene ដែលចង់តាម', 'Click the subject to follow in this scene')}
            </span>
          )}
          {state !== 'idle' && (
            <span className="pointer-events-none absolute top-3 left-3 rounded-[6px] bg-black/70 px-2.5 py-1 type-hint text-text">
              {state === 'picking' ? t('កំពុងរកប្រធានបទ…', 'Finding the subject…') : t('កំពុងតាមពេញ scene…', 'Following through the scene…')}
            </span>
          )}
        </div>
      </div>

      {/* ---- Subject / Area: ចុចលើវត្ថុក្នុងដៃមនុស្ស = Area ល្អជាង (វាស់: ចានបាយ) ----
          ជួរនេះ និងបន្ទាត់សារ នៅជានិច្ច (មិនលេច/បាត់): dialog នៅកណ្តាលអេក្រង់ ដូច្នេះកម្ពស់ដែលប្តូរ
          ធ្វើឲ្យវាលោតឡើងចុះរាល់ការចុច ("dialog ញាក់" — អ្នកអភិវឌ្ឍ 2026-10-26) */}
      <div className="flex min-h-8 flex-nowrap items-center gap-2">
        <span className="type-label text-text-3">{t('តាម:', 'Follow:')}</span>
        {(
          [
            ['subject', !pick ? 'Subject' : pick.subject ? `Subject · ${pick.label}` : `Subject · ${t('រកមិនឃើញ', 'not found')}`, !fresh?.subject],
            ['area', `Area · ${t('តំបន់ជុំវិញចំណុចចុច', 'around the click')}`, !fresh],
          ] as const
        ).map(([value, label, disabled]) => (
          <button
            key={value}
            type="button"
            aria-pressed={!!pick && mode === value}
            disabled={disabled}
            onClick={() => setMode(value)}
            className={`min-h-8 shrink-0 cursor-pointer rounded-full border-0 px-3.5 type-label font-semibold disabled:cursor-default disabled:opacity-40 ${
              pick && mode === value ? 'bg-gold text-on-gold' : 'bg-raised text-text-2 hover:bg-raised-2'
            } ${focusRing}`}
          >
            {label}
          </button>
        ))}
        <span className="min-w-0 truncate type-hint text-text-4">
          {pick ? t('វត្ថុក្នុងដៃមនុស្ស (ចាន, កែវ) = Area; មនុស្ស ឬសត្វ = Subject', 'Something held (a plate, a glass) = Area; a person or animal = Subject') : t('ចុចលើ frame ខាងលើជាមុនសិន', 'Click the frame above first')}
        </span>
      </div>
      {/* កម្ពស់ពីរបន្ទាត់ជានិច្ច: សារវែងបំផុត (Apply + ការព្រមាន) មានពីរបន្ទាត់ */}
      <p className="m-0 line-clamp-2 min-h-[3.4em] type-hint text-text-2">{message}</p>

      {/* ---- ▶ + filmstrip របស់ scene ---- */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => (playing ? player.current?.pause() : void player.current?.play())}
          className={`inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-raised-2 text-[16px] text-text hover:bg-raised-3 ${focusRing}`}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="relative flex h-[64px] min-w-0 flex-1 overflow-hidden rounded-[8px] bg-raised p-1">
          {scenes.map(([start, end]) => {
            const tracked = look.subjects.some((item) => item.start < end && item.end > start)
            const here = scene !== null && scene[0] === start
            return (
              <button
                key={start}
                type="button"
                title={`${start.toFixed(1)}–${end.toFixed(1)} s${tracked ? ` · ${t('តាមដានដោយដៃ', 'tracked by hand')}` : ''}`}
                onClick={() => seek(start + Math.min(0.5, (end - start) / 2))}
                className={`relative h-full min-w-0 cursor-pointer overflow-hidden border-0 border-r border-chrome p-0 ${here ? 'outline-2 outline-white -outline-offset-2 outline' : ''} ${focusRing}`}
                style={{ width: `${((end - start) / (total || 1)) * 100}%` }}
              >
                <img src={sourceFrameUrl(video.path, (start + end) / 2)} alt="" loading="lazy" className="size-full object-cover" />
                {tracked && <span aria-label={t('មានផ្លូវ', 'Has a path')} className="absolute right-0 bottom-0 left-0 h-1 bg-gold" />}
              </button>
            )
          })}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white"
            style={{ left: `${(time / (total || 1)) * 100}%` }}
          />
        </div>
      </div>
    </Dialog>
  )
}
