import { useEffect, useRef, useState } from 'react'
import { api, sourceFrameUrl, type CleanupSuggestion, type JobStatus, type Video, type VideoFormat } from '../api'
import { Segmented, Switch } from '../kit/controls'
import { Dialog } from '../kit/Dialog'
import { focusRing } from '../kit/styles'
import { normalize, type Cut } from '../cutList'
import { CleanupPanel } from './CleanupPanel'
import { nearestAspect } from './aspects'
import { TranscribeState } from './EditorScreen'
import { clock, khmerNumber } from './khmer'
import type { ReframeSettings } from './ReframeSetup'
import { Illustration, Source } from './VideoPicker'

type Transition = 'punch' | 'hard'

/** អ្វីដែល dialog ផ្ញើទៅ App: ការកាត់ (ពី Speech cleanup) + transition + aspect ដូចវីដេអូ. */
export type SilenceSettings = {
  aspect: ReframeSettings['aspect']
  cuts: Cut[]
  transition: Transition
  captions: boolean
}

/** កាត "លុបភាពស្ងាត់ & អឺ" (ផ្នែក ឃ): Speech cleanup របស់ Edit Video ក្នុង dialog មួយ.
 *
 *  ជំហាន ១ = ជ្រើសវីដេអូ (ដូចឧបករណ៍ផ្សេង); ជំហាន ២ = transcribe ម្តង (បើមិនទាន់មាន), បញ្ជីការស្នើ
 *  ដែលអ្នក**ពិនិត្យ**, transition, subtitles; Export = `--full --cuts` ក្នុងទំហំដើម (`--layout center`,
 *  frame ទាំងមូល គ្មាន reframe). លទ្ធផលជា `full_edit*` របស់ project ដដែល, វីដេអូដើមមិនប្តូរទេ. */
export function SilenceDialog({
  video,
  videos,
  project,
  job,
  busy,
  device,
  dropOver,
  onChoose,
  onChoosePath,
  onClear,
  onTranscribe,
  onStart,
  onClose,
}: {
  video: Video | null
  videos: Video[]
  project: string
  job: JobStatus | null // job --transcribe-only របស់វីដេអូនេះ
  busy: boolean // job ផ្សេងកំពុងរត់
  device: string
  dropOver: boolean
  onChoose: (video: Video) => void
  onChoosePath: (path: string) => void
  onClear: () => void
  onTranscribe: () => void
  onStart: (settings: SilenceSettings) => void
  onClose: () => void
}) {
  const title = 'លុបភាពស្ងាត់ & "អឺ"'
  if (!video) {
    return (
      <Dialog width={640} onClose={onClose} title={title}>
        <p className="-mt-2.5 type-body-lg text-text-3">កាត់ pause វែង និងពាក្យ "um / you know" ចេញ — អ្នកពិនិត្យមុន export។</p>
        <Illustration variant="subtitles" video={[...videos].sort((a, b) => b.mb - a.mb)[0] ?? null} />
        <Source videos={videos} dropOver={dropOver} onChoose={onChoose} onChoosePath={onChoosePath} />
      </Dialog>
    )
  }
  // key: វីដេអូថ្មី = state ថ្មី (ពាក្យ, ការជ្រើស)
  return (
    <SilenceSettingsStep
      key={video.path}
      title={title}
      video={video}
      project={project}
      job={job}
      busy={busy}
      device={device}
      onClear={onClear}
      onTranscribe={onTranscribe}
      onStart={onStart}
      onClose={onClose}
    />
  )
}

function SilenceSettingsStep({
  title,
  video,
  project,
  job,
  busy,
  device,
  onClear,
  onTranscribe,
  onStart,
  onClose,
}: {
  title: string
  video: Video
  project: string
  job: JobStatus | null
  busy: boolean
  device: string
  onClear: () => void
  onTranscribe: () => void
  onStart: (settings: SilenceSettings) => void
  onClose: () => void
}) {
  // transcript មានឬទេ — សួរម្តងទៀតពេល job transcribe ចប់
  const [ready, setReady] = useState<boolean | null>(null)
  const jobDone = job?.state === 'done'
  useEffect(() => {
    let stale = false
    api
      .words(project)
      .then((answer) => !stale && setReady(answer.ready))
      .catch(() => !stale && setReady(false))
    return () => {
      stale = true
    }
  }, [project, jobDone])

  // គ្មាន transcript -> transcribe ម្តង (ដូច editor); ref ព្រោះការចាប់ផ្តើម job ជា side effect
  const asked = useRef(false)
  useEffect(() => {
    if (ready !== false || asked.current || busy || job) return
    asked.current = true
    onTranscribe()
  }, [ready, busy, job, onTranscribe])

  const [format, setFormat] = useState<VideoFormat | null>(null)
  useEffect(() => {
    let stale = false
    api.probe(video.path).then((answer) => !stale && setFormat(answer)).catch(() => {})
    return () => {
      stale = true
    }
  }, [video.path])
  const aspect = nearestAspect(format?.width && format.height ? format.width / format.height : 16 / 9)

  const [picked, setPicked] = useState<CleanupSuggestion[]>([])
  const [transition, setTransition] = useState<Transition>('punch')
  const [captions, setCaptions] = useState(false)
  const seconds = picked.reduce((sum, item) => sum + item.end - item.start, 0)
  const length = format?.seconds ?? 0

  return (
    <Dialog
      width={640}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-[13px] text-text-3">
            {picked.length > 0 && length > 0 ? (
              <>
                <strong className="text-text">{clock(length)}</strong> →{' '}
                <strong className="text-gold">{clock(Math.max(0, length - seconds))}</strong> · {device === 'cuda' ? 'GPU' : 'CPU'} ·
                វីដេអូដើមមិនប្តូរ
              </>
            ) : (
              'វីដេអូដើមមិនប្តូរ — លទ្ធផលជាឯកសារថ្មីក្នុង output/'
            )}
          </p>
          <button
            type="button"
            disabled={busy || !ready || picked.length === 0}
            onClick={() =>
              onStart({
                aspect,
                cuts: normalize(picked.map((item): Cut => [item.start, item.end])),
                transition,
                captions,
              })
            }
            title={busy ? 'មាន job កំពុងរត់' : picked.length === 0 ? 'គ្មានអ្វីត្រូវកាត់' : undefined}
            className={`inline-flex min-h-12 cursor-pointer items-center rounded-[12px] border-0 bg-gold px-6 text-[16px] font-bold text-on-gold disabled:cursor-default disabled:opacity-40 ${focusRing}`}
          >
            {busy ? 'មាន job កំពុងរត់...' : `លុប ${khmerNumber(picked.length)} កន្លែង · Export`}
          </button>
        </div>
      }
    >
      {/* ---- វីដេអូ ---- */}
      <div className="flex items-center gap-3">
        <img
          src={sourceFrameUrl(video.path, length ? Math.min(60, length * 0.1) : 5)}
          alt=""
          className="h-[68px] w-[120px] shrink-0 rounded-[8px] bg-raised-2 object-cover"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate type-body font-semibold">{video.name}</span>
          <span className="type-hint text-text-4 tabular-nums">
            {length ? clock(length) : '…'}
            {format?.width && format.height ? ` · ${Math.min(format.width, format.height)}p · ${aspect}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className={`min-h-9 cursor-pointer rounded-field border-0 bg-raised-2 px-3 type-label text-text hover:bg-raised-3 ${focusRing}`}
        >
          ប្ដូរ
        </button>
      </div>

      {ready === null ? (
        <p className="type-hint text-text-4">…</p>
      ) : !ready ? (
        <TranscribeState job={job} busy={busy} onRetry={onTranscribe} />
      ) : (
        <>
          <CleanupPanel project={project} onChange={setPicked} />
          <div className="flex flex-col gap-1.5">
            <span className="type-hint text-text-3">Transition នៅកន្លែងកាត់</span>
            <Segmented
              label="Transition"
              size="sm"
              value={transition}
              onChange={setTransition}
              options={[
                { value: 'punch', label: 'Zoom punch-in' },
                { value: 'hard', label: 'Hard cut' },
              ]}
            />
            <span className="type-hint text-text-4">
              {transition === 'punch'
                ? 'ផ្នែកឆ្លាស់ 100% / 110% — jump cut មើលទៅដូចការប្តូរកាមេរ៉ា'
                : 'គ្មាន effect — fade សំឡេង 10 ms តែប៉ុណ្ណោះ'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="type-label text-text-2">ដុត subtitles ផង (style លំនាំដើម)</span>
            <Switch checked={captions} onChange={setCaptions} label="Subtitles" />
          </div>
          <p className="m-0 type-hint text-text-4">
            ចង់លុបពាក្យផ្សេងទៀតដោយដៃ? ប្រើ Edit Video — ការលុបនៅទីនោះ និងទីនេះ ជាវីដេអូមួយ project។
          </p>
        </>
      )}
    </Dialog>
  )
}
