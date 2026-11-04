import { useEffect, useRef, useState } from 'react'
import { api, sourceFrameUrl, type JobStatus, type Video } from '../api'
import { transcribePercent } from '../eta'
import { useNum, useT } from '../i18n'
import { Button } from '../kit/controls'
import { Dialog } from '../kit/Dialog'
import { Source } from './VideoPicker'

/** Edit Video មុនបើក editor (រូប OpusClip "Enhanced Editor experience"): ជ្រើសវីដេអូ -> បើគ្មាន transcript
 *  transcribe ក្នុង dialog នេះ (% ពិតពី Whisper) -> ចប់ = បើក editor ដោយខ្លួនឯង. មាន transcript រួច = បើកភ្លាម. */
export function EditorStartDialog({
  video,
  videos,
  dropOver,
  job,
  starting,
  jobError,
  device,
  whisperModel,
  onPick,
  onStart,
  onStop,
  onOpen,
  onClose,
}: {
  video: Video | null
  videos: Video[]
  dropOver: boolean
  job: JobStatus | null // job ចុងក្រោយរបស់ app (អាចជារបស់វីដេអូផ្សេង)
  starting: boolean
  jobError: string
  device: string
  whisperModel: string
  onPick: (video: Video) => void
  onStart: () => void // ចាប់ផ្តើម --transcribe-only
  onStop: () => void // បញ្ឈប់ job ហើយបិទ dialog
  onOpen: () => void // បើក editor
  onClose: () => void
}) {
  const t = useT()
  const num = useNum()
  const path = video?.path ?? null
  const stem = video ? video.name.replace(/\.[^.]+$/, '') : ''

  // ---- មាន transcript ឬអត់ ----
  const [checkedPath, setCheckedPath] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    let stale = false
    api
      .words(stem)
      .then((answer) => {
        if (stale) return
        if (answer.ready) onOpen()
        else setCheckedPath(path)
      })
      .catch(() => !stale && setCheckedPath(path)) // project មិនទាន់មាន = ត្រូវ transcribe
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- សួរម្តងក្នុងមួយវីដេអូ; onOpen ថ្មីរាល់ render
  }, [path, stem])
  const needsTranscript = path !== null && checkedPath === path

  // ---- job: `waited` = job នេះជារបស់យើង ដូច្នេះ `done` ចាស់ពីមុនមិនបើក editor ដោយខុស ----
  const mine = job && job.video === path ? job : null
  const running = job?.state === 'running'
  const otherRunning = running && !mine
  const waited = useRef(false)
  useEffect(() => {
    if (!needsTranscript || waited.current || otherRunning || starting) return
    waited.current = true
    if (!running) onStart() // job របស់វីដេអូនេះរត់ស្រាប់ = គ្រាន់តែរង់ចាំវា
  }, [needsTranscript, otherRunning, running, starting, onStart])
  const done = mine?.state === 'done'
  useEffect(() => {
    if (done && waited.current) onOpen()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- បើកម្តងពេល job ចប់
  }, [done])

  // X / Escape / ចុចខាងក្រៅ ពេលកំពុង transcribe: សួរសិន (ចុចខុសមិនគួរបញ្ឈប់ job)
  const [asking, setAsking] = useState(false)
  const failed = (needsTranscript && !starting && jobError) || mine?.state === 'failed' ? jobError || mine?.error || t('មើល log', 'see the log') : ''
  const busy = Boolean(video) && !failed
  // ប្រវែងវីដេអូ (សម្រាប់ការប៉ាន់) និងនាឡិកាក្នុង dialog: % ឡើងរាល់ 0.5 s ទោះ Whisper មិនទាន់ប្រាប់អ្វី
  const [length, setLength] = useState<number | null>(null)
  useEffect(() => {
    if (!path) return
    let stale = false
    api.probe(path).then((format) => !stale && setLength(format.seconds ?? null)).catch(() => {})
    return () => {
      stale = true
    }
  }, [path])
  const [elapsed, setElapsed] = useState(0)
  const ticking = mine?.state === 'running'
  useEffect(() => {
    if (!ticking) return
    const timer = window.setInterval(() => setElapsed((value) => value + 0.5), 500)
    return () => window.clearInterval(timer)
  }, [ticking])
  const fraction = mine?.progress.fraction?.transcribe ?? 0
  const percent = transcribePercent({ seconds: length, device, whisperModel, llm: '', clips: 1 }, elapsed, fraction)

  const title = (
    <span className="flex items-center gap-2.5">
      Edit Video <span className="rounded-field bg-raised-2 px-2.5 py-0.5 type-hint font-semibold text-text">{t('ថ្មី', 'New')}</span>
    </span>
  )
  return (
    <Dialog width={640} title={title} onClose={() => (mine?.state === 'running' ? setAsking(true) : onClose())}>
      <p className="-mt-2.5 type-body-lg text-text-3">{t('ជ្រើសវីដេអូ ហើយកែវាតាម transcript។', 'Choose a video and edit it through its transcript.')}</p>
      {!video ? (
        <>
          <EditorArt video={[...videos].sort((a, b) => b.mb - a.mb)[0] ?? null} />
          <Source
            videos={videos}
            dropOver={dropOver}
            onChoose={onPick}
            onChoosePath={(picked) => onPick({ name: picked.split(/[\\/]/).pop() ?? picked, path: picked, mb: 0 })}
          />
          <p className="type-hint text-text-3">{t('វីដេអូនៅលើកុំព្យូទ័រនេះ — គ្មានការ upload និងមិនត្រូវការ credit។', 'Your video stays on this computer: nothing is uploaded and no credits are needed.')}</p>
        </>
      ) : (
        <div className="relative flex h-[330px] flex-col items-center justify-center gap-3 overflow-hidden rounded-card bg-raised px-8 text-center">
          <img
            src={sourceFrameUrl(video.path, 10)}
            alt=""
            onError={(event) => (event.currentTarget.style.display = 'none')}
            className="absolute top-1/2 left-1/2 h-[60%] w-[60%] -translate-x-1/2 -translate-y-1/2 object-cover opacity-40 blur-md"
          />
          <div className="relative flex flex-col items-center gap-3">
            {failed ? (
              <>
                <p className="m-0 type-body-lg font-semibold text-danger">{t('Transcribe មិនបាន', 'Transcribing failed')}</p>
                <p className="m-0 max-h-20 overflow-y-auto type-hint text-text-2">{failed}</p>
                <Button size="sm" variant="primary" onClick={onStart}>
                  {t('សាកម្តងទៀត', 'Try again')}
                </Button>
              </>
            ) : asking ? (
              <>
                <p className="m-0 type-body-lg font-semibold">{t('បញ្ឈប់ការ transcribe?', 'Stop transcribing?')}</p>
                <p className="m-0 type-hint text-text-2">{t('បើកវីដេអូនេះម្តងទៀត វានឹងចាប់ផ្តើមពីដើម។', 'Opening this video again starts over.')}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => setAsking(false)}>
                    {t('បន្ត', 'Keep going')}
                  </Button>
                  <Button size="sm" onClick={onStop}>
                    {t('បញ្ឈប់', 'Stop')}
                  </Button>
                </div>
              </>
            ) : otherRunning ? (
              <p className="m-0 type-body-lg font-semibold">{t('រង់ចាំ job ផ្សេងចប់ (GPU តែមួយ)…', 'Waiting for another job to finish (one GPU)…')}</p>
            ) : (
              <>
                <span className="text-[34px] leading-none font-bold tabular-nums">{mine?.state === 'running' ? `${num(percent)}%` : '…'}</span>
                <p className="m-0 max-w-[400px] type-body-lg font-semibold">
                  {needsTranscript
                    ? t('កំពុង transcribe វីដេអូរបស់អ្នក។ សូមទុក window នេះបើករហូតដល់ចប់។', "We're transcribing your video. Please keep this window open until it's done.")
                    : t('កំពុងពិនិត្យវីដេអូ…', 'Checking the video…')}
                </p>
                {mine?.state === 'running' && (
                  <p className="m-0 type-hint text-text-2">
                    {fraction > 0 ? t('កំពុងបម្លែងសំឡេងជាអក្សរ', 'Turning speech into text') : t('កំពុងរៀបចំសំឡេង និង model · % ប៉ាន់ស្មាន', 'Preparing the audio and speech model · estimated %')}
                  </p>
                )}
              </>
            )}
          </div>
          {busy && (
            <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="absolute inset-x-0 bottom-0 h-1.5 bg-raised-3">
              <div className="h-full bg-text-2 transition-[width]" style={{ width: `${Math.max(2, percent)}%` }} />
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

/** រូប: វីដេអូផ្ដេកមានឧបករណ៍ -> វីដេអូបញ្ឈរមាន caption. frame ពិត; ឧបករណ៍ក្នុងរូបមានពិតទាំងអស់ (CC, កាត់, Italic, Underline, ពណ៌). */
function EditorArt({ video }: { video: Video | null }) {
  const src = video ? sourceFrameUrl(video.path, 60) : null
  const glyph = 'flex size-7 items-center justify-center rounded-[6px] text-[12px] font-semibold text-text'
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-10 py-2">
      <span className="relative ml-8 h-[130px] w-[230px] shrink-0 rounded-[10px] bg-raised-3">
        {src && <img src={src} alt="" className="size-full rounded-[10px] object-cover" />}
        <span className="absolute top-1/2 -left-8 flex -translate-y-1/2 flex-col gap-1 rounded-[10px] bg-raised-2 p-1 shadow-[0_6px_16px_rgba(0,0,0,0.45)]">
          <span className={glyph}>CC</span>
          <span className={glyph}>✂</span>
        </span>
        <span className="absolute -bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-[10px] bg-raised-2 p-1 shadow-[0_6px_16px_rgba(0,0,0,0.45)]">
          <span className={`${glyph} italic`}>I</span>
          <span className={`${glyph} underline`}>U</span>
          <span className="mx-1 size-4 rounded-full bg-gold" />
        </span>
      </span>
      <span className="relative h-[176px] w-[100px] shrink-0 overflow-hidden rounded-[10px] bg-raised-3">
        {src && <img src={src} alt="" className="size-full object-cover" style={{ objectPosition: '30% 50%' }} />}
        <span className="absolute inset-x-0 bottom-5 text-center text-[11px] leading-tight font-extrabold text-white [-webkit-text-stroke:3px_#000] [paint-order:stroke_fill]">
          MULTIPLE LINES <span className="text-gold">CAPTION</span>
        </span>
      </span>
    </div>
  )
}
